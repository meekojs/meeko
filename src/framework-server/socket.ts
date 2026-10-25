import { createRequestContext, type RequestContext } from "./context.js";
import { ApiError, normalizeServerError, observeErrorCallback, SessionRevokedError, type Schema } from "./contracts.js";
import { serializeJson } from "../server.js";
import type { SessionManager } from "./sessions.js";
import type { ServerPlatform } from "./platform.js";

type Output<S> = S extends Schema<unknown, infer O> ? O : never;
type SchemaMap = Readonly<Record<string, Schema>>;

export interface SocketPeer {
  send(message: string): void | Promise<void>;
  close(code?: number, reason?: string): void;
  readonly bufferedAmount?: number;
}

export interface SocketChannelDefinition<C extends SchemaMap, S extends SchemaMap, TServices = unknown> {
  clientToServer: C;
  serverToClient: S;
  auth?: "required" | "optional";
  authorize?: (args: { context: RequestContext<TServices>; roomId?: string }) => boolean | Promise<boolean>;
  authorizeEvent?: (args: { event: keyof C & string; payload: unknown; context: RequestContext<TServices>; roomId?: string }) => boolean | Promise<boolean>;
  authorizeSend?: (args: { event: keyof S & string; payload: unknown; context: RequestContext<TServices>; roomId?: string }) => boolean | Promise<boolean>;
  handlers?: { [K in keyof C]?: (args: { payload: Output<C[K]>; context: RequestContext<TServices>; roomId?: string; emit: <E extends keyof S & string>(event: E, payload: Output<S[E]>) => Promise<void> }) => void | Promise<void> };
}

export function defineSocketChannel<C extends SchemaMap, S extends SchemaMap, TServices = unknown>(definition: SocketChannelDefinition<C, S, TServices>): SocketChannelDefinition<C, S, TServices> {
  return definition;
}

/** Event and payload carried between instances; payloads are validated again on delivery. */
export interface SocketMessage {
  readonly event: string;
  readonly payload: unknown;
}

/** Releases a subscription; may finish asynchronously. */
export type Unsubscribe = () => void | Promise<void>;

/**
 * Broker between hubs. `publish` resolves once the broker accepts the message;
 * delivery to each subscribed peer happens at most once and its failures never
 * reach the publisher. `subscribe` resolves once the broker is listening.
 */
export interface SocketPubSub {
  publish(channel: string, room: string, message: SocketMessage): Promise<void>;
  subscribe(channel: string, room: string, listener: (message: SocketMessage) => void | Promise<void>): Unsubscribe | Promise<Unsubscribe>;
}

export interface LocalSocketPubSubOptions {
  /** Receives a listener failure; defaults to `console.error`. Hub listeners never fail. */
  onListenerError?(error: unknown): void;
}

