import { onCleanup, signal } from "../reactivity.js";
import type { ReadonlySignal } from "../reactivity.js";
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

  const connect = () => {
    if (closed) return;
    state.value = "connecting";
    const peer = factory(url);
    socket = peer;
    peer.addEventListener("open", () => { if (peer === socket) { attempts = 0; state.value = "open"; } });
    peer.addEventListener("message", (message) => {
      if (peer !== socket || typeof message.data !== "string" || new TextEncoder().encode(message.data).byteLength > maxBytes) {
        closed = true;
        state.value = "closed";
        peer.close(1009, "Message too large");
        return;
      }
      void (async () => {
        const decoded: unknown = JSON.parse(message.data as string);
        if (typeof decoded !== "object" || decoded === null || !("event" in decoded) || !("payload" in decoded) || typeof decoded.event !== "string") throw new TypeError("Invalid socket message");
        const schema = contract.serverToClient[decoded.event];
        if (!schema) throw new TypeError("Unknown socket event");
        const value = await validate(schema, decoded.payload);
        for (const listener of listeners.get(decoded.event) ?? []) listener(value);
      })().catch(() => { closed = true; state.value = "closed"; peer.close(1008, "Invalid event"); });
    });
    peer.addEventListener("close", (event) => {
      if (peer !== socket || closed) return;
      state.value = "closed";
      if ([1008, 1009].includes((event as CloseEvent).code)) { closed = true; return; }
      const delay = Math.min((options.retryMs ?? 500) * 2 ** attempts++, options.maxRetryMs ?? 30_000);
      retry = setTimeout(connect, delay);
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
      return () => { set.delete(listener as (value: unknown) => void); if (set.size === 0) listeners.delete(event); };
    },
    close() {
      if (closed) return;
      closed = true;
      if (retry) clearTimeout(retry);
      socket?.close(1000, "Client closed");
      listeners.clear();
      state.value = "closed";
    },
  };
}

/** Binds socket lifetime to a Meeko root; SSR never opens a connection. */
export function useSocket<C extends SocketContract>(url: string, contract: C, options: SocketClientOptions = {}): SocketClient<C> {
  if (typeof window === "undefined") throw new Error("useSocket() is only available in the browser");
  const client = createSocketClient(url, contract, options);
  try { onCleanup(() => client.close()); }
  catch (error) { client.close(); throw error; }
  return client;
}

/** Creates lazily connected, typed channel clients from public shared schemas. */
export function createSocketRegistry<C extends Record<string, SocketContract>>(contracts: C, options: SocketRegistryOptions = {}): SocketRegistry<C> {
  const result: Record<string, unknown> = Object.create(null);
  for (const name of Object.keys(contracts)) {
    let client: SocketClient<SocketContract> | undefined;
    Object.defineProperty(result, name, {
      enumerable: true,
      get() {
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
