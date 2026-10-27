import { AsyncLocalStorage } from "node:async_hooks";
import { createRequestContext, type RequestContext } from "./context.js";
import { ApiError, normalizeServerError, observeErrorCallback, SessionRevokedError, type Schema } from "./contracts.js";
import { serializeJson } from "../server.js";
import type { SessionHandle, SessionManager } from "./sessions.js";
import type { ServerPlatform } from "./platform.js";
import type { SocketClient, SocketContract } from "../framework/socket.js";

type Output<S> = S extends Schema<unknown, infer O> ? O : never;
type SchemaMap = Readonly<Record<string, Schema>>;
type SchemaInput<T> = T extends { readonly "~standard": { readonly types?: infer U } }
  ? NonNullable<U> extends { readonly input: infer I } ? I : never
  : T extends Schema<infer I, unknown> ? I : never;

/** The hub of the application whose request or Socket handler is running. */
const activeHub = new AsyncLocalStorage<SocketHub>();

/** Binds `socket.<channel>.broadcast` of generated server clients to `hub` across async work. */
export function withSocketHub<T>(hub: SocketHub, run: () => T): T {
  return activeHub.run(hub, run);
}

/**
 * Conexión WebSocket ya aceptada por el adaptador, tal como la ve el hub.
 *
 * @example
 * ```ts
 * import type { SocketPeer } from "@meekojs/meeko/server";
 *
 * function peerOf(socket: WebSocket): SocketPeer {
 *   return {
 *     send: (message) => socket.send(message),
 *     close: (code, reason) => socket.close(code, reason),
 *     get bufferedAmount() { return socket.bufferedAmount; },
 *   };
 * }
 * ```
 */
export interface SocketPeer {
  /** Envía un mensaje de texto. */
  send(message: string): void | Promise<void>;
  /** Cierra la conexión con un código y un motivo. */
  close(code?: number, reason?: string): void;
  /** Bytes salientes pendientes, para aplicar `maxBufferBytes`. */
  readonly bufferedAmount?: number;
}

/**
 * Definición de un canal Socket de `server/socket/<nombre>.ts`: schemas por dirección, guardas y
 * handlers de los eventos del cliente. Se declara con {@link defineSocketChannel}.
 *
 * @typeParam C Schemas de los eventos que envía el cliente.
 * @typeParam S Schemas de los eventos que envía el servidor.
 * @typeParam TServices Tipo de los servicios.
 * @example
 * ```ts
 * import type { Schema, SocketChannelDefinition } from "@meekojs/meeko/server";
 *
 * type Chat = SocketChannelDefinition<{ message: Schema<{ text: string }> }, { message: Schema<{ text: string }> }>;
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#websocket
 */
export interface SocketChannelDefinition<C extends SchemaMap, S extends SchemaMap, TServices = unknown> {
  /** Schemas de los eventos que envía el cliente; deben venir de `shared/`. */
  clientToServer: C;
  /** Schemas de los eventos que envía el servidor; deben venir de `shared/`. */
  serverToClient: S;
  /** `"required"` rechaza el handshake sin sesión con `401`. */
  auth?: "required" | "optional";
  /** Autoriza el handshake y cada entrega; `false` responde `403`. */
  authorize?: (args: { context: RequestContext<TServices>; roomId?: string }) => boolean | Promise<boolean>;
  /** Autoriza cada evento entrante. */
  authorizeEvent?: (args: { event: keyof C & string; payload: unknown; context: RequestContext<TServices>; roomId?: string }) => boolean | Promise<boolean>;
  /** Filtra cada envío a un peer: con `false` no lo recibe y sigue conectado. */
  authorizeSend?: (args: { event: keyof S & string; payload: unknown; context: RequestContext<TServices>; roomId?: string }) => boolean | Promise<boolean>;
  /** Handlers de los eventos del cliente, con el payload validado y `emit` hacia ese cliente. */
  handlers?: { [K in keyof C]?: (args: { payload: Output<C[K]>; context: RequestContext<TServices>; roomId?: string; emit: <E extends keyof S & string>(event: E, payload: Output<S[E]>) => Promise<void> }) => void | Promise<void> };
}

