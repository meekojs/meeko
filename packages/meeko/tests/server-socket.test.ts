import assert from "node:assert/strict";
import test from "node:test";
import { ApiError, createSocketHub, createSocketUpgradeHandler, defineSocketChannel, MemorySessionStore, openSocketSession, SessionManager } from "../src/framework-server.ts";
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

test("the Socket handshake turns auth refusals into a 4401/4403 close and keeps HTTP for the rest", async () => {
  const store = new MemorySessionStore<{ user: string }>();
  const sessions = new SessionManager({ store, secure: false });
  const record = await (await sessions.load(new Request("https://example.test/"))).create({ user: "alice" });
  let handled = 0;
  const channel = (options: { auth?: "required"; authorize?: () => boolean }) => defineSocketChannel({
    clientToServer: { message: messageSchema }, serverToClient: { message: messageSchema },
    ...options,
    handlers: { message: () => { handled++; } },
  });
  const hub = createSocketHub({
    channels: { private: channel({ auth: "required" }), forbidden: channel({ authorize: () => false }) },
    sessions, services: {},
  });
  const observed: unknown[] = [];
  const handshake = createSocketUpgradeHandler({ hub, publicOrigin: "https://example.test", onError: (error) => observed.push(error) });
  const upgrade = (path: string, origin = "https://example.test", cookie?: string) => handshake(new Request(`https://example.test/_meeko/socket/${path}`, {
    headers: { upgrade: "websocket", origin, ...(cookie ? { cookie } : {}) },
  }));
  const cookie = `meeko.sid=${record.id}`;

  assert.deepEqual(await upgrade("private"), { action: "reject", status: 401, close: { code: 4401, reason: "Autenticación requerida" } });
  assert.deepEqual(await upgrade("forbidden", undefined, cookie), { action: "reject", status: 403, close: { code: 4403, reason: "Acceso denegado" } });
  // A foreign Origin is a request policy, not the channel's authorization: it never upgrades.
  assert.deepEqual(await upgrade("private", "https://evil.test", cookie), { action: "reject", status: 403 });
  assert.deepEqual(await upgrade("missing"), { action: "reject", status: 404 });
  assert.deepEqual(await upgrade("bad.name"), { action: "reject", status: 400 });
  assert.equal((await upgrade("private", undefined, cookie)).action, "upgrade");
  assert.equal(observed.length, 4);
  // The reason is fixed text: no session id or user data.
  for (const decision of [await upgrade("private"), await upgrade("forbidden", undefined, cookie)]) {
    assert.ok(decision.action === "reject" && decision.close);
    assert.doesNotMatch(decision.close.reason, new RegExp(`${record.id}|alice`));
  }
  assert.equal(handled, 0);
});

test("a Socket session refused by the hub closes with 4401/4403 and never delivers messages", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  let handled = 0;
  const handlers = { message: () => { handled++; } };
  const hub = createSocketHub({
    channels: {
      private: defineSocketChannel({ clientToServer: { message: messageSchema }, serverToClient: {}, auth: "required", handlers }),
      forbidden: defineSocketChannel({ clientToServer: { message: messageSchema }, serverToClient: {}, authorize: () => false, handlers }),
    },
    sessions, services: {},
  });
  const request = new Request("https://example.test/_meeko/socket/chat", { headers: { origin: "https://example.test" } });
  for (const [name, code] of [["private", 4401], ["forbidden", 4403]] as const) {
    const closes: Array<[number | undefined, string | undefined]> = [];
    const session = openSocketSession({
      hub, name, request, roomId: undefined, maxPendingBytes: 1024,
      peer: { send() { throw new Error("nothing is sent"); }, close(closeCode, reason) { closes.push([closeCode, reason]); } },
    });
    session.receive('{"event":"message","payload":{"text":"early"}}');
    assert.equal(await session.ready, false);
    await session.settled();
    assert.deepEqual(closes.map(([closeCode]) => closeCode), [code]);
  }
  assert.equal(handled, 0);
});
