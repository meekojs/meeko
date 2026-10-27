import { randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { join } from "node:path";
import { Readable } from "node:stream";
import { TLSSocket } from "node:tls";
import { ApiError, errorResponse, observeServerError } from "./framework-server/contracts.js";
import { assetResponse, etagMatches, findAsset } from "./framework-server/assets.js";
import type { AssetManifest, AssetReader } from "./framework-server/assets.js";
import type { ServerApp } from "./framework-server/app.js";
import type { ServerPlatform } from "./framework-server/platform.js";
import { attachNodeWebSocketServer } from "./framework-server/node-websocket.js";
import type { NodeWebSocketServer } from "./framework-server/node-websocket.js";

export { attachNodeWebSocketServer } from "./framework-server/node-websocket.js";
export type { NodeWebSocketOptions, NodeWebSocketServer } from "./framework-server/node-websocket.js";
export { createNodeSocketUpgradeHandler } from "./framework-server/node-upgrade.js";
export type { NodeAcceptedSocket, NodeSocketUpgradeOptions } from "./framework-server/node-upgrade.js";

/**
 * Opciones de {@link toNodeListener}.
 *
 * @example
 * ```ts
 * import type { NodeListenerOptions } from "@meekojs/meeko/node";
 *
 * const options: NodeListenerOptions = {
 *   publicOrigin: "https://example.com",
 *   onError: (error, requestId) => console.error("[node]", requestId, error),
 * };
 * ```
 */
export interface NodeListenerOptions {
  /** Recibe los fallos no capturados del handler o del stream de respuesta con un ID de correlación. */
  onError?: (error: unknown, requestId: string) => void;
  /**
   * Origen público con el que se construyen las URL de las peticiones en lugar de la cabecera
   * `Host`, por ejemplo `https://example.com` tras un proxy TLS.
   */
  publicOrigin?: string;
}

function nodeResponseHeaders(headers: Headers): Record<string, string | string[]> {
  const result: Record<string, string | string[]> = {};
  headers.forEach((value, name) => { result[name] = value; });
  const cookies = headers.getSetCookie();
  if (cookies.length) result["set-cookie"] = cookies;
  return result;
}

function originOf(value: string): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new TypeError(`Invalid publicOrigin: ${value}`); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError("publicOrigin must use HTTP or HTTPS");
  return url.origin;
}

/**
 * Resolves a request-target against its origin. Origin-form targets are
 * assigned as path and query, so `//other.example/x` stays on `base` instead of
 * being read as a scheme-relative URL of another host.
 */
function requestUrl(target: string, base: string): URL {
  if (!target.startsWith("/")) return new URL(target, base);
  const url = new URL(base);
  const query = target.indexOf("?");
  url.pathname = query < 0 ? target : target.slice(0, query);
  url.search = query < 0 ? "" : target.slice(query);
  return url;
}

/**
 * Adapta un handler Fetch portable al callback del servidor HTTP de Node 24. Envía por separado
 * varias cabeceras `Set-Cookie`, cancela el cuerpo si el cliente se desconecta y trata un
 * request-target que empieza por `//` como ruta del origen propio.
 *
 * @param handler Handler Fetch, como `app.fetch`.
 * @param options Origen público y observador de errores.
 * @returns El listener para `http.createServer`.
 * @throws {TypeError} Si `publicOrigin` no es una URL HTTP(S).
 * @example
 * ```ts
 * import { createServer } from "node:http";
 * import { toNodeListener } from "@meekojs/meeko/node";
 *
 * const server = createServer(toNodeListener((request) => app.fetch(request), { publicOrigin: "https://example.com" }));
 * server.listen(3000);
 * ```
 */
