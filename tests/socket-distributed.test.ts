import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiError, createServerApp, createSocketHub, defineServerRuntime, defineSocketChannel, LocalSocketPubSub, MemorySessionStore, RedisSocketPubSub, SessionManager,
} from "../src/framework-server.ts";
import type { RedisPublisherClient, RedisSubscriberClient, Schema, SocketDeliveryErrorContext, SocketPeer } from "../src/framework-server.ts";

const messageSchema: Schema<{ text: string }> = {
  "~standard": {
    version: 1,
    validate(value) {
      return value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string"
        ? { value: value as { text: string } }
        : { issues: [{}] };
    },
  },
};

const origin = "https://example.test";
const request = (cookie?: string) => new Request(`${origin}/_meeko/socket/chat`, { headers: { origin, ...(cookie ? { cookie } : {}) } });

function peer() {
  const sent: string[] = [];
  const closed: number[] = [];
  const socket: SocketPeer = { send(message) { sent.push(message); }, close(code) { closed.push(code ?? 1000); }, bufferedAmount: 0 };
  return { socket, sent, closed, texts: () => sent.map((message) => (JSON.parse(message) as { payload: { text: string } }).payload.text) };
}

async function until(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 2_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

type Listener = (message: string, channel: string) => unknown;

/** In-memory broker with node-redis listener semantics: delivery happens after PUBLISH returns. */
class FakeBroker {
  private readonly channels = new Map<string, Set<Listener>>();
  readonly log: string[] = [];
  client(name: string): RedisPublisherClient & RedisSubscriberClient {
    const subscribe = (kind: string) => async (channel: string, listener: Listener) => {
      this.log.push(`${name} ${kind}SUBSCRIBE ${channel}`);
      let listeners = this.channels.get(channel);
      if (!listeners) { listeners = new Set(); this.channels.set(channel, listeners); }
      listeners.add(listener);
    };
    const unsubscribe = (kind: string) => async (channel: string, listener: Listener) => {
      this.log.push(`${name} ${kind}UNSUBSCRIBE ${channel}`);
      this.channels.get(channel)?.delete(listener);
    };
    const publish = (kind: string) => async (channel: string, message: string) => {
      this.log.push(`${name} ${kind}PUBLISH ${channel}`);
      const listeners = [...this.channels.get(channel) ?? []];
      setTimeout(() => { for (const listener of listeners) listener(message, channel); }, 1);
      return listeners.length;
    };
    return {
      publish: publish(""), subscribe: subscribe(""), unsubscribe: unsubscribe(""),
      sPublish: publish("S"), sSubscribe: subscribe("S"), sUnsubscribe: unsubscribe("S"),
    };
  }
  deliver(channel: string, message: string): void {
    for (const listener of this.channels.get(channel) ?? []) listener(message, channel);
  }
  listeners(channel: string): number { return this.channels.get(channel)?.size ?? 0; }
}

const chat = defineSocketChannel({ clientToServer: { message: messageSchema }, serverToClient: { message: messageSchema } });

test("broadcast resolves when a peer fails, closes that peer and reports it on the owning hub", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const failures: Array<{ error: unknown; context: SocketDeliveryErrorContext }> = [];
  const hub = createSocketHub({ channels: { chat }, sessions, services: {}, onDeliveryError: (error, context) => { failures.push({ error, context }); } });
  const closed: number[] = [];
  let attempts = 0;
  const sendError = new Error("peer disconnected during send");
  await hub.accept("chat", request(), { send() { attempts++; throw sendError; }, close(code) { closed.push(code ?? 1000); } }, "room");
  const healthy = peer();
  await hub.accept("chat", request(), healthy.socket, "room");

  await hub.broadcast("chat", "room", "message", { text: "first" });
  assert.deepEqual(healthy.texts(), ["first"]);
  assert.deepEqual(closed, [1011]);
  assert.equal(failures.length, 1);
  assert.equal(failures[0]!.error, sendError);
  assert.deepEqual(failures[0]!.context, { channel: "chat", room: "room", event: "message" });

  await hub.broadcast("chat", "room", "message", { text: "second" });
  assert.equal(attempts, 1);
  assert.deepEqual(healthy.texts(), ["first", "second"]);
});

