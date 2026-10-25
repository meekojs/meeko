import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createSocketHub, defineSocketChannel, MemorySessionStore, SessionManager } from "../src/framework-server.ts";
import type { Schema, SocketPeer } from "../src/framework-server.ts";

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

function peer() {
  const sent: string[] = [];
  const closed: number[] = [];
  const socket: SocketPeer = { send(message) { sent.push(message); }, close(code) { closed.push(code ?? 1000); }, bufferedAmount: 0 };
  return { socket, sent, closed };
}

test("socket checks Origin, session, room, message schema, and revocation on every event", async () => {
  const store = new MemorySessionStore<{ user: string }>();
  const sessions = new SessionManager({ store, secure: false });
  const first = await sessions.load(new Request("https://example.test/"));
  const record = await first.create({ user: "alice" });
  const channel = defineSocketChannel({
    clientToServer: { message: messageSchema },
    serverToClient: { message: messageSchema },
    auth: "required",
    authorize: ({ context, roomId }) => (context.session.current?.data as { user: string } | undefined)?.user === roomId,
    authorizeEvent: ({ payload }) => (payload as { text: string }).text !== "blocked",
    handlers: { message: async ({ payload, emit }) => emit("message", payload) },
  });
  const hub = createSocketHub({ channels: { chat: channel }, sessions, services: {} });
  const request = (origin?: string, cookie?: string) => new Request("https://example.test/socket/chat", { headers: { ...(origin ? { origin } : {}), ...(cookie ? { cookie } : {}) } });
  await assert.rejects(hub.accept("chat", request(undefined, `meeko.sid=${record.id}`), peer().socket, "alice"), (error: unknown) => error instanceof ApiError && error.code === "INVALID_ORIGIN");
  await assert.rejects(hub.accept("chat", request("https://example.test"), peer().socket, "alice"), (error: unknown) => error instanceof ApiError && error.code === "UNAUTHENTICATED");
  await assert.rejects(hub.accept("chat", request("https://example.test", `meeko.sid=${record.id}`), peer().socket, "other"), (error: unknown) => error instanceof ApiError && error.code === "FORBIDDEN");
  const acceptedPeer = peer();
  const connection = await hub.accept("chat", request("https://example.test", `meeko.sid=${record.id}`), acceptedPeer.socket, "alice");
  await connection.receive('{"event":"message","payload":{"text":"hello"}}');
  assert.deepEqual(JSON.parse(acceptedPeer.sent[0]!) as unknown, { event: "message", payload: { text: "hello" } });
  await assert.rejects(connection.receive('{"event":"message","payload":{"text":3}}'), (error: unknown) => error instanceof ApiError && error.code === "INVALID_SOCKET_PAYLOAD");
  await assert.rejects(connection.receive('{"event":"message","payload":{"text":"blocked"}}'), (error: unknown) => error instanceof ApiError && error.code === "FORBIDDEN");
  await store.delete(record.id);
  await assert.rejects(connection.receive('{"event":"message","payload":{"text":"later"}}'), (error: unknown) => error instanceof ApiError && error.code === "UNAUTHENTICATED");
  assert.deepEqual(acceptedPeer.closed, [1008]);
});

test("socket pub/sub releases listeners and enforces message limits", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const channel = defineSocketChannel({ clientToServer: { message: messageSchema }, serverToClient: { message: messageSchema } });
  const hub = createSocketHub({ channels: { chat: channel }, sessions, services: {}, maxMessageBytes: 100 });
  const request = new Request("https://example.test/socket/chat", { headers: { origin: "https://example.test" } });
  const a = peer();
  const b = peer();
  const first = await hub.accept("chat", request, a.socket, "room");
  const second = await hub.accept("chat", request, b.socket, "room");
  await hub.broadcast("chat", "room", "message", { text: "hello" });
  assert.equal(a.sent.length, 1);
  assert.equal(b.sent.length, 1);
  first.close();
  await hub.broadcast("chat", "room", "message", { text: "again" });
  assert.equal(a.sent.length, 1);
  assert.equal(b.sent.length, 2);
  await assert.rejects(second.receive("x".repeat(101)), (error: unknown) => error instanceof ApiError && error.code === "SOCKET_LIMIT_EXCEEDED");
  assert.deepEqual(b.closed, [1009]);
});