export function toNodeListener(handler: (request: Request) => Promise<Response> | Response, options: NodeListenerOptions = {}): (request: IncomingMessage, response: ServerResponse) => void {
  const publicOrigin = options.publicOrigin ? originOf(options.publicOrigin) : undefined;
  return (incoming, outgoing) => {
    let responseRequestId: string | undefined;
    void (async () => {
      const controller = new AbortController();
      const abort = () => controller.abort();
      incoming.once("aborted", abort);
      outgoing.once("close", abort);
      try {
      const authority = incoming.headers.host ?? "localhost";
      const protocol = incoming.socket instanceof TLSSocket ? "https" : "http";
      let url: URL;
      try {
        url = requestUrl(incoming.url || "/", publicOrigin ?? `${protocol}://${authority}`);
        if (publicOrigin && url.origin !== publicOrigin) throw new TypeError("Absolute request target outside publicOrigin");
      }
      catch { throw new ApiError("INVALID_URL", 400); }
      const method = incoming.method ?? "GET";
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      }
      const hasBody = method !== "GET" && method !== "HEAD";
      const request = new Request(url, {
        method, headers, signal: controller.signal,
        ...(hasBody ? { body: Readable.toWeb(incoming) as ReadableStream<Uint8Array>, duplex: "half" as const } : {}),
      });
      const result = await handler(request);
      const candidateRequestId = result.headers.get("x-request-id");
      if (candidateRequestId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidateRequestId)) {
        responseRequestId = candidateRequestId;
      }
      // An unsent body may hold a file handle or a running producer.
      const discard = async (): Promise<void> => { await result.body?.cancel().catch(() => {}); };
      if (controller.signal.aborted || outgoing.destroyed) { await discard(); return; }
      outgoing.writeHead(result.status, nodeResponseHeaders(result.headers));
      if (method === "HEAD" || !result.body) { await discard(); outgoing.end(); return; }
      const reader = result.body.getReader();
      // A client that leaves while the producer is idle must still stop it.
      const cancelOnAbort = (): void => { void reader.cancel().catch(() => {}); };
      controller.signal.addEventListener("abort", cancelOnAbort, { once: true });
      try {
        while (true) {
          if (controller.signal.aborted || outgoing.destroyed) { await reader.cancel(); return; }
          const chunk = await reader.read();
          if (chunk.done) break;
          if (controller.signal.aborted || outgoing.destroyed) { await reader.cancel(); return; }
          outgoing.write(chunk.value);
        }
      } finally {
        controller.signal.removeEventListener("abort", cancelOnAbort);
        reader.releaseLock();
      }
      if (!controller.signal.aborted && !outgoing.destroyed) outgoing.end();
      } finally {
        incoming.off("aborted", abort);
        outgoing.off("close", abort);
      }
    })().catch(async (error: unknown) => {
      const requestId = responseRequestId ?? randomUUID();
      observeServerError(error, requestId, options.onError);
      if (outgoing.destroyed) return;
      const reportSecondary = (failure: unknown): void => {
        if (!Object.is(failure, error)) observeServerError(failure, requestId, options.onError);
      };
      const destroySafely = (cause: unknown): void => {
        try { outgoing.destroy(cause instanceof Error ? cause : undefined); }
        catch (destroyError) {
          if (!Object.is(destroyError, error) && !Object.is(destroyError, cause)) {
            observeServerError(destroyError, requestId, options.onError);
          }
        }
      };
      if (outgoing.headersSent) { destroySafely(error); return; }
      try {
        const failure = errorResponse(error, requestId);
        outgoing.writeHead(failure.status, nodeResponseHeaders(failure.headers));
        outgoing.end(incoming.method === "HEAD" ? undefined : await failure.text());
      } catch (failure) {
        reportSecondary(failure);
        destroySafely(failure);
      }
    });
  };
}

/**
 * Opciones de {@link createNodeAssetReader}.
 *
 * @example
 * ```ts
 * import type { NodeAssetReaderOptions } from "@meekojs/meeko/node";
 *
 * const options: NodeAssetReaderOptions = { root: ".meeko/output/node/client", assets: manifest.assets ?? {} };
 * ```
 */
export interface NodeAssetReaderOptions {
  /** Carpeta que contiene los archivos listados en `assets`. */
  readonly root: string;
  /** Manifiesto de los archivos públicos. */
  readonly assets: AssetManifest;
}

