import { normalizeServerError, observeErrorCallback } from "./contracts.js";
import type { SocketConnection, SocketHub, SocketPeer } from "./socket.js";

export interface SocketUpgradeOptions {
  hub: SocketHub;
  /** Fixed public origin; never infer security policy from an untrusted Host header. */
  publicOrigin: string;
  /** Defaults to `/_meeko/socket`; channels are served at `<prefix>/<name>`. */
  pathnamePrefix?: string;
  /** Inbound bytes held while the hub authorizes a new connection. Defaults to 64 KiB. */
  maxPendingBytes?: number;
  onError?(error: unknown): void;
}

/** Inbound side of an upgraded connection, driven by the transport's events. */
export interface SocketSession {
  /** Delivers one text message. Messages are processed one at a time, in arrival order. */
  receive(message: string | Uint8Array): void;
  /** Reports that the transport closed. */
  closed(): void;
}

/** Outcome of the policy preflight that precedes the transport upgrade. */
export type SocketUpgrade =
  /** Not a Socket channel request; the host handles it as plain HTTP. */
  | { readonly action: "pass" }
  /** Answer with this HTTP status instead of upgrading. */
  | { readonly action: "reject"; readonly status: number }
  /** Perform the transport upgrade, then call `open` once the connection is ready. */
  | {
    readonly action: "upgrade";
    readonly channel: string;
    readonly roomId: string | undefined;
    /** Handshake request rebased on the public origin. */
    readonly request: Request;
    open(peer: SocketPeer): SocketSession;
  };

/** Runs the Socket policy for a handshake request; adapters own wire framing. */
export type SocketUpgradeHandler = (request: Request) => Promise<SocketUpgrade>;

const channelName = /^[A-Za-z_$][\w$-]*$/;
const encoder = new TextEncoder();

/** Validates a Socket pathname prefix and returns it. */
export function socketPathnamePrefix(value: string | undefined): string {
  const prefix = value ?? "/_meeko/socket";
  if (!prefix.startsWith("/") || prefix.endsWith("/")) throw new TypeError("Invalid socket pathname prefix");
  return prefix;
}

/** Normalizes a Socket public origin, which must use HTTP or HTTPS. */
export function socketPublicOrigin(value: string): URL {
  const origin = new URL(value);
  if (origin.protocol !== "http:" && origin.protocol !== "https:") throw new TypeError("Socket publicOrigin must use HTTP or HTTPS");
  return origin;
}

/**
 * Portable Socket handshake for any runtime: validates the channel path, runs
 * the hub preflight, and after the adapter upgrades the transport, connects it
 * to the hub with a serialized receive chain.
 */
export function createSocketUpgradeHandler(options: SocketUpgradeOptions): SocketUpgradeHandler {
  const origin = socketPublicOrigin(options.publicOrigin);
  const prefix = socketPathnamePrefix(options.pathnamePrefix);
  const maxPendingBytes = options.maxPendingBytes ?? 64 * 1024;
  if (!Number.isSafeInteger(maxPendingBytes) || maxPendingBytes <= 0) throw new RangeError("Invalid socket pending buffer limit");
  const hub = options.hub;
  const observeError = (error: unknown): void => observeErrorCallback(error, options.onError);

  const open = (name: string, request: Request, roomId: string | undefined, peer: SocketPeer): SocketSession => {
    let connection: SocketConnection | undefined;
    let ended = false;
    let refused = false;
    let pendingBytes = 0;
    const closeConnection = (target: SocketConnection): void => {
      try { target.close(); }
      catch (error) { observeError(error); }
    };
    // Messages that arrive while the hub authorizes the connection wait on
    // this chain, then run in arrival order like every later message.
    let delivery: Promise<void> = hub.accept(name, request, peer, roomId).then((accepted) => {
      connection = accepted;
      pendingBytes = 0;
      if (ended) closeConnection(accepted);
    }, (error: unknown) => {
      refused = true;
      try { peer.close(1008, "Unauthorized"); }
      catch (closeError) { observeError(closeError); }
      observeError(error);
    });
    return {
      receive(message) {
        if (refused || ended) return;
        if (!connection) {
          pendingBytes += typeof message === "string" ? encoder.encode(message).byteLength : message.byteLength;
          if (pendingBytes > maxPendingBytes) {
            refused = true;
            try { peer.close(1009, "Message buffer exceeded"); }
            catch (error) { observeError(error); }
            return;
          }
        }
        delivery = delivery.then(() => connection?.receive(message)).catch((error: unknown) => {
          observeError(error);
          try { connection?.close(normalizeServerError(error).status < 500 ? 1008 : 1011); }
          catch (closeError) { observeError(closeError); }
        });
      },
      closed() {
        if (ended) return;
        ended = true;
        if (connection) closeConnection(connection);
      },
    };
  };

  return async (incoming) => {
    const url = new URL(incoming.url);
    if (!url.pathname.startsWith(`${prefix}/`)) return { action: "pass" };
    const name = url.pathname.slice(prefix.length + 1);
    if (!channelName.test(name)) return { action: "reject", status: 400 };
    if (incoming.method !== "GET" || incoming.headers.get("upgrade")?.toLowerCase() !== "websocket") return { action: "reject", status: 400 };
    // Origin checks compare against the request URL, so it carries the public origin.
    const request = new Request(new URL(url.pathname + url.search, origin), { headers: incoming.headers });
    const roomId = url.searchParams.get("room") ?? undefined;
    try { await hub.preflight(name, request, roomId); }
    catch (error) {
      observeError(error);
      return { action: "reject", status: normalizeServerError(error).status };
    }
    return { action: "upgrade", channel: name, roomId, request, open: (peer) => open(name, request, roomId, peer) };
  };
}
