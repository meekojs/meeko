import { AsyncLocalStorage } from "node:async_hooks";
import { assetResponse, etagMatches, findAsset } from "./framework-server/assets.js";
import type { AssetManifest, AssetReader } from "./framework-server/assets.js";
import type { ServerApp } from "./framework-server/app.js";
import { ApiError, errorResponse, observeErrorCallback } from "./framework-server/contracts.js";
import { setSocketAddress } from "./framework-server/env.js";
import { fetchApp, positiveInteger, publicOriginOf, rebaseRequest } from "./framework-server/fetch-host.js";
import { createDetachedPlatform } from "./framework-server/platform.js";
import type { ServerPlatform } from "./framework-server/platform.js";
import { watchIsolateErrors } from "./framework-server/process-errors.js";
import type { SqlSessionDriver, SqlSessionRow } from "./framework-server/session-stores.js";
import type { SocketMessage, SocketPeer, SocketPubSub, Unsubscribe } from "./framework-server/socket.js";
import { createSocketUpgradeHandler, openSocketSession, socketPathnamePrefix } from "./framework-server/upgrade.js";
import type { OpenedSocketSession, SocketUpgradeClose, SocketUpgradeHandler } from "./framework-server/upgrade.js";
import type { PrerenderedPage, PrerenderSource } from "./framework/server.js";

// Minimal structural views of the Workers runtime, so this entry type-checks
// and loads without @cloudflare/workers-types or `cloudflare:workers`.

/**
 * Parte del `ExecutionContext` de Workers que usa Meeko. Los tipos `*Like` de esta entrada son
 * estructurales, para compilar y cargar el módulo sin `@cloudflare/workers-types` ni
 * `cloudflare:workers`.
 *
 * @example
 * ```ts
 * import type { CloudflareExecutionContext } from "@meekojs/meeko/cloudflare";
 *
 * export default {
 *   async scheduled(event: unknown, env: Env, ctx: CloudflareExecutionContext) {
 *     ctx.waitUntil(new D1SessionDriver(env.DB).deleteExpired());
 *   },
 * };
 * ```
 */