/**
 * Sirve desde el disco sólo los archivos del build listados en el manifiesto, en streaming y con
 * `ETag`, `HEAD` y `304`. Cualquier otra ruta devuelve `null` y nunca se lee.
 *
 * @param options Carpeta y manifiesto de archivos.
 * @returns El lector de archivos.
 * @example
 * ```ts
 * import { fileURLToPath } from "node:url";
 * import { createServerApp } from "@meekojs/meeko/server";
 * import { createNodeAssetReader } from "@meekojs/meeko/node";
 *
 * const root = fileURLToPath(new URL("./client/", import.meta.url));
 * const app = await createServerApp({
 *   manifest, load, runtime, production: true,
 *   assets: createNodeAssetReader({ root, assets: manifest.assets ?? {} }),
 * });
 * ```
 */
export function createNodeAssetReader(options: NodeAssetReaderOptions): AssetReader {
  return {
    async get(pathname, request) {
      const record = findAsset(options.assets, pathname, request);
      if (!record) return null;
      if (request.method === "HEAD" || etagMatches(request.headers.get("if-none-match"), record.etag)) {
        return assetResponse(record, request, () => null);
      }
      // Keys come from the build manifest, never from the request.
      const file = join(options.root, ...pathname.split("/").filter(Boolean).map(decodeURIComponent));
      const handle = await open(file, "r");
      return assetResponse(record, request, () => Readable.toWeb(handle.createReadStream()) as ReadableStream<Uint8Array>);
    },
  };
}

/**
 * Opciones de {@link serveNode}.
 *
 * @example
 * ```ts
 * import type { ServeNodeOptions } from "@meekojs/meeko/node";
 *
 * const options: ServeNodeOptions = {
 *   host: process.env.MEEKO_HOST ?? "127.0.0.1",
 *   port: Number(process.env.MEEKO_PORT ?? 4173),
 *   publicOrigin: process.env.MEEKO_PUBLIC_ORIGIN,
 *   handleSignals: true,
 *   shutdownTimeout: 5_000,
 * };
 * ```
 */
export interface ServeNodeOptions {
  /** Interfaz en la que escucha. Por defecto, `127.0.0.1`; use `0.0.0.0` para aceptar tráfico remoto. */
  readonly host?: string;
  /** Puerto; 4173 por defecto y `0` elige uno libre. */
  readonly port?: number;
  /** Sustituye al `publicOrigin` de la aplicación en las comprobaciones de Origin de HTTP y Socket. */
  readonly publicOrigin?: string;
  /** Plataforma que recibe cada petición. Por defecto, Node con `process.env`. */
  readonly platform?: ServerPlatform;
  /** Observador de errores; por defecto, el de la aplicación. */
  readonly onError?: (error: unknown, requestId: string) => void;
  /** Cierra de forma ordenada ante `SIGINT` y `SIGTERM`. */
  readonly handleSignals?: boolean;
  /**
   * Milisegundos que las respuestas abiertas, como un stream, pueden seguir tras `close()` antes de
   * cortar sus conexiones. Por defecto, 10 000.
   */
  readonly shutdownTimeout?: number;
}

/**
 * Servidor Node en marcha que devuelve {@link serveNode}.
 *
 * @example
 * ```ts
 * const node = await serveNode(app, { port: 0 });
 * console.log(`Escuchando en ${node.url}`);
 * await node.close();
 * ```
 */
export interface NodeServer {
  /** Servidor HTTP de Node. */
  readonly server: Server;
  /** URL local en la que escucha. */
  readonly url: string;
  /** Cierra los peers de Socket y HTTP, espera las tareas en segundo plano y cierra la aplicación. */
  close(): Promise<void>;
}

/** Tracks background work so a graceful shutdown can wait for it. */
function createNodePlatform(onError?: (error: unknown) => void): ServerPlatform<NodeJS.ProcessEnv> & { settle(): Promise<void> } {
  const pending = new Set<Promise<unknown>>();
  return {
    name: "node",
    env: process.env,
    waitUntil(promise) {
      const tracked: Promise<unknown> = Promise.resolve(promise)
        .catch((error: unknown) => onError?.(error))
        .finally(() => pending.delete(tracked));
      pending.add(tracked);
    },
    async settle() { while (pending.size) await Promise.allSettled([...pending]); },
  };
}

