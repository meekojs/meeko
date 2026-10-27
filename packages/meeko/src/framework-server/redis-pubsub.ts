import { serializeJson } from "../server.js";
import { ApiError } from "./contracts.js";
import type { SocketMessage, SocketPubSub, Unsubscribe } from "./socket.js";

/**
 * Firma del listener de `subscribe` y `sSubscribe` en node-redis 4 o posterior.
 *
 * @example
 * ```ts
 * import type { RedisMessageListener } from "@meekojs/meeko/server";
 *
 * const listener: RedisMessageListener = (message, channel) => console.log(channel, message.length);
 * await subscriber.subscribe("app:prod:revoked", listener);
 * ```
 */
export type RedisMessageListener = (message: string, channel: string) => unknown;

/**
 * Lado publicador de un cliente Redis, compatible por estructura con node-redis 4 o posterior.
 *
 * @example
 * ```ts
 * import { createClient } from "redis";
 * import type { RedisPublisherClient } from "@meekojs/meeko/server";
 *
 * const publisher: RedisPublisherClient = createClient({ url: process.env.MEEKO_REDIS_URL });
 * ```
 */
export interface RedisPublisherClient {
  /** `PUBLISH` de un mensaje en un canal. */
  publish(channel: string, message: string): Promise<unknown>;
  /** Pub/sub fragmentado de Redis 7 (`SPUBLISH`); sólo hace falta con `sharded: true`. */
  sPublish?(channel: string, message: string): Promise<unknown>;
}

/**
 * Conexión suscriptora dedicada, compatible por estructura con node-redis 4 o posterior, que exige
 * un cliente aparte en modo suscriptor (por ejemplo, `client.duplicate()`).
 *
 * @example
 * ```ts
 * import { createClient } from "redis";
 * import type { RedisSubscriberClient } from "@meekojs/meeko/server";
 *
 * const redis = createClient({ url: process.env.MEEKO_REDIS_URL });
 * const connection = redis.duplicate();
 * await connection.connect();
 * const subscriber: RedisSubscriberClient = connection;
 * ```
 */
export interface RedisSubscriberClient {
  /** `SUBSCRIBE` a un canal con un listener. */
  subscribe(channel: string, listener: RedisMessageListener): Promise<unknown>;
  /** `UNSUBSCRIBE` de ese listener. */
  unsubscribe(channel: string, listener: RedisMessageListener): Promise<unknown>;
  /** Pub/sub fragmentado de Redis 7 (`SSUBSCRIBE`); sólo hace falta con `sharded: true`. */
  sSubscribe?(channel: string, listener: RedisMessageListener): Promise<unknown>;
  /** `SUNSUBSCRIBE`; sólo hace falta con `sharded: true`. */
  sUnsubscribe?(channel: string, listener: RedisMessageListener): Promise<unknown>;
}

interface ChannelEntry<L> {
  readonly listeners: Set<L>;
  readonly onMessage: RedisMessageListener;
  readonly ready: Promise<void>;
}

/**
 * One Redis subscription per channel, shared by every local listener and
 * released when the last one leaves.
 */
export class RedisChannelSubscriptions<L> {
  private readonly entries = new Map<string, ChannelEntry<L>>();
  constructor(
    private readonly subscribeChannel: (channel: string, listener: RedisMessageListener) => Promise<unknown>,
    private readonly unsubscribeChannel: (channel: string, listener: RedisMessageListener) => Promise<unknown>,
    private readonly dispatch: (message: string, listeners: readonly L[]) => void,
  ) {}
  async add(channel: string, listener: L): Promise<() => Promise<void>> {
    let entry = this.entries.get(channel);
    if (!entry) {
      const listeners = new Set<L>();
      const onMessage: RedisMessageListener = (message) => this.dispatch(message, [...listeners]);
      const ready = Promise.resolve().then(() => this.subscribeChannel(channel, onMessage)).then(() => undefined);
      const created: ChannelEntry<L> = { listeners, onMessage, ready };
      this.entries.set(channel, created);
      ready.catch(() => { if (this.entries.get(channel) === created) this.entries.delete(channel); });
      entry = created;
    }
    const current = entry;
    current.listeners.add(listener);
    try { await current.ready; }
    catch (error) {
      current.listeners.delete(listener);
      throw error;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      current.listeners.delete(listener);
      if (current.listeners.size || this.entries.get(channel) !== current) return;
      this.entries.delete(channel);
      await this.unsubscribeChannel(channel, current.onMessage);
    };
  }
}

