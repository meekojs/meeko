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

export interface NodeListenerOptions {
  /** Receives uncaught handler or response-stream failures with a correlation ID. */
  onError?: (error: unknown, requestId: string) => void;
  /**
   * Public origin used for request URLs instead of the Host header, for example
   * `https://example.com` behind a TLS proxy.
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

/** Adapts a portable Fetch handler to Node 24's HTTP server callback. */
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
        url = new URL(incoming.url ?? "/", publicOrigin ?? `${protocol}://${authority}`);
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
      if (controller.signal.aborted || outgoing.destroyed) return;
      outgoing.writeHead(result.status, nodeResponseHeaders(result.headers));
      if (method === "HEAD" || !result.body) { outgoing.end(); return; }
      const reader = result.body.getReader();
      try {
        while (true) {
          if (controller.signal.aborted || outgoing.destroyed) { await reader.cancel(); return; }
          const chunk = await reader.read();
          if (chunk.done) break;
          if (controller.signal.aborted || outgoing.destroyed) { await reader.cancel(); return; }
          outgoing.write(chunk.value);
        }
      } finally { reader.releaseLock(); }
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

export interface NodeAssetReaderOptions {
  /** Directory holding the files listed in `assets`. */
  readonly root: string;
  readonly assets: AssetManifest;
}

/** Serves only manifest-listed build files from disk, streamed with validators. */
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

export interface ServeNodeOptions {
  /** Interface to bind. Defaults to 127.0.0.1; use 0.0.0.0 to accept remote traffic. */
  readonly host?: string;
  /** Defaults to 4173; 0 selects a free port. */
  readonly port?: number;
  /** Overrides the application's `publicOrigin` for HTTP and Socket origin checks. */
  readonly publicOrigin?: string;
  /** Platform passed to each request. Defaults to Node with `process.env`. */
  readonly platform?: ServerPlatform;
  /** Defaults to the application's error observer. */
  readonly onError?: (error: unknown, requestId: string) => void;
  /** Close gracefully on SIGINT and SIGTERM. */
  readonly handleSignals?: boolean;
}

export interface NodeServer {
  readonly server: Server;
  /** Local URL the server listens on. */
  readonly url: string;
  /** Stops Socket peers and HTTP, waits for background tasks, then closes the application. */
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

/** Serves a Meeko application, including its Socket channels, with Node's HTTP server. */
export async function serveNode(app: ServerApp, options: ServeNodeOptions = {}): Promise<NodeServer> {
  const host = options.host ?? "127.0.0.1";
  const port = options.port ?? 4173;
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) throw new RangeError(`Invalid port: ${port}`);
  const report = options.onError ?? ((error: unknown, requestId: string) => app.reportError(error, requestId));
  const publicOrigin = options.publicOrigin ?? app.publicOrigin;
  const nodePlatform = createNodePlatform((error) => report(error, randomUUID()));
  const platform = options.platform ?? nodePlatform;
  const server = createServer(toNodeListener((request) => app.fetch(request, platform), {
    onError: report, ...(publicOrigin ? { publicOrigin } : {}),
  }));
  let socketServer: NodeWebSocketServer | undefined;
  try {
    await new Promise<void>((done, fail) => {
      server.once("error", fail);
      server.listen(port, host, () => {
        server.off("error", fail);
        done();
      });
    });
  } catch (error) {
    try { await app.close(); }
    catch (cleanupError) { report(cleanupError, randomUUID()); }
    throw error;
  }
  const address = server.address();
  const actualPort = address && typeof address !== "string" ? address.port : port;
  const url = `http://${urlHost(host)}:${actualPort}`;
  if (app.socket) {
    socketServer = attachNodeWebSocketServer({
      server, hub: app.socket.hub,
      publicOrigin: publicOrigin ?? url,
      pathnamePrefix: app.socket.pathnamePrefix,
      ...(app.socket.maxMessageBytes === undefined ? {} : { maxMessageBytes: app.socket.maxMessageBytes }),
      onError: (error) => report(error, randomUUID()),
    });
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
        () => new Promise<void>((done, fail) => server.close((error) => error ? fail(error) : done())),
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