export interface CloudflareExecutionContext {
  /** Mantiene vivo un trabajo tras la respuesta. */
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Parte del ID de un Durable Object que usa Meeko.
 *
 * @example
 * ```ts
 * import { socketRoomName } from "@meekojs/meeko/cloudflare";
 * import type { DurableObjectIdLike } from "@meekojs/meeko/cloudflare";
 *
 * const id: DurableObjectIdLike = env.MEEKO_SOCKET.idFromName(socketRoomName("chat", "general"));
 * console.log(id.name, id.toString());
 * ```
 */
export interface DurableObjectIdLike {
  /** Nombre, en los IDs creados con `idFromName`. */
  readonly name?: string;
  /** ID hexadecimal. */
  toString(): string;
}

/**
 * Stub de un Durable Object; las salas de Socket exponen además el método RPC `meekoPublish`.
 *
 * @example
 * ```ts
 * import type { DurableObjectStubLike } from "@meekojs/meeko/cloudflare";
 *
 * const stub: DurableObjectStubLike = env.MEEKO_SOCKET.get(env.MEEKO_SOCKET.idFromName("chat\0general"));
 * await stub.meekoPublish?.("chat", "general", { event: "message", payload: { text: "Hola" } });
 * ```
 */
export interface DurableObjectStubLike {
  /** Reenvía una petición HTTP al objeto. */
  fetch(request: Request): Promise<Response>;
  /** RPC de las salas de Socket; se resuelve cuando la sala acepta el mensaje. */
  meekoPublish?(channel: string, room: string, message: SocketMessage): Promise<void>;
}

/**
 * Parte del `DurableObjectNamespace` que usa Meeko, como el binding `MEEKO_SOCKET`.
 *
 * @example
 * ```ts
 * import type { DurableObjectNamespaceLike } from "@meekojs/meeko/cloudflare";
 *
 * interface Env { readonly MEEKO_SOCKET?: DurableObjectNamespaceLike }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#cloudflare-workers
 */
export interface DurableObjectNamespaceLike {
  /** ID estable de un objeto por nombre. */
  idFromName(name: string): DurableObjectIdLike;
  /** Stub del objeto con ese ID. */
  get(id: DurableObjectIdLike): DurableObjectStubLike;
}

/**
 * Binding de Static Assets (`env.ASSETS`).
 *
 * @example
 * ```ts
 * import { createCloudflareAssetReader } from "@meekojs/meeko/cloudflare";
 * import type { CloudflareAssetsBinding } from "@meekojs/meeko/cloudflare";
 *
 * interface Env { readonly ASSETS: CloudflareAssetsBinding }
 * const assets = (env: Env) => createCloudflareAssetReader({ binding: env.ASSETS, assets: manifest.assets ?? {} });
 * ```
 */
export interface CloudflareAssetsBinding {
  /** Lee un archivo de los assets. */
  fetch(request: Request): Promise<Response>;
}

/**
 * Lado servidor de un WebSocket con hibernación.
 *
 * @example
 * ```ts
 * import type { CloudflareWebSocket } from "@meekojs/meeko/cloudflare";
 *
 * const openSockets = (sockets: CloudflareWebSocket[]) => sockets.filter((socket) => socket.readyState === 1).length;
 * ```
 */
export interface CloudflareWebSocket {
  /** 0 conectando, 1 abierto, 2 cerrando, 3 cerrado. */
  readonly readyState: number;
  /** Envía un mensaje de texto. */
  send(message: string): void;
  /** Cierra la conexión. */
  close(code?: number, reason?: string): void;
  /** Guarda el estado que sobrevive a la hibernación (hasta 16.384 bytes serializados). */
  serializeAttachment(value: unknown): void;
  /** Lee el estado guardado con `serializeAttachment`. */
  deserializeAttachment(): unknown;
}

/**
 * Parte del `DurableObjectState` que usan las salas de Socket.
 *
 * @example
 * ```ts
 * import type { DurableObjectStateLike } from "@meekojs/meeko/cloudflare";
 *
 * const peers = (ctx: DurableObjectStateLike): number => ctx.getWebSockets().length;
 * ```
 */
export interface DurableObjectStateLike {
  /** ID del objeto. */
  readonly id: DurableObjectIdLike;
  /** Acepta un WebSocket con la API de hibernación. */
  acceptWebSocket(socket: CloudflareWebSocket, tags?: string[]): void;
  /** WebSockets aceptados del objeto. */
  getWebSockets(tag?: string): CloudflareWebSocket[];
  /** Respuesta automática a un mensaje sin despertar el objeto. */
  setWebSocketAutoResponse?(pair?: unknown): void;
  /** Mantiene vivo un trabajo. */
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Clase `DurableObject` de `cloudflare:workers`, que se pasa como argumento para que este módulo
 * se pueda cargar fuera de Workers.
 *
 * @example
 * ```ts
 * import { DurableObject } from "cloudflare:workers";
 * import { createSocketRoomClass } from "@meekojs/meeko/cloudflare";
 * import type { DurableObjectBase } from "@meekojs/meeko/cloudflare";
 *
 * const base: DurableObjectBase<Env> = DurableObject;
 * export const MeekoSocketRoom = createSocketRoomClass(createApp, base);
 * ```
 */
export type DurableObjectBase<Env> = abstract new (ctx: DurableObjectStateLike, env: Env) => object;

interface WorkersGlobals {
  WebSocketPair: new () => Record<0 | 1, CloudflareWebSocket>;
  WebSocketRequestResponsePair?: new (request: string, response: string) => unknown;
}

/**
 * Lo que recibe la fábrica de la aplicación, una vez por aislado.
 *
 * @typeParam Env Bindings y variables del Worker.
 * @example
 * ```ts
 * import type { CloudflareAppContext } from "@meekojs/meeko/cloudflare";
 *
 * function createCloudflareApp({ env, platform }: CloudflareAppContext<Env>) {
 *   return createApp({ production: true, platform, assets: createCloudflareAssetReader({ binding: env.ASSETS, assets: manifest.assets ?? {} }) });
 * }
 * ```
 */
export interface CloudflareAppContext<Env> {
  /** Bindings y variables del Worker. */
  readonly env: Env;
  /** Plataforma para la fábrica del runtime y el trabajo fuera de las peticiones. */
  readonly platform: ServerPlatform<Env>;
}

/**
 * Una aplicación ya creada, o una fábrica que la crea a partir de los bindings en el primer
 * evento de cada aislado; si falla, el siguiente evento la reintenta.
 *
 * @typeParam Env Bindings y variables del Worker.
 * @example
 * ```ts
 * import type { CloudflareApp } from "@meekojs/meeko/cloudflare";
 *
 * const app: CloudflareApp<Env> = ({ env, platform }) => createApp({ production: true, platform });
 * export default createWorker(app);
 * ```
 */
export type CloudflareApp<Env> = ServerApp | ((context: CloudflareAppContext<Env>) => ServerApp | Promise<ServerApp>);

const apps = new WeakMap<object, Promise<ServerApp>>();

/** Marks `DurableObjectSocketPubSub` instances, also across copies of this module. */
const durableObjectBroker = Symbol.for("meeko.cloudflare.durable-object-socket-pubsub");

/**
 * Socket peers live in room Durable Objects, so only the Durable Object broker
 * reaches them; any other broker would deliver to subscribers of one isolate.
 */
function assertWorkersBroker(instance: ServerApp): ServerApp {
  const socket = instance.socket;
  if (socket && (socket.pubsub as { [durableObjectBroker]?: unknown } | undefined)?.[durableObjectBroker] !== true) {
    throw new TypeError(
      "Socket channels on Cloudflare Workers require DurableObjectSocketPubSub: leave runtime.socket.pubsub unset and bind MEEKO_SOCKET, " +
      "or set it to new DurableObjectSocketPubSub(env.MEEKO_SOCKET). Other brokers cannot reach the WebSockets held by Socket room Durable Objects.",
    );
  }
  return instance;
}

/** One application per factory and isolate; a failed start is retried by the next event. */
function resolveApp<Env>(app: CloudflareApp<Env>, env: Env): Promise<ServerApp> {
  if (typeof app !== "function") return Promise.resolve(app).then(assertWorkersBroker);
  let pending = apps.get(app);
  if (!pending) {
    pending = Promise.resolve().then(() => app({ env, platform: createDetachedPlatform(env, "cloudflare") })).then(async (instance) => {
      try { return assertWorkersBroker(instance); }
      catch (error) {
        await instance.close().catch(() => undefined);
        throw error;
      }
    });
    apps.set(app, pending);
    pending.catch(() => { if (apps.get(app) === pending) apps.delete(app); });
  }
  return pending;
}

function reportStartup(error: unknown, requestId: string): void {
  try { console.error(`[meeko] application startup failed ${requestId}`, error); }
  catch { /* A broken console cannot hide the error response. */ }
}

/**
 * Nombre del Durable Object de una sala de Socket: un objeto por canal y sala.
 *
 * @param channel Canal.
 * @param room Sala.
 * @returns El nombre que se pasa a `idFromName`.
 * @example
 * ```ts
 * import { socketRoomName } from "@meekojs/meeko/cloudflare";
 *
 * const stub = env.MEEKO_SOCKET.get(env.MEEKO_SOCKET.idFromName(socketRoomName("chat", "general")));
 * ```
 */
export function socketRoomName(channel: string, room: string): string {
  return `${channel}\0${room}`;
}

/**
 * Opciones de {@link createWorker}.
 *
 * @example
 * ```ts
 * import type { CloudflareWorkerOptions } from "@meekojs/meeko/cloudflare";
 *
 * const options: CloudflareWorkerOptions = { socketBinding: "ROOMS", publicOrigin: "https://example.com" };
 * ```
 */
export interface CloudflareWorkerOptions {
  /** Binding del namespace de Durable Objects de las salas de Socket. Por defecto, `MEEKO_SOCKET`. */
  readonly socketBinding?: string;
  /** Sustituye al `publicOrigin` de la aplicación en las comprobaciones de Origin de HTTP y Socket. */
  readonly publicOrigin?: string;
  /** Observador de errores; por defecto, el de la aplicación. */
  readonly onError?: (error: unknown, requestId: string) => void;
}

/**
 * Handler de un Worker de módulo: `export default createWorker(app)`.
 *
 * @typeParam Env Bindings y variables del Worker.
 * @example
 * ```ts
 * import type { CloudflareWorker } from "@meekojs/meeko/cloudflare";
 *
 * const worker: CloudflareWorker<Env> = createWorker(createCloudflareApp);
 * export default worker;
 * ```
 */
export interface CloudflareWorker<Env> {
  /** Atiende una petición del Worker. */
  fetch(request: Request, env: Env, ctx: CloudflareExecutionContext): Promise<Response>;
}

/**
 * Sirve una aplicación de Meeko desde un Worker de módulo. La aplicación se crea en la primera
 * petición con los bindings del Worker; los upgrades de Socket se comprueban aquí (ruta, Origin y
 * autorización) y se reenvían al Durable Object de su sala. Sólo admite `DurableObjectSocketPubSub`
 * como broker.
 *
 * @param app Aplicación o fábrica de la aplicación.
 * @param options Binding de las salas, origen público y observador de errores.
 * @returns El handler `{ fetch }` del módulo.
 * @example
 * ```ts
 * import { DurableObject } from "cloudflare:workers";
 * import { createCloudflareAssetReader, createCloudflarePrerenderSource, createSocketRoomClass, createWorker } from "@meekojs/meeko/cloudflare";
 * import type { CloudflareAppContext } from "@meekojs/meeko/cloudflare";
 *
 * function createCloudflareApp({ env, platform }: CloudflareAppContext<Env>) {
 *   return createApp({
 *     production: true,
 *     platform,
 *     assets: createCloudflareAssetReader({ binding: env.ASSETS, assets: manifest.assets ?? {} }),
 *     prerender: createCloudflarePrerenderSource({ binding: env.ASSETS }),
 *   });
 * }
 *
 * export default createWorker(createCloudflareApp);
 * export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, DurableObject);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#cloudflare-workers
 */
export function createWorker<Env = Record<string, unknown>>(app: CloudflareApp<Env>, options: CloudflareWorkerOptions = {}): CloudflareWorker<Env> {
  const binding = options.socketBinding ?? "MEEKO_SOCKET";
  const configuredOrigin = options.publicOrigin ? publicOriginOf(options.publicOrigin) : undefined;
  // Only a configured origin is cached: one derived from each request's URL
  // could grow the cache without bound under a wildcard route.
  const handshakes = new WeakMap<ServerApp, SocketUpgradeHandler>();
  const handshakeFor = (instance: ServerApp, origin: string | undefined, request: Request, report: (error: unknown) => void): SocketUpgradeHandler => {
    const socket = instance.socket!;
    const create = (publicOrigin: string) =>
      createSocketUpgradeHandler({ hub: socket.hub, publicOrigin, pathnamePrefix: socket.pathnamePrefix, onError: report });
    // Workers receive the routed public URL, so it names the origin when none is configured.
    if (origin === undefined) return create(new URL(request.url).origin);
    let handshake = handshakes.get(instance);
    if (!handshake) { handshake = create(origin); handshakes.set(instance, handshake); }
    return handshake;
  };
  return {
    async fetch(request, env, ctx) {
      let instance: ServerApp;
      try { instance = await resolveApp(app, env); }
      catch (error) {
        const requestId = crypto.randomUUID();
        if (options.onError) observeErrorCallback(error, (failure) => options.onError!(failure, requestId));
        else reportStartup(error, requestId);
        return errorResponse(error, requestId);
      }
      const report = options.onError ?? ((error: unknown, requestId: string) => instance.reportError(error, requestId));
      // The isolate's unhandled rejections reach the application, once per application.
      watchIsolateErrors(instance, options.onError);
      const platform: ServerPlatform<Env> = { name: "cloudflare", env, waitUntil: (promise) => ctx.waitUntil(promise) };
      // Cloudflare's edge sets CF-Connecting-IP and replaces any value the client sends.
      setSocketAddress(request, request.headers.get("cf-connecting-ip") ?? undefined);
      const origin = configuredOrigin ?? instance.publicOrigin;
      if (instance.socket && request.headers.has("upgrade")) {
        try {
          const decision = await handshakeFor(instance, origin, request, (error) => report(error, crypto.randomUUID()))(request);
          if (decision.action === "reject") return (decision.close && deniedUpgrade(decision.close)) || new Response(null, { status: decision.status });
          if (decision.action === "upgrade") {
            const rooms = (env as Record<string, unknown> | undefined)?.[binding] as DurableObjectNamespaceLike | undefined;
            if (!rooms || typeof rooms.idFromName !== "function") throw new Error(`Socket channels require the ${binding} Durable Object binding`);
            const stub = rooms.get(rooms.idFromName(socketRoomName(decision.channel, decision.roomId ?? "")));
            return await stub.fetch(decision.request);
          }
        } catch (error) {
          report(error, crypto.randomUUID());
          return new Response(null, { status: 500 });
        }
      }
      return fetchApp(instance, rebaseRequest(request, origin), platform, report);
    },
  };
}

type RoomListener = (message: SocketMessage) => void | Promise<void>;

/** Subscriptions of one Durable Object instance; a woken instance starts empty. */
class RoomSubscriptions {
  private readonly listeners = new Map<string, Set<RoomListener>>();
  /**
   * Durable Object name of the room: `ctx.id.name`, or learned from its first
   * connection or publication when the runtime omits it (names over 1,024 bytes).
   */
  name: string | undefined;
  constructor(name: string | undefined, readonly dispatch: (channel: string, room: string, message: SocketMessage) => void) {
    this.name = name;
  }
  subscribe(channel: string, room: string, listener: RoomListener): Unsubscribe {
    const key = socketRoomName(channel, room);
    let listeners = this.listeners.get(key);
    if (!listeners) { listeners = new Set(); this.listeners.set(key, listeners); }
    listeners.add(listener);
    return () => {
      listeners!.delete(listener);
      if (!listeners!.size && this.listeners.get(key) === listeners) this.listeners.delete(key);
    };
  }
  /** Starts delivery to each listener; the hub's listeners queue per peer and never reject. */
  deliver(channel: string, room: string, message: SocketMessage): Promise<unknown>[] {
    return [...this.listeners.get(socketRoomName(channel, room)) ?? []].map((listener) => {
      try { return Promise.resolve(listener(message)); }
      catch (error) { return Promise.reject(error); }
    });
  }
}

/** The room whose event is running; Socket subscriptions belong to it. */
const currentRoom = new AsyncLocalStorage<RoomSubscriptions>();

function socketMessage(value: unknown): SocketMessage {
  if (!value || typeof value !== "object" || typeof (value as { event?: unknown }).event !== "string" || !("payload" in value)) {
    throw new TypeError("Invalid Socket message");
  }
  return { event: (value as SocketMessage).event, payload: (value as SocketMessage).payload };
}

/**
 * Broker de Socket para Workers, el que se usa por defecto: cada canal y sala es un Durable Object.
 * `publish` se resuelve cuando la sala acepta el mensaje (por RPC a la sala, o directamente si ya
 * se ejecuta en ella), y la sala lo reparte a sus peers. Sólo se puede suscribir dentro del Durable
 * Object de la sala, adonde `createWorker` reenvía cada upgrade.
 *
 * @example
 * ```ts
 * // server/runtime.ts
 * import { DurableObjectSocketPubSub } from "@meekojs/meeko/cloudflare";
 * import type { DurableObjectNamespaceLike } from "@meekojs/meeko/cloudflare";
 * import { defineServerRuntime, SessionManager } from "@meekojs/meeko/server";
 *
 * interface Env { readonly MEEKO_SOCKET?: DurableObjectNamespaceLike }
 *
 * export default defineServerRuntime<Env>(({ env, production }) => ({
 *   sessions: new SessionManager({ store, production }),
 *   socket: env.MEEKO_SOCKET ? { pubsub: new DurableObjectSocketPubSub(env.MEEKO_SOCKET) } : {},
 * }));
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#socket-y-durable-objects
 */
export class DurableObjectSocketPubSub implements SocketPubSub {
  /** Permite que el adaptador de Cloudflare reconozca este broker. */
  readonly [durableObjectBroker] = true;
  /**
   * @param namespace Binding del namespace de las salas, normalmente `env.MEEKO_SOCKET`.
   * @throws {TypeError} Si no es un binding de Durable Objects.
   */
  constructor(private readonly namespace: DurableObjectNamespaceLike) {
    if (!namespace || typeof namespace.idFromName !== "function" || typeof namespace.get !== "function") {
      throw new TypeError("DurableObjectSocketPubSub requires a Durable Object namespace binding");
    }
  }
  /**
   * Entrega el mensaje a la sala; se resuelve cuando la sala lo acepta. Rechaza con
   * `SOCKET_BACKLOG_EXCEEDED` (503) si la sala tiene demasiadas publicaciones sin entregar.
   */
  async publish(channel: string, room: string, message: SocketMessage): Promise<void> {
    const checked = socketMessage(message);
    const name = socketRoomName(channel, room);
    const local = currentRoom.getStore();
    if (local?.name === name) { local.dispatch(channel, room, checked); return; }
    const stub = this.namespace.get(this.namespace.idFromName(name));
    if (typeof stub.meekoPublish !== "function") throw new TypeError("The Socket Durable Object must be created with createSocketRoomClass");
    await stub.meekoPublish(channel, room, checked);
  }
  /**
   * Escucha el par canal/sala dentro del Durable Object de la sala.
   * @throws {Error} Fuera del Durable Object de la sala.
   */
  subscribe(channel: string, room: string, listener: RoomListener): Unsubscribe {
    const local = currentRoom.getStore();
    if (!local) throw new Error("DurableObjectSocketPubSub subscribes only inside the Socket room Durable Object; forward upgrades with createWorker");
    return local.subscribe(channel, room, listener);
  }
}

/**
 * Opciones de {@link createSocketRoomClass}.
 *
 * @example
 * ```ts
 * import type { SocketRoomOptions } from "@meekojs/meeko/cloudflare";
 *
 * const options: SocketRoomOptions = { keepHeaders: ["accept-language"], maxPendingPublications: 256, autoResponse: false };
 * ```
 */
export interface SocketRoomOptions {
  /** Mensaje entrante más grande; los mayores cierran el peer con `1009`. Por defecto, el límite de Socket de la aplicación o 64 KiB. */
  readonly maxMessageBytes?: number;
  /**
   * Mensaje de texto que el runtime responde sin despertar el objeto, o `false`. Por defecto,
   * `ping` responde `pong`. Los pings del protocolo se responden siempre.
   */
  readonly autoResponse?: { readonly request: string; readonly response: string } | false;
  /**
   * Cabeceras adicionales de la petición (en minúsculas) que se conservan con cada conexión y que
   * el canal ve en `context.request` antes y después de la hibernación. Por defecto sólo se conservan
   * la cookie de sesión, `origin` y `authorization`; `"cookie"` conserva la cabecera completa. Todo
   * va en el attachment del WebSocket, limitado a 16.384 bytes: un upgrade que no cabe se rechaza
   * con `431` antes de aceptar el WebSocket.
   */
  readonly keepHeaders?: readonly string[];
  /**
   * Publicaciones que una sala acepta antes de entregarlas. Por encima, `publish` rechaza con
   * `SOCKET_BACKLOG_EXCEEDED` (503) y el mensaje no se entrega. Por defecto, 1024.
   */
  readonly maxPendingPublications?: number;
  /**
   * Milisegundos que las publicaciones esperan a una conexión reconstruida tras hibernar, desde el
   * inicio de su reconstrucción; pasado ese plazo, la conexión sólo recibe las publicaciones
   * siguientes. Las conexiones que aún se autorizan tras su upgrade no se esperan. Por defecto, 5000.
   */
  readonly rebuildTimeoutMs?: number;
  /** Observador de errores; por defecto, el de la aplicación. */
  readonly onError?: (error: unknown, requestId: string) => void;
}

/** State kept with each WebSocket so a woken room can rebuild its connections. */
interface SocketAttachment {
  readonly v: 1;
  readonly name: string;
  readonly room: string | null;
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

/** Largest serialized WebSocket attachment accepted by Durable Objects. */
const attachmentLimitBytes = 16_384;
/** Request headers kept across hibernation besides the session cookie. */
const defaultKeptHeaders = ["origin", "authorization"] as const;
const headerName = /^[!#$%&'*+.^_`|~0-9a-z-]+$/;

function attachmentOf(value: unknown): SocketAttachment | undefined {
  const candidate = value as Partial<SocketAttachment> | null;
  if (!candidate || candidate.v !== 1 || typeof candidate.name !== "string" || typeof candidate.url !== "string" ||
      (candidate.room !== null && typeof candidate.room !== "string") || !candidate.headers || typeof candidate.headers !== "object") return undefined;
  return candidate as SocketAttachment;
}

/** Upper bound of a string in V8's serialization: one byte per Latin-1 character, two otherwise. */
function serializedStringBytes(value: string): number {
  return 5 + (/[^\u0000-ÿ]/.test(value) ? value.length * 2 : value.length);
}

/** Upper bound of the attachment's structured-clone size. */
function attachmentBytes(attachment: SocketAttachment): number {
  let total = 64;
  for (const value of [attachment.name, attachment.room ?? "", attachment.url]) total += serializedStringBytes(value);
  for (const [name, value] of Object.entries(attachment.headers)) total += serializedStringBytes(name) + serializedStringBytes(value);
  return total;
}

/** `name=value` of one cookie in a Cookie header, as sent. */
function cookiePair(header: string | null, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const separator = part.indexOf("=");
    if (separator >= 0 && part.slice(0, separator).trim() === name) return `${name}=${part.slice(separator + 1).trim()}`;
  }
  return undefined;
}

/**
 * Instancia de la clase de salas de Socket; sus métodos públicos son los handlers y el RPC del
 * Durable Object, que llama el runtime de Workers.
 *
 * @example
 * ```ts
 * import type { MeekoSocketRoom } from "@meekojs/meeko/cloudflare";
 *
 * const room = env.MEEKO_SOCKET.get(env.MEEKO_SOCKET.idFromName("chat\0general")) as unknown as MeekoSocketRoom;
 * await room.meekoPublish("chat", "general", { event: "message", payload: { text: "Hola" } });
 * ```
 */
export interface MeekoSocketRoom {
  /** Acepta el upgrade que reenvía `createWorker`. */
  fetch(request: Request): Promise<Response>;
  /** Handler de hibernación de los mensajes entrantes. */
  webSocketMessage(socket: CloudflareWebSocket, message: string | ArrayBuffer): Promise<void>;
  /** Handler de hibernación de los cierres. */
  webSocketClose(socket: CloudflareWebSocket, code: number, reason: string, wasClean: boolean): Promise<void>;
  /** Handler de hibernación de los errores. */
  webSocketError(socket: CloudflareWebSocket, error: unknown): Promise<void>;
  /** RPC que usa `DurableObjectSocketPubSub`; se resuelve cuando la sala acepta el mensaje. */
  meekoPublish(channel: string, room: string, message: SocketMessage): Promise<void>;
}

/**
 * Clase de salas de Socket que devuelve {@link createSocketRoomClass}, para exportarla desde el
 * Worker con el nombre declarado en `wrangler.jsonc`.
 *
 * @typeParam Env Bindings y variables del Worker.
 * @example
 * ```ts
 * import { DurableObject } from "cloudflare:workers";
 * import { createSocketRoomClass } from "@meekojs/meeko/cloudflare";
 * import type { MeekoSocketRoomClass } from "@meekojs/meeko/cloudflare";
 *
 * export const MeekoSocketRoom: MeekoSocketRoomClass<Env> = createSocketRoomClass(createCloudflareApp, DurableObject);
 * ```
 */
export type MeekoSocketRoomClass<Env> = new (ctx: DurableObjectStateLike, env: Env) => MeekoSocketRoom;

const channelName = /^[A-Za-z_$][\w$-]*$/;
const encoder = new TextEncoder();

function closeQuietly(socket: CloudflareWebSocket, code: number, reason: string): void {
  try { if (socket.readyState <= 1) socket.close(code, reason); }
  catch { /* The peer is already gone. */ }
}

/**
 * An auth refusal completes the upgrade in the Worker, without waking the room's Durable Object,
 * only to close with 4401/4403, which a browser can read. Without `WebSocketPair` the caller keeps
 * the HTTP status.
 */
function deniedUpgrade(close: SocketUpgradeClose): Response | undefined {
  const Pair = (globalThis as Partial<WorkersGlobals>).WebSocketPair;
  if (!Pair) return undefined;
  const pair = new Pair();
  // A socket of a WebSocketPair outside the hibernation API must be accepted before it closes.
  const server = pair[1] as CloudflareWebSocket & { accept?(): void };
  server.accept?.();
  server.close(close.code, close.reason);
  return new Response(null, { status: 101, webSocket: pair[0] } as ResponseInit);
}

/**
 * Crea la clase Durable Object que aloja los WebSockets de una sala de Socket con la API de
 * hibernación: `export const MeekoSocketRoom = createSocketRoomClass(app, DurableObject)`, con
 * `DurableObject` importado de `cloudflare:workers`.
 *
 * Los WebSockets de Workers no informan de `bufferedAmount`, así que aquí no se aplica
 * `maxBufferBytes` del hub; `maxMessageBytes` y `maxPendingDeliveries` siguen limitando cada peer.
 *
 * @param app Aplicación o fábrica, la misma que recibe `createWorker`.
 * @param base Clase `DurableObject` de `cloudflare:workers`.
 * @param options Límites, cabeceras conservadas y respuesta automática.
 * @returns La clase de salas.
 * @throws {TypeError} Si `base` no es una clase o `keepHeaders` tiene nombres no válidos.
 * @throws {RangeError} Si un límite no es válido.
 * @example
 * ```ts
 * import { DurableObject } from "cloudflare:workers";
 * import { createSocketRoomClass } from "@meekojs/meeko/cloudflare";
 *
 * export const MeekoSocketRoom = createSocketRoomClass(createCloudflareApp, DurableObject, {
 *   keepHeaders: ["accept-language"],
 *   rebuildTimeoutMs: 2_000,
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#socket-y-durable-objects
 */
export function createSocketRoomClass<Env = Record<string, unknown>>(
  app: CloudflareApp<Env>,
  base: DurableObjectBase<Env>,
  options: SocketRoomOptions = {},
): MeekoSocketRoomClass<Env> {
  if (typeof base !== "function") throw new TypeError("createSocketRoomClass requires DurableObject from cloudflare:workers");
  const autoResponse = options.autoResponse === undefined ? { request: "ping", response: "pong" } : options.autoResponse;
  const keepHeaders = [...new Set(options.keepHeaders ?? [])];
  for (const name of keepHeaders) {
    if (typeof name !== "string" || !headerName.test(name)) throw new TypeError(`keepHeaders must list lowercase header names: ${String(name)}`);
  }
  const keepCookie = keepHeaders.includes("cookie");
  const keptHeaders = [...new Set<string>([...defaultKeptHeaders, ...keepHeaders])].filter((name) => name !== "cookie");
  const maxPendingPublications = positiveInteger(options.maxPendingPublications ?? 1024, "maxPendingPublications");
  const rebuildTimeoutMs = options.rebuildTimeoutMs ?? 5_000;
  if (!Number.isFinite(rebuildTimeoutMs) || rebuildTimeoutMs < 0) throw new RangeError("rebuildTimeoutMs must be a non-negative number");
  abstract class Base extends (base as abstract new (ctx: DurableObjectStateLike, env: Env) => object) {}
  class SocketRoom extends Base implements MeekoSocketRoom {
    readonly #ctx: DurableObjectStateLike;
    readonly #env: Env;
    readonly #sessions = new Map<CloudflareWebSocket, Promise<OpenedSocketSession | undefined>>();
    readonly #subscriptions: RoomSubscriptions;
    /** Authorization of connections rebuilt after hibernation; publications wait for them, up to a timeout. */
    readonly #rebuilds = new Set<Promise<unknown>>();
    #fanout: Promise<void> = Promise.resolve();
    #pendingPublications = 0;

    constructor(ctx: DurableObjectStateLike, env: Env) {
      super(ctx, env);
      this.#ctx = ctx;
      this.#env = env;
      this.#subscriptions = new RoomSubscriptions(ctx.id?.name, (channel, room, message) => this.#dispatch(channel, room, message));
      const Pair = (globalThis as Partial<WorkersGlobals>).WebSocketRequestResponsePair;
      // Answered by the runtime while the object hibernates.
      if (autoResponse && Pair && ctx.setWebSocketAutoResponse) ctx.setWebSocketAutoResponse(new Pair(autoResponse.request, autoResponse.response));
    }

    #report(error: unknown, instance?: ServerApp): void {
      const requestId = crypto.randomUUID();
      if (options.onError) observeErrorCallback(error, (failure) => options.onError!(failure, requestId));
      else if (instance) instance.reportError(error, requestId);
      else reportStartup(error, requestId);
    }

    /** Checks a room name against this object's, learning it when the runtime did not provide one. */
    #claim(name: string): boolean {
      if (this.#subscriptions.name === undefined) this.#subscriptions.name = name;
      return this.#subscriptions.name === name;
    }

    async fetch(request: Request): Promise<Response> {
      const instance = await resolveApp(app, this.#env);
      const socket = instance.socket;
      if (!socket) return new Response(null, { status: 404 });
      const url = new URL(request.url);
      const prefix = socketPathnamePrefix(socket.pathnamePrefix);
      const name = url.pathname.startsWith(`${prefix}/`) ? url.pathname.slice(prefix.length + 1) : "";
      if (!channelName.test(name)) return new Response(null, { status: 404 });
      if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return new Response(null, { status: 426 });
      const room = url.searchParams.get("room");
      if (!this.#claim(socketRoomName(name, room ?? ""))) return new Response(null, { status: 400 });
      const headers: Record<string, string> = {};
      for (const header of keptHeaders) {
        const value = request.headers.get(header);
        if (value !== null) headers[header] = value;
      }
      const cookie = keepCookie ? request.headers.get("cookie") ?? undefined
        : socket.sessionCookieName ? cookiePair(request.headers.get("cookie"), socket.sessionCookieName) : undefined;
      if (cookie !== undefined) headers.cookie = cookie;
      const attachment: SocketAttachment = { v: 1, name, room, url: url.href, headers };
      const size = attachmentBytes(attachment);
      if (size > attachmentLimitBytes) {
        this.#report(new RangeError(
          `Socket connection state needs up to ${size} bytes, over the ${attachmentLimitBytes}-byte limit of a Durable Object WebSocket attachment; ` +
          "keep fewer or smaller headers with SocketRoomOptions.keepHeaders, or use a shorter room name",
        ), instance);
        return new Response(null, { status: 431 });
      }
      const Pair = (globalThis as Partial<WorkersGlobals>).WebSocketPair;
      if (!Pair) throw new Error("WebSocketPair is not available; Socket rooms run on Cloudflare Workers");
      const pair = new Pair();
      const client = pair[0];
      const server = pair[1];
      // Stored before accepting, so a state the runtime refuses never opens a connection.
      try { server.serializeAttachment(attachment); }
      catch (error) {
        this.#report(error, instance);
        return new Response(null, { status: 431 });
      }
      this.#ctx.acceptWebSocket(server);
      this.#sessions.set(server, Promise.resolve(this.#open(server, attachment, instance)));
      return new Response(null, { status: 101, webSocket: client } as ResponseInit);
    }

    /** Connects a WebSocket to the hub, which authorizes it again; runs inside this room. */
    #open(socket: CloudflareWebSocket, attachment: SocketAttachment, instance: ServerApp): OpenedSocketSession | undefined {
      const hub = instance.socket?.hub;
      if (!hub) { closeQuietly(socket, 1011, "Socket unavailable"); return undefined; }
      const peer: SocketPeer = {
        send(message) {
          if (socket.readyState !== 1) throw new Error("Socket is disconnected");
          socket.send(message);
        },
        close(code, reason) { if (socket.readyState <= 1) socket.close(code, reason); },
      };
      const request = new Request(attachment.url, { headers: attachment.headers });
      const maxPendingBytes = this.#limit(instance);
      const session = currentRoom.run(this.#subscriptions, () => openSocketSession({
        hub, name: attachment.name, request, roomId: attachment.room ?? undefined, peer, maxPendingBytes,
        onError: (error) => this.#report(error, instance),
      }));
      // Keep the object in memory until the room subscription exists.
      this.#ctx.waitUntil(session.ready);
      return session;
    }