/**
 * Declara un canal Socket, el export por defecto de `server/socket/<nombre>.ts`. El generador
 * emite un contrato público con sus schemas, sin importar los handlers, para `socket` y `useSocket`.
 *
 * @param definition Schemas, guardas y handlers.
 * @returns La misma definición, con sus tipos inferidos.
 * @example
 * ```ts
 * // server/socket/chat.ts
 * import { defineSocketChannel } from "@meekojs/meeko/server";
 * import { chatInput, chatMessage } from "../../shared/schemas/chat.js";
 *
 * export default defineSocketChannel({
 *   clientToServer: { message: chatInput },
 *   serverToClient: { message: chatMessage },
 *   auth: "required",
 *   authorize: ({ context, roomId }) => !!context.session.current && roomId === "general",
 *   handlers: { message: async ({ payload, emit }) => emit("message", payload) },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#websocket
 */
export function defineSocketChannel<C extends SchemaMap, S extends SchemaMap, TServices = unknown>(definition: SocketChannelDefinition<C, S, TServices>): SocketChannelDefinition<C, S, TServices> {
  return definition;
}

/**
 * Evento y payload que viajan entre instancias; el payload se vuelve a validar al entregarlo.
 *
 * @example
 * ```ts
 * import type { SocketMessage } from "@meekojs/meeko/server";
 *
 * await pubsub.publish("chat", "general", { event: "message", payload: { text: "Hola" } } satisfies SocketMessage);
 * ```
 */
export interface SocketMessage {
  /** Nombre del evento del servidor. */
  readonly event: string;
  /** Payload sin validar. */
  readonly payload: unknown;
}

/**
 * Cancela una suscripción; puede terminar de forma asíncrona.
 *
 * @example
 * ```ts
 * import type { Unsubscribe } from "@meekojs/meeko/server";
 *
 * const stop: Unsubscribe = await pubsub.subscribe("chat", "general", (message) => console.log(message.event));
 * await stop();
 * ```
 */
export type Unsubscribe = () => void | Promise<void>;

/**
 * Broker entre hubs. `publish` se resuelve cuando el broker acepta el mensaje; la entrega a cada
 * peer suscrito ocurre como mucho una vez y sus fallos nunca llegan al emisor. `subscribe` se
 * resuelve cuando el broker ya escucha. Los listeners del hub nunca rechazan.
 *
 * @example
 * ```ts
 * import type { SocketMessage, SocketPubSub } from "@meekojs/meeko/server";
 *
 * class LoggingPubSub implements SocketPubSub {
 *   constructor(private readonly inner: SocketPubSub) {}
 *   async publish(channel: string, room: string, message: SocketMessage): Promise<void> {
 *     console.info("publish", channel, room, message.event);
 *     await this.inner.publish(channel, room, message);
 *   }
 *   subscribe(channel: string, room: string, listener: (message: SocketMessage) => void | Promise<void>) {
 *     return this.inner.subscribe(channel, room, listener);
 *   }
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#broadcast-y-varias-instancias
 */
export interface SocketPubSub {
  /** Publica un mensaje en el par canal/sala; se resuelve cuando el broker lo acepta. */
  publish(channel: string, room: string, message: SocketMessage): Promise<void>;
  /** Escucha el par canal/sala; se resuelve cuando el broker ya escucha. */
  subscribe(channel: string, room: string, listener: (message: SocketMessage) => void | Promise<void>): Unsubscribe | Promise<Unsubscribe>;
}

/**
 * Opciones de {@link LocalSocketPubSub}.
 *
 * @example
 * ```ts
 * import { LocalSocketPubSub } from "@meekojs/meeko/server";
 *
 * const pubsub = new LocalSocketPubSub({ onListenerError: (error) => console.warn("socket listener", error) });
 * ```
 */
export interface LocalSocketPubSubOptions {
  /** Recibe el fallo de un listener; por defecto, `console.error`. Los listeners del hub nunca fallan. */
  onListenerError?(error: unknown): void;
}

/**
 * Broker de una sola instancia, el que usa el hub por defecto. `publish` también espera los intentos
 * de entrega locales. Para varias instancias, use `RedisSocketPubSub`.
 *
 * @example
 * ```ts
 * import { LocalSocketPubSub } from "@meekojs/meeko/server";
 *
 * const pubsub = new LocalSocketPubSub();
 * const stop = pubsub.subscribe("chat", "general", (message) => console.log(message.payload));
 * await pubsub.publish("chat", "general", { event: "message", payload: { text: "Hola" } });
 * stop();
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#broadcast-y-varias-instancias
 */
