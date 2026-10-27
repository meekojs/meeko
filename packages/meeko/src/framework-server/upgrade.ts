import { normalizeServerError, observeErrorCallback } from "./contracts.js";
import type { SocketConnection, SocketHub, SocketPeer } from "./socket.js";

/**
 * Opciones de {@link createSocketUpgradeHandler}.
 *
 * @example
 * ```ts
 * import type { SocketUpgradeOptions } from "@meekojs/meeko/server";
 *
 * const options: SocketUpgradeOptions = {
 *   hub: app.socket!.hub,
 *   publicOrigin: "https://example.com",
 *   onError: (error) => app.reportError(error, crypto.randomUUID()),
 * };
 * ```
 */
export interface SocketUpgradeOptions {
  /** Hub de la aplicación. */
  hub: SocketHub;
  /** Origen público fijo; la política de seguridad nunca se deduce de una cabecera `Host` no confiable. */
  publicOrigin: string;
  /** Prefijo de los canales, servidos en `<prefix>/<nombre>`. Por defecto, `/_meeko/socket`. */
  pathnamePrefix?: string;
  /** Bytes entrantes retenidos mientras el hub autoriza una conexión nueva. Por defecto, 64 KiB. */
  maxPendingBytes?: number;
  /** Observador de los fallos del transporte y de las sesiones. */
  onError?(error: unknown): void;
}

/**
 * Lado entrante de una conexión ya actualizada, que el adaptador alimenta con los eventos del
 * transporte.
 *
 * @example
 * ```ts
 * const session = upgrade.open(peerOf(socket));
 * socket.addEventListener("message", (event) => session.receive(event.data as string));
 * socket.addEventListener("close", () => session.closed());
 * ```
 */
export interface SocketSession {
  /** Entrega un mensaje. Los mensajes se procesan de uno en uno, en orden de llegada. */
  receive(message: string | Uint8Array): void;
  /** Indica que el transporte se cerró. */
  closed(): void;
}

/**
 * Resultado de la comprobación de política que precede al upgrade del transporte.
 *
 * @example
 * ```ts
 * const upgrade = await handleUpgrade(request);
 * if (upgrade.action === "pass") return app.fetch(request);
 * if (upgrade.action === "reject" && upgrade.close) {
 *   // Rechazo de autenticación o autorización: acepta el WebSocket y lo cierra con upgrade.close.code.
 * }
 * if (upgrade.action === "reject") return new Response(null, { status: upgrade.status });
 * // upgrade.action === "upgrade": el adaptador acepta el WebSocket y llama a upgrade.open(peer).
 * ```
 */
export type SocketUpgrade =
  /** No es una petición de canal Socket; el host la atiende como HTTP normal. */
  | {
    /** Discriminante: la petición no se trata como Socket. */
    readonly action: "pass";
  }
  /**
   * Responder con este estado HTTP en lugar de hacer el upgrade, salvo que haya `close`.
   */
  | {
    /** Discriminante: la política rechazó el handshake. */
    readonly action: "reject";
    /** Estado HTTP del rechazo: `400` si el handshake está mal formado; si no, el del error de la comprobación previa del canal. */
    readonly status: number;
    /**
     * Desde `1.1`, presente sólo cuando el hub rechaza la sesión (`401`) o la autorización del
     * canal (`403`), nunca en un Origin no permitido. El adaptador acepta el upgrade y cierra en
     * seguida con este código (`4401` o `4403`) y motivo, sin abrir sesión ni entregar mensajes:
     * el `WebSocket` del navegador no expone el estado HTTP de un handshake rechazado, pero sí el
     * código de cierre. Un adaptador que no lo conoce responde `status`, como en `1.0`.
     */
    readonly close?: { readonly code: 4401 | 4403; readonly reason: string };
  }
  /** Hacer el upgrade del transporte y llamar a `open` cuando la conexión esté lista. */
  | {
    /** Discriminante: la política aceptó el handshake. */
    readonly action: "upgrade";
    /** Nombre del canal, tomado de la ruta tras el prefijo de Socket. */
    readonly channel: string;
    /** Sala pedida con el parámetro `room` de la URL, o `undefined` si no hay ninguno. */
    readonly roomId: string | undefined;
    /** Petición del handshake, reescrita sobre el origen público. */
    readonly request: Request;
    /** Abre la sesión del canal sobre el transporte ya aceptado; el adaptador le entrega los mensajes. */
    open(peer: SocketPeer): SocketSession;
  };

/**
 * Aplica la política de Socket a una petición de handshake; el framing del protocolo es cosa del
 * adaptador. La crea {@link createSocketUpgradeHandler}.
 *
 * @example
 * ```ts
 * import type { SocketUpgradeHandler } from "@meekojs/meeko/server";
 *
 * async function isSocketRequest(handler: SocketUpgradeHandler, request: Request): Promise<boolean> {
 *   return (await handler(request)).action !== "pass";
 * }
 * ```
 */
export type SocketUpgradeHandler = (request: Request) => Promise<SocketUpgrade>;

/** The close that replaces an HTTP 401/403 handshake refusal. */
export type SocketUpgradeClose = NonNullable<Extract<SocketUpgrade, { action: "reject" }>["close"]>;

const channelName = /^[A-Za-z_$][\w$-]*$/;
const encoder = new TextEncoder();
const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
/** Request-level security policies stay HTTP refusals: a foreign page never completes an upgrade. */
const requestPolicyCodes = new Set(["INVALID_ORIGIN", "INVALID_CSRF"]);

/**
 * The close for a handshake that the hub refused for authentication (`401`) or for the channel's
 * authorization (`403`). Origin and CSRF refusals, limits and unknown channels keep their HTTP
 * status. The reason is fixed, so it never carries session data.
 */
