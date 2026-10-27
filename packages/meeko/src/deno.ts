import { assetLocation, assetResponse, etagMatches, findAsset } from "./framework-server/assets.js";
import type { AssetManifest, AssetReader } from "./framework-server/assets.js";
import type { ServerApp } from "./framework-server/app.js";
import { setSocketAddress } from "./framework-server/env.js";
import { createTrackedPlatform, fetchApp, positiveInteger, publicOriginOf, rebaseRequest, visibleHost } from "./framework-server/fetch-host.js";
import type { ServerPlatform } from "./framework-server/platform.js";
import type { SocketPeer } from "./framework-server/socket.js";
import { createSocketUpgradeHandler } from "./framework-server/upgrade.js";
import type { SocketSession, SocketUpgrade, SocketUpgradeClose, SocketUpgradeHandler } from "./framework-server/upgrade.js";

// Minimal structural views of the Deno namespace, so this entry type-checks without Deno's types.

interface DenoHttpServer {
  readonly addr: { readonly hostname: string; readonly port: number };
  readonly finished: Promise<void>;
  shutdown(): Promise<void>;
}

interface DenoNamespace {
  serve(
    options: { hostname?: string; port?: number; onListen?(address: { hostname: string; port: number }): void; onError?(error: unknown): Response | Promise<Response> },
    handler: (request: Request, info?: { readonly remoteAddr?: { readonly hostname?: string } }) => Response | Promise<Response>,
  ): DenoHttpServer;
  upgradeWebSocket(request: Request, options?: { idleTimeout?: number }): { socket: WebSocket; response: Response };
  open(path: string | URL, options?: { read?: boolean }): Promise<{ readonly readable: ReadableStream<Uint8Array> }>;
  readonly env: { toObject(): Record<string, string> };
  readonly build: { readonly os: string };
  addSignalListener(signal: string, handler: () => void): void;
  removeSignalListener(signal: string, handler: () => void): void;
}

function denoGlobal(): DenoNamespace {
  const deno = (globalThis as { Deno?: DenoNamespace }).Deno;
  if (!deno) throw new Error("The Meeko Deno adapter requires the Deno runtime");
  return deno;
}

/**
 * Opciones de {@link serveDeno}.
 *
 * @example
 * ```ts
 * import type { ServeDenoOptions } from "@meekojs/meeko/deno";
 *
 * const options: ServeDenoOptions = {
 *   host: Deno.env.get("MEEKO_HOST") ?? "127.0.0.1",
 *   port: Number(Deno.env.get("MEEKO_PORT") ?? 4173),
 *   handleSignals: true,
 * };
 * ```
 */
export interface ServeDenoOptions {
  /** Interfaz en la que escucha. Por defecto, `127.0.0.1`; use `0.0.0.0` para aceptar tráfico remoto. */
  readonly host?: string;
  /** Puerto; 4173 por defecto y `0` elige uno libre. */
  readonly port?: number;
  /** Sustituye al `publicOrigin` de la aplicación en las comprobaciones de Origin de HTTP y Socket. */
  readonly publicOrigin?: string;
  /** Plataforma que recibe cada petición. Por defecto, Deno con `Deno.env`. */
  readonly platform?: ServerPlatform;
  /** Observador de errores; por defecto, el de la aplicación. */
  readonly onError?: (error: unknown, requestId: string) => void;
  /** Mensaje de Socket entrante más grande; los mayores cierran el peer con `1009`. Por defecto, el límite de Socket de la aplicación o 64 KiB. */
  readonly maxMessageBytes?: number;
  /** Segundos sin `pong` antes de que Deno cierre un peer; los pings se envían a la mitad de ese intervalo. Por defecto, 60. */
  readonly idleTimeout?: number;
  /** Cierra de forma ordenada ante `SIGINT` y `SIGTERM` (`SIGINT` y `SIGBREAK` en Windows). */
  readonly handleSignals?: boolean;
}

/**
 * Servidor Deno en marcha que devuelve {@link serveDeno}.
 *
 * @example
 * ```ts
 * const server = await serveDeno(app, { port: 0 });
 * console.log(server.url);
 * await server.close();
 * await server.finished;
 * ```
 */
export interface DenoServer {
  /** URL local en la que escucha. */
  readonly url: string;
  /** Se resuelve cuando el servidor HTTP se ha detenido. */
  readonly finished: Promise<void>;
  /** Cierra los peers de Socket con `1001` y HTTP, espera las tareas en segundo plano y cierra la aplicación. */
  close(): Promise<void>;
}

const encoder = new TextEncoder();

