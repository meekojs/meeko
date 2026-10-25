import { assetLocation, assetResponse, etagMatches, findAsset } from "./framework-server/assets.js";
import type { AssetManifest, AssetReader } from "./framework-server/assets.js";
import type { ServerApp } from "./framework-server/app.js";
import { createTrackedPlatform, fetchApp, positiveInteger, publicOriginOf, rebaseRequest, visibleHost } from "./framework-server/fetch-host.js";
import type { ServerPlatform } from "./framework-server/platform.js";
import type { SocketPeer } from "./framework-server/socket.js";
import { createSocketUpgradeHandler } from "./framework-server/upgrade.js";
import type { SocketSession, SocketUpgrade, SocketUpgradeHandler } from "./framework-server/upgrade.js";

// Minimal structural views of the Deno namespace, so this entry type-checks without Deno's types.

interface DenoHttpServer {
  readonly addr: { readonly hostname: string; readonly port: number };
  readonly finished: Promise<void>;
  shutdown(): Promise<void>;
}

interface DenoNamespace {
  serve(
    options: { hostname?: string; port?: number; onListen?(address: { hostname: string; port: number }): void; onError?(error: unknown): Response | Promise<Response> },
    handler: (request: Request) => Response | Promise<Response>,
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

export interface ServeDenoOptions {
  /** Interface to bind. Defaults to 127.0.0.1; use 0.0.0.0 to accept remote traffic. */
  readonly host?: string;
  /** Defaults to 4173; 0 selects a free port. */
  readonly port?: number;
  /** Overrides the application's `publicOrigin` for HTTP and Socket origin checks. */
  readonly publicOrigin?: string;
  /** Platform passed to each request. Defaults to Deno with `Deno.env`. */
  readonly platform?: ServerPlatform;
  /** Defaults to the application's error observer. */
  readonly onError?: (error: unknown, requestId: string) => void;
  /** Largest inbound Socket message; larger messages close the peer with 1009. Defaults to the application's Socket limit or 64 KiB. */
  readonly maxMessageBytes?: number;
  /** Seconds without a pong before Deno closes a peer; pings are sent at half this interval. Defaults to 60. */
  readonly idleTimeout?: number;
  /** Close gracefully on SIGINT and SIGTERM (SIGINT and SIGBREAK on Windows). */
  readonly handleSignals?: boolean;
}

export interface DenoServer {
  /** Local URL the server listens on. */
  readonly url: string;
  /** Resolves once the HTTP server has stopped. */
  readonly finished: Promise<void>;
  /** Stops Socket peers and HTTP, waits for background tasks, then closes the application. */
  close(): Promise<void>;
}

const encoder = new TextEncoder();

/** Serves a Meeko application, including its Socket channels, with `Deno.serve`. */
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

  const handler = async (request: Request): Promise<Response> => {
    await ready;
    if (closing) return new Response(null, { status: 503 });
    if (handshake && request.headers.has("upgrade")) {
      let decision: SocketUpgrade;
      try { decision = await handshake(request); }
      catch (error) {
        report(error, crypto.randomUUID());
        return new Response(null, { status: 500 });
      }
      if (decision.action === "reject") return new Response(null, { status: decision.status });
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

export interface DenoAssetReaderOptions {
  /** Directory holding the files listed in `assets`, as a path or a `file:` URL. */
  readonly root: string | URL;
  readonly assets: AssetManifest;
}

/** Serves only manifest-listed build files with `Deno.open`, streamed with validators. */
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
