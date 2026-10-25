import { currentEffectOwner, onCleanup, signal } from "../reactivity.js";
import type { ReadonlySignal } from "../reactivity.js";
import { logClientError, observeCallback } from "../error-observer.js";
import { currentAppErrorChannel, currentComponentErrorHandler } from "../component-errors.js";
import { serializeJson } from "../server.js";

export interface SocketSchema<I = unknown, O = I> {
  readonly "~standard": {
    readonly version: 1;
    readonly validate: (value: unknown) => { value: O; issues?: undefined } | { issues: readonly unknown[] } | Promise<{ value: O; issues?: undefined } | { issues: readonly unknown[] }>;
    readonly types?: { readonly input: I; readonly output: O } | undefined;
  };
}

type SchemaInput<T> = T extends { readonly "~standard": { readonly types?: infer U } }
  ? NonNullable<U> extends { readonly input: infer I } ? I : never
  : T extends SocketSchema<infer I, unknown> ? I : never;
type SchemaOutput<T> = T extends { readonly "~standard": { readonly types?: infer U } }
  ? NonNullable<U> extends { readonly output: infer O } ? O : never
  : T extends SocketSchema<unknown, infer O> ? O : never;
type Events = Record<string, SocketSchema>;

export interface SocketContract<ClientToServer extends Events = Events, ServerToClient extends Events = Events> {
  readonly clientToServer: ClientToServer;
  readonly serverToClient: ServerToClient;
}

export interface SocketClient<C extends SocketContract> {
  readonly state: ReadonlySignal<"connecting" | "open" | "closed">;
  emit<K extends keyof C["clientToServer"] & string>(event: K, data: SchemaInput<C["clientToServer"][K]>): Promise<void>;
  on<K extends keyof C["serverToClient"] & string>(event: K, listener: (data: SchemaOutput<C["serverToClient"][K]>) => void): () => void;
  close(): void;
}

export interface SocketClientOptions {
  readonly retryMs?: number;
  readonly maxRetryMs?: number;
  readonly maxMessageBytes?: number;
  readonly webSocketFactory?: (url: string) => WebSocket;
  /** Receives invalid inbound messages and consumer listener failures. */
  readonly onError?: (error: unknown) => void;
}

export interface SocketRegistryOptions extends SocketClientOptions {
  /** HTTP(S) or WS(S) base URL. Defaults to the current browser origin. */
  readonly baseUrl?: string;
  readonly pathnamePrefix?: string;
  readonly roomId?: string;
}

export type SocketRegistry<C extends Record<string, SocketContract>> = {
  readonly [K in keyof C]: SocketClient<C[K]>;
};

function socketUrl(name: string, options: SocketRegistryOptions): string {
  if (typeof window === "undefined") throw new Error("Socket connections are unavailable during SSR");
  const prefix = options.pathnamePrefix ?? "/_meeko/socket";
  if (!prefix.startsWith("/") || prefix.endsWith("/")) throw new TypeError("Invalid socket pathname prefix");
  const url = new URL(`${prefix}/${encodeURIComponent(name)}`, options.baseUrl ?? window.location.href);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new TypeError("Invalid socket URL protocol");
  if (options.roomId !== undefined) url.searchParams.set("room", options.roomId);
  return url.href;
}

async function validate<T extends SocketSchema>(schema: T, value: unknown): Promise<SchemaOutput<T>> {
  const result = await schema["~standard"].validate(value);
  if ("issues" in result && result.issues) throw new TypeError("Invalid socket event payload");
  return (result as { value: SchemaOutput<T> }).value;
}

