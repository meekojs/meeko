import { assetLocation, assetResponse, etagMatches, findAsset } from "./framework-server/assets.js";
import type { AssetManifest, AssetReader } from "./framework-server/assets.js";
import type { ServerApp } from "./framework-server/app.js";
import { fetchApp, positiveInteger, publicOriginOf, rebaseRequest, visibleHost } from "./framework-server/fetch-host.js";
import { createDetachedPlatform } from "./framework-server/platform.js";
import type { ServerPlatform } from "./framework-server/platform.js";
import type { SocketPeer } from "./framework-server/socket.js";
import { createSocketUpgradeHandler } from "./framework-server/upgrade.js";
import type { SocketSession, SocketUpgrade, SocketUpgradeClose, SocketUpgradeHandler } from "./framework-server/upgrade.js";

// Minimal structural views of Bun's globals, so this entry type-checks without @types/bun.

/**
 * Parte del `ServerWebSocket` de Bun que usa Meeko. Es un tipo estructural para que la entrada
 * compile sin `@types/bun`.
 *
 * @example
 * ```ts
 * import type { BunServerWebSocket } from "@meekojs/meeko/bun";
 *
 * const isOpen = (socket: BunServerWebSocket): boolean => socket.readyState === 1;
 * ```
 */
export interface BunServerWebSocket {
  /** Datos asociados en el upgrade. */
  readonly data: unknown;
  /** 0 conectando, 1 abierto, 2 cerrando, 3 cerrado. */
  readonly readyState: number;
  /** Bytes enviados; -1 si queda en cola por contrapresión; 0 si se descarta. */
  send(message: string): number;
  /** Cierra la conexión. */
  close(code?: number, reason?: string): void;
  /** Bytes salientes pendientes. */
  getBufferedAmount?(): number;
}

/**
 * Parte del `Server` de Bun que recibe `fetch`.
 *
 * @example
 * ```ts
 * import type { BunServerLike } from "@meekojs/meeko/bun";
 *
 * const origin = (server: BunServerLike): string | undefined => server.url?.origin;
 * ```
 */
export interface BunServerLike {
  /** Hace el upgrade a WebSocket de una petición. */
  upgrade(request: Request, options?: { data?: unknown; headers?: HeadersInit }): boolean;
  /** URL en la que escucha el servidor. */
  readonly url?: URL;
}

/**
 * Opciones y handlers WebSocket para `Bun.serve({ websocket })`, con los límites ya resueltos.
 *
 * @example
 * ```ts
 * const { websocket } = createBunServer(app);
 * console.log(websocket.maxPayloadLength, websocket.idleTimeout);
 * ```
 */
export interface BunWebSocketHandler {
  /** Conecta el peer al hub. */
  open(socket: BunServerWebSocket): void;
  /** Entrega un mensaje al hub. */
  message(socket: BunServerWebSocket, message: string | Uint8Array): void;
  /** Informa al hub del cierre. */
  close(socket: BunServerWebSocket, code: number, reason: string): void;
  /** Frame entrante más grande. */
  readonly maxPayloadLength: number;
  /** Bytes salientes en cola por peer. */
  readonly backpressureLimit: number;
  /** Cierra el peer al superar `backpressureLimit`. */
  readonly closeOnBackpressureLimit: boolean;
  /** Segundos sin tráfico antes de cerrar un peer. */
  readonly idleTimeout: number;
  /** Envía pings a los peers inactivos. */
  readonly sendPings: boolean;
  /** Compresión por mensaje; siempre desactivada. */
  readonly perMessageDeflate: boolean;
}

/**
 * Handlers que se expanden en `Bun.serve({ hostname, port, ...handlers })`. Los devuelve
 * {@link createBunServer}.
 *
 * @example
 * ```ts
 * import type { BunServeHandlers } from "@meekojs/meeko/bun";
 *
 * const handlers: BunServeHandlers = createBunServer(app);
 * Bun.serve({ port: 3000, ...handlers });
 * ```
 */
export interface BunServeHandlers {
  /** Atiende HTTP y el upgrade de los canales Socket. */
  fetch(request: Request, server: BunServerLike): Promise<Response | undefined>;
  /** Handlers WebSocket de Bun. */
  readonly websocket: BunWebSocketHandler;
}