/**
 * Sirve una aplicación de Meeko con `Deno.serve`, incluidos sus canales Socket con
 * `Deno.upgradeWebSocket`. Sólo funciona en Deno.
 *
 * @param app Aplicación de `createServerApp`.
 * @param options Dirección, origen público, límites de Socket y señales.
 * @returns El servidor en marcha.
 * @throws {RangeError} Si el puerto o algún límite no son válidos.
 * @throws {Error} Fuera del runtime de Deno.
 * @example
 * ```ts
 * import { createServerApp } from "@meekojs/meeko/server";
 * import { createDenoAssetReader, serveDeno } from "@meekojs/meeko/deno";
 *
 * const app = await createServerApp({
 *   manifest, load, runtime, production: true,
 *   assets: createDenoAssetReader({ root: new URL("./client/", import.meta.url), assets: manifest.assets ?? {} }),
 * });
 * const server = await serveDeno(app, { host: "0.0.0.0", port: 8000, handleSignals: true });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#deno
 */
export async function serveDeno(app: ServerApp, options: ServeDenoOptions = {}): Promise<DenoServer> {
  const deno = denoGlobal();
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4173;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new RangeError(`Invalid port: ${port}`);
  const report = options.onError ?? ((error: unknown, requestId: string) => app.reportError(error, requestId));
  const configuredOrigin = options.publicOrigin ? publicOriginOf(options.publicOrigin) : app.publicOrigin;
  const maxMessageBytes = positiveInteger(options.maxMessageBytes ?? app.socket?.maxMessageBytes ?? 64 * 1024, "maxMessageBytes");
  const idleTimeout = positiveInteger(options.idleTimeout ?? 60, "idleTimeout");
  const denoPlatform = createTrackedPlatform("deno", deno.env.toObject(), (error) => report(error, crypto.randomUUID()));
  const platform = options.platform ?? denoPlatform;
  const peers = new Set<WebSocket>();
  let handshake: SocketUpgradeHandler | undefined;
  let closing = false;
  let listening!: () => void;
  const ready = new Promise<void>((resolve) => { listening = resolve; });

  const connect = (request: Request, decision: Extract<SocketUpgrade, { action: "upgrade" }>): Response => {
    const { socket, response } = deno.upgradeWebSocket(request, { idleTimeout });
    let session: SocketSession | undefined;
    const peer: SocketPeer = {
      send(message) {
        if (socket.readyState !== WebSocket.OPEN) throw new Error("Socket is disconnected");
        socket.send(message);
      },
      close(code, reason) {
        if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) socket.close(code, reason);
      },
      get bufferedAmount() { return socket.bufferedAmount; },
    };
    peers.add(socket);
    // The hub sees the peer only once it is open, so nothing is sent earlier.
    socket.onopen = () => { session = decision.open(peer); };
    socket.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") { peer.close(1003, "Text messages required"); return; }
      // Deno has no frame limit option; enforce the Socket limit on every message.
      if (event.data.length > maxMessageBytes || encoder.encode(event.data).byteLength > maxMessageBytes) {
        peer.close(1009, "Message too large");
        return;
      }
      session?.receive(event.data);
    };
    socket.onclose = () => {
      peers.delete(socket);
      session?.closed();
    };
    return response;
  };

  /**
   * An auth refusal completes the upgrade only to close with 4401/4403, which a browser can read.
   *
   * The close waits one macrotask after `open`. A Deno server socket that reads a data frame while
   * it is CLOSING drops the connection at once, and the close frame it was writing can be lost: the
   * client then sees 1006. A client that sends as soon as it opens (Meeko's client may emit from its
   * `open` state) often has that frame already queued when `onopen` runs; read while the socket is
   * still OPEN, it is discarded here and the close frame reaches the client. `peers` holds the
   * socket until `onclose`.
   */
  const deny = (request: Request, close: SocketUpgradeClose): Response => {
    const { socket, response } = deno.upgradeWebSocket(request, { idleTimeout });
    peers.add(socket);
    socket.onopen = () => {
      setTimeout(() => { if (socket.readyState === WebSocket.OPEN) socket.close(close.code, close.reason); }, 0);
    };
    socket.onmessage = () => { /* A refused connection never reaches the hub. */ };
    socket.onclose = () => { peers.delete(socket); };
    return response;
  };

  const handler = async (request: Request, info?: { readonly remoteAddr?: { readonly hostname?: string } }): Promise<Response> => {
    setSocketAddress(request, info?.remoteAddr?.hostname);
    await ready;
    if (closing) return new Response(null, { status: 503 });
    if (handshake && request.headers.has("upgrade")) {
      let decision: SocketUpgrade;
      try { decision = await handshake(request); }
      catch (error) {
        report(error, crypto.randomUUID());
        return new Response(null, { status: 500 });
      }
      if (decision.action === "reject") {
        if (decision.close) {
          try { return deny(request, decision.close); }
          catch (error) { report(error, crypto.randomUUID()); }
        }
        return new Response(null, { status: decision.status });
      }
      if (decision.action === "upgrade") {
        try { return connect(request, decision); }
        catch (error) {
          report(error, crypto.randomUUID());
          return new Response(null, { status: 400 });
        }
      }
    }
    return fetchApp(app, rebaseRequest(request, configuredOrigin), platform, report);
  };

  let server: DenoHttpServer;
  try {
    server = deno.serve({
      hostname: host, port,
      onListen() { /* The adapter reports its URL itself. */ },
      onError(error) {
        const requestId = crypto.randomUUID();
        report(error, requestId);
        return new Response(null, { status: 500, headers: { "x-request-id": requestId } });
      },
    }, handler);
  } catch (error) {
    try { await app.close(); }
    catch (cleanupError) { report(cleanupError, crypto.randomUUID()); }
    throw error;
  }
  const url = `http://${visibleHost(host)}:${server.addr.port}`;
  if (app.socket) {
    handshake = createSocketUpgradeHandler({
      hub: app.socket.hub, publicOrigin: configuredOrigin ?? url, pathnamePrefix: app.socket.pathnamePrefix,
      maxPendingBytes: maxMessageBytes,
      onError: (error) => report(error, crypto.randomUUID()),
    });
  }
  listening();

  const signals = deno.build.os === "windows" ? ["SIGINT", "SIGBREAK"] : ["SIGINT", "SIGTERM"];
  const onSignal = (): void => { void close().catch(() => {}); };
  let closed: Promise<void> | undefined;
  const close = (): Promise<void> => {
    closed ??= (async () => {
      closing = true;
      if (options.handleSignals) {
        for (const signal of signals) {
          try { deno.removeSignalListener(signal, onSignal); }
          catch { /* The listener was never added on this platform. */ }
        }
      }
      const failures: unknown[] = [];
      const steps: Array<() => Promise<unknown>> = [
        async () => { for (const peer of peers) peer.close(1001, "Server shutting down"); },
        () => server.shutdown(),
        () => denoPlatform.settle(),
        () => app.close(),
      ];
      for (const step of steps) {
        try { await step(); }
        catch (error) { failures.push(error); report(error, crypto.randomUUID()); }
      }
      if (failures.length) throw failures[0];
    })();
    return closed;
  };
  if (options.handleSignals) {
    for (const signal of signals) {
      try { deno.addSignalListener(signal, onSignal); }
      catch { /* Unsupported signal on this platform. */ }
    }
  }
  return { url, finished: server.finished, close };
}