    #limit(instance: ServerApp): number {
      return positiveInteger(options.maxMessageBytes ?? instance.socket?.maxMessageBytes ?? 64 * 1024, "maxMessageBytes");
    }

    /** The session of a WebSocket; after hibernation it is rebuilt from the attachment. */
    #session(socket: CloudflareWebSocket): Promise<OpenedSocketSession | undefined> {
      let session = this.#sessions.get(socket);
      if (!session) {
        session = (async () => {
          const attachment = attachmentOf(socket.deserializeAttachment());
          if (!attachment) { closeQuietly(socket, 1011, "Missing connection state"); return undefined; }
          if (!this.#claim(socketRoomName(attachment.name, attachment.room ?? ""))) {
            closeQuietly(socket, 1011, "Connection state of another room");
            return undefined;
          }
          return this.#open(socket, attachment, await resolveApp(app, this.#env));
        })();
        this.#sessions.set(socket, session);
        session.catch((error: unknown) => {
          this.#report(error);
          closeQuietly(socket, 1011, "Connection failed");
        });
        // Publications wait for this connection until it is authorized, at most rebuildTimeoutMs.
        let timer: ReturnType<typeof setTimeout> | undefined;
        const rebuilt: Promise<unknown> = Promise.race([
          session.then((opened) => opened?.ready, () => undefined),
          new Promise<void>((resolve) => { timer = setTimeout(resolve, rebuildTimeoutMs); }),
        ]);
        this.#rebuilds.add(rebuilt);
        void rebuilt.then(() => {
          clearTimeout(timer);
          this.#rebuilds.delete(rebuilt);
        });
      }
      return session;
    }

    async webSocketMessage(socket: CloudflareWebSocket, message: string | ArrayBuffer): Promise<void> {
      if (typeof message !== "string") { closeQuietly(socket, 1003, "Text messages required"); return; }
      let instance: ServerApp;
      try { instance = await resolveApp(app, this.#env); }
      catch (error) {
        // A room that cannot start would otherwise leave the peer waiting forever.
        this.#report(error);
        closeQuietly(socket, 1011, "Socket unavailable");
        return;
      }
      const limit = this.#limit(instance);
      // Workers have no frame limit option; enforce the Socket limit on every message.
      if (message.length > limit || encoder.encode(message).byteLength > limit) { closeQuietly(socket, 1009, "Message too large"); return; }
      // A failed rebuild is reported and closes the socket in #session.
      const session = await this.#session(socket).catch(() => undefined);
      if (!session) return;
      currentRoom.run(this.#subscriptions, () => session.receive(message));
      await session.settled();
    }

    async webSocketClose(socket: CloudflareWebSocket, code: number, reason: string): Promise<void> {
      const session = this.#sessions.get(socket);
      this.#sessions.delete(socket);
      (await session?.catch(() => undefined))?.closed();
      // Reserved codes cannot be sent back; the runtime may already have replied.
      closeQuietly(socket, code === 1005 || code === 1006 || code === 1015 ? 1000 : code, reason);
    }

    async webSocketError(socket: CloudflareWebSocket, error: unknown): Promise<void> {
      const session = this.#sessions.get(socket);
      this.#sessions.delete(socket);
      (await session?.catch(() => undefined))?.closed();
      this.#report(error);
    }

    async meekoPublish(channel: string, room: string, message: SocketMessage): Promise<void> {
      if (!this.#claim(socketRoomName(channel, room))) throw new Error("Socket message sent to another room");
      this.#dispatch(channel, room, socketMessage(message));
    }

    /**
     * Delivers to the room's subscribed peers in publish order. Peers that
     * hibernated are rebuilt first and waited for, up to `rebuildTimeoutMs`,
     * so a woken room does not miss its own broadcasts; peers still being
     * authorized after their upgrade receive later publications only.
     */
    #dispatch(channel: string, room: string, message: SocketMessage): void {
      if (this.#pendingPublications >= maxPendingPublications) {
        throw new ApiError("SOCKET_BACKLOG_EXCEEDED", 503, `SOCKET_BACKLOG_EXCEEDED: the Socket room already holds ${maxPendingPublications} undelivered publications`);
      }
      this.#pendingPublications++;
      for (const socket of this.#ctx.getWebSockets()) {
        if (socket.readyState === 1 && !this.#sessions.has(socket)) void this.#session(socket).catch(() => undefined);
      }
      const deliveries = this.#fanout.then(async () => {
        await this.#rebuilt();
        return this.#subscriptions.deliver(channel, room, message);
      }).finally(() => { this.#pendingPublications--; });
      this.#fanout = deliveries.then(() => undefined, (error: unknown) => this.#report(error));
      this.#ctx.waitUntil(deliveries.then((started) => Promise.allSettled(started).then((results) => {
        for (const result of results) if (result.status === "rejected") this.#report(result.reason);
      }), () => undefined));
    }

    /** Waits for connections rebuilt after hibernation; each is waited for at most `rebuildTimeoutMs` after it starts. */
    async #rebuilt(): Promise<void> {
      if (this.#rebuilds.size) await Promise.all([...this.#rebuilds]);
    }
  }
  return SocketRoom;
}