export class LocalSocketPubSub implements SocketPubSub {
  private readonly listeners = new Map<string, Set<(message: SocketMessage) => void | Promise<void>>>();
  /** @param options Observador de los fallos de los listeners. */
  constructor(private readonly options: LocalSocketPubSubOptions = {}) {}
  async publish(channel: string, room: string, message: SocketMessage): Promise<void> {
    const listeners = [...this.listeners.get(`${channel}\0${room}`) ?? []];
    await Promise.all(listeners.map(async (listener) => {
      try { await listener(message); }
      catch (error) { this.report(error); }
    }));
  }
  subscribe(channel: string, room: string, listener: (message: SocketMessage) => void | Promise<void>): Unsubscribe {
    const key = `${channel}\0${room}`;
    let listeners = this.listeners.get(key);
    if (!listeners) { listeners = new Set(); this.listeners.set(key, listeners); }
    listeners.add(listener);
    return () => {
      listeners!.delete(listener);
      if (!listeners!.size && this.listeners.get(key) === listeners) this.listeners.delete(key);
    };
  }
  private report(error: unknown): void {
    try {
      if (this.options.onListenerError) this.options.onListenerError(error);
      else console.error("[meeko] Socket listener failed", error);
    } catch { /* Observer failures cannot stop delivery to other listeners. */ }
  }
}

/**
 * Conexión aceptada por el hub, que el adaptador alimenta con los mensajes del peer.
 *
 * @example
 * ```ts
 * const connection = await hub.accept("chat", request, peerOf(socket), "general");
 * socket.addEventListener("message", (event) => void connection.receive(event.data as string));
 * socket.addEventListener("close", () => connection.close());
 * ```
 */
export interface SocketConnection {
  /** Procesa un mensaje del cliente en JSON (texto o bytes UTF-8); uno demasiado grande cierra con `1009` y uno inválido con `1008`. */
  receive(message: string | Uint8Array): Promise<void>;
  /** Valida y envía un evento del servidor a este peer. */
  emit(event: string, payload: unknown): Promise<void>;
  /** Cierra la conexión y la desuscribe de su sala. */
  close(code?: number, reason?: string): void;
}

/**
 * Opciones de {@link createSocketHub}.
 *
 * @typeParam TServices Tipo de los servicios.
 * @example
 * ```ts
 * import type { SocketHubOptions } from "@meekojs/meeko/server";
 *
 * const options: SocketHubOptions = {
 *   channels,
 *   sessions,
 *   services: {},
 *   maxMessageBytes: 16 * 1024,
 *   onDeliveryError: (error, { channel, room, event }) => console.warn(channel, room, event, error),
 * };
 * ```
 */
export interface SocketHubOptions<TServices = unknown> {
  /** Definiciones de los canales por nombre, como las de `loadSocketChannels`. */
  channels: Readonly<Record<string, unknown>>;
  /** Gestor de sesiones. */
  sessions: SessionManager;
  /** Servicios compartidos o una función que los crea en cada handshake. */
  services: TServices | ((request: Request) => TServices | Promise<TServices>);
  /** Orígenes adicionales aceptados en el handshake. */
  allowedOrigins?: readonly string[];
  /** Mensaje entrante o saliente más grande, serializado; `broadcast` rechaza los mayores. Por defecto, 64 KiB. */
  maxMessageBytes?: number;
  /** Bytes salientes pendientes por peer antes de cerrarlo; 1 MiB por defecto. */
  maxBufferBytes?: number;
  /**
   * Entregas del broker en espera para un peer local, contando la que está en curso. Un peer más
   * retrasado se cierra con `1013` y se informa con `SOCKET_BACKLOG_EXCEEDED`. Por defecto, 256.
   */
  maxPendingDeliveries?: number;
  /**
   * Milisegundos durante los que las entregas reutilizan la última lectura de sesión del peer en
   * lugar de releer el store. Una revocación cierra el peer al momento mediante
   * `SessionHandle.signal`; `0` relee en cada entrega. La autorización se ejecuta en cada entrega.
   * Por defecto, 1000.
   */
  sessionRefreshMs?: number;
  /** Broker entre instancias; por defecto, `LocalSocketPubSub`. */
  pubsub?: SocketPubSub;
  /** Runtime que se expone en `RequestContext.platform` en los callbacks del canal. */
  platform?: ServerPlatform;
  /**
   * Recibe las entregas fallidas a un peer local, que se cierra, y las desuscripciones asíncronas
   * fallidas (sin `event`). Nunca llega al emisor. Por defecto, `console.error`.
   */
  onDeliveryError?(error: unknown, context: SocketDeliveryErrorContext): void;
}

