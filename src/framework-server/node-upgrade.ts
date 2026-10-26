import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { SocketHub, SocketPeer } from "./socket.js";
import { observeErrorCallback } from "./contracts.js";
import { createSocketUpgradeHandler, socketPathnamePrefix, socketPublicOrigin } from "./upgrade.js";

/**
 * Conexión que devuelve la librería WebSocket del host tras el upgrade; la librería se encarga del
 * framing y de la respuesta HTTP 101.
 *
 * @example
 * ```ts
 * import type WebSocket from "ws";
 * import type { NodeAcceptedSocket } from "@meekojs/meeko/node";
 *
 * const accepted = (socket: WebSocket): NodeAcceptedSocket => ({
 *   peer: { send: (message) => socket.send(message), close: (code, reason) => socket.close(code, reason) },
 *   onMessage: (listener) => socket.on("message", (data, binary) => listener(binary ? new Uint8Array(data as Buffer) : data.toString())),
 *   onClose: (listener) => socket.on("close", listener),
 * });
 * ```
 */
export interface NodeAcceptedSocket {
  /** Peer que recibe los envíos del hub. */
  peer: SocketPeer;
  /** Registra el listener de los mensajes entrantes. */
  onMessage(listener: (message: string | Uint8Array) => void): void;
  /** Registra el listener del cierre. */
  onClose(listener: () => void): void;
}

/**
 * Opciones de {@link createNodeSocketUpgradeHandler}.
 *
 * @example
 * ```ts
 * import type { NodeSocketUpgradeOptions } from "@meekojs/meeko/node";
 *
 * const options: NodeSocketUpgradeOptions = {
 *   hub: app.socket!.hub,
 *   publicOrigin: "https://example.com",
 *   upgrade: (incoming, socket, head) => new Promise((resolve) => wss.handleUpgrade(incoming, socket, head, (ws) => resolve(accepted(ws)))),
 * };
 * ```
 */
export interface NodeSocketUpgradeOptions {
  /** Hub de la aplicación. */
  hub: SocketHub;
  /** Origen público fijo; la política de seguridad nunca se deduce de una cabecera `Host` no confiable. */
  publicOrigin: string;
  /** Prefijo de los canales; por defecto, `/_meeko/socket`. */
  pathnamePrefix?: string;
  /** Bytes entrantes retenidos mientras el hub autoriza una conexión nueva. Por defecto, 64 KiB. */
  maxPendingBytes?: number;
  /** Hace el upgrade con la librería WebSocket del host. */
  upgrade(incoming: IncomingMessage, socket: Duplex, head: Buffer): Promise<NodeAcceptedSocket> | NodeAcceptedSocket;
  /**
   * Responde a un handshake rechazado; por defecto, destruye el socket. Desde `1.1` no recibe los
   * rechazos de sesión (`401`) ni de autorización del canal (`403`): esos hacen el upgrade con
   * `upgrade` y cierran en seguida con `4401` o `4403`. Un Origin no permitido sigue llegando aquí
   * con `403`.
   */
  reject?(incoming: IncomingMessage, socket: Duplex, status: number): void;
  /** Observador de los fallos del upgrade y de las sesiones. */
  onError?(error: unknown): void;
}

/**
 * Atiende el evento `upgrade` de Node tras la comprobación de política. El host aporta la
 * implementación de WebSocket; este adaptador no implementa el framing. El handler devuelve `false`
 * si la petición no es de un canal, para que otro listener la atienda.
 *
 * @param options Hub, origen público y funciones de upgrade y rechazo.
 * @returns Un handler `(incoming, socket, head) => Promise<boolean>`.
 * @throws {TypeError} Si el origen público o el prefijo no son válidos.
 * @example
 * ```ts
 * import { WebSocketServer } from "ws";
 * import { createNodeSocketUpgradeHandler } from "@meekojs/meeko/node";
 *
 * const wss = new WebSocketServer({ noServer: true });
 * const handleUpgrade = createNodeSocketUpgradeHandler({
 *   hub: app.socket!.hub,
 *   publicOrigin: "https://example.com",
 *   upgrade: (incoming, socket, head) => new Promise((resolve) => wss.handleUpgrade(incoming, socket, head, (ws) => resolve(accepted(ws)))),
 * });
 * server.on("upgrade", (incoming, socket, head) => {
 *   void handleUpgrade(incoming, socket, head).then((handled) => { if (!handled) socket.destroy(); });
 * });
 * ```
 */
export function createNodeSocketUpgradeHandler(options: NodeSocketUpgradeOptions): (incoming: IncomingMessage, socket: Duplex, head: Buffer) => Promise<boolean> {
  const origin = socketPublicOrigin(options.publicOrigin);
  const prefix = socketPathnamePrefix(options.pathnamePrefix);
  const observeError = (error: unknown): void => observeErrorCallback(error, options.onError);
  const handshake = createSocketUpgradeHandler({
    hub: options.hub,
    publicOrigin: origin.href,
    pathnamePrefix: prefix,
    ...(options.maxPendingBytes === undefined ? {} : { maxPendingBytes: options.maxPendingBytes }),
    ...(options.onError ? { onError: options.onError } : {}),
  });
  return async (incoming, socket, head) => {
    let url: URL;
    try { url = new URL(incoming.url ?? "", origin); }
    catch { return false; }
    if (!url.pathname.startsWith(`${prefix}/`)) return false;
    const reject = (status: number) => { if (options.reject) options.reject(incoming, socket, status); else socket.destroy(); };
    // An absolute-form request target cannot name another origin.
    if (url.origin !== origin.origin || incoming.method !== "GET") { reject(400); return true; }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const decision = await handshake(new Request(url, { headers }));
    if (decision.action === "pass") return false;
    const upgradeSocket = async (): Promise<NodeAcceptedSocket | undefined> => {
      try { return await options.upgrade(incoming, socket, head); }
      catch (error) { socket.destroy(); observeError(error); return undefined; }
    };
    if (decision.action === "reject") {
      const denial = decision.close;
      if (!denial) { reject(decision.status); return true; }
      // An auth refusal completes the upgrade only to close with 4401/4403, which a browser can read.
      const denied = await upgradeSocket();
      if (!denied) return true;
      denied.onMessage(() => { /* A refused connection never reaches the hub. */ });
      denied.onClose(() => { /* Nothing was opened. */ });
      try { denied.peer.close(denial.code, denial.reason); }
      catch (error) { socket.destroy(); observeError(error); }
      return true;
    }
    const accepted = await upgradeSocket();
    if (!accepted) return true;
    const session = decision.open(accepted.peer);
    accepted.onMessage((message) => session.receive(message));
    accepted.onClose(() => session.closed());
    return true;
  };
}
