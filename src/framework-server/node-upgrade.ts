import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { SocketHub, SocketPeer } from "./socket.js";
import { observeErrorCallback } from "./contracts.js";
import { createSocketUpgradeHandler, socketPathnamePrefix, socketPublicOrigin } from "./upgrade.js";

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
  /** Inbound bytes held while the hub authorizes a new connection. Defaults to 64 KiB. */
  maxPendingBytes?: number;
  upgrade(incoming: IncomingMessage, socket: Duplex, head: Buffer): Promise<NodeAcceptedSocket> | NodeAcceptedSocket;
  reject?(incoming: IncomingMessage, socket: Duplex, status: number): void;
  onError?(error: unknown): void;
}

/**
 * Handles the Node `upgrade` event after policy preflight. The host supplies a
 * WebSocket implementation; this adapter does not implement wire framing.
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
    if (decision.action === "reject") { reject(decision.status); return true; }
    let accepted: NodeAcceptedSocket;
    try { accepted = await options.upgrade(incoming, socket, head); }
    catch (error) { socket.destroy(); observeError(error); return true; }
    const session = decision.open(accepted.peer);
    accepted.onMessage((message) => session.receive(message));
    accepted.onClose(() => session.closed());
    return true;
  };
}