/**
 * Dónde falló una entrega; `event` no existe en los fallos de desuscripción.
 *
 * @example
 * ```ts
 * import type { SocketDeliveryErrorContext } from "@meekojs/meeko/server";
 *
 * const describe = ({ channel, room, event }: SocketDeliveryErrorContext): string =>
 *   event ? `${channel}/${room}: ${event}` : `${channel}/${room}: desuscripción`;
 * ```
 */
export interface SocketDeliveryErrorContext {
  /** Canal. */
  readonly channel: string;
  /** Sala. */
  readonly room: string;
  /** Evento que no se pudo entregar. */
  readonly event?: string;
}

/**
 * Hub de Socket: autoriza handshakes, acepta conexiones y reparte broadcasts. El host hace el
 * upgrade HTTP y le pasa el peer conectado.
 *
 * @example
 * ```ts
 * // Un broadcast desde una API o una tarea programada.
 * await hub.broadcast("chat", "general", "message", { text: "Mantenimiento en 5 minutos" });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#broadcast-y-varias-instancias
 */
export interface SocketHub {
  /** Comprueba canal, Origin, sesión y autorización antes del upgrade; rechaza con `ApiError`. */
  preflight(name: string, request: Request, roomId?: string): Promise<void>;
  /** Acepta un peer; se resuelve cuando la conexión ya está suscrita a su canal y sala. */
  accept(name: string, request: Request, peer: SocketPeer, roomId?: string): Promise<SocketConnection>;
  /**
   * Valida el evento y se resuelve cuando el broker lo acepta. Rechaza con
   * `SOCKET_LIMIT_EXCEEDED` (413), antes de publicar, si el mensaje serializado supera
   * `maxMessageBytes`. Cada peer lo recibe como mucho una vez; un peer que falla se cierra y se
   * informa con `onDeliveryError` en el hub que lo tiene.
   */
  broadcast(name: string, roomId: string, event: string, payload: unknown): Promise<void>;
}

const encoder = new TextEncoder();

async function validate(schema: Schema, value: unknown): Promise<unknown> {
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues) throw new ApiError("INVALID_SOCKET_PAYLOAD", 400);
  return (result as { value: unknown }).value;
}

function channelDefinition(value: unknown): SocketChannelDefinition<SchemaMap, SchemaMap> {
  if (!value || typeof value !== "object" || !("clientToServer" in value) || !("serverToClient" in value)) throw new ApiError("UNKNOWN_SOCKET_CHANNEL", 404);
  return value as SocketChannelDefinition<SchemaMap, SchemaMap>;
}

function originAllowed(request: Request, allowedOrigins: readonly string[]): boolean {
  const origin = request.headers.get("origin");
  return !!origin && (origin === new URL(request.url).origin || allowedOrigins.includes(origin));
}

/**
 * Crea el hub de Socket de un host propio. El host hace el upgrade HTTP y pasa el peer conectado a
 * `hub.accept`. El hub valida Origin, sesión, canal, sala, evento y payload, y aplica los límites
 * de mensaje, búfer y cola.
 *
 * @param options Canales, sesiones, servicios, límites y broker.
 * @returns El hub.
 * @throws {RangeError} Si algún límite no es válido.
 * @example
 * ```ts
 * import { createSocketHub, loadSocketChannels } from "@meekojs/meeko/server";
 *
 * const hub = createSocketHub({
 *   channels: await loadSocketChannels(manifest, load),
 *   sessions,
 *   services: {},
 *   pubsub,
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#websocket
 */