test("outbound delivery rechecks a revoked session", async () => {
  const store = new MemorySessionStore();
  const sessions = new SessionManager({ store, secure: false });
  const handle = await sessions.load(new Request("https://example.test/"));
  const record = await handle.create({ user: "alice" });
  const channel = defineSocketChannel({ clientToServer: { message: messageSchema }, serverToClient: { message: messageSchema }, auth: "required" });
  const hub = createSocketHub({ channels: { chat: channel }, sessions, services: {} });
  const acceptedPeer = peer();
  await hub.accept("chat", new Request("https://example.test/socket/chat", { headers: { origin: "https://example.test", cookie: `meeko.sid=${record.id}` } }), acceptedPeer.socket, "room");
  await store.delete(record.id);
  await assert.rejects(hub.broadcast("chat", "room", "message", { text: "later" }), (error: unknown) => error instanceof ApiError && error.code === "UNAUTHENTICATED");
  assert.equal(acceptedPeer.sent.length, 0);
  assert.deepEqual(acceptedPeer.closed, [1008]);
});

test("a failed socket peer does not suppress delivery to other peers", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const channel = defineSocketChannel({ clientToServer: { message: messageSchema }, serverToClient: { message: messageSchema } });
  const hub = createSocketHub({ channels: { chat: channel }, sessions, services: {} });
  const request = new Request("https://example.test/socket/chat", { headers: { origin: "https://example.test" } });
  const closed: number[] = [];
  let attempts = 0;
  await hub.accept("chat", request, {
    send() { attempts++; throw new Error("peer disconnected during send"); },
    close(code) { closed.push(code ?? 1000); },
  }, "room");
  const healthy = peer();
  const connection = await hub.accept("chat", request, healthy.socket, "room");

  await assert.rejects(hub.broadcast("chat", "room", "message", { text: "first" }), /peer disconnected during send/);
  assert.deepEqual(healthy.sent.map((message) => JSON.parse(message) as unknown), [
    { event: "message", payload: { text: "first" } },
  ]);
  assert.deepEqual(closed, [1011]);
  await hub.broadcast("chat", "room", "message", { text: "second" });
  assert.equal(attempts, 1);
  assert.equal(healthy.sent.length, 2);
  connection.close();
});

test("socket close still closes the peer and preserves both cleanup failures", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const channel = defineSocketChannel({ clientToServer: {}, serverToClient: {} });
  const unsubscribeError = new Error("unsubscribe failed");
  const closeError = new Error("peer close failed");
  let releases = 0;
  let peerCloses = 0;
  const hub = createSocketHub({
    channels: { chat: channel }, sessions, services: {},
    pubsub: {
      async publish() {},
      subscribe() { return () => { releases++; throw unsubscribeError; }; },
    },
  });
  const request = new Request("https://example.test/socket/chat", { headers: { origin: "https://example.test" } });
  const connection = await hub.accept("chat", request, {
    send() {},
    close() { peerCloses++; throw closeError; },
  });

  assert.throws(() => connection.close(), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.deepEqual(error.errors, [unsubscribeError, closeError]);
    return true;
  });
  assert.equal(releases, 1);
  assert.equal(peerCloses, 1);
  connection.close();
  assert.equal(releases, 1);
  assert.equal(peerCloses, 1);
});

test("invalid socket messages retain their public error when unsubscribe fails", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const channel = defineSocketChannel({ clientToServer: {}, serverToClient: {} });
  const unsubscribeError = new Error("unsubscribe failed");
  const closed: number[] = [];
  const hub = createSocketHub({
    channels: { chat: channel }, sessions, services: {},
    pubsub: {
      async publish() {},
      subscribe() { return () => { throw unsubscribeError; }; },
    },
  });
  const request = new Request("https://example.test/socket/chat", { headers: { origin: "https://example.test" } });
  const connection = await hub.accept("chat", request, {
    send() {},
    close(code) { closed.push(code ?? 1000); },
  });

  await assert.rejects(connection.receive("{"), (error: unknown) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "INVALID_SOCKET_MESSAGE");
    assert.equal(error.status, 400);
    assert.equal(error.cause, unsubscribeError);
    return true;
  });
  assert.deepEqual(closed, [1008]);
});