function urlHost(host: string): string {
  const visible = host === "0.0.0.0" ? "127.0.0.1" : host === "::" ? "::1" : host;
  return visible.includes(":") ? `[${visible}]` : visible;
}

/**
 * Sirve una aplicación de Meeko con el servidor HTTP de Node, incluidos sus canales Socket (con
 * `ws`). Si el servidor arranca pero falla la conexión de Socket, libera el puerto y cierra la
 * aplicación antes de propagar el error.
 *
 * @param app Aplicación de `createServerApp`.
 * @param options Dirección, origen público, señales y cierre.
 * @returns El servidor en marcha.
 * @example
 * ```ts
 * import { createServerApp } from "@meekojs/meeko/server";
 * import { serveNode } from "@meekojs/meeko/node";
 *
 * const app = await createServerApp({ manifest, load, runtime, production: true });
 * const server = await serveNode(app, { host: "0.0.0.0", port: 3000, publicOrigin: "https://example.com", handleSignals: true });
 * console.log(server.url);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#build-despliegue-y-verificación
 */
export async function serveNode(app: ServerApp, options: ServeNodeOptions = {}): Promise<NodeServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4173;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new RangeError(`Invalid port: ${port}`);
  const shutdownTimeout = options.shutdownTimeout ?? 10_000;
  if (!Number.isFinite(shutdownTimeout) || shutdownTimeout < 0 || shutdownTimeout > 2_147_483_647) {
    throw new RangeError(`Invalid shutdownTimeout: ${shutdownTimeout}`);
  }
  const report = options.onError ?? ((error: unknown, requestId: string) => app.reportError(error, requestId));
  const publicOrigin = options.publicOrigin ?? app.publicOrigin;
  const nodePlatform = createNodePlatform((error) => report(error, randomUUID()));
  const platform = options.platform ?? nodePlatform;
  const server = createServer(toNodeListener((request) => app.fetch(request, platform), {
    onError: report, ...(publicOrigin ? { publicOrigin } : {}),
  }));
  let socketServer: NodeWebSocketServer | undefined;
  let url: string;
  try {
    await new Promise<void>((done, fail) => {
      server.once("error", fail);
      server.listen(port, host, () => {
        server.off("error", fail);
        done();
      });
    });
    const address = server.address();
    const actualPort = address && typeof address !== "string" ? address.port : port;
    url = `http://${urlHost(host)}:${actualPort}`;
    if (app.socket) {
      socketServer = attachNodeWebSocketServer({
        server, hub: app.socket.hub,
        publicOrigin: publicOrigin ?? url,
        pathnamePrefix: app.socket.pathnamePrefix,
        ...(app.socket.maxMessageBytes === undefined ? {} : { maxMessageBytes: app.socket.maxMessageBytes }),
        onError: (error) => report(error, randomUUID()),
      });
    }
  } catch (error) {
    // A partial start must not keep the port bound or the application open.
    if (server.listening) {
      server.closeAllConnections();
      await new Promise<void>((done) => server.close(() => done()));
    }
    try { await app.close(); }
    catch (cleanupError) { report(cleanupError, randomUUID()); }
    throw error;
  }
  let closing: Promise<void> | undefined;
  const onSignal = (): void => { void close().catch(() => {}); };
  const close = (): Promise<void> => {
    closing ??= (async () => {
      if (options.handleSignals) {
        process.off("SIGINT", onSignal);
        process.off("SIGTERM", onSignal);
      }
      const failures: unknown[] = [];
      const steps: Array<() => Promise<unknown>> = [
        () => socketServer?.close() ?? Promise.resolve(),
        () => new Promise<void>((done, fail) => {
          // Open responses get a grace period; then their connections are cut.
          const deadline = setTimeout(() => server.closeAllConnections(), shutdownTimeout);
          server.close((error) => {
            clearTimeout(deadline);
            if (error) fail(error); else done();
          });
        }),
        () => nodePlatform.settle(),
        () => app.close(),
      ];
      for (const step of steps) {
        try { await step(); }
        catch (error) { failures.push(error); report(error, randomUUID()); }
      }
      if (failures.length) throw failures[0];
    })();
    return closing;
  };
  if (options.handleSignals) {
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  }
  return { server, url, close };
}