/**
 * Opciones de {@link createBunServer}.
 *
 * @example
 * ```ts
 * import type { BunServerOptions } from "@meekojs/meeko/bun";
 *
 * const options: BunServerOptions = { publicOrigin: "https://example.com", maxPayloadLength: 16 * 1024, idleTimeout: 120 };
 * ```
 */
export interface BunServerOptions {
  /** Sustituye al `publicOrigin` de la aplicación en las comprobaciones de Origin de HTTP y Socket. */
  readonly publicOrigin?: string;
  /** Plataforma que recibe cada petición. Por defecto, Bun con `Bun.env`. */
  readonly platform?: ServerPlatform;
  /** Observador de errores; por defecto, el de la aplicación. */
  readonly onError?: (error: unknown, requestId: string) => void;
  /** Frame entrante más grande; Bun cierra los mayores. Por defecto, el límite de Socket de la aplicación o 64 KiB. */
  readonly maxPayloadLength?: number;
  /** Bytes salientes en cola por peer antes de que un envío falle y cierre el peer con `1011`. Por defecto, 1 MiB. */
  readonly backpressureLimit?: number;
  /** Segundos sin tráfico antes de que Bun cierre un peer. Por defecto, 60. */
  readonly idleTimeout?: number;
  /** Envía pings a los peers inactivos para que las conexiones vivas no caduquen. Por defecto, `true`. */
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
  /** `close` is set for an auth refusal: the socket only opens to close with 4401/4403. */
  constructor(readonly upgrade: Extract<SocketUpgrade, { action: "upgrade" }> | undefined, readonly close?: SocketUpgradeClose) {}
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
 * Sirve una aplicación de Meeko con `Bun.serve`, incluidos sus canales Socket con el WebSocket
 * nativo de Bun: `Bun.serve({ port, ...createBunServer(app) })`.
 *
 * @param app Aplicación de `createServerApp`.
 * @param options Origen público, plataforma y límites de Socket.
 * @returns `{ fetch, websocket }` para `Bun.serve`.
 * @throws {RangeError} Si algún límite no es un entero positivo.
 * @example
 * ```ts
 * import { createServerApp } from "@meekojs/meeko/server";
 * import { createBunAssetReader, createBunServer } from "@meekojs/meeko/bun";
 *
 * const app = await createServerApp({
 *   manifest, load, runtime, production: true,
 *   assets: createBunAssetReader({ root: new URL("./client/", import.meta.url), assets: manifest.assets ?? {} }),
 * });
 * Bun.serve({ hostname: "0.0.0.0", port: 3000, ...createBunServer(app, { publicOrigin: "https://example.com" }) });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#bun
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
        if (decision.action === "reject") {
          if (decision.close && server.upgrade(request, { data: new MeekoBunSocket(undefined, decision.close) })) return undefined;
          return new Response(null, { status: decision.status });
        }
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
        if (!state) return;
        if (state.upgrade) state.session = state.upgrade.open(bunPeer(socket));
        else if (state.close) socket.close(state.close.code, state.close.reason);
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

/**
 * Opciones de {@link createBunAssetReader}.
 *
 * @example
 * ```ts
 * import type { BunAssetReaderOptions } from "@meekojs/meeko/bun";
 *
 * const options: BunAssetReaderOptions = { root: new URL("./client/", import.meta.url), assets: manifest.assets ?? {} };
 * ```
 */
export interface BunAssetReaderOptions {
  /** Carpeta que contiene los archivos listados en `assets`, como ruta o URL `file:`. */
  readonly root: string | URL;
  /** Manifiesto de los archivos públicos. */
  readonly assets: AssetManifest;
}

/**
 * Sirve con `Bun.file` sólo los archivos del build listados en el manifiesto, con `ETag`, `HEAD` y
 * `304`. Sólo funciona en Bun.
 *
 * @param options Carpeta y manifiesto de archivos.
 * @returns El lector de archivos.
 * @example
 * ```ts
 * import { createBunAssetReader } from "@meekojs/meeko/bun";
 *
 * const assets = createBunAssetReader({ root: new URL("./client/", import.meta.url), assets: manifest.assets ?? {} });
 * const response = await assets.get("/assets/entry.js", new Request("http://localhost/assets/entry.js"));
 * ```
 */
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