test("a revoked subscriber is closed during delivery without failing the broadcaster", async () => {
  const store = new MemorySessionStore();
  const sessions = new SessionManager({ store, secure: false });
  const record = await (await sessions.load(new Request(origin))).create({ user: "alice" });
  const failures: unknown[] = [];
  const channel = defineSocketChannel({ clientToServer: { message: messageSchema }, serverToClient: { message: messageSchema }, auth: "required" });
  // A deletion without a revocation notice is only seen when the session is re-read; 0 re-reads on every delivery.
  const hub = createSocketHub({ channels: { chat: channel }, sessions, services: {}, sessionRefreshMs: 0, onDeliveryError: (error) => { failures.push(error); } });
  const subscriber = peer();
  await hub.accept("chat", request(`meeko.sid=${record.id}`), subscriber.socket, "room");
  await store.delete(record.id);

  await hub.broadcast("chat", "room", "message", { text: "later" });
  assert.equal(subscriber.sent.length, 0);
  assert.deepEqual(subscriber.closed, [1008]);
  assert.ok(failures[0] instanceof ApiError && failures[0].code === "UNAUTHENTICATED");
});

test("createServerApp sends Socket delivery failures to the runtime error observer", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const observed: Array<{ error: unknown; requestId: string }> = [];
  const app = await createServerApp({
    production: false,
    manifest: {
      version: 1, routes: [], routeMiddleware: [], serverMiddleware: [],
      client: { entry: "/assets/entry.js", css: [], preload: [] },
      server: { api: [], rpc: [], socket: [{ kind: "socket", file: "/server/socket/chat.ts", name: "chat", pathname: "/_meeko/socket/chat" }] },
    },
    load: async (key) => (key === "/server/socket/chat.ts" ? { default: chat } : undefined),
    runtime: defineServerRuntime(() => ({ sessions, onError: (error, requestId) => { observed.push({ error, requestId }); } })),
  });
  const sendError = new Error("transport gone");
  const closed: number[] = [];
  await app.socket!.hub.accept("chat", request(), { send() { throw sendError; }, close(code) { closed.push(code ?? 1000); } }, "room");
  await app.socket!.hub.broadcast("chat", "room", "message", { text: "hello" });
  assert.deepEqual(closed, [1011]);
  assert.equal(observed.length, 1);
  assert.equal(observed[0]!.error, sendError);
  assert.match(observed[0]!.requestId, /^[0-9a-f-]{36}$/);
  await app.close();
});

test("createServerApp passes the runtime Socket backlog and session refresh options to the hub", async () => {
  const create = (socket: { maxPendingDeliveries?: number; sessionRefreshMs?: number }) => createServerApp({
    production: false,
    manifest: {
      version: 1, routes: [], routeMiddleware: [], serverMiddleware: [],
      client: { entry: "/assets/entry.js", css: [], preload: [] },
      server: { api: [], rpc: [], socket: [{ kind: "socket", file: "/server/socket/chat.ts", name: "chat", pathname: "/_meeko/socket/chat" }] },
    },
    load: async (key) => (key === "/server/socket/chat.ts" ? { default: chat } : undefined),
    runtime: defineServerRuntime(() => ({ sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }), socket, onError: () => {} })),
  });
  await assert.rejects(create({ maxPendingDeliveries: 0 }), RangeError);
  await assert.rejects(create({ sessionRefreshMs: Number.NaN }), RangeError);
  await (await create({ maxPendingDeliveries: 8, sessionRefreshMs: 0 })).close();
});

test("authorizeSend filters a broadcast per peer without closing it", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const failures: unknown[] = [];
  let allow = false;
  const channel = defineSocketChannel({ clientToServer: {}, serverToClient: { message: messageSchema }, authorizeSend: () => allow });
  const hub = createSocketHub({ channels: { chat: channel }, sessions, services: {}, onDeliveryError: (error) => { failures.push(error); } });
  const filtered = peer();
  await hub.accept("chat", request(), filtered.socket, "room");
  await hub.broadcast("chat", "room", "message", { text: "hidden" });
  allow = true;
  await hub.broadcast("chat", "room", "message", { text: "visible" });
  assert.deepEqual(filtered.texts(), ["visible"]);
  assert.deepEqual(filtered.closed, []);
  assert.deepEqual(failures, []);
});

