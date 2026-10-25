import { assetLocation, assetResponse, etagMatches, findAsset } from "./framework-server/assets.js";
import type { AssetManifest, AssetReader } from "./framework-server/assets.js";
import type { ServerApp } from "./framework-server/app.js";
import { fetchApp, positiveInteger, publicOriginOf, rebaseRequest, visibleHost } from "./framework-server/fetch-host.js";
import { createDetachedPlatform } from "./framework-server/platform.js";
import type { ServerPlatform } from "./framework-server/platform.js";
import type { SocketPeer } from "./framework-server/socket.js";
import { createSocketUpgradeHandler } from "./framework-server/upgrade.js";
import type { SocketSession, SocketUpgrade, SocketUpgradeHandler } from "./framework-server/upgrade.js";

// Minimal structural views of Bun's globals, so this entry type-checks without @types/bun.

/** The subset of Bun's `ServerWebSocket` used by Meeko. */
export interface BunServerWebSocket {
  readonly data: unknown;
  /** 0 connecting, 1 open, 2 closing, 3 closed. */
  readonly readyState: number;
  /** Bytes sent; -1 when queued behind backpressure; 0 when dropped. */
  send(message: string): number;
  close(code?: number, reason?: string): void;
  getBufferedAmount?(): number;
}

/** The subset of Bun's `Server` passed to `fetch`. */
export interface BunServerLike {
  upgrade(request: Request, options?: { data?: unknown; headers?: HeadersInit }): boolean;
  readonly url?: URL;
}

/** WebSocket options and handlers for `Bun.serve({ websocket })`. */
export interface BunWebSocketHandler {
  open(socket: BunServerWebSocket): void;
  message(socket: BunServerWebSocket, message: string | Uint8Array): void;
  close(socket: BunServerWebSocket, code: number, reason: string): void;
  readonly maxPayloadLength: number;
  readonly backpressureLimit: number;
  readonly closeOnBackpressureLimit: boolean;
  readonly idleTimeout: number;
  readonly sendPings: boolean;
  readonly perMessageDeflate: boolean;
}

/** Spread into `Bun.serve({ hostname, port, ...handlers })`. */
export interface BunServeHandlers {
  fetch(request: Request, server: BunServerLike): Promise<Response | undefined>;
  readonly websocket: BunWebSocketHandler;
}

export interface BunServerOptions {
  /** Overrides the application's `publicOrigin` for HTTP and Socket origin checks. */
  readonly publicOrigin?: string;
  /** Platform passed to each request. Defaults to Bun with `Bun.env`. */
  readonly platform?: ServerPlatform;
  /** Defaults to the application's error observer. */
  readonly onError?: (error: unknown, requestId: string) => void;
  /** Largest inbound frame; Bun closes larger frames. Defaults to the application's Socket limit or 64 KiB. */
  readonly maxPayloadLength?: number;
  /** Outbound bytes queued per peer before a send fails and closes the peer with 1011. Defaults to 1 MiB. */
  readonly backpressureLimit?: number;
  /** Seconds without traffic before Bun closes a peer. Defaults to 60. */
  readonly idleTimeout?: number;
  /** Ping idle peers so live connections are not timed out. Defaults to true. */
  readonly sendPings?: boolean;
}

interface BunGlobal {
  readonly env: Record<string, string | undefined>;
  file(path: string | URL): Blob & { exists(): Promise<boolean> };
}

function bunGlobal(): BunGlobal {
  const bun = (globalThis as { Bun?: BunGlobal }).Bun;
  if (!bun) throw new Error("The Meeko Bun adapter requires the Bun runtime");
  return bun;
}

/** Upgrade state carried in `ws.data`; other sockets on the same server are ignored. */
class MeekoBunSocket {
  session: SocketSession | undefined;
  constructor(readonly upgrade: Extract<SocketUpgrade, { action: "upgrade" }>) {}
}

function bunPeer(socket: BunServerWebSocket): SocketPeer {
  return {
    send(message) {
      if (socket.readyState !== 1) throw new Error("Socket is disconnected");
      const sent = socket.send(message);
      if (sent > 0) return;
      // A slow or dead peer cannot hold memory for the others in its room.
      socket.close(1011, sent === 0 ? "Send failed" : "Backpressure limit exceeded");
      if (sent === 0) throw new Error("Socket send failed");
    },
    close(code, reason) { if (socket.readyState <= 1) socket.close(code, reason); },
    get bufferedAmount() { return socket.getBufferedAmount?.() ?? 0; },
  };
}