/**
 * Opciones de {@link createCloudflareAssetReader}.
 *
 * @example
 * ```ts
 * import type { CloudflareAssetReaderOptions } from "@meekojs/meeko/cloudflare";
 *
 * const options: CloudflareAssetReaderOptions = { binding: env.ASSETS, assets: manifest.assets ?? {} };
 * ```
 */
export interface CloudflareAssetReaderOptions {
  /** Binding de Static Assets, normalmente `env.ASSETS`. */
  readonly binding: CloudflareAssetsBinding;
  /** Manifiesto de los archivos públicos. */
  readonly assets: AssetManifest;
}

const assetOrigin = "https://assets.meeko.invalid";

/**
 * Sirve desde el binding de Static Assets sólo los archivos del build listados en el manifiesto,
 * con el `ETag` y la política de caché de los demás adaptadores.
 *
 * @param options Binding y manifiesto de archivos.
 * @returns El lector de archivos.
 * @throws {Error} Desde `get`, si un archivo listado falta en los assets.
 * @example
 * ```ts
 * import { createCloudflareAssetReader } from "@meekojs/meeko/cloudflare";
 *
 * const assets = createCloudflareAssetReader({ binding: env.ASSETS, assets: manifest.assets ?? {} });
 * ```
 */
export function createCloudflareAssetReader(options: CloudflareAssetReaderOptions): AssetReader {
  return {
    async get(pathname, request) {
      const record = findAsset(options.assets, pathname, request);
      if (!record) return null;
      if (request.method === "HEAD" || etagMatches(request.headers.get("if-none-match"), record.etag)) {
        return assetResponse(record, request, () => null);
      }
      // Keys come from the build manifest, never from the request.
      const response = await options.binding.fetch(new Request(new URL(pathname, assetOrigin)));
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error(`Missing build asset ${pathname}`);
      }
      return assetResponse(record, request, () => response.body);
    },
  };
}