test("LocalSocketPubSub delivers to every listener and never rejects for a failing one", async () => {
  const listenerErrors: unknown[] = [];
  const pubsub = new LocalSocketPubSub({ onListenerError: (error) => { listenerErrors.push(error); } });
  const received: string[] = [];
  const listenerError = new Error("listener failed");
  const release = await pubsub.subscribe("chat", "room", () => { throw listenerError; });
  await pubsub.subscribe("chat", "room", async ({ event }) => { received.push(event); });
  await pubsub.publish("chat", "room", { event: "message", payload: {} });
  assert.deepEqual(received, ["message"]);
  assert.deepEqual(listenerErrors, [listenerError]);
  await release();
  await pubsub.publish("chat", "room", { event: "again", payload: {} });
  assert.deepEqual(received, ["message", "again"]);
});

test("the hub awaits an asynchronous subscription before accept resolves and reports async unsubscribe failures", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const failures: Array<{ error: unknown; context: SocketDeliveryErrorContext }> = [];
  let subscribed!: () => void;
  const unsubscribeError = new Error("unsubscribe failed");
  const hub = createSocketHub({
    channels: { chat }, sessions, services: {},
    onDeliveryError: (error, context) => { failures.push({ error, context }); },
    pubsub: {
      async publish() {},
      subscribe: () => new Promise((resolve) => { subscribed = () => resolve(async () => { throw unsubscribeError; }); }),
    },
  });
  let accepted = false;
  const pending = hub.accept("chat", request(), peer().socket, "room").then((connection) => { accepted = true; return connection; });
  await until(() => subscribed !== undefined, "subscription");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(accepted, false);
  subscribed();
  const connection = await pending;
  connection.close();
  await until(() => failures.length === 1, "unsubscribe failure");
  assert.equal(failures[0]!.error, unsubscribeError);
  assert.deepEqual(failures[0]!.context, { channel: "chat", room: "room" });
});

test("deliveries to one peer keep publication order even when authorization is slow", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  let delay = 0;
  const slow = defineSocketChannel({
    clientToServer: {}, serverToClient: { message: messageSchema },
    authorizeSend: async () => { const wait = delay; delay = Math.max(0, delay - 10); await new Promise((resolve) => setTimeout(resolve, wait)); return true; },
  });
  const hub = createSocketHub({ channels: { chat: slow }, sessions, services: {}, pubsub: new RedisSocketPubSub(fakePair(new FakeBroker(), "ordering")) });
  const target = peer();
  const connection = await hub.accept("chat", request(), target.socket, "room");
  delay = 30;
  await Promise.all(["one", "two", "three"].map((text) => hub.broadcast("chat", "room", "message", { text })));
  await until(() => target.sent.length === 3, "ordered deliveries");
  assert.deepEqual(target.texts(), ["one", "two", "three"]);
  connection.close();
});

function fakePair(broker: FakeBroker, name: string, extra: { maxMessageBytes?: number; sharded?: boolean; onError?: (error: unknown) => void } = {}) {
  return { publisher: broker.client(`${name}-pub`), subscriber: broker.client(`${name}-sub`), prefix: "app:test:", ...extra };
}

test("RedisSocketPubSub fans out across hubs with one ref-counted Redis channel per room", async () => {
  const broker = new FakeBroker();
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const hubA = createSocketHub({ channels: { chat }, sessions, services: {}, pubsub: new RedisSocketPubSub(fakePair(broker, "a")) });
  const hubB = createSocketHub({ channels: { chat }, sessions, services: {}, pubsub: new RedisSocketPubSub(fakePair(broker, "b")) });
  const redisChannel = "app:test:socket:chat:room%201";
  const first = peer();
  const second = peer();
  const local = peer();
  const firstConnection = await hubB.accept("chat", request(), first.socket, "room 1");
  const secondConnection = await hubB.accept("chat", request(), second.socket, "room 1");
  await hubA.accept("chat", request(), local.socket, "room 1");
  assert.deepEqual(broker.log.filter((line) => line.startsWith("b-sub")), [`b-sub SUBSCRIBE ${redisChannel}`]);

  await hubA.broadcast("chat", "room 1", "message", { text: "hello" });
  assert.ok(broker.log.includes(`a-pub PUBLISH ${redisChannel}`));
  await until(() => first.sent.length === 1 && second.sent.length === 1 && local.sent.length === 1, "fan-out");
  assert.deepEqual(first.texts(), ["hello"]);
  assert.deepEqual(local.texts(), ["hello"]);

  firstConnection.close();
  assert.equal(broker.log.filter((line) => line.startsWith("b-sub UNSUBSCRIBE")).length, 0);
  secondConnection.close();
  await until(() => broker.log.includes(`b-sub UNSUBSCRIBE ${redisChannel}`), "last unsubscribe");
  assert.equal(broker.listeners(redisChannel), 1);
});