/**
 * Serves a Meeko application with `Bun.serve`, including its Socket channels:
 * `Bun.serve({ port, ...createBunServer(app) })`.
 */
export function createBunServer(app: ServerApp, options: BunServerOptions = {}): BunServeHandlers {
  const report = options.onError ?? ((error: unknown, requestId: string) => app.reportError(error, requestId));
  const configuredOrigin = options.publicOrigin ? publicOriginOf(options.publicOrigin) : app.publicOrigin;
  const platform = options.platform ?? createDetachedPlatform((globalThis as { Bun?: BunGlobal }).Bun?.env ?? {}, "bun");
  const maxPayloadLength = positiveInteger(options.maxPayloadLength ?? app.socket?.maxMessageBytes ?? 64 * 1024, "maxPayloadLength");
  const backpressureLimit = positiveInteger(options.backpressureLimit ?? 1024 * 1024, "backpressureLimit");
  const idleTimeout = positiveInteger(options.idleTimeout ?? 60, "idleTimeout");
  const handshakes = new Map<string, SocketUpgradeHandler>();
  const handshakeFor = (origin: string): SocketUpgradeHandler => {
    let handshake = handshakes.get(origin);
    if (!handshake) {
      const socket = app.socket!;
      handshake = createSocketUpgradeHandler({
        hub: socket.hub, publicOrigin: origin, pathnamePrefix: socket.pathnamePrefix, maxPendingBytes: maxPayloadLength,
        onError: (error) => report(error, crypto.randomUUID()),
      });
      handshakes.set(origin, handshake);
    }
    return handshake;
  };
  const meekoSocket = (socket: BunServerWebSocket): MeekoBunSocket | undefined =>
    socket.data instanceof MeekoBunSocket ? socket.data : undefined;
  return {
    async fetch(request, server) {
      if (app.socket && request.headers.has("upgrade")) {
        // Without a configured origin, use the address Bun listens on, never the Host header.
        const listening = server.url ? `${server.url.protocol}//${visibleHost(server.url.hostname)}${server.url.port ? `:${server.url.port}` : ""}` : new URL(request.url).origin;
        let decision: SocketUpgrade;
        try { decision = await handshakeFor(configuredOrigin ?? listening)(request); }
        catch (error) {
          report(error, crypto.randomUUID());
          return new Response(null, { status: 500 });
        }
        if (decision.action === "reject") return new Response(null, { status: decision.status });
        if (decision.action === "upgrade") {
          if (server.upgrade(request, { data: new MeekoBunSocket(decision) })) return undefined;
          return new Response(null, { status: 400 });
        }
      }
      return fetchApp(app, rebaseRequest(request, configuredOrigin), platform, report);
    },
    websocket: {
      open(socket) {
        const state = meekoSocket(socket);
        if (state) state.session = state.upgrade.open(bunPeer(socket));
      },
      message(socket, message) {
        const state = meekoSocket(socket);
        if (!state) return;
        if (typeof message !== "string") { socket.close(1003, "Text messages required"); return; }
        state.session?.receive(message);
      },
      close(socket) {
        meekoSocket(socket)?.session?.closed();
      },
      maxPayloadLength,
      backpressureLimit,
      closeOnBackpressureLimit: false,
      idleTimeout,
      sendPings: options.sendPings ?? true,
      perMessageDeflate: false,
    },
  };
}

export interface BunAssetReaderOptions {
  /** Directory holding the files listed in `assets`, as a path or a `file:` URL. */
  readonly root: string | URL;
  readonly assets: AssetManifest;
}

/** Serves only manifest-listed build files with `Bun.file`, with validators. */
export function createBunAssetReader(options: BunAssetReaderOptions): AssetReader {
  return {
    async get(pathname, request) {
      const record = findAsset(options.assets, pathname, request);
      if (!record) return null;
      if (request.method === "HEAD" || etagMatches(request.headers.get("if-none-match"), record.etag)) {
        return assetResponse(record, request, () => null);
      }
      // Keys come from the build manifest, never from the request.
      const file = bunGlobal().file(assetLocation(options.root, pathname));
      if (!(await file.exists())) throw new Error(`Missing build asset ${pathname}`);
      return assetResponse(record, request, () => file);
    },
  };
}