export function createSocketHub<TServices>(options: SocketHubOptions<TServices>): SocketHub {
  const maxMessageBytes = options.maxMessageBytes ?? 64 * 1024;
  const maxBufferBytes = options.maxBufferBytes ?? 1024 * 1024;
  const maxPendingDeliveries = options.maxPendingDeliveries ?? 256;
  const sessionRefreshMs = options.sessionRefreshMs ?? 1000;
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes <= 0 || !Number.isSafeInteger(maxBufferBytes) || maxBufferBytes <= 0 ||
      !Number.isSafeInteger(maxPendingDeliveries) || maxPendingDeliveries <= 0 || !Number.isFinite(sessionRefreshMs) || sessionRefreshMs < 0) {
    throw new RangeError("Invalid socket limits");
  }
  const pubsub = options.pubsub ?? new LocalSocketPubSub();
  const getDefinition = (name: string) => channelDefinition(options.channels[name]);
  const authorizeHandshake = async (name: string, request: Request, roomId?: string) => {
    const definition = getDefinition(name);
    if (!originAllowed(request, options.allowedOrigins ?? [])) throw new ApiError("INVALID_ORIGIN", 403);
    const session = await options.sessions.load(request);
    if (definition.auth === "required" && !session.current) throw new ApiError("UNAUTHENTICATED", 401);
    const services = typeof options.services === "function" ? await (options.services as (request: Request) => TServices | Promise<TServices>)(request) : options.services;
    const context = createRequestContext(request, services, session, options.platform);
    if (definition.authorize && !(await definition.authorize({ context, ...(roomId === undefined ? {} : { roomId }) }))) throw new ApiError("FORBIDDEN", 403);
    return { definition, services, session };
  };
  const reportDelivery = (error: unknown, context: SocketDeliveryErrorContext): void => {
    const observer = options.onDeliveryError;
    if (observer) observeErrorCallback(error, (failure) => observer(failure, context));
    else {
      try { console.error(`[meeko] Socket delivery failed (${context.channel}${context.event ? `:${context.event}` : ""})`, error); }
      catch { /* Logging cannot interrupt delivery to other peers. */ }
    }
  };
  const hub: SocketHub = {
    async preflight(name, request, roomId) { await authorizeHandshake(name, request, roomId); },
    async accept(name: string, request: Request, peer: SocketPeer, roomId?: string): Promise<SocketConnection> {
      const { definition, services, session } = await authorizeHandshake(name, request, roomId);
      if (session.signal.aborted) throw new SessionRevokedError();
      const room = roomId ?? "";
      const scope = roomId === undefined ? {} : { roomId };
      let closed = false;
      let release: Unsubscribe | undefined;
      // Revocations arrive through `signal`; other changes (expiry, rotation, a
      // deletion without notice) are seen when the session is reloaded.
      let deliverySession: SessionHandle = session;
      let deliverySessionAt = Date.now();
      let reloading: Promise<SessionHandle> | undefined;
      const remember = (fresh: SessionHandle): SessionHandle => {
        deliverySession = fresh;
        deliverySessionAt = Date.now();
        return fresh;
      };
      const sessionForDelivery = (): Promise<SessionHandle> => {
        const now = Date.now();
        const expiresAt = deliverySession.current?.expiresAt;
        if (!deliverySession.signal.aborted && now - deliverySessionAt < sessionRefreshMs && (expiresAt === undefined || expiresAt > now)) {
          return Promise.resolve(deliverySession);
        }
        return reloading ??= options.sessions.load(request).then(remember).finally(() => { reloading = undefined; });
      };
      // `broadcast` deliveries skip peers refused by `authorizeSend`; direct emits fail.
      const deliver = async (event: string, payload: unknown, broadcast: boolean): Promise<void> => {
        if (closed) throw new ApiError("SOCKET_DISCONNECTED", 409);
        const schema = definition.serverToClient[event];
        if (!schema) throw new ApiError("UNKNOWN_SOCKET_EVENT", 404);
        const checked = await validate(schema, payload);
        const fresh = await sessionForDelivery();
        if (definition.auth === "required" && !fresh.current) failAndClose(new ApiError("UNAUTHENTICATED", 401), 1008, "Session expired");
        const sendContext = createRequestContext(request, services, fresh, options.platform);
        if (definition.authorize && !(await definition.authorize({ context: sendContext, ...scope }))) throw new ApiError("FORBIDDEN", 403);
        if (definition.authorizeSend && !(await definition.authorizeSend({ event, payload: checked, context: sendContext, ...scope }))) {
          if (broadcast) return;
          throw new ApiError("FORBIDDEN", 403);
        }
        const message = serializeJson({ event, payload: checked });
        const messageBytes = encoder.encode(message).byteLength;
        // `broadcast` already rejects oversized messages; this protects receivers with a smaller limit.
        if (messageBytes > maxMessageBytes || (peer.bufferedAmount ?? 0) + messageBytes > maxBufferBytes) {
          failAndClose(new ApiError("SOCKET_LIMIT_EXCEEDED", 413), 1009, "Message too large");
        }
        if (closed) throw new ApiError("SOCKET_DISCONNECTED", 409);
        try { await peer.send(message); }
        catch (error) {
          try { close(1011, "Send failed"); }
          catch (closeError) { throw new AggregateError([error, closeError], "Socket send and close failed"); }
          throw error;
        }
      };
      const emit = (event: string, payload: unknown): Promise<void> => deliver(event, payload, false);
      // Broker deliveries run one at a time per peer, in arrival order, and never reject.
      let queue: Promise<void> = Promise.resolve();
      let pending = 0;
      const receiveBroadcast = ({ event, payload }: SocketMessage): Promise<void> => {
        if (closed) return Promise.resolve();
        if (pending >= maxPendingDeliveries) {
          // A peer that cannot keep up is dropped instead of buffering without bound.
          const error = new ApiError("SOCKET_BACKLOG_EXCEEDED", 503);
          try { close(1013, "Delivery backlog exceeded"); }
          catch (closeError) { error.cause = closeError; }
          reportDelivery(error, { channel: name, room, event });
          return Promise.resolve();
        }
        pending++;
        queue = queue.then(async () => {
          try {
            if (closed) return;
            await deliver(event, payload, true);
          } catch (error) {
            if (closed && error instanceof ApiError && error.code === "SOCKET_DISCONNECTED") return;
            // A malformed message is not the peer's fault; every other failure closes it.
            const messageFault = error instanceof ApiError && (error.code === "INVALID_SOCKET_PAYLOAD" || error.code === "UNKNOWN_SOCKET_EVENT");
            if (!messageFault && !closed) {
              try { close(normalizeServerError(error).status < 500 ? 1008 : 1011, "Delivery failed"); }
              catch (closeError) { reportDelivery(closeError, { channel: name, room, event }); }
            }
            reportDelivery(error, { channel: name, room, event });
          } finally {
            pending--;
          }
        });
        return queue;
      };
      const onRevoked = (): void => {
        try { close(1008, "Session revoked"); }
        catch (error) { reportDelivery(error, { channel: name, room }); }
      };
      const unsubscribe = (): void => {
        const current = release;
        release = undefined;
        if (!current) return;
        const pending = current();
        if (pending && typeof (pending as Promise<void>).then === "function") {
          void (pending as Promise<void>).then(undefined, (error: unknown) => reportDelivery(error, { channel: name, room }));
        }
      };
      const close = (code?: number, reason?: string): void => {
        if (closed) return;
        closed = true;
        session.signal.removeEventListener("abort", onRevoked);
        const failures: unknown[] = [];
        try { unsubscribe(); }
        catch (error) { failures.push(error); }
        try { peer.close(code, reason); }
        catch (error) { failures.push(error); }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) throw new AggregateError(failures, "Socket unsubscribe and peer close failed");
      };
      function failAndClose(error: ApiError, code: number, reason: string): never {
        try { close(code, reason); }
        catch (cleanupError) { error.cause = cleanupError; }
        throw error;
      }
      release = await pubsub.subscribe(name, room, receiveBroadcast);
      // A delivery during `subscribe` may already have closed the peer, before `release` existed.
      if (closed || session.signal.aborted) {
        const disconnected = closed;
        closed = true;
        unsubscribe();
        throw disconnected ? new ApiError("SOCKET_DISCONNECTED", 409) : new SessionRevokedError();
      }
      // Revoking the handshake session's family closes the connection immediately.
      session.signal.addEventListener("abort", onRevoked, { once: true });
      return {
        emit,
        close,
        async receive(raw) {
          if (closed) throw new ApiError("SOCKET_DISCONNECTED", 409);
          const bytes = typeof raw === "string" ? encoder.encode(raw) : raw;
          if (bytes.byteLength > maxMessageBytes) failAndClose(new ApiError("SOCKET_LIMIT_EXCEEDED", 413), 1009, "Message too large");
          let envelope: unknown;
          try { envelope = JSON.parse(typeof raw === "string" ? raw : new TextDecoder("utf-8", { fatal: true }).decode(raw)) as unknown; }
          catch { failAndClose(new ApiError("INVALID_SOCKET_MESSAGE", 400), 1008, "Invalid message"); }
          if (!envelope || typeof envelope !== "object" || typeof (envelope as { event?: unknown }).event !== "string" || !("payload" in envelope)) {
            failAndClose(new ApiError("INVALID_SOCKET_MESSAGE", 400), 1008, "Invalid message");
          }
          const event = (envelope as { event?: unknown }).event as string;
          const schema = definition.clientToServer[event];
          if (!schema) failAndClose(new ApiError("UNKNOWN_SOCKET_EVENT", 404), 1008, "Unknown event");
          const payload = await validate(schema, (envelope as { payload: unknown }).payload);
          // Re-read storage and policy for every event, including after a session revocation.
          const fresh = remember(await options.sessions.load(request));
          if (definition.auth === "required" && !fresh.current) failAndClose(new ApiError("UNAUTHENTICATED", 401), 1008, "Session expired");
          const eventContext = createRequestContext(request, services, fresh, options.platform);
          if (definition.authorize && !(await definition.authorize({ context: eventContext, ...(roomId === undefined ? {} : { roomId }) }))) throw new ApiError("FORBIDDEN", 403);
          if (definition.authorizeEvent && !(await definition.authorizeEvent({ event, payload, context: eventContext, ...(roomId === undefined ? {} : { roomId }) }))) throw new ApiError("FORBIDDEN", 403);
          const handler = definition.handlers?.[event];
          if (!handler) throw new ApiError("UNHANDLED_SOCKET_EVENT", 404);
          // A handler can broadcast to its own or another room with the generated server `socket`.
          await withSocketHub(hub, () => handler({ payload, context: eventContext, ...(roomId === undefined ? {} : { roomId }), emit }));
        },
      };
    },
    async broadcast(name: string, roomId: string, event: string, payload: unknown): Promise<void> {
      const definition = getDefinition(name);
      const schema = definition.serverToClient[event];
      if (!schema) throw new ApiError("UNKNOWN_SOCKET_EVENT", 404);
      const checked = await validate(schema, payload);
      // Escaping can grow a payload past the limit; rejecting here spares every peer a `1009` close.
      if (encoder.encode(serializeJson({ event, payload: checked })).byteLength > maxMessageBytes) throw new ApiError("SOCKET_LIMIT_EXCEEDED", 413);
      await pubsub.publish(name, roomId, { event, payload: checked });
    },
  };
  return hub;
}