test("RedisSocketPubSub publishes a versioned envelope and rejects oversized messages before PUBLISH", async () => {
  const broker = new FakeBroker();
  const published: string[] = [];
  const pubsub = new RedisSocketPubSub({ ...fakePair(broker, "a", { maxMessageBytes: 64 }), publisher: { publish: async (_channel, message) => { published.push(message); return 0; } } });
  await pubsub.publish("chat", "", { event: "message", payload: { text: "<hi>" } });
  assert.deepEqual(JSON.parse(published[0]!) as unknown, { v: 1, event: "message", payload: { text: "<hi>" } });
  await assert.rejects(pubsub.publish("chat", "", { event: "message", payload: { text: "x".repeat(64) } }), (error: unknown) => error instanceof ApiError && error.code === "SOCKET_LIMIT_EXCEEDED");
  assert.equal(published.length, 1);
  assert.throws(() => new RedisSocketPubSub({ ...fakePair(broker, "b"), prefix: "missing-colon" }), /prefix/);
});

test("RedisSocketPubSub receivers drop malformed envelopes and re-validate payloads through the hub", async () => {
  const broker = new FakeBroker();
  const envelopeErrors: unknown[] = [];
  const deliveryErrors: unknown[] = [];
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const hub = createSocketHub({
    channels: { chat }, sessions, services: {},
    onDeliveryError: (error) => { deliveryErrors.push(error); },
    pubsub: new RedisSocketPubSub(fakePair(broker, "b", { onError: (error) => { envelopeErrors.push(error); } })),
  });
  const target = peer();
  await hub.accept("chat", request(), target.socket, "room");
  broker.deliver("app:test:socket:chat:room", "not json");
  broker.deliver("app:test:socket:chat:room", JSON.stringify({ v: 2, event: "message", payload: { text: "future" } }));
  broker.deliver("app:test:socket:chat:room", JSON.stringify({ v: 1, event: "message", payload: { text: 3 } }));
  broker.deliver("app:test:socket:chat:room", JSON.stringify({ v: 1, event: "message", payload: { text: "valid" } }));
  await until(() => target.sent.length === 1 && deliveryErrors.length === 1, "validated delivery");
  assert.equal(envelopeErrors.length, 2);
  assert.ok(deliveryErrors[0] instanceof ApiError && deliveryErrors[0].code === "INVALID_SOCKET_PAYLOAD");
  assert.deepEqual(target.texts(), ["valid"]);
  assert.deepEqual(target.closed, []);
});

test("RedisSocketPubSub uses sharded pub/sub commands when requested", async () => {
  const broker = new FakeBroker();
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const hub = createSocketHub({ channels: { chat }, sessions, services: {}, pubsub: new RedisSocketPubSub(fakePair(broker, "s", { sharded: true })) });
  const target = peer();
  const connection = await hub.accept("chat", request(), target.socket, "room");
  await hub.broadcast("chat", "room", "message", { text: "sharded" });
  await until(() => target.sent.length === 1, "sharded delivery");
  connection.close();
  await until(() => broker.log.some((line) => line.includes("SUNSUBSCRIBE")), "sharded unsubscribe");
  assert.deepEqual(broker.log, [
    "s-sub SSUBSCRIBE app:test:socket:chat:room",
    "s-pub SPUBLISH app:test:socket:chat:room",
    "s-sub SUNSUBSCRIBE app:test:socket:chat:room",
  ]);
  assert.throws(() => new RedisSocketPubSub({ publisher: { publish: async () => 0 }, subscriber: broker.client("x"), prefix: "app:", sharded: true }), /sharded/);
});