/**
 * Opciones de {@link createCloudflarePrerenderSource}.
 *
 * @example
 * ```ts
 * import type { CloudflarePrerenderSourceOptions } from "@meekojs/meeko/cloudflare";
 *
 * const options: CloudflarePrerenderSourceOptions = { binding: env.ASSETS, directory: "/_meeko/prerender/" };
 * ```
 */
export interface CloudflarePrerenderSourceOptions {
  /** Binding de Static Assets. */
  readonly binding: CloudflareAssetsBinding;
  /** Carpeta de los assets con `manifest.json` y las páginas; empieza y termina en `/`. Por defecto, `/_meeko/prerender/`. */
  readonly directory?: string;
}

interface PrerenderIndex { readonly pages?: Record<string, { file: string; headOffset: number; etag: string; payload?: string }> }

/**
 * Páginas prerenderizadas guardadas con los assets y leídas mediante el binding. El índice y cada
 * página se leen una vez por aislado; una lectura fallida se reintenta en la petición siguiente.
 *
 * @param options Binding y carpeta.
 * @returns La fuente de páginas prerenderizadas.
 * @throws {TypeError} Si la carpeta no empieza y termina en `/`.
 * @example
 * ```ts
 * import { createCloudflarePrerenderSource } from "@meekojs/meeko/cloudflare";
 *
 * const app = await createApp({ production: true, prerender: createCloudflarePrerenderSource({ binding: env.ASSETS }) });
 * ```
 */