function refusalClose(error: { readonly code: string; readonly status: number }): SocketUpgradeClose | undefined {
  if (error.status === 401) return { code: 4401, reason: "Autenticación requerida" };
  if (error.status === 403 && !requestPolicyCodes.has(error.code)) return { code: 4403, reason: "Acceso denegado" };
  return undefined;
}

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

/**
 * Opciones de {@link openSocketSession}.
 *
 * @example
 * ```ts
 * import type { OpenSocketSessionOptions } from "@meekojs/meeko/server";
 *
 * const options: OpenSocketSessionOptions = { hub, name: "chat", request, roomId: "general", peer, maxPendingBytes: 64 * 1024 };
 * ```
 */
export interface OpenSocketSessionOptions {
  /** Hub de la aplicación. */
  readonly hub: SocketHub;
  /** Nombre del canal. */
  readonly name: string;
  /** Petición del handshake sobre el origen público; el hub la vuelve a autorizar. */
  readonly request: Request;
  /** Sala, si la hay. */
  readonly roomId: string | undefined;
  /** Conexión ya aceptada por el transporte. */
  readonly peer: SocketPeer;
  /** Bytes entrantes retenidos mientras el hub autoriza la conexión. */
  readonly maxPendingBytes: number;
  /** Observador de los fallos de la sesión. */
  onError?(error: unknown): void;
}

/**
 * Sesión de transporte con el resultado de la autorización del hub.
 *
 * @example
 * ```ts
 * const session = openSocketSession({ hub, name: "chat", request, roomId, peer, maxPendingBytes: 64 * 1024 });
 * if (!(await session.ready)) return; // el hub rechazó la conexión y cerró el peer
 * session.receive(JSON.stringify({ event: "message", payload: { text: "Hola" } }));
 * await session.settled();
 * ```
 */
export interface OpenedSocketSession extends SocketSession {
  /** Se resuelve con `true` cuando el hub acepta el peer y con `false` si lo rechaza; nunca rechaza. */
  readonly ready: Promise<boolean>;
  /** Se resuelve cuando se han procesado todos los mensajes recibidos hasta ahora; nunca rechaza. */
  settled(): Promise<void>;
}

/**
 * Conecta un transporte ya actualizado al hub, con una cadena de recepción en serie. Los hosts que
 * reconstruyen conexiones, como un Durable Object que despierta, la llaman directamente; el hub
 * vuelve a autorizar la petición. Si la rechaza, cierra el peer con `4401` (sesión) o `4403`
 * (autorización del canal), desde `1.1`, o con `1008` por cualquier otro motivo.
 *
 * @param options Hub, canal, petición, sala, peer y límite de bytes pendientes.
 * @returns La sesión, con `ready` y `settled`.
 * @example
 * ```ts
 * import { openSocketSession } from "@meekojs/meeko/server";
 *
 * const session = openSocketSession({ hub: app.socket!.hub, name: "chat", request, roomId: "general", peer, maxPendingBytes: 64 * 1024 });
 * socket.addEventListener("message", (event) => session.receive(event.data as string));
 * socket.addEventListener("close", () => session.closed());
 * ```
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
    // The same 4401/4403 as a refused handshake, e.g. when a woken Durable Object authorizes again.
    const close = refusalClose(normalizeServerError(error)) ?? { code: 1008, reason: "Unauthorized" };
    try { peer.close(close.code, close.reason); }
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
 * Handshake de Socket portable para cualquier runtime: valida la ruta del canal y la petición, ejecuta
 * la comprobación previa del hub (Origin, sesión, autorización) y, cuando el adaptador ha hecho el
 * upgrade del transporte, lo conecta al hub con una cadena de recepción en serie. Desde `1.1`, un
 * rechazo de sesión (`401`) o de autorización del canal (`403`) lleva `close`: el adaptador hace el
 * upgrade y cierra con `4401` o `4403`. Los adaptadores de Node, Bun, Deno y Cloudflare lo comparten.
 *
 * @param options Hub, origen público, prefijo y límites.
 * @returns El handler de upgrade.
 * @throws {TypeError} Si el origen público no es HTTP(S) o el prefijo no es válido.
 * @throws {RangeError} Si `maxPendingBytes` no es un entero positivo.
 * @example
 * ```ts
 * import { createSocketUpgradeHandler } from "@meekojs/meeko/server";
 *
 * const handleUpgrade = createSocketUpgradeHandler({ hub: app.socket!.hub, publicOrigin: "https://example.com" });
 * Deno.serve(async (request) => {
 *   const upgrade = await handleUpgrade(request);
 *   if (upgrade.action === "pass") return app.fetch(request);
 *   if (upgrade.action === "reject" && !upgrade.close) return new Response(null, { status: upgrade.status });
 *   const { socket, response } = Deno.upgradeWebSocket(request);
 *   socket.onopen = () => {
 *     // 401/403 del hub: cierre 4401/4403, que el navegador sí ve, sin sesión. Tras un tick: Deno
 *     // corta la conexión sin el frame de cierre si lee un mensaje mientras cierra.
 *     if (upgrade.action === "reject") { setTimeout(() => socket.close(upgrade.close?.code, upgrade.close?.reason), 0); return; }
 *     const session = upgrade.open({ send: (message) => socket.send(message), close: (code, reason) => socket.close(code, reason) });
 *     socket.onmessage = (event) => session.receive(event.data);
 *     socket.onclose = () => session.closed();
 *   };
 *   return response;
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#websocket
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
      const refusal = normalizeServerError(error);
      const close = refusalClose(refusal);
      return close ? { action: "reject", status: refusal.status, close } : { action: "reject", status: refusal.status };
    }
    return { action: "upgrade", channel: name, roomId, request, open: (peer) => open(name, request, roomId, peer) };
  };
}