/**
 * Broadcast tipado de un canal Socket desde el servidor, que añade el registro `socket` de los
 * clientes de servidor generados (desde `1.2`).
 *
 * @typeParam C Contrato público del canal.
 * @since 1.2.0
 * @example
 * ```ts
 * import type { SocketBroadcaster } from "@meekojs/meeko/server";
 *
 * declare const kitchen: SocketBroadcaster<typeof socketContracts.operations>;
 * await kitchen.broadcast("store-12", "kitchenChanged", { orderId: "A-31", status: "ready" });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#broadcast-desde-el-servidor
 */
export interface SocketBroadcaster<C extends SocketContract> {
  /**
   * Publica `event` en la sala `roomId` del canal con las mismas comprobaciones que
   * `hub.broadcast`: rechaza con `UNKNOWN_SOCKET_EVENT` (404), `INVALID_SOCKET_PAYLOAD` (400) o
   * `SOCKET_LIMIT_EXCEEDED` (413) antes de publicar, y se resuelve cuando el broker acepta el
   * mensaje. Las conexiones sin sala usan `""`.
   */
  broadcast<K extends keyof C["serverToClient"] & string>(roomId: string, event: K, payload: SchemaInput<C["serverToClient"][K]>): Promise<void>;
}

/**
 * Registro `socket` de los clientes de servidor generados (`clients.server.ts`): por cada canal,
 * el mismo tipo que en el navegador más `broadcast` (desde `1.2`). En el servidor los miembros del
 * cliente (`on`, `emit`, `state`, `close`) lanzan un error, porque no hay conexión durante SSR.
 *
 * @typeParam C Contratos públicos por nombre de canal.
 * @since 1.2.0
 * @example
 * ```ts
 * import { createServerSocketRegistry } from "@meekojs/meeko/server";
 * import type { ServerSocketRegistry } from "@meekojs/meeko/server";
 * import { socketContracts } from "./socket-contracts.js";
 *
 * export const socket: ServerSocketRegistry<typeof socketContracts> = createServerSocketRegistry(socketContracts);
 * ```
 */