export function createCloudflarePrerenderSource(options: CloudflarePrerenderSourceOptions): PrerenderSource {
  const directory = options.directory ?? "/_meeko/prerender/";
  if (!directory.startsWith("/") || !directory.endsWith("/")) throw new TypeError("Prerender directory must start and end with /");
  const read = async (file: string, optional: boolean): Promise<string | undefined> => {
    const path = directory + file.split("/").map(encodeURIComponent).join("/");
    const response = await options.binding.fetch(new Request(new URL(path, assetOrigin)));
    if (response.status === 404 && optional) { await response.body?.cancel(); return undefined; }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`Missing prerendered file ${path}`); }
    return response.text();
  };
  let index: Promise<PrerenderIndex["pages"]> | undefined;
  const cache = new Map<string, Promise<PrerenderedPage>>();
  const pages = (): Promise<PrerenderIndex["pages"]> => {
    if (!index) {
      const pending = read("manifest.json", true).then((source) => source === undefined ? {} : (JSON.parse(source) as PrerenderIndex).pages ?? {});
      index = pending;
      pending.catch(() => { if (index === pending) index = undefined; });
    }
    return index;
  };
  return {
    async get(pathname) {
      const listed = await pages();
      if (!listed || !Object.hasOwn(listed, pathname)) return undefined;
      let page = cache.get(pathname);
      if (!page) {
        const entry = listed[pathname]!;
        const loading = (async () => {
          const html = (await read(entry.file, false))!;
          const payload = entry.payload ? await read(entry.payload, false) : undefined;
          return { html, headOffset: entry.headOffset, etag: entry.etag, ...(payload === undefined ? {} : { payload }) };
        })();
        page = loading;
        cache.set(pathname, loading);
        // A failed read is retried by the next request instead of being cached.
        loading.catch(() => { if (cache.get(pathname) === loading) cache.delete(pathname); });
      }
      return page;
    },
  };
}