/** Native WebSocket client: no offline queue and no automatic replay. */
export function createSocketClient<C extends SocketContract>(url: string, contract: C, options: SocketClientOptions = {}): SocketClient<C> {
  const state = signal<"connecting" | "open" | "closed">("connecting");
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const factory = options.webSocketFactory ?? ((address: string) => new WebSocket(address));
  const maxBytes = options.maxMessageBytes ?? 64 * 1024;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let closed = false;
  const reportError = (error: unknown) => {
    if (!options.onError) { logClientError("Meeko socket client error", error); return; }
    observeCallback(() => options.onError!(error),
      (observerError) => logClientError("Meeko socket error observer failed", error, observerError));
  };
  const setState = (next: "connecting" | "open" | "closed") => {
    try { state.value = next; }
    catch (error) { reportError(error); }
  };
  const closePeer = (peer: WebSocket | undefined, code: number, reason: string) => {
    try { peer?.close(code, reason); }
    catch (error) { reportError(error); }
  };
  const scheduleRetry = () => {
    if (closed) return;
    const delay = Math.min((options.retryMs ?? 500) * 2 ** attempts++, options.maxRetryMs ?? 30_000);
    retry = setTimeout(() => {
      retry = undefined;
      try { connect(); }
      catch (error) {
        reportError(error);
        setState("closed");
        scheduleRetry();
      }
    }, delay);
  };

  const connect = () => {
    if (closed) return;
    setState("connecting");
    const peer = factory(url);
    socket = peer;
    let transportErrorReported = false;
    peer.addEventListener("open", () => { if (peer === socket) { attempts = 0; setState("open"); } });
    peer.addEventListener("error", () => {
      if (peer !== socket || closed || transportErrorReported) return;
      transportErrorReported = true;
      reportError(new Error("Socket transport error"));
    });
    peer.addEventListener("message", (message) => {
      if (peer !== socket || closed) return;
      if (typeof message.data !== "string" || new TextEncoder().encode(message.data).byteLength > maxBytes) {
        reportError(new RangeError("Socket message too large or not text"));
        closed = true;
        setState("closed");
        listeners.clear();
        closePeer(peer, 1009, "Message too large");
        return;
      }
      void (async () => {
        const decoded: unknown = JSON.parse(message.data as string);
        if (typeof decoded !== "object" || decoded === null || !("event" in decoded) || !("payload" in decoded) || typeof decoded.event !== "string") throw new TypeError("Invalid socket message");
        const schema = contract.serverToClient[decoded.event];
        if (!schema) throw new TypeError("Unknown socket event");
        const value = await validate(schema, decoded.payload);
        if (peer !== socket || closed) return;
        for (const listener of listeners.get(decoded.event) ?? []) {
          if (peer !== socket || closed) return;
          observeCallback(() => listener(value), reportError);
        }
      })().catch((error: unknown) => {
        if (peer !== socket || closed) return;
        reportError(error);
        closed = true;
        setState("closed");
        listeners.clear();
        closePeer(peer, 1008, "Invalid event");
      });
    });
    peer.addEventListener("close", (event) => {
      if (peer !== socket || closed) return;
      setState("closed");
      if ([1008, 1009].includes((event as CloseEvent).code)) { closed = true; listeners.clear(); return; }
      scheduleRetry();
    });
  };
  connect();
  return {
    state,
    async emit(event, data) {
      if (closed || socket?.readyState !== WebSocket.OPEN) throw new Error("Socket is disconnected");
      const schema = contract.clientToServer[event];
      if (!schema) throw new TypeError(`Unknown socket event: ${event}`);
      const value = await validate(schema, data);
      if (closed || socket.readyState !== WebSocket.OPEN) throw new Error("Socket is disconnected");
      const message = serializeJson({ event, payload: value });
      if (new TextEncoder().encode(message).byteLength > maxBytes) throw new RangeError("Socket message too large");
      socket.send(message);
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set();
      set.add(listener as (value: unknown) => void);
      listeners.set(event, set);
      const unsubscribe = () => { set.delete(listener as (value: unknown) => void); if (set.size === 0) listeners.delete(event); };
      if (currentEffectOwner()) onCleanup(unsubscribe);
      return unsubscribe;
    },
    close() {
      if (closed) { listeners.clear(); return; }
      closed = true;
      if (retry) clearTimeout(retry);
      closePeer(socket, 1000, "Client closed");
      listeners.clear();
      setState("closed");
    },
  };
}

function appSocketObserver(channel: NonNullable<ReturnType<typeof currentAppErrorChannel>>): (error: unknown) => void {
  return (error) => {
    const handler = channel.current();
    if (handler) return handler(error, "socket");
    logClientError("Meeko socket client error", error);
  };
}

/** The nearest component observer, else the mounted application's own observer. */
function contextualSocketObserver(): ((error: unknown) => void) | undefined {
  const nearest = currentComponentErrorHandler();
  if (nearest) return (error) => nearest(error, "socket");
  const channel = currentAppErrorChannel();
  if (!channel) return undefined;
  return (error) => {
    const handler = channel.application();
    if (handler) return handler(error, "socket");
    logClientError("Meeko socket client error", error);
  };
}

/** Binds socket lifetime to a Meeko root; SSR never opens a connection. */
export function useSocket<C extends SocketContract>(url: string, contract: C, options: SocketClientOptions = {}): SocketClient<C> {
  if (typeof window === "undefined") throw new Error("useSocket() is only available in the browser");
  const onError = options.onError ?? contextualSocketObserver();
  const client = createSocketClient(url, contract, onError ? { ...options, onError } : options);
  try { onCleanup(() => client.close()); }
  catch (error) { client.close(); throw error; }
  return client;
}

/** Creates lazily connected, typed channel clients from public shared schemas. */
export function createSocketRegistry<C extends Record<string, SocketContract>>(contracts: C, options: SocketRegistryOptions = {}): SocketRegistry<C> {
  const result: Record<string, unknown> = Object.create(null);
  for (const name of Object.keys(contracts)) {
    let client: SocketClient<SocketContract> | undefined;
    const appClients = new WeakMap<NonNullable<ReturnType<typeof currentAppErrorChannel>>, SocketClient<SocketContract>>();
    const rootClients = new WeakMap<object, SocketClient<SocketContract>>();
    Object.defineProperty(result, name, {
      enumerable: true,
      get() {
        const channel = currentAppErrorChannel();
        if (channel) {
          let scoped = appClients.get(channel);
          if (!scoped) {
            const onError = options.onError ?? appSocketObserver(channel);
            scoped = createSocketClient(socketUrl(name, options), contracts[name]!, { ...options, onError });
            appClients.set(channel, scoped);
            const owned = scoped;
            channel.track(() => { owned.close(); appClients.delete(channel); });
          }
          return scoped;
        }
        const owner = currentEffectOwner();
        if (owner) {
          let scoped = rootClients.get(owner);
          if (!scoped) {
            const onError = options.onError ?? contextualSocketObserver();
            scoped = createSocketClient(socketUrl(name, options), contracts[name]!, onError ? { ...options, onError } : options);
            rootClients.set(owner, scoped);
            const owned = scoped;
            onCleanup(() => { owned.close(); rootClients.delete(owner); });
          }
          return scoped;
        }
        if (!client) client = createSocketClient(socketUrl(name, options), contracts[name]!, options);
        return client;
      },
    });
  }
  return result as SocketRegistry<C>;
}

/** Creates a channel scoped to the current component root. */
export function useSocketChannel<C extends Record<string, SocketContract>, K extends keyof C & string>(contracts: C, name: K, options: SocketRegistryOptions = {}): SocketClient<C[K]> {
  const contract = contracts[name];
  if (!contract) throw new TypeError(`Unknown socket channel: ${name}`);
  return useSocket(socketUrl(name, options), contract, options);
}
