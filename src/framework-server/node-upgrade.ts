import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { SocketHub, SocketPeer } from "./socket.js";
import { ApiError } from "./contracts.js";

/** A WebSocket server library owns framing and the HTTP 101 response. */
export interface NodeAcceptedSocket {
  peer: SocketPeer;
  onMessage(listener: (message: string | Uint8Array) => void): void;
  onClose(listener: () => void): void;
}

export interface NodeSocketUpgradeOptions {
  hub: SocketHub;
  /** Fixed public origin; never infer security policy from an untrusted Host header. */
  publicOrigin: string;
  pathnamePrefix?: string;
  upgrade(incoming: IncomingMessage, socket: Duplex, head: Buffer): Promise<NodeAcceptedSocket> | NodeAcceptedSocket;
  reject?(incoming: IncomingMessage, socket: Duplex, status: number): void;
  onError?(error: unknown): void;
}

/**
 * Handles the Node `upgrade` event after policy preflight. The host supplies a
 * WebSocket implementation; this adapter does not implement wire framing.
 */
export function createNodeSocketUpgradeHandler(options: NodeSocketUpgradeOptions): (incoming: IncomingMessage, socket: Duplex, head: Buffer) => Promise<boolean> {
  const origin = new URL(options.publicOrigin);
  if (origin.protocol !== "http:" && origin.protocol !== "https:") throw new TypeError("Socket publicOrigin must use HTTP or HTTPS");
  const prefix = options.pathnamePrefix ?? "/_meeko/socket";
  if (!prefix.startsWith("/") || prefix.endsWith("/")) throw new TypeError("Invalid socket pathname prefix");
  return async (incoming, socket, head) => {
    let url: URL;
    try { url = new URL(incoming.url ?? "", origin); }
    catch { return false; }
    if (!url.pathname.startsWith(`${prefix}/`)) return false;
    const reject = (status: number) => { if (options.reject) options.reject(incoming, socket, status); else socket.destroy(); };
    const name = url.pathname.slice(prefix.length + 1);
    if (url.origin !== origin.origin || !/^[A-Za-z_$][\w$-]*$/.test(name)) { reject(400); return true; }
    if (incoming.method !== "GET" || incoming.headers.upgrade?.toLowerCase() !== "websocket") { reject(400); return true; }
    const headers = new Headers();
    for (const [key, value] of Object.entries(incoming.headers)) {
      if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(", ") : value);
    }
    const request = new Request(url, { headers });
    const roomId = url.searchParams.get("room") ?? undefined;
    try { await options.hub.preflight(name, request, roomId); }
    catch (error) { reject(error instanceof ApiError ? error.status : 500); options.onError?.(error); return true; }
    let accepted: NodeAcceptedSocket;
    try { accepted = await options.upgrade(incoming, socket, head); }
    catch (error) { socket.destroy(); options.onError?.(error); return true; }
    try {
      const connection = await options.hub.accept(name, request, accepted.peer, roomId);
      let delivery = Promise.resolve();
      accepted.onMessage((message) => {
        delivery = delivery.then(() => connection.receive(message)).catch((error: unknown) => {
          options.onError?.(error);
          connection.close(error instanceof ApiError && error.status < 500 ? 1008 : 1011);
        });
      });
      accepted.onClose(() => connection.close());
    } catch (error) {
      accepted.peer.close(1008, "Unauthorized");
      options.onError?.(error);
    }
    return true;
  };
}