/**
 * Parte de una sentencia preparada de D1 que usa `D1SessionDriver`.
 *
 * @example
 * ```ts
 * import type { D1PreparedStatementLike } from "@meekojs/meeko/cloudflare";
 *
 * const statement: D1PreparedStatementLike = env.DB.prepare("SELECT count(*) AS total FROM meeko_sessions");
 * const row = await statement.first<{ total: number }>();
 * ```
 */
export interface D1PreparedStatementLike {
  /** Enlaza los parámetros. */
  bind(...values: unknown[]): D1PreparedStatementLike;
  /** Primera fila, o `null`. */
  first<T = Record<string, unknown>>(): Promise<T | null>;
  /** Ejecuta la sentencia; `meta.changes` es el número de filas cambiadas. */
  run(): Promise<{ readonly meta: { readonly changes: number } }>;
}

/**
 * Parte de un binding de base de datos D1 que usa `D1SessionDriver`.
 *
 * @example
 * ```ts
 * import type { D1DatabaseLike } from "@meekojs/meeko/cloudflare";
 *
 * interface Env { readonly DB?: D1DatabaseLike }
 * ```
 */
export interface D1DatabaseLike {
  /** Prepara una sentencia SQL. */
  prepare(query: string): D1PreparedStatementLike;
}

