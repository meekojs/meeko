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
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * A loopback public origin also answers to its other loopback names on the same
 * scheme and port, so a page opened at `localhost` reaches a server listening on
 * `127.0.0.1`. Non-loopback origins never take their identity from a header.
 */
function loopbackAlias(origin: URL, header: string | null): URL | undefined {
  if (!header || !loopbackHosts.has(origin.hostname)) return undefined;
  let candidate: URL;
  try { candidate = new URL(header); }
  catch { return undefined; }
  // Rebuild from the serialized origin so credentials in the header never reach the request URL.
  return candidate.protocol === origin.protocol && candidate.port === origin.port && loopbackHosts.has(candidate.hostname) ? new URL(candidate.origin) : undefined;
}

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

export interface OpenSocketSessionOptions {
  readonly hub: SocketHub;
  readonly name: string;
  /** Handshake request on the public origin; the hub authorizes it again. */
  readonly request: Request;
  readonly roomId: string | undefined;
  readonly peer: SocketPeer;
  /** Inbound bytes held while the hub authorizes the connection. */
  readonly maxPendingBytes: number;
  onError?(error: unknown): void;
}

/** A transport session plus the outcome of the hub's authorization. */
export interface OpenedSocketSession extends SocketSession {
  /** Resolves true once the hub accepted the peer and false when it refused it; never rejects. */
  readonly ready: Promise<boolean>;
  /** Resolves once every message received so far has been handled; never rejects. */
  settled(): Promise<void>;
}

/**
 * Connects an upgraded transport to the hub with a serialized receive chain.
 * Hosts that rebuild connections, such as a woken Durable Object, call it
 * directly; the hub authorizes the request again.
 */
export function openSocketSession(options: OpenSocketSessionOptions): OpenedSocketSession {
  const { hub, name, request, roomId, peer, maxPendingBytes } = options;
  const observeError = (error: unknown): void => observeErrorCallback(error, options.onError);
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
  const ready = hub.accept(name, request, peer, roomId).then((accepted) => {
    connection = accepted;
    pendingBytes = 0;
    if (ended) closeConnection(accepted);
    return true;
  }, (error: unknown) => {
    refused = true;
    try { peer.close(1008, "Unauthorized"); }
    catch (closeError) { observeError(closeError); }
    observeError(error);
    return false;
  });
  let delivery: Promise<unknown> = ready;
  return {
    ready,
    settled: () => delivery.then(() => undefined),
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
  const open = (name: string, request: Request, roomId: string | undefined, peer: SocketPeer): SocketSession =>
    openSocketSession({ hub, name, request, roomId, peer, maxPendingBytes, onError: observeError });

  return async (incoming) => {
    const url = new URL(incoming.url);
    if (!url.pathname.startsWith(`${prefix}/`)) return { action: "pass" };
    const name = url.pathname.slice(prefix.length + 1);
    if (!channelName.test(name)) return { action: "reject", status: 400 };
    if (incoming.method !== "GET" || incoming.headers.get("upgrade")?.toLowerCase() !== "websocket") return { action: "reject", status: 400 };
    // Origin checks compare against the request URL, so it carries the public origin.
    const base = loopbackAlias(origin, incoming.headers.get("origin")) ?? origin;
    const request = new Request(new URL(url.pathname + url.search, base), { headers: incoming.headers });
    const roomId = url.searchParams.get("room") ?? undefined;
    try { await hub.preflight(name, request, roomId); }
    catch (error) {
      observeError(error);
      return { action: "reject", status: normalizeServerError(error).status };
    }
    return { action: "upgrade", channel: name, roomId, request, open: (peer) => open(name, request, roomId, peer) };
  };
}