/**
 * Opciones de {@link RedisSocketPubSub}.
 *
 * @example
 * ```ts
 * import type { RedisSocketPubSubOptions } from "@meekojs/meeko/server";
 *
 * const options: RedisSocketPubSubOptions = { publisher: redis, subscriber, prefix: "app:prod:", sharded: true };
 * ```
 */
export interface RedisSocketPubSubOptions {
  /** Conexión normal que se usa para `PUBLISH`. */
  readonly publisher: RedisPublisherClient;
  /** Conexión dedicada en modo suscriptor. */
  readonly subscriber: RedisSubscriberClient;
  /** Prefijo único por aplicación y entorno; termina en `:`. */
  readonly prefix: string;
  /** Mensaje serializado más grande que acepta `publish`. Por defecto, 1 MiB. */
  readonly maxMessageBytes?: number;
  /** Usa el pub/sub fragmentado de Redis 7 (`SPUBLISH`/`SSUBSCRIBE`), recomendado en Redis Cluster. */
  readonly sharded?: boolean;
  /** Recibe los mensajes mal formados y los fallos de los listeners; por defecto, `console.error`. */
  readonly onError?: (error: unknown, context: { readonly channel: string; readonly room: string }) => void;
}

const encoder = new TextEncoder();

function decodeEnvelope(raw: string): SocketMessage {
  let envelope: unknown;
  try { envelope = JSON.parse(raw) as unknown; }
  catch { throw new TypeError("Malformed Redis Socket envelope"); }
  if (!envelope || typeof envelope !== "object" || (envelope as { v?: unknown }).v !== 1 ||
      typeof (envelope as { event?: unknown }).event !== "string" || !Object.hasOwn(envelope, "payload")) {
    throw new TypeError("Unsupported Redis Socket envelope");
  }
  return { event: (envelope as { event: string }).event, payload: (envelope as { payload: unknown }).payload };
}

/**
 * Reparte los broadcasts de Socket entre instancias del servidor con el pub/sub de Redis. Cada par
 * canal/sala es un canal Redis (`<prefix>socket:<canal>:<sala>`), al que cada instancia se suscribe
 * una vez mientras tenga peers locales. La entrega es como mucho una vez: los mensajes publicados
 * mientras una instancia está desconectada se pierden.
 *
 * @example
 * ```ts
 * // server/runtime.ts
 * import { createClient } from "redis";
 * import { defineServerRuntime, RedisSocketPubSub, SessionManager } from "@meekojs/meeko/server";
 *
 * export default defineServerRuntime(async ({ env, production }) => {
 *   const redis = createClient({ url: env.MEEKO_REDIS_URL });
 *   await redis.connect();
 *   const subscriber = redis.duplicate();
 *   await subscriber.connect();
 *   return {
 *     sessions: new SessionManager({ store, production }),
 *     socket: { pubsub: new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "app:prod:" }) },
 *     close: async () => { await subscriber.quit(); await redis.quit(); },
 *   };
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#broadcast-y-varias-instancias
 */