test("broadcast rejects a message that exceeds maxMessageBytes once escaped, before publishing and without closing peers", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const local = new LocalSocketPubSub();
  let published = 0;
  const failures: unknown[] = [];
  const hub = createSocketHub({
    channels: { chat }, sessions, services: {}, onDeliveryError: (error) => { failures.push(error); },
    pubsub: { publish: (...args) => { published++; return local.publish(...args); }, subscribe: (...args) => local.subscribe(...args) },
  });
  const target = peer();
  await hub.accept("chat", request(), target.socket, "room");
  // 11 000 bytes of `<` fit a 64 KiB client frame, but `serializeJson` writes each one as `<` (6 bytes).
  const text = "<".repeat(11_000);
  assert.ok(new TextEncoder().encode(JSON.stringify({ event: "message", payload: { text } })).byteLength < 64 * 1024);
  await assert.rejects(hub.broadcast("chat", "room", "message", { text }), (error: unknown) => error instanceof ApiError && error.code === "SOCKET_LIMIT_EXCEEDED" && error.status === 413);
  assert.equal(published, 0);
  assert.deepEqual(target.closed, []);
  assert.deepEqual(failures, []);
  await hub.broadcast("chat", "room", "message", { text: "<ok>" });
  assert.deepEqual(target.texts(), ["<ok>"]);
});

test("a receiving hub with a smaller maxMessageBytes still closes its peer with 1009", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const pubsub = new LocalSocketPubSub();
  const failures: unknown[] = [];
  const sender = createSocketHub({ channels: { chat }, sessions, services: {}, pubsub });
  const receiver = createSocketHub({ channels: { chat }, sessions, services: {}, pubsub, maxMessageBytes: 32, onDeliveryError: (error) => { failures.push(error); } });
  const near = peer();
  const far = peer();
  await sender.accept("chat", request(), near.socket, "room");
  await receiver.accept("chat", request(), far.socket, "room");
  await sender.broadcast("chat", "room", "message", { text: "longer than thirty-two bytes" });
  assert.deepEqual(near.texts(), ["longer than thirty-two bytes"]);
  assert.deepEqual(far.closed, [1009]);
  assert.ok(failures[0] instanceof ApiError && failures[0].code === "SOCKET_LIMIT_EXCEEDED");
});

test("a peer whose delivery backlog exceeds maxPendingDeliveries is closed with 1013 and reported", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  let open!: () => void;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  let authorizeCalls = 0;
  const stalled = defineSocketChannel({
    clientToServer: {}, serverToClient: { message: messageSchema },
    authorizeSend: async () => { authorizeCalls++; await gate; return true; },
  });
  const failures: Array<{ error: unknown; context: SocketDeliveryErrorContext }> = [];
  const hub = createSocketHub({
    channels: { chat: stalled }, sessions, services: {}, maxPendingDeliveries: 4,
    onDeliveryError: (error, context) => { failures.push({ error, context }); },
    pubsub: new RedisSocketPubSub(fakePair(new FakeBroker(), "backlog")),
  });
  const target = peer();
  await hub.accept("chat", request(), target.socket, "room");
  for (let index = 0; index < 10; index++) await hub.broadcast("chat", "room", "message", { text: `m${index}` });
  await until(() => target.closed.length > 0, "backlog close");
  assert.deepEqual(target.closed, [1013]);
  assert.equal(failures.length, 1);
  assert.ok(failures[0]!.error instanceof ApiError && failures[0]!.error.code === "SOCKET_BACKLOG_EXCEEDED" && failures[0]!.error.status === 503);
  assert.deepEqual(failures[0]!.context, { channel: "chat", room: "room", event: "message" });
  open();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(authorizeCalls, 1, "queued deliveries of a closed peer are dropped");
  assert.deepEqual(target.sent, []);
  assert.equal(failures.length, 1);
});

class CountingSessionStore extends MemorySessionStore {
  reads = 0;
  override async get(id: string) {
    this.reads++;
    await new Promise((resolve) => setTimeout(resolve, 5));
    return super.get(id);
  }
}