export type ServerSocketRegistry<C extends Record<string, SocketContract>> = {
  readonly [K in keyof C]: SocketClient<C[K]> & SocketBroadcaster<C[K]>;
};

/**
 * Opciones de {@link createServerSocketRegistry}.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import { createServerSocketRegistry } from "@meekojs/meeko/server";
 * import type { ServerSocketRegistryOptions } from "@meekojs/meeko/server";
 *
 * const options: ServerSocketRegistryOptions = { hub: () => app.socket?.hub };
 * const socket = createServerSocketRegistry(socketContracts, options);
 * ```
 */
export interface ServerSocketRegistryOptions {
  /**
   * Hub al que publica `broadcast`, o una función que lo devuelve en cada llamada. Sin él, se usa
   * el de la aplicación que atiende la petición o el handler de Socket en curso; sirve para el
   * trabajo que empieza fuera de ellos, como una tarea programada al arrancar.
   */
  readonly hub?: SocketHub | (() => SocketHub | undefined);
}

const ssrUnavailable = (): never => { throw new Error("Socket connections are unavailable during SSR"); };

/**
 * Crea el registro `socket` de los clientes de servidor: cada canal ofrece
 * `broadcast(roomId, event, payload)`, tipado por su contrato público y validado por el hub con la
 * definición del canal. Sin `options.hub`, publica en el hub de la aplicación de la petición HTTP
 * (API, RPC, páginas y middleware, también su trabajo asíncrono, como `platform.waitUntil`) o del
 * handler de Socket en curso. Los clientes generados lo usan para el autoimport `socket` de
 * servidor.
 *
 * @param contracts Contratos públicos por nombre de canal.
 * @param options Hub explícito para el trabajo fuera de una petición.
 * @returns El registro tipado.
 * @throws {Error} Desde `broadcast`, sin `options.hub` y fuera de una petición o de un handler de
 * Socket de una aplicación con canales.
 * @since 1.2.0
 * @example
 * ```ts
 * // server/api/orders/[id]/ready.post.ts, con el autoimport `socket` de servidor
 * import { defineApiRoute } from "@meekojs/meeko/server";
 * import { orderParams, orderSchema } from "../../../../shared/schemas/order.js";
 * import { markReady } from "../../../utils/orders.js";
 *
 * export default defineApiRoute({
 *   params: orderParams,
 *   response: orderSchema,
 *   handler: async ({ params }) => {
 *     const order = await markReady(params.id);
 *     await socket.operations.broadcast(order.storeId, "kitchenChanged", { orderId: order.id, status: "ready" });
 *     return order;
 *   },
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#broadcast-desde-el-servidor
 */