export class RedisSocketPubSub implements SocketPubSub {
  private readonly prefix: string;
  private readonly maxMessageBytes: number;
  private readonly publishChannel: (channel: string, message: string) => Promise<unknown>;
  private readonly subscriptions: RedisChannelSubscriptions<{ readonly listener: (message: SocketMessage) => void | Promise<void>; readonly channel: string; readonly room: string }>;
  /**
   * @param options Clientes, prefijo y límites.
   * @throws {TypeError} Si el prefijo no es válido o, con `sharded`, faltan los métodos fragmentados.
   * @throws {RangeError} Si `maxMessageBytes` no es un entero positivo.
   */
  constructor(private readonly options: RedisSocketPubSubOptions) {
    if (!options.prefix || !options.prefix.endsWith(":") || /\s/.test(options.prefix)) throw new TypeError("Socket Redis prefix must be nonempty, contain no whitespace, and end with ':'");
    this.prefix = options.prefix;
    this.maxMessageBytes = options.maxMessageBytes ?? 1024 * 1024;
    if (!Number.isSafeInteger(this.maxMessageBytes) || this.maxMessageBytes <= 0) throw new RangeError("Invalid Socket Redis message limit");
    const { publisher, subscriber } = options;
    if (options.sharded) {
      if (!publisher.sPublish || !subscriber.sSubscribe || !subscriber.sUnsubscribe) throw new TypeError("Redis sharded pub/sub requires sPublish, sSubscribe and sUnsubscribe");
      const sPublish = publisher.sPublish, sSubscribe = subscriber.sSubscribe, sUnsubscribe = subscriber.sUnsubscribe;
      this.publishChannel = (channel, message) => sPublish.call(publisher, channel, message);
      this.subscriptions = new RedisChannelSubscriptions((channel, listener) => sSubscribe.call(subscriber, channel, listener), (channel, listener) => sUnsubscribe.call(subscriber, channel, listener), (raw, listeners) => this.dispatch(raw, listeners));
    } else {
      this.publishChannel = (channel, message) => publisher.publish(channel, message);
      this.subscriptions = new RedisChannelSubscriptions((channel, listener) => subscriber.subscribe(channel, listener), (channel, listener) => subscriber.unsubscribe(channel, listener), (raw, listeners) => this.dispatch(raw, listeners));
    }
  }
  /** Canal Redis de un par canal/sala de Socket. */
  channelName(channel: string, room: string): string {
    return `${this.prefix}socket:${encodeURIComponent(channel)}:${encodeURIComponent(room)}`;
  }
  /**
   * Se resuelve cuando Redis acepta el mensaje; los peers remotos lo reciben después.
   * @throws {ApiError} `SOCKET_LIMIT_EXCEEDED` (413) si el mensaje serializado supera `maxMessageBytes`.
   */
  async publish(channel: string, room: string, message: SocketMessage): Promise<void> {
    const envelope = serializeJson({ v: 1, event: message.event, payload: message.payload });
    if (encoder.encode(envelope).byteLength > this.maxMessageBytes) throw new ApiError("SOCKET_LIMIT_EXCEEDED", 413);
    await this.publishChannel(this.channelName(channel, room), envelope);
  }
  /** Se resuelve cuando Redis confirma la suscripción, así que no se pierde ningún broadcast posterior. */
  async subscribe(channel: string, room: string, listener: (message: SocketMessage) => void | Promise<void>): Promise<Unsubscribe> {
    return this.subscriptions.add(this.channelName(channel, room), { listener, channel, room });
  }
  private report(error: unknown, context: { readonly channel: string; readonly room: string }): void {
    try {
      if (this.options.onError) this.options.onError(error, context);
      else console.error(`[meeko] Redis Socket message dropped (${context.channel})`, error);
    } catch { /* A failing observer cannot interrupt delivery to other peers. */ }
  }
  private dispatch(raw: string, listeners: readonly { readonly listener: (message: SocketMessage) => void | Promise<void>; readonly channel: string; readonly room: string }[]): void {
    const first = listeners[0];
    if (!first) return;
    let message: SocketMessage;
    try { message = decodeEnvelope(raw); }
    catch (error) { this.report(error, first); return; }
    for (const entry of listeners) {
      try { void Promise.resolve(entry.listener(message)).catch((error: unknown) => this.report(error, entry)); }
      catch (error) { this.report(error, entry); }
    }
  }
}
