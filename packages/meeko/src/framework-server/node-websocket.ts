import { STATUS_CODES, type IncomingMessage, type Server as HttpServer } from "node:http";
import { createRequire } from "node:module";
import type { Duplex } from "node:stream";
import type WebSocket from "ws";
import { createNodeSocketUpgradeHandler } from "./node-upgrade.js";
import { observeErrorCallback } from "./contracts.js";
import type { NodeAcceptedSocket, NodeSocketUpgradeOptions } from "./node-upgrade.js";

/**
 * Opciones de {@link attachNodeWebSocketServer}.
 *
 * @example
 * ```ts
 * import type { NodeWebSocketOptions } from "@meekojs/meeko/node";
 *
 * const options: NodeWebSocketOptions = { server, hub: app.socket!.hub, publicOrigin: "https://example.com", heartbeatMs: 15_000 };
 * ```
 */
export interface NodeWebSocketOptions extends Omit<NodeSocketUpgradeOptions, "upgrade" | "reject" | "maxPendingBytes"> {
  /** El mismo servidor HTTP que atiende el handler Fetch. */
  server: HttpServer;
  /** Payload máximo de un frame WebSocket, que se aplica antes de decodificarlo. Por defecto, 64 KiB. */
  maxMessageBytes?: number;
  /** Intervalo de ping y tiempo de inactividad. Por defecto, 30 segundos. */
  heartbeatMs?: number;
}

/**
 * Servidor WebSocket conectado a un servidor HTTP de Node.
 *
 * @example
 * ```ts
 * const sockets = attachNodeWebSocketServer({ server, hub: app.socket!.hub, publicOrigin: "https://example.com" });
 * process.once("SIGTERM", () => void sockets.close().then(() => server.close()));
 * ```
 */
export interface NodeWebSocketServer {
  /** Quita el listener de `upgrade` y cierra todos los peers; el servidor HTTP sigue siendo del llamador. */
  close(): Promise<void>;
}

/**
 * Conecta los canales Socket de Meeko a un servidor HTTP de Node usando `ws` para el protocolo. Carga
 * `ws` sólo al llamarse, no al importar el adaptador.
 *
 * @param options Servidor HTTP, hub, origen público y límites.
 * @returns El servidor WebSocket, con `close()`.
 * @throws {RangeError} Si `maxMessageBytes` o `heartbeatMs` no son enteros positivos.
 * @example
 * ```ts
 * import { createServer } from "node:http";
 * import { attachNodeWebSocketServer, toNodeListener } from "@meekojs/meeko/node";
 *
 * const server = createServer(toNodeListener((request) => app.fetch(request)));
 * const sockets = app.socket
 *   ? attachNodeWebSocketServer({ server, hub: app.socket.hub, publicOrigin: "https://example.com" })
 *   : undefined;
 * server.listen(3000);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#websocket
 */
export function attachNodeWebSocketServer(options: NodeWebSocketOptions): NodeWebSocketServer {
  const maxPayload = options.maxMessageBytes ?? 64 * 1024;
  const heartbeatMs = options.heartbeatMs ?? 30_000;
  if (!Number.isSafeInteger(maxPayload) || maxPayload <= 0) throw new RangeError("Invalid socket message limit");
  if (!Number.isSafeInteger(heartbeatMs) || heartbeatMs <= 0) throw new RangeError("Invalid socket heartbeat interval");
  // Keep the optional server transport out of engine-only and HTTP-only imports.
  const { WebSocket: WebSocketClass, WebSocketServer } = createRequire(import.meta.url)("ws") as typeof import("ws");
  const webSockets = new WebSocketServer({ noServer: true, maxPayload, perMessageDeflate: false });
  const observeError = (error: unknown): void => observeErrorCallback(error, options.onError);
  const alive = new WeakMap<WebSocket, boolean>();
  let closing = false;
  let closePromise: Promise<void> | undefined;

  const upgrade = (incoming: IncomingMessage, socket: Duplex, head: Buffer): Promise<NodeAcceptedSocket> =>
    new Promise((resolve, reject) => {
      try {
        webSockets.handleUpgrade(incoming, socket, head, (peer) => {
          alive.set(peer, true);
          peer.on("pong", () => alive.set(peer, true));
          peer.on("error", observeError);
          const pending: Uint8Array[] = [];
          let pendingBytes = 0;
          let messageListener: ((message: string | Uint8Array) => void) | undefined;
          let closeListener: (() => void) | undefined;
          let didClose = false;
          peer.on("message", (data, isBinary) => {
            if (isBinary) { peer.close(1003, "Text messages required"); return; }
            const bytes = Array.isArray(data) ? Buffer.concat(data) : Buffer.isBuffer(data) ? data : Buffer.from(data);
            if (messageListener) { messageListener(bytes); return; }
            pendingBytes += bytes.byteLength;
            if (pendingBytes > maxPayload) { peer.close(1009, "Message buffer exceeded"); return; }
            pending.push(bytes);
          });
          peer.once("close", () => { didClose = true; closeListener?.(); });
          resolve({
            peer: {
              send(message) {
                if (peer.readyState !== WebSocketClass.OPEN) throw new Error("Socket is disconnected");
                peer.send(message);
              },
              close(code, reason) { if (peer.readyState === WebSocketClass.OPEN) peer.close(code, reason); },
              get bufferedAmount() { return peer.bufferedAmount; },
            },
            onMessage(listener) {
              messageListener = listener;
              for (const message of pending) listener(message);
              pending.length = 0;
              pendingBytes = 0;
            },
            onClose(listener) { closeListener = listener; if (didClose) listener(); },
          });
        });
      } catch (error) { reject(error); }
    });

  const bridge = createNodeSocketUpgradeHandler({
    hub: options.hub,
    publicOrigin: options.publicOrigin,
    ...(options.pathnamePrefix ? { pathnamePrefix: options.pathnamePrefix } : {}),
    maxPendingBytes: maxPayload,
    upgrade,
    reject(_incoming, socket, status) {
      if (!socket.destroyed) socket.end(`HTTP/1.1 ${status} ${STATUS_CODES[status] ?? "Error"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
    },
    ...(options.onError ? { onError: options.onError } : {}),
  });
  const onUpgrade = (incoming: IncomingMessage, socket: Duplex, head: Buffer): void => {
    if (closing) { socket.destroy(); return; }
    void bridge(incoming, socket, head).then((handled) => {
      if (!handled) socket.destroy();
    }).catch((error: unknown) => {
      observeError(error);
      socket.destroy();
    });
  };
  options.server.on("upgrade", onUpgrade);
  const heartbeat = setInterval(() => {
    for (const peer of webSockets.clients) {
      if (alive.get(peer) === false) { peer.terminate(); continue; }
      alive.set(peer, false);
      if (peer.readyState === WebSocketClass.OPEN) peer.ping();
    }
  }, heartbeatMs);
  heartbeat.unref();

  return {
    close() {
      if (closePromise) return closePromise;
      closing = true;
      options.server.off("upgrade", onUpgrade);
      clearInterval(heartbeat);
      for (const peer of webSockets.clients) peer.terminate();
      closePromise = new Promise<void>((resolve, reject) => webSockets.close((error) => error ? reject(error) : resolve()));
      return closePromise;
    },
  };
}
