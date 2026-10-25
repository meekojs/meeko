import { createRequestContext, type RequestContext } from "./context.js";
import { ApiError, type Schema } from "./contracts.js";
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

export interface SocketPubSub {
  publish(channel: string, room: string, message: { event: string; payload: unknown }): Promise<void>;
  subscribe(channel: string, room: string, listener: (message: { event: string; payload: unknown }) => void | Promise<void>): () => void;
}

export class LocalSocketPubSub implements SocketPubSub {
  private readonly listeners = new Map<string, Set<(message: { event: string; payload: unknown }) => void | Promise<void>>>();
  async publish(channel: string, room: string, message: { event: string; payload: unknown }): Promise<void> {
    const errors: unknown[] = [];
    for (const listener of this.listeners.get(`${channel}\0${room}`) ?? []) {
      try { await listener(message); }
      catch (error) { errors.push(error); }
    }
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, "Socket delivery failed for multiple peers");
  }
  subscribe(channel: string, room: string, listener: (message: { event: string; payload: unknown }) => void | Promise<void>): () => void {
    const key = `${channel}\0${room}`;
    let listeners = this.listeners.get(key);
    if (!listeners) { listeners = new Set(); this.listeners.set(key, listeners); }
    listeners.add(listener);
    return () => {
      listeners!.delete(listener);
      if (!listeners!.size) this.listeners.delete(key);
    };
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
}

export interface SocketHub {
  preflight(name: string, request: Request, roomId?: string): Promise<void>;
  accept(name: string, request: Request, peer: SocketPeer, roomId?: string): Promise<SocketConnection>;
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
    return { definition, services };
  };
  return {
    async preflight(name, request, roomId) { await authorizeHandshake(name, request, roomId); },
    async accept(name: string, request: Request, peer: SocketPeer, roomId?: string): Promise<SocketConnection> {
      const { definition, services } = await authorizeHandshake(name, request, roomId);
      let closed = false;
      const emit = async (event: string, payload: unknown): Promise<void> => {
        if (closed) throw new ApiError("SOCKET_DISCONNECTED", 409);
        const schema = definition.serverToClient[event];
        if (!schema) throw new ApiError("UNKNOWN_SOCKET_EVENT", 404);
        const checked = await validate(schema, payload);
        const fresh = await options.sessions.load(request);
        if (definition.auth === "required" && !fresh.current) failAndClose(new ApiError("UNAUTHENTICATED", 401), 1008, "Session expired");
        const sendContext = createRequestContext(request, services, fresh, options.platform);
        if (definition.authorize && !(await definition.authorize({ context: sendContext, ...(roomId === undefined ? {} : { roomId }) }))) throw new ApiError("FORBIDDEN", 403);
        if (definition.authorizeSend && !(await definition.authorizeSend({ event, payload: checked, context: sendContext, ...(roomId === undefined ? {} : { roomId }) }))) throw new ApiError("FORBIDDEN", 403);
        const message = serializeJson({ event, payload: checked });
        const messageBytes = new TextEncoder().encode(message).byteLength;
        if (messageBytes > maxMessageBytes || (peer.bufferedAmount ?? 0) + messageBytes > maxBufferBytes) {
          failAndClose(new ApiError("SOCKET_LIMIT_EXCEEDED", 413), 1009, "Message too large");
        }
        try { await peer.send(message); }
        catch (error) {
          try { close(1011, "Send failed"); }
          catch (closeError) { throw new AggregateError([error, closeError], "Socket send and close failed"); }
          throw error;
        }
      };
      const release = pubsub.subscribe(name, roomId ?? "", ({ event, payload }) => emit(event, payload));
      const close = (code?: number, reason?: string): void => {
        if (closed) return;
        closed = true;
        const failures: unknown[] = [];
        try { release(); }
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
