import { createRoot, currentEffectOwner, effect, onCleanup, signal } from "../reactivity.js";
import { browserReady } from "../element-refs.js";
import type { ReadonlySignal } from "../reactivity.js";
import { logClientError, observeCallback } from "../error-observer.js";
import { currentAppErrorChannel, currentComponentErrorHandler } from "../component-errors.js";
import { serializeJson } from "../server.js";
import { setupPhase } from "../lifecycle.js";
import { ClientError } from "./clients.js";

/**
 * Subconjunto de Standard Schema v1 que valida los payloads de un evento Socket, como los schemas
 * de Valibot de `shared/schemas`.
 *
 * @typeParam I Tipo de entrada.
 * @typeParam O Tipo de salida.
 * @example
 * ```ts
 * import * as v from "valibot";
 * import type { SocketSchema } from "@meekojs/meeko/framework";
 *
 * const chatMessage: SocketSchema<{ text: string }> = v.object({ text: v.string() });
 * ```
 */
export interface SocketSchema<I = unknown, O = I> {
  /** Interfaz Standard Schema v1: `validate` devuelve el valor de salida o la lista de `issues`. */
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

/**
 * Contrato público de un canal Socket: los schemas de cada evento en cada dirección. Meeko lo
 * genera a partir de `defineSocketChannel` sin importar los handlers privados.
 *
 * @example
 * ```ts
 * import * as v from "valibot";
 * import type { SocketContract } from "@meekojs/meeko/framework";
 *
 * const chat = {
 *   clientToServer: { message: v.object({ text: v.string(), roomId: v.string() }) },
 *   serverToClient: { message: v.object({ text: v.string() }) },
 * } satisfies SocketContract;
 * ```
 */
export interface SocketContract<ClientToServer extends Events = Events, ServerToClient extends Events = Events> {
  /** Eventos que envía el cliente, con su schema. */
  readonly clientToServer: ClientToServer;
  /** Eventos que envía el servidor, con su schema. */
  readonly serverToClient: ServerToClient;
}

type SocketClientState = "connecting" | "open" | "closed" | "unauthorized";

/** Auth refusals that a client can observe: an HTTP status of the handshake or a close of the hub. */
const authCloseReasons = new Set(["Unauthorized", "Session expired", "Session revoked"]);

function authError(status: 401 | 403): ClientError {
  return new ClientError(status === 401 ? "UNAUTHENTICATED" : "FORBIDDEN", status);
}

/**
 * The 401 or 403 that refused the handshake, when the WebSocket implementation exposes it, as the
 * `ws` package does in its error. A browser never exposes the status of a failed handshake.
 */
function handshakeRefusal(event: Event): 401 | 403 | undefined {
  const details = event as Event & { status?: unknown; statusCode?: unknown; message?: unknown; error?: { status?: unknown; statusCode?: unknown; message?: unknown } };
  const values: unknown[] = [details.status, details.statusCode, details.error?.status, details.error?.statusCode];
  for (const text of [details.message, details.error?.message]) {
    const match = typeof text === "string" ? /Unexpected server response: (\d{3})\b/.exec(text) : null;
    if (match) values.push(Number(match[1]));
  }
  const status = values.find((value) => value === 401 || value === 403);
  return status as 401 | 403 | undefined;
}

/** The refusal that a close carries: the hub's policy close (`1008`) for auth, or `4401`/`4403`. */
function closeRefusal(event: Event): 401 | 403 | undefined {
  const { code, reason } = event as Partial<CloseEvent>;
  if (code === 4401) return 401;
  if (code === 4403) return 403;
  return code === 1008 && typeof reason === "string" && authCloseReasons.has(reason) ? 401 : undefined;
}

/**
 * Cliente tipado de un canal Socket. La entrega es como mucho una vez: `emit` rechaza si está
 * desconectado, sin cola ni reenvío, y reconecta con retroceso.
 *
 * @example
 * ```ts
 * const chat = socket.chat;
 * const stop = chat.on("message", (message) => console.log(message.text));
 * await chat.emit("message", { text: "Hola", roomId: "general" });
 * stop();
 * chat.close();
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#websocket
 */
export interface SocketClient<C extends SocketContract> {
  /**
   * Estado de la conexión. `"unauthorized"` (desde 1.1.0) es terminal: el servidor rechazó la
   * autenticación o la autorización y el cliente no reintenta; `close()` lo pasa a `"closed"`.
   */
  readonly state: ReadonlySignal<SocketClientState>;
  /** Valida y envía un evento; rechaza si el socket no está abierto o el payload no es válido. */
  emit<K extends keyof C["clientToServer"] & string>(event: K, data: SchemaInput<C["clientToServer"][K]>): Promise<void>;
  /** Escucha un evento del servidor ya validado; devuelve la función que deja de escucharlo. */
  on<K extends keyof C["serverToClient"] & string>(event: K, listener: (data: SchemaOutput<C["serverToClient"][K]>) => void): () => void;
  /** Cierra la conexión y deja de reconectar. */
  close(): void;
}

/**
 * Opciones de {@link createSocketClient} y {@link useSocketClient}.
 *
 * @example
 * ```ts
 * import type { SocketClientOptions } from "@meekojs/meeko/framework";
 *
 * const options: SocketClientOptions = { retryMs: 1_000, maxRetryMs: 10_000, onError: (error) => console.warn(error) };
 * ```
 */
export interface SocketClientOptions {
  /** Primer retraso de reconexión en milisegundos, que se duplica en cada intento; 500 por defecto. */
  readonly retryMs?: number;
  /** Retraso máximo de reconexión; 30 000 por defecto. */
  readonly maxRetryMs?: number;
  /** Tamaño máximo de un mensaje entrante en bytes; 64 KiB por defecto. */
  readonly maxMessageBytes?: number;
  /** Crea el `WebSocket`; útil en pruebas o fuera del navegador. */
  readonly webSocketFactory?: (url: string) => WebSocket;
  /** Recibe los mensajes entrantes inválidos y los fallos de los listeners; sin él, la consola. */
  readonly onError?: (error: unknown) => void;
}

/**
 * Opciones de {@link createSocketRegistry} y {@link useSocketChannel}, además de las del cliente.
 *
 * @example
 * ```ts
 * import type { SocketRegistryOptions } from "@meekojs/meeko/framework";
 *
 * const options: SocketRegistryOptions = { roomId: "general", baseUrl: "https://example.com" };
 * ```
 */
export interface SocketRegistryOptions extends SocketClientOptions {
  /** URL base HTTP(S) o WS(S). Por defecto, el origen actual del navegador. */
  readonly baseUrl?: string;
  /** Prefijo de las rutas de los canales; por defecto, `/_meeko/socket`. */
  readonly pathnamePrefix?: string;
  /** Sala a la que se une el cliente (`?room=`). */
  readonly roomId?: string;
}

/**
 * Registro de clientes Socket por nombre de canal, como el autoimport `socket`. Cada canal se
 * conecta la primera vez que se lee, sólo en el navegador.
 *
 * @example
 * ```ts
 * import { createSocketRegistry } from "@meekojs/meeko/framework";
 * import type { SocketRegistry } from "@meekojs/meeko/framework";
 *
 * const socket: SocketRegistry<typeof socketContracts> = createSocketRegistry(socketContracts);
 * socket.chat.on("message", (message) => console.log(message.text));
 * ```
 */
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

/**
 * Crea un cliente Socket de bajo nivel sobre el `WebSocket` nativo, sin cola sin conexión ni
 * reenvío automático. Valida los payloads con el contrato y reconecta con retroceso exponencial.
 * El llamador debe cerrarlo con `close()`.
 *
 * @param url URL `ws:` o `wss:` del canal, con `?room=` si hace falta.
 * @param contract Contrato del canal.
 * @param options Reintentos, tamaño máximo y observador de errores.
 * @returns El cliente tipado.
 * @example
 * ```ts
 * import { createSocketClient } from "@meekojs/meeko/framework";
 *
 * const chat = createSocketClient("wss://example.com/_meeko/socket/chat?room=general", chatContract, {
 *   onError: (error) => console.warn("socket", error),
 * });
 * chat.on("message", (message) => console.log(message.text));
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#websocket
 */
export function createSocketClient<C extends SocketContract>(url: string, contract: C, options: SocketClientOptions = {}): SocketClient<C> {
  const state = signal<SocketClientState>("connecting");
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const factory = options.webSocketFactory ?? ((address: string) => new WebSocket(address));
  const maxBytes = options.maxMessageBytes ?? 64 * 1024;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let closed = false;
  /** The server refused the session; the state stays `"unauthorized"` until `close()`. */
  let refused = false;
  const reportError = (error: unknown) => {
    if (!options.onError) { logClientError("Meeko socket client error", error); return; }
    observeCallback(() => options.onError!(error),
      (observerError) => logClientError("Meeko socket error observer failed", error, observerError));
  };
  const setState = (next: SocketClientState) => {
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
    // The server refused the session: retrying cannot succeed, so the client stops for good.
    const refuse = (status: 401 | 403) => {
      closed = true;
      refused = true;
      if (retry) clearTimeout(retry);
      listeners.clear();
      setState("unauthorized");
      reportError(authError(status));
      closePeer(peer, 1000, "Unauthorized");
    };
    peer.addEventListener("open", () => { if (peer === socket) { attempts = 0; setState("open"); } });
    peer.addEventListener("error", (event) => {
      if (peer !== socket || closed || transportErrorReported) return;
      const refusal = handshakeRefusal(event);
      if (refusal) { refuse(refusal); return; }
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
      const refusal = closeRefusal(event);
      if (refusal) { refuse(refusal); return; }
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
      if (closed) {
        listeners.clear();
        if (refused) {
          refused = false;
          setState("closed");
        }
        return;
      }
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

/**
 * The client of a component script that only renders HTML in the browser: the render before a
 * mount, or a dry pass that loads data. It never connects and stays `"connecting"`, like the
 * client of the mount that follows starts.
 */
function renderOnlyClient<C extends SocketContract>(): SocketClient<C> {
  const state = signal<SocketClientState>("connecting");
  return {
    state,
    emit: () => Promise.reject(new Error("Socket is disconnected")),
    on: () => () => {},
    close: () => {},
  };
}

/**
 * Crea un cliente Socket ligado a la raíz del componente actual, que se cierra al desmontarlo.
 * Nunca abre conexión en SSR ni en un render que sólo produce HTML. Es la forma de bajo nivel, con
 * URL y contrato explícitos; el autoimport `useSocket(canal, opciones)` de las aplicaciones es
 * otra función, generada con {@link useSocketChannel}. Con `await` en el nivel superior del
 * script, el resto del setup continúa en el navegador cuando el socket está abierto. Fuera de un
 * componente, use {@link createSocketClient}.
 *
 * @param url URL `ws:` o `wss:` del canal.
 * @param contract Contrato del canal.
 * @param options Opciones del cliente; sin `onError`, usa el observador de errores más cercano.
 * @returns El cliente tipado.
 * @throws {Error} En SSR («only available in the browser»).
 * @since 1.1.0
 * @example
 * ```ts
 * import { useSocketClient } from "@meekojs/meeko/framework";
 *
 * // Dentro del <script> de un componente, sólo en el navegador.
 * const chat = typeof window === "undefined" ? undefined : useSocketClient("wss://example.com/_meeko/socket/chat?room=general", chatContract);
 * chat?.on("message", (message) => console.log(message.text));
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#websocket
 */
export function useSocketClient<C extends SocketContract>(url: string, contract: C, options: SocketClientOptions = {}): SocketClient<C> {
  if (typeof window === "undefined") throw new Error("useSocketClient() is only available in the browser");
  if (setupPhase() === "render") return renderOnlyClient<C>();
  const onError = options.onError ?? contextualSocketObserver();
  const client = createSocketClient(url, contract, onError ? { ...options, onError } : options);
  try { onCleanup(() => client.close()); }
  catch (error) { client.close(); throw error; }
  // `await useSocketClient(...)` in a component script continues once the socket is open.
  Object.defineProperty(client, browserReady, { value: () => socketOpen(client) });
  return client;
}

/**
 * Alias obsoleto de {@link useSocketClient}: es la misma función, con la misma firma y los mismos
 * tipos. No es el autoimport `useSocket(canal, opciones)` de las aplicaciones, que generan los
 * clientes con {@link useSocketChannel} y no está obsoleto.
 *
 * @deprecated Desde 1.1.0: use useSocketClient. Se retirará en 2.0.
 * @example
 * ```ts
 * // Antes:
 * import { useSocket } from "@meekojs/meeko/framework";
 * const chat = useSocket("wss://example.com/_meeko/socket/chat", chatContract);
 *
 * // Ahora:
 * import { useSocketClient } from "@meekojs/meeko/framework";
 * const chat = useSocketClient("wss://example.com/_meeko/socket/chat", chatContract);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#websocket
 */
export const useSocket: typeof useSocketClient = useSocketClient;

/** Resolves with `client` once its state is `"open"`; a client that never opens keeps it pending. */
function socketOpen<C extends SocketContract>(client: SocketClient<C>): Promise<SocketClient<C>> {
  return new Promise((resolve) => {
    createRoot((dispose) => {
      effect(() => {
        if (client.state.value !== "open") return;
        resolve(client);
        queueMicrotask(dispose);
      });
    });
  });
}

/**
 * Crea un registro de clientes Socket tipados por canal, que se conectan al leer cada canal. Dentro
 * de `mountClientApp` cada aplicación tiene su conexión por canal y la cierra al desmontarse; en
 * un componente, la conexión pertenece a su raíz; fuera de ambos, el cliente es compartido y el
 * llamador lo cierra. Es el autoimport `socket` de los clientes generados.
 *
 * @param contracts Contratos públicos por nombre de canal.
 * @param options Opciones comunes a todos los canales.
 * @returns El registro tipado.
 * @example
 * ```ts
 * import { createSocketRegistry } from "@meekojs/meeko/framework";
 * import { socketContracts } from "./socket-contracts.js";
 *
 * export const socket = createSocketRegistry(socketContracts);
 * // En el navegador:
 * socket.chat.on("message", (message) => console.log(message.text));
 * ```
 */
export function createSocketRegistry<C extends Record<string, SocketContract>>(contracts: C, options: SocketRegistryOptions = {}): SocketRegistry<C> {
  const result: Record<string, unknown> = Object.create(null);
  for (const name of Object.keys(contracts)) {
    let client: SocketClient<SocketContract> | undefined;
    const appClients = new WeakMap<NonNullable<ReturnType<typeof currentAppErrorChannel>>, SocketClient<SocketContract>>();
    const rootClients = new WeakMap<object, SocketClient<SocketContract>>();
    Object.defineProperty(result, name, {
      enumerable: true,
      get() {
        // A component script that only renders HTML in the browser never connects.
        if (typeof window !== "undefined" && setupPhase() === "render") return renderOnlyClient();
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

/**
 * Abre el canal `name` de un registro de contratos ligado a la raíz del componente actual, como
 * {@link useSocketClient}. Los clientes generados lo usan para el autoimport `useSocket(canal, opciones)`.
 *
 * @param contracts Contratos públicos por nombre de canal.
 * @param name Canal que se abre.
 * @param options Sala, URL base y opciones del cliente.
 * @returns El cliente tipado del canal.
 * @throws {TypeError} Si el canal no existe.
 * @throws {Error} En SSR.
 * @example
 * ```ts
 * import { useSocketChannel } from "@meekojs/meeko/framework";
 * import type { SocketRegistryOptions } from "@meekojs/meeko/framework";
 * import { socketContracts } from "./socket-contracts.js";
 *
 * export const useSocket = <K extends keyof typeof socketContracts & string>(name: K, options?: SocketRegistryOptions) =>
 *   useSocketChannel(socketContracts, name, options);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#websocket
 */
export function useSocketChannel<C extends Record<string, SocketContract>, K extends keyof C & string>(contracts: C, name: K, options: SocketRegistryOptions = {}): SocketClient<C[K]> {
  const contract = contracts[name];
  if (!contract) throw new TypeError(`Unknown socket channel: ${name}`);
  return useSocketClient(socketUrl(name, options), contract, options);
}