test("broadcast deliveries rely on the revocation signal and re-read the session at most once per sessionRefreshMs", async () => {
  const store = new CountingSessionStore();
  const sessions = new SessionManager({ store, secure: false });
  const record = await (await sessions.load(new Request(origin))).create({ user: "alice" });
  const channel = defineSocketChannel({ clientToServer: {}, serverToClient: { message: messageSchema }, auth: "required", authorizeSend: () => true });
  const hub = createSocketHub({ channels: { chat: channel }, sessions, services: {}, pubsub: new RedisSocketPubSub(fakePair(new FakeBroker(), "reads")) });
  const target = peer();
  await hub.accept("chat", request(`meeko.sid=${record.id}`), target.socket, "room");
  const afterHandshake = store.reads;
  for (let index = 0; index < 20; index++) await hub.broadcast("chat", "room", "message", { text: `m${index}` });
  await until(() => target.sent.length === 20, "throttled deliveries");
  assert.ok(store.reads - afterHandshake <= 1, `expected at most one store read for 20 deliveries, got ${store.reads - afterHandshake}`);
  await (await sessions.load(request(`meeko.sid=${record.id}`))).revoke();
  assert.deepEqual(target.closed, [1008], "revocation closes the peer through the session signal");
});

test("a delivery after sessionRefreshMs re-reads the session and closes a peer whose record disappeared", async () => {
  const store = new CountingSessionStore();
  const sessions = new SessionManager({ store, secure: false });
  const record = await (await sessions.load(new Request(origin))).create({ user: "alice" });
  const channel = defineSocketChannel({ clientToServer: {}, serverToClient: { message: messageSchema }, auth: "required" });
  const failures: unknown[] = [];
  const hub = createSocketHub({ channels: { chat: channel }, sessions, services: {}, sessionRefreshMs: 20, onDeliveryError: (error) => { failures.push(error); } });
  const target = peer();
  await hub.accept("chat", request(`meeko.sid=${record.id}`), target.socket, "room");
  await store.delete(record.id);
  await new Promise((resolve) => setTimeout(resolve, 40));
  await hub.broadcast("chat", "room", "message", { text: "late" });
  assert.deepEqual(target.sent, []);
  assert.deepEqual(target.closed, [1008]);
  assert.ok(failures[0] instanceof ApiError && failures[0].code === "UNAUTHENTICATED");
  assert.throws(() => createSocketHub({ channels: { chat }, sessions, services: {}, sessionRefreshMs: -1 }), RangeError);
  assert.throws(() => createSocketHub({ channels: { chat }, sessions, services: {}, maxPendingDeliveries: 0 }), RangeError);
});

test("a peer closed by a delivery while its subscription is pending releases it and accept rejects", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  let released = 0;
  const hub = createSocketHub({
    channels: { chat }, sessions, services: {}, onDeliveryError: () => {},
    pubsub: {
      async publish() {},
      async subscribe(_channel, _room, listener) {
        // The broker delivers before `subscribe` resolves; the failed send closes the peer.
        await listener({ event: "message", payload: { text: "early" } });
        return () => { released++; };
      },
    },
  });
  const closed: number[] = [];
  await assert.rejects(
    hub.accept("chat", request(), { send() { throw new Error("transport gone"); }, close(code) { closed.push(code ?? 1000); } }, "room"),
    (error: unknown) => error instanceof ApiError && error.code === "SOCKET_DISCONNECTED",
  );
  assert.equal(released, 1);
  assert.deepEqual(closed, [1011]);
});

test("RedisSocketPubSub keeps one subscription when the last peer leaves while another joins the same room", async () => {
  const broker = new FakeBroker();
  const client = broker.client("churn");
  let releaseUnsubscribe!: () => void;
  const unsubscribing = new Promise<void>((resolve) => { releaseUnsubscribe = resolve; });
  const subscriber: RedisSubscriberClient = { subscribe: client.subscribe, unsubscribe: async (channel, listener) => { await unsubscribing; return client.unsubscribe(channel, listener); } };
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const hub = createSocketHub({ channels: { chat }, sessions, services: {}, pubsub: new RedisSocketPubSub({ publisher: client, subscriber, prefix: "app:test:" }) });
  const redisChannel = "app:test:socket:chat:room";
  const leaving = await hub.accept("chat", request(), peer().socket, "room");
  leaving.close();
  const joining = peer();
  const joiningAccept = hub.accept("chat", request(), joining.socket, "room");
  releaseUnsubscribe();
  await joiningAccept;
  await until(() => broker.log.filter((line) => line.includes("SUBSCRIBE")).length === 3, "subscription churn");
  assert.equal(broker.listeners(redisChannel), 1);
  await hub.broadcast("chat", "room", "message", { text: "after churn" });
  await until(() => joining.sent.length === 1, "delivery after churn");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(joining.texts(), ["after churn"]);
});