/** Single-instance broker; `publish` also waits for local delivery attempts. */
export class LocalSocketPubSub implements SocketPubSub {
  private readonly listeners = new Map<string, Set<(message: SocketMessage) => void | Promise<void>>>();
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

export interface SocketConnection {
  receive(message: string | Uint8Array): Promise<void>;
  emit(event: string, payload: unknown): Promise<void>;
  close(code?: number, reason?: string): void;
}

export interface SocketHubOptions<TServices = unknown> {
  channels: Readonly<Record<string, unknown>>;
  sessions: SessionManager;
  services: TServices | ((request: Request) => TServices | Promise<TServices>);
  allowedOrigins?: readonly string[];
  maxMessageBytes?: number;
  maxBufferBytes?: number;
  pubsub?: SocketPubSub;
  /** Runtime exposed through `RequestContext.platform` in channel callbacks. */
  platform?: ServerPlatform;
  /**
   * Receives a failed delivery to a local peer, which is closed, and failed
   * asynchronous unsubscriptions (without `event`). Never reaches the
   * broadcaster. Defaults to `console.error`.
   */
  onDeliveryError?(error: unknown, context: SocketDeliveryErrorContext): void;
}

/** Where a delivery failed; `event` is absent for unsubscription failures. */
export interface SocketDeliveryErrorContext {
  readonly channel: string;
  readonly room: string;
  readonly event?: string;
}

export interface SocketHub {
  preflight(name: string, request: Request, roomId?: string): Promise<void>;
  /** Resolves once the connection is subscribed to its channel and room. */
  accept(name: string, request: Request, peer: SocketPeer, roomId?: string): Promise<SocketConnection>;
  /**
   * Validates the event and resolves once the broker accepts it. Each peer
   * receives it at most once; a peer that fails is closed and reported through
   * `onDeliveryError` on the hub that owns it.
   */
  broadcast(name: string, roomId: string, event: string, payload: unknown): Promise<void>;
}

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

/** The host performs the HTTP upgrade, then passes its connected peer here. */
export function createSocketHub<TServices>(options: SocketHubOptions<TServices>): SocketHub {
  const maxMessageBytes = options.maxMessageBytes ?? 64 * 1024;
  const maxBufferBytes = options.maxBufferBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes <= 0 || !Number.isSafeInteger(maxBufferBytes) || maxBufferBytes <= 0) throw new RangeError("Invalid socket limits");
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
  return {
    async preflight(name, request, roomId) { await authorizeHandshake(name, request, roomId); },
    async accept(name: string, request: Request, peer: SocketPeer, roomId?: string): Promise<SocketConnection> {
      const { definition, services, session } = await authorizeHandshake(name, request, roomId);
      if (session.signal.aborted) throw new SessionRevokedError();
      const room = roomId ?? "";
      const scope = roomId === undefined ? {} : { roomId };
      let closed = false;
      let release: Unsubscribe | undefined;
      // `broadcast` deliveries skip peers refused by `authorizeSend`; direct emits fail.
      const deliver = async (event: string, payload: unknown, broadcast: boolean): Promise<void> => {
        if (closed) throw new ApiError("SOCKET_DISCONNECTED", 409);
        const schema = definition.serverToClient[event];
        if (!schema) throw new ApiError("UNKNOWN_SOCKET_EVENT", 404);
        const checked = await validate(schema, payload);
        const fresh = await options.sessions.load(request);
        if (definition.auth === "required" && !fresh.current) failAndClose(new ApiError("UNAUTHENTICATED", 401), 1008, "Session expired");
        const sendContext = createRequestContext(request, services, fresh, options.platform);
        if (definition.authorize && !(await definition.authorize({ context: sendContext, ...scope }))) throw new ApiError("FORBIDDEN", 403);
        if (definition.authorizeSend && !(await definition.authorizeSend({ event, payload: checked, context: sendContext, ...scope }))) {
          if (broadcast) return;
          throw new ApiError("FORBIDDEN", 403);
        }
        const message = serializeJson({ event, payload: checked });
        const messageBytes = new TextEncoder().encode(message).byteLength;
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
      const receiveBroadcast = ({ event, payload }: SocketMessage): Promise<void> => {
        queue = queue.then(async () => {
          if (closed) return;
          try { await deliver(event, payload, true); }
          catch (error) {
            if (closed && error instanceof ApiError && error.code === "SOCKET_DISCONNECTED") return;
            // A malformed message is not the peer's fault; every other failure closes it.
            const messageFault = error instanceof ApiError && (error.code === "INVALID_SOCKET_PAYLOAD" || error.code === "UNKNOWN_SOCKET_EVENT");
            if (!messageFault && !closed) {
              try { close(normalizeServerError(error).status < 500 ? 1008 : 1011, "Delivery failed"); }
              catch (closeError) { reportDelivery(closeError, { channel: name, room, event }); }
            }
            reportDelivery(error, { channel: name, room, event });
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
      if (session.signal.aborted) {
        closed = true;
        unsubscribe();
        throw new SessionRevokedError();
      }
      // Revoking the handshake session's family closes the connection immediately.
      session.signal.addEventListener("abort", onRevoked, { once: true });
      return {
        emit,
        close,
        async receive(raw) {
          if (closed) throw new ApiError("SOCKET_DISCONNECTED", 409);
          const bytes = typeof raw === "string" ? new TextEncoder().encode(raw) : raw;
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
          const fresh = await options.sessions.load(request);
          if (definition.auth === "required" && !fresh.current) failAndClose(new ApiError("UNAUTHENTICATED", 401), 1008, "Session expired");
          const eventContext = createRequestContext(request, services, fresh, options.platform);
          if (definition.authorize && !(await definition.authorize({ context: eventContext, ...(roomId === undefined ? {} : { roomId }) }))) throw new ApiError("FORBIDDEN", 403);
          if (definition.authorizeEvent && !(await definition.authorizeEvent({ event, payload, context: eventContext, ...(roomId === undefined ? {} : { roomId }) }))) throw new ApiError("FORBIDDEN", 403);
          const handler = definition.handlers?.[event];
          if (!handler) throw new ApiError("UNHANDLED_SOCKET_EVENT", 404);
          await handler({ payload, context: eventContext, ...(roomId === undefined ? {} : { roomId }), emit });
        },
      };
    },
    async broadcast(name: string, roomId: string, event: string, payload: unknown): Promise<void> {
      const definition = getDefinition(name);
      const schema = definition.serverToClient[event];
      if (!schema) throw new ApiError("UNKNOWN_SOCKET_EVENT", 404);
      const checked = await validate(schema, payload);
      serializeJson({ event, payload: checked });
      await pubsub.publish(name, roomId, { event, payload: checked });
    },
  };
}
