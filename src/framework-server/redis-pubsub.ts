import { serializeJson } from "../server.js";
import { ApiError } from "./contracts.js";
import type { SocketMessage, SocketPubSub, Unsubscribe } from "./socket.js";

/** Listener signature used by node-redis 4+ for `subscribe` and `sSubscribe`. */
export type RedisMessageListener = (message: string, channel: string) => unknown;

/** Publishing side of a Redis client, structurally compatible with node-redis 4+. */
export interface RedisPublisherClient {
  publish(channel: string, message: string): Promise<unknown>;
  /** Redis 7 sharded pub/sub (`SPUBLISH`); required only with `sharded: true`. */
  sPublish?(channel: string, message: string): Promise<unknown>;
}

/**
 * Dedicated subscriber connection, structurally compatible with node-redis 4+.
 * node-redis requires a separate client (for example `client.duplicate()`) in
 * subscriber mode.
 */
export interface RedisSubscriberClient {
  subscribe(channel: string, listener: RedisMessageListener): Promise<unknown>;
  unsubscribe(channel: string, listener: RedisMessageListener): Promise<unknown>;
  /** Redis 7 sharded pub/sub (`SSUBSCRIBE`); required only with `sharded: true`. */
  sSubscribe?(channel: string, listener: RedisMessageListener): Promise<unknown>;
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

export interface RedisSocketPubSubOptions {
  /** Regular connection used for `PUBLISH`. */
  readonly publisher: RedisPublisherClient;
  /** Dedicated connection in subscriber mode. */
  readonly subscriber: RedisSubscriberClient;
  /** Unique per application and environment; must end with `:`. */
  readonly prefix: string;
  /** Largest serialized envelope accepted by `publish`. Defaults to 1 MiB. */
  readonly maxMessageBytes?: number;
  /** Use Redis 7 sharded pub/sub (`SPUBLISH`/`SSUBSCRIBE`), recommended on Redis Cluster. */
  readonly sharded?: boolean;
  /** Receives malformed envelopes and listener failures; defaults to `console.error`. */
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
 * Distributes Socket broadcasts between server instances through Redis
 * pub/sub. Each (channel, room) maps to one Redis channel, subscribed once per
 * instance while it has local peers. Delivery is at most once: messages
 * published while an instance is disconnected are lost.
 */
export class RedisSocketPubSub implements SocketPubSub {
  private readonly prefix: string;
  private readonly maxMessageBytes: number;
  private readonly publishChannel: (channel: string, message: string) => Promise<unknown>;
  private readonly subscriptions: RedisChannelSubscriptions<{ readonly listener: (message: SocketMessage) => void | Promise<void>; readonly channel: string; readonly room: string }>;
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
  /** Redis channel carrying one Socket channel and room. */
  channelName(channel: string, room: string): string {
    return `${this.prefix}socket:${encodeURIComponent(channel)}:${encodeURIComponent(room)}`;
  }
  /** Resolves once Redis accepts the message; remote peers receive it afterwards. */
  async publish(channel: string, room: string, message: SocketMessage): Promise<void> {
    const envelope = serializeJson({ v: 1, event: message.event, payload: message.payload });
    if (encoder.encode(envelope).byteLength > this.maxMessageBytes) throw new ApiError("SOCKET_LIMIT_EXCEEDED", 413);
    await this.publishChannel(this.channelName(channel, room), envelope);
  }
  /** Resolves after Redis confirms the subscription, so no later broadcast is missed. */
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