/**
 * Opciones de {@link D1SessionDriver}.
 *
 * @example
 * ```ts
 * import { D1SessionDriver } from "@meekojs/meeko/cloudflare";
 *
 * const driver = new D1SessionDriver(env.DB, { table: "app_sessions" });
 * ```
 */
export interface D1SessionDriverOptions {
  /** Tabla creada con `D1SessionDriver.schema(table)`. Por defecto, `meeko_sessions`. */
  readonly table?: string;
}

interface D1SessionRow {
  id: string;
  family_id: string;
  csrf_token: string;
  data_json: string;
  created_at: number;
  expires_at: number;
}

function tableName(value: string | undefined): string {
  const table = value ?? "meeko_sessions";
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,62}$/.test(table)) throw new TypeError(`Invalid D1 session table name: ${table}`);
  return table;
}

/**
 * Driver de `SqlSessionStore` para Cloudflare D1. La rotación y la revocación de familia son
 * sentencias atómicas únicas; `UNIQUE(family_id)` mantiene un único ID activo por familia. D1 no
 * notifica revocaciones a otros aislados.
 *
 * @example
 * ```ts
 * // server/runtime.ts
 * import { D1SessionDriver } from "@meekojs/meeko/cloudflare";
 * import type { D1DatabaseLike } from "@meekojs/meeko/cloudflare";
 * import { defineServerRuntime, MemorySessionStore, SessionManager, SqlSessionStore } from "@meekojs/meeko/server";
 *
 * interface Env { readonly DB?: D1DatabaseLike }
 *
 * export default defineServerRuntime<Env>(({ env, production, prerendering }) => {
 *   const store = prerendering || !env.DB ? new MemorySessionStore() : new SqlSessionStore(new D1SessionDriver(env.DB));
 *   return { sessions: new SessionManager({ production: production && !prerendering, store }) };
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#sesiones-en-d1
 */
export class D1SessionDriver implements SqlSessionDriver {
  private readonly table: string;

  /**
   * Esquema de referencia de la tabla; aplíquelo con una migración de D1 antes de desplegar.
   * @throws {TypeError} Si el nombre de la tabla no es válido.
   */
  static schema(table?: string): string {
    const name = tableName(table);
    return `CREATE TABLE IF NOT EXISTS "${name}" (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "${name}_expires_at" ON "${name}" (expires_at);
`;
  }

  /**
   * @param db Binding de la base de datos D1.
   * @param options Tabla de las sesiones.
   * @throws {TypeError} Si `db` no es un binding de D1 o la tabla no es válida.
   */
  constructor(private readonly db: D1DatabaseLike, options: D1SessionDriverOptions = {}) {
    if (!db || typeof db.prepare !== "function") throw new TypeError("D1SessionDriver requires a D1 database binding");
    this.table = tableName(options.table);
  }

  async read(id: string): Promise<SqlSessionRow | undefined> {
    const row = await this.db.prepare(`SELECT id, family_id, csrf_token, data_json, created_at, expires_at FROM "${this.table}" WHERE id = ?`).bind(id).first<D1SessionRow>();
    if (!row) return undefined;
    return {
      id: row.id, familyId: row.family_id, csrfToken: row.csrf_token, dataJson: row.data_json,
      createdAt: Number(row.created_at), expiresAt: Number(row.expires_at),
    };
  }

  async write(row: SqlSessionRow): Promise<void> {
    // A second id in an active family violates UNIQUE(family_id) and fails.
    const result = await this.db.prepare(
      `INSERT INTO "${this.table}" (id, family_id, csrf_token, data_json, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?) ` +
      `ON CONFLICT(id) DO UPDATE SET csrf_token = excluded.csrf_token, data_json = excluded.data_json, expires_at = excluded.expires_at ` +
      `WHERE "${this.table}".family_id = excluded.family_id`,
    ).bind(row.id, row.familyId, row.csrfToken, row.dataJson, row.createdAt, row.expiresAt).run();
    if (result.meta.changes !== 1) throw new Error("Session id cannot change family");
  }

  async remove(id: string): Promise<void> {
    await this.db.prepare(`DELETE FROM "${this.table}" WHERE id = ?`).bind(id).run();
  }

  async replace(previousId: string, row: SqlSessionRow, now: number): Promise<boolean> {
    const result = await this.db.prepare(
      `UPDATE "${this.table}" SET id = ?, csrf_token = ?, data_json = ?, created_at = ?, expires_at = ? WHERE id = ? AND family_id = ? AND expires_at > ?`,
    ).bind(row.id, row.csrfToken, row.dataJson, row.createdAt, row.expiresAt, previousId, row.familyId, now).run();
    return result.meta.changes === 1;
  }

  async revokeFamily(familyId: string): Promise<void> {
    await this.db.prepare(`DELETE FROM "${this.table}" WHERE family_id = ?`).bind(familyId).run();
  }

  /** Borra las filas caducadas, por ejemplo desde un Cron Trigger; devuelve cuántas borró. */
  async deleteExpired(now: number = Date.now()): Promise<number> {
    const result = await this.db.prepare(`DELETE FROM "${this.table}" WHERE expires_at <= ?`).bind(now).run();
    return result.meta.changes;
  }
}