/**
 * Opciones de {@link createDenoAssetReader}.
 *
 * @example
 * ```ts
 * import type { DenoAssetReaderOptions } from "@meekojs/meeko/deno";
 *
 * const options: DenoAssetReaderOptions = { root: new URL("./client/", import.meta.url), assets: manifest.assets ?? {} };
 * ```
 */
export interface DenoAssetReaderOptions {
  /** Carpeta que contiene los archivos listados en `assets`, como ruta o URL `file:`. */
  readonly root: string | URL;
  /** Manifiesto de los archivos públicos. */
  readonly assets: AssetManifest;
}

/**
 * Sirve con `Deno.open` sólo los archivos del build listados en el manifiesto, en streaming y con
 * `ETag`, `HEAD` y `304`. Sólo funciona en Deno.
 *
 * @param options Carpeta y manifiesto de archivos.
 * @returns El lector de archivos.
 * @example
 * ```ts
 * import { createDenoAssetReader } from "@meekojs/meeko/deno";
 *
 * const assets = createDenoAssetReader({ root: new URL("./client/", import.meta.url), assets: manifest.assets ?? {} });
 * ```
 */
export function createDenoAssetReader(options: DenoAssetReaderOptions): AssetReader {
  return {
    async get(pathname, request) {
      const record = findAsset(options.assets, pathname, request);
      if (!record) return null;
      if (request.method === "HEAD" || etagMatches(request.headers.get("if-none-match"), record.etag)) {
        return assetResponse(record, request, () => null);
      }
      // Keys come from the build manifest, never from the request.
      const file = await denoGlobal().open(assetLocation(options.root, pathname), { read: true });
      return assetResponse(record, request, () => file.readable);
    },
  };
}