export function createServerSocketRegistry<C extends Record<string, SocketContract>>(contracts: C, options: ServerSocketRegistryOptions = {}): ServerSocketRegistry<C> {
  const resolveHub = (name: string): SocketHub => {
    const explicit = typeof options.hub === "function" ? options.hub() : options.hub;
    const hub = explicit ?? activeHub.getStore();
    if (!hub) {
      throw new Error(`socket.${name}.broadcast() requires an active Meeko request or Socket handler of an application with Socket channels; `
        + "outside them, pass the application's hub with createServerSocketRegistry(contracts, { hub: () => app.socket?.hub })");
    }
    return hub;
  };
  const result: Record<string, unknown> = Object.create(null);
  for (const name of Object.keys(contracts)) {
    const channel = Object.create(null, {
      state: { get: ssrUnavailable, enumerable: true },
      on: { value: ssrUnavailable, enumerable: true },
      emit: { value: ssrUnavailable, enumerable: true },
      close: { value: ssrUnavailable, enumerable: true },
      broadcast: {
        enumerable: true,
        value: async (roomId: string, event: string, payload: unknown): Promise<void> => {
          if (typeof roomId !== "string") throw new TypeError("Socket broadcast requires a room ID string");
          await resolveHub(name).broadcast(name, roomId, event, payload);
        },
      },
    }) as object;
    Object.defineProperty(result, name, { value: Object.freeze(channel), enumerable: true });
  }
  return Object.freeze(result) as ServerSocketRegistry<C>;
}
