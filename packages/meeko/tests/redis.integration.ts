import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createClient } from "redis";
import {
  createServerApp, createSocketHub, defineApiRoute, defineServerRuntime, defineSocketChannel, MemorySessionStore, RedisSocketPubSub, SessionRevokedError,
} from "../src/framework-server.ts";
import type { Schema } from "../src/framework-server.ts";
import { RedisSessionStore } from "../src/framework-server/session-stores.ts";
import { SessionManager } from "../src/framework-server/sessions.ts";
import type { SessionRecord } from "../src/framework-server/sessions.ts";

const url = process.env.MEEKO_REDIS_URL;

test("RedisSessionStore persists isolated concurrent users, rotates, revokes and expires on real Redis", { skip: !url }, async () => {
  if (!url) throw new Error("MEEKO_REDIS_URL is required");
  const client = createClient({ url, socket: { reconnectStrategy: false } });
  client.on("error", () => { /* Connection errors are asserted at the call site. */ });
  await client.connect();
  const serverInfo = await client.info("server");
  const version = serverInfo.split("\n").find((line) => line.startsWith("redis_version:"))?.slice("redis_version:".length).trim();
  assert.ok(version, "Redis server version was not reported");
  console.log(`Redis server version: ${version}`);
  const prefix = `meeko:test:${randomUUID()}:`;
  const otherPrefix = `meeko:test:${randomUUID()}:`;
  const ids = new Set<string>();
  const families = new Set<string>();
  try {
    const store = new RedisSessionStore<{ user: string }>(client, { prefix });
    const other = new RedisSessionStore<{ user: string }>(client, { prefix: otherPrefix });
    const manager = new SessionManager({ store, production: true, secure: false, ttlMs: 5_000 });
    const handles = await Promise.all(Array.from({ length: 8 }, () => manager.load(new Request("http://localhost/"))));
    const records = await Promise.all(handles.map((handle, index) => handle.create({ user: `user-${index}` })));
    for (const record of records) { ids.add(record.id); families.add(record.familyId ?? record.id); }
    assert.equal(new Set(records.map((record) => record.id)).size, records.length);
    const recovered = await Promise.all(records.map((record) => store.get(record.id)));
    assert.deepEqual(recovered.map((record) => record?.data.user), handles.map((_, index) => `user-${index}`));
    assert.equal(await store.get("missing"), undefined);
    assert.equal(await other.get(records[0]!.id), undefined);
    const raw = await client.get(`${prefix}${records[0]!.id}`);
    assert.ok(raw);
    assert.equal((JSON.parse(raw) as SessionRecord<{ user: string }>).data.user, "user-0");
    const initialTtl = await client.pTTL(`${prefix}${records[0]!.id}`);
    assert.ok(initialTtl > 0 && initialTtl <= 5_000);
    assert.ok(Math.abs(initialTtl - (records[0]!.expiresAt - Date.now())) < 500);

    const stale = await manager.load(new Request("http://localhost/", { headers: { cookie: `${manager.cookieName}=${records[0]!.id}` } }));
    const rotated = await handles[0]!.create({ user: "updated" });
    ids.add(rotated.id);
    assert.equal(await store.get(records[0]!.id), undefined);
    assert.equal((await store.get(rotated.id))?.data.user, "updated");
    assert.ok((await client.pTTL(`${prefix}${rotated.id}`)) > 0);
    assert.ok((await client.pTTL(`${prefix}family:${rotated.familyId}`)) > 0);
    const rotatedAgain = await handles[0]!.rotate();
    ids.add(rotatedAgain.id);
    await stale.revoke();
    assert.equal(await store.get(rotatedAgain.id), undefined);
    assert.equal(await client.exists(`${prefix}family:${rotated.familyId}`), 0);
    await stale.revoke();
    assert.equal((await store.get(records[1]!.id))?.data.user, "user-1");
    await handles[1]!.revoke();
    assert.equal(await store.get(records[1]!.id), undefined);

    const legacy = records[2]!;
    await client.set(`${prefix}${legacy.id}`, JSON.stringify({ ...legacy, familyId: undefined }), { PX: 5_000 });
    await client.del(`${prefix}family:${legacy.familyId}`);
    families.add(legacy.id);
    const oldCookie = `${manager.cookieName}=${legacy.id}`;
    const legacyOwner = await manager.load(new Request("http://localhost/", { headers: { cookie: oldCookie } }));
    const legacyStale = await manager.load(new Request("http://localhost/", { headers: { cookie: oldCookie } }));
    const migrated = await legacyOwner.rotate();
    ids.add(migrated.id);
    assert.equal(migrated.familyId, legacy.id);
    await legacyStale.revoke();
    assert.equal(await store.get(migrated.id), undefined);

    const racing = records[3]!;
    const racingOwner = await manager.load(new Request("http://localhost/", { headers: { cookie: `${manager.cookieName}=${racing.id}` } }));
    const racingStale = await manager.load(new Request("http://localhost/", { headers: { cookie: `${manager.cookieName}=${racing.id}` } }));
    const [rotation, revocation] = await Promise.allSettled([racingOwner.rotate(), racingStale.revoke()]);
    assert.equal(revocation.status, "fulfilled");
    if (rotation.status === "fulfilled") {
      ids.add(rotation.value.id);
      assert.equal(await store.get(rotation.value.id), undefined);
    } else assert.match(String(rotation.reason), /expired or been revoked/);
    assert.equal(await store.get(racing.id), undefined);

    const renewable = { id: randomUUID(), csrfToken: randomUUID(), data: { user: "renewable" }, createdAt: Date.now(), expiresAt: Date.now() + 600 };
    ids.add(renewable.id);
    await store.set(renewable);
    const renewed = { ...renewable, expiresAt: Date.now() + 5_000 };
    await store.set(renewed);
    assert.ok((await client.pTTL(`${prefix}${renewable.id}`)) > 4_000);

    const soon = { id: randomUUID(), csrfToken: randomUUID(), data: { user: "short" }, createdAt: Date.now(), expiresAt: Date.now() + 500 };
    ids.add(soon.id);
    await store.set(soon);
    assert.ok((await client.pTTL(`${prefix}${soon.id}`)) > 0);
    const deadline = Date.now() + 2_000;
    while (await client.exists(`${prefix}${soon.id}`)) {
      assert.ok(Date.now() < deadline, "Redis TTL did not expire within the bounded deadline");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(await store.get(soon.id), undefined);

    const wrongType = randomUUID();
    ids.add(wrongType);
    await client.lPush(`${prefix}${wrongType}`, "not a session");
    await assert.rejects(store.get(wrongType), /WRONGTYPE/);
  } finally {
    await Promise.all([...ids].map((id) => client.del(`${prefix}${id}`)));
    await Promise.all([...families].map((id) => client.del(`${prefix}family:${id}`)));
    await client.quit();
  }
});

test("RedisSessionStore rejects a closed connection and recovers with a replacement client", { skip: !url }, async () => {
  if (!url) throw new Error("MEEKO_REDIS_URL is required");
  const client = createClient({ url, disableOfflineQueue: true, socket: { reconnectStrategy: false } });
  client.on("error", () => {});
  await client.connect();
  const prefix = `meeko:test:${randomUUID()}:`;
  const id = randomUUID();
  const store = new RedisSessionStore<{ user: string }>(client, { prefix, closeClient: true });
  await store.set({ id, csrfToken: randomUUID(), data: { user: "recovered" }, createdAt: Date.now(), expiresAt: Date.now() + 5_000 });
  await store.close();
  await assert.rejects(store.get(id));

  const replacement = createClient({ url, disableOfflineQueue: true, socket: { reconnectStrategy: false } });
  replacement.on("error", () => {});
  try {
    await replacement.connect();
    const recoveredStore = new RedisSessionStore<{ user: string }>(replacement, { prefix });
    assert.equal((await recoveredStore.get(id))?.data.user, "recovered");
    await recoveredStore.delete(id);
  } finally {
    if (replacement.isOpen) await replacement.quit();
  }
});

async function connectedClient(redisUrl: string) {
  const client = createClient({ url: redisUrl, socket: { reconnectStrategy: false } });
  client.on("error", () => { /* Failures surface at the awaiting call site. */ });
  await client.connect();
  return client;
}

async function deletePrefix(client: Awaited<ReturnType<typeof connectedClient>>, prefix: string): Promise<void> {
  // Only keys inside this test's random namespace are touched.
  for await (const batch of client.scanIterator({ MATCH: `${prefix}*`, COUNT: 100 })) {
    for (const key of [batch].flat()) if (key.startsWith(prefix)) await client.del(key);
  }
}

const textSchema: Schema<{ text: string }> = { "~standard": { version: 1, validate(value) {
  return value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string" ? { value: value as { text: string } } : { issues: [{}] };
} } };

test("RedisSocketPubSub delivers broadcasts between two server processes on real Redis", { skip: !url, timeout: 30_000 }, async () => {
  if (!url) throw new Error("MEEKO_REDIS_URL is required");
  const prefix = `meeko:test:${randomUUID()}:`;
  const publisher = await connectedClient(url);
  const subscriber = publisher.duplicate();
  subscriber.on("error", () => {});
  await subscriber.connect();
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./fixtures/redis-socket-instance.ts", import.meta.url))], {
    env: { ...process.env, MEEKO_REDIS_URL: url, MEEKO_TEST_PREFIX: prefix },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines: string[] = [];
  let stderr = "";
  createInterface({ input: child.stdout }).on("line", (line) => lines.push(line));
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  const waitFor = async (predicate: () => boolean, label: string) => {
    const deadline = Date.now() + 15_000;
    while (!predicate()) {
      if (child.exitCode !== null) throw new Error(`Instance exited early (${child.exitCode}): ${stderr.slice(0, 500)}`);
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}: ${lines.join(" | ")} ${stderr.slice(0, 500)}`);
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  };
  const texts = (messages: readonly string[]) => messages.map((message) => (JSON.parse(message) as { payload: { text: string } }).payload.text);
  try {
    await waitFor(() => lines.includes("ready"), "the second instance");
    const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
    const deliveryErrors: unknown[] = [];
    const hub = createSocketHub({
      channels: { chat: defineSocketChannel({ clientToServer: {}, serverToClient: { message: textSchema } }) },
      sessions, services: {}, pubsub: new RedisSocketPubSub({ publisher, subscriber, prefix }),
      onDeliveryError: (error) => { deliveryErrors.push(error); },
    });
    const localSent: string[] = [];
    const otherRoom: string[] = [];
    const request = new Request("https://example.test/_meeko/socket/chat", { headers: { origin: "https://example.test" } });
    const local = await hub.accept("chat", request, { send(message) { localSent.push(message); }, close() {} }, "room 1");
    const unrelated = await hub.accept("chat", request, { send(message) { otherRoom.push(message); }, close() {} }, "room 2");
    for (const text of ["one", "two", "three"]) await hub.broadcast("chat", "room 1", "message", { text });
    await assert.rejects(hub.broadcast("chat", "room 1", "message", { text: 3 }), /INVALID_SOCKET_PAYLOAD/);
    const remote = () => lines.filter((line) => line.startsWith("message ")).map((line) => line.slice("message ".length));
    await waitFor(() => remote().length === 3 && localSent.length === 3, "cross-process delivery");
    assert.deepEqual(texts(remote()), ["one", "two", "three"]);
    assert.deepEqual(texts(localSent), ["one", "two", "three"]);
    assert.deepEqual(otherRoom, []);
    assert.deepEqual(deliveryErrors, []);

    // A raw publish that bypasses the sender's schema is re-validated by every receiver.
    await publisher.publish(`${prefix}socket:chat:room%201`, JSON.stringify({ v: 1, event: "message", payload: { text: 4 } }));
    await waitFor(() => lines.some((line) => line.startsWith("delivery-error")) && deliveryErrors.length === 1, "receiver validation");
    assert.equal(remote().length, 3);
    local.close();
    unrelated.close();
  } finally {
    child.stdin.end();
    await new Promise((resolve) => { if (child.exitCode !== null) resolve(undefined); else child.once("exit", resolve); });
    await subscriber.quit();
    await deletePrefix(publisher, prefix);
    await publisher.quit();
  }
});

test("RedisSocketPubSub supports Redis 7 sharded pub/sub", { skip: !url }, async (context) => {
  if (!url) throw new Error("MEEKO_REDIS_URL is required");
  const publisher = await connectedClient(url);
  const major = Number(/redis_version:(\d+)/.exec(await publisher.info("server"))?.[1] ?? 0);
  if (major < 7) { await publisher.quit(); context.skip("Redis < 7 has no sharded pub/sub"); return; }
  const subscriber = publisher.duplicate();
  subscriber.on("error", () => {});
  await subscriber.connect();
  const receiverPublisher = publisher.duplicate();
  receiverPublisher.on("error", () => {});
  await receiverPublisher.connect();
  const receiverSubscriber = publisher.duplicate();
  receiverSubscriber.on("error", () => {});
  await receiverSubscriber.connect();
  const prefix = `meeko:test:${randomUUID()}:`;
  try {
    const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
    const channels = { chat: defineSocketChannel({ clientToServer: {}, serverToClient: { message: textSchema } }) };
    const sender = createSocketHub({ channels, sessions, services: {}, pubsub: new RedisSocketPubSub({ publisher, subscriber, prefix, sharded: true }) });
    const receiver = createSocketHub({ channels, sessions, services: {}, pubsub: new RedisSocketPubSub({ publisher: receiverPublisher, subscriber: receiverSubscriber, prefix, sharded: true }) });
    const sent: string[] = [];
    const connection = await receiver.accept("chat", new Request("https://example.test/_meeko/socket/chat", { headers: { origin: "https://example.test" } }), { send(message) { sent.push(message); }, close() {} }, "room");
    await sender.broadcast("chat", "room", "message", { text: "sharded" });
    const deadline = Date.now() + 5_000;
    while (!sent.length) {
      assert.ok(Date.now() < deadline, "sharded message was not delivered");
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal((JSON.parse(sent[0]!) as { payload: { text: string } }).payload.text, "sharded");
    connection.close();
  } finally {
    await receiverSubscriber.quit();
    await receiverPublisher.quit();
    await subscriber.quit();
    await deletePrefix(publisher, prefix);
    await publisher.quit();
  }
});

test("RedisSocketPubSub keeps the room subscribed when the last peer leaves while another joins, on real Redis", { skip: !url, timeout: 30_000 }, async () => {
  if (!url) throw new Error("MEEKO_REDIS_URL is required");
  const publisher = await connectedClient(url);
  const subscriber = publisher.duplicate();
  subscriber.on("error", () => {});
  await subscriber.connect();
  const prefix = `meeko:test:${randomUUID()}:`;
  try {
    const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
    const pubsub = new RedisSocketPubSub({ publisher, subscriber, prefix });
    const hub = createSocketHub({ channels: { chat: defineSocketChannel({ clientToServer: {}, serverToClient: { message: textSchema } }) }, sessions, services: {}, pubsub });
    const request = new Request("https://example.test/_meeko/socket/chat", { headers: { origin: "https://example.test" } });
    const channel = pubsub.channelName("chat", "room");
    let current = await hub.accept("chat", request, { send() {}, close() {} }, "room");
    for (let round = 0; round < 5; round++) {
      const sent: string[] = [];
      current.close(); // the UNSUBSCRIBE is still in flight when the next peer subscribes
      current = await hub.accept("chat", request, { send(message) { sent.push(message); }, close() {} }, "room");
      await hub.broadcast("chat", "room", "message", { text: `round ${round}` });
      const deadline = Date.now() + 5_000;
      while (!sent.length) {
        assert.ok(Date.now() < deadline, `round ${round} was not delivered`);
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
      assert.deepEqual(sent.map((message) => (JSON.parse(message) as { payload: { text: string } }).payload.text), [`round ${round}`]);
      assert.deepEqual(await publisher.sendCommand(["PUBSUB", "NUMSUB", channel]), [channel, 1]);
    }
    current.close();
  } finally {
    await subscriber.quit();
    await deletePrefix(publisher, prefix);
    await publisher.quit();
  }
});

test("hub.broadcast rejects a message that escaping pushes past maxMessageBytes before reaching real Redis", { skip: !url }, async () => {
  if (!url) throw new Error("MEEKO_REDIS_URL is required");
  const publisher = await connectedClient(url);
  const subscriber = publisher.duplicate();
  subscriber.on("error", () => {});
  await subscriber.connect();
  const prefix = `meeko:test:${randomUUID()}:`;
  try {
    const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
    const hub = createSocketHub({ channels: { chat: defineSocketChannel({ clientToServer: {}, serverToClient: { message: textSchema } }) }, sessions, services: {}, pubsub: new RedisSocketPubSub({ publisher, subscriber, prefix }) });
    const closed: number[] = [];
    const connection = await hub.accept("chat", new Request("https://example.test/_meeko/socket/chat", { headers: { origin: "https://example.test" } }), { send() {}, close(code) { closed.push(code ?? 1000); } }, "room");
    await assert.rejects(hub.broadcast("chat", "room", "message", { text: "<".repeat(11_000) }), /SOCKET_LIMIT_EXCEEDED/);
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.deepEqual(closed, []);
    connection.close();
  } finally {
    await subscriber.quit();
    await deletePrefix(publisher, prefix);
    await publisher.quit();
  }
});

test("a revocation on one instance aborts an in-flight request on another through real Redis", { skip: !url, timeout: 30_000 }, async () => {
  if (!url) throw new Error("MEEKO_REDIS_URL is required");
  const prefix = `meeko:test:${randomUUID()}:`;
  const clientA = await connectedClient(url);
  const clientB = await connectedClient(url);
  const subscriberB = clientB.duplicate();
  subscriberB.on("error", () => {});
  await subscriberB.connect();
  let started!: () => void;
  const running = new Promise<void>((resolve) => { started = resolve; });
  const sessionsA = new SessionManager({ store: new RedisSessionStore(clientA, { prefix }), production: true, secure: false });
  const sessionsB = new SessionManager({ store: new RedisSessionStore(clientB, { prefix, subscriber: subscriberB }), production: true, secure: false });
  const app = await createServerApp({
    production: false,
    manifest: {
      version: 1, routes: [], routeMiddleware: [], serverMiddleware: [],
      client: { entry: "/assets/entry.js", css: [], preload: [] },
      server: { api: [{ kind: "api", file: "/server/api/transfer.get.ts", pathname: "/api/transfer", method: "GET", clientKey: "transfer" }], rpc: [], socket: [] },
    },
    load: async () => ({ default: defineApiRoute({ contentType: "response", async handler({ context }) {
      started();
      await new Promise((_resolve, reject) => context.signal.addEventListener("abort", () => reject(context.signal.reason as Error), { once: true }));
      return new Response("unreachable");
    } }) }),
    runtime: defineServerRuntime(() => ({ sessions: sessionsB, onError: () => {} })),
  });
  try {
    const record = await (await sessionsA.load(new Request("https://example.test/"))).create({ user: "ada" });
    const cookie = `${sessionsB.cookieName}=${record.id}`;
    const pending = app.fetch(new Request("https://example.test/api/transfer", { headers: { cookie } }));
    await running;
    const stale = await sessionsB.load(new Request("https://example.test/", { headers: { cookie } }));
    await (await sessionsA.load(new Request("https://example.test/", { headers: { cookie } }))).revoke();
    const response = await pending;
    assert.equal(response.status, 401);
    assert.equal(((await response.json()) as { code: string }).code, "SESSION_REVOKED");
    await assert.rejects(stale.verify(), (error: unknown) => error instanceof SessionRevokedError);
  } finally {
    await app.close();
    await subscriberB.quit();
    await deletePrefix(clientA, prefix);
    await clientA.quit();
    await clientB.quit();
  }
});

test("sessions without server/runtime.ts use MEEKO_REDIS_URL in production and revoke across instances on real Redis", { skip: !url, timeout: 30_000 }, async () => {
  if (!url) throw new Error("MEEKO_REDIS_URL is required");
  const prefix = `meeko:test:${randomUUID()}:`;
  const admin = await connectedClient(url);
  const manifest = {
    version: 1 as const, routes: [], routeMiddleware: [], serverMiddleware: [],
    client: { entry: "/assets/entry.js", css: [], preload: [] },
    server: {
      api: [
        { kind: "api" as const, file: "/login", pathname: "/api/login", method: "POST" as const, clientKey: "login.post" },
        { kind: "api" as const, file: "/logout", pathname: "/api/logout", method: "POST" as const, clientKey: "logout.post" },
        { kind: "api" as const, file: "/me", pathname: "/api/me", method: "GET" as const, clientKey: "me.get" },
      ],
      rpc: [], socket: [],
    },
  };
  const routes: Record<string, unknown> = {
    "/login": { default: defineApiRoute({ origin: "required", contentType: "response", async handler({ context }) {
      await context.session.create({ user: "ada" });
      return new Response(null, { status: 204 });
    } }) },
    "/logout": { default: defineApiRoute({ auth: "required", contentType: "response", async handler({ context }) {
      await context.session.revoke();
      return new Response(null, { status: 204 });
    } }) },
    "/me": { default: defineApiRoute({ auth: "required", contentType: "response", handler: ({ context }) => Response.json(context.session.current?.data) }) },
  };
  const options = {
    manifest, production: true, load: async (key: string) => routes[key],
    loadRedis: () => import("redis"),
    platform: { name: "node" as const, env: { MEEKO_REDIS_URL: url, MEEKO_REDIS_PREFIX: prefix, MEEKO_SESSION_TTL: "1h" }, waitUntil() {} },
  };
  const first = await createServerApp(options);
  const second = await createServerApp(options);
  try {
    const login = await first.fetch(new Request("https://shop.example/api/login", { method: "POST", headers: { origin: "https://shop.example" } }));
    assert.equal(login.status, 204, await login.text());
    const setCookie = login.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /^__Host-meeko\.sid=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure$/);
    const cookie = setCookie.split(";")[0]!;
    const id = cookie.split("=")[1]!;
    const ttl = await admin.pTTL(`${prefix}${id}`);
    assert.ok(ttl > 3_500_000 && ttl <= 3_600_000, `TTL ${ttl}`);
    // Another instance reads the same session from Redis.
    const me = await second.fetch(new Request("https://shop.example/api/me", { headers: { cookie } }));
    assert.deepEqual(await me.json(), { user: "ada" });
    const csrf = me.headers.get("x-meeko-csrf-token") ?? "";
    const logout = await second.fetch(new Request("https://shop.example/api/logout", { method: "POST", headers: { cookie, origin: "https://shop.example", "x-meeko-csrf": csrf } }));
    assert.equal(logout.status, 204, await logout.text());
    assert.equal(await admin.get(`${prefix}${id}`), null);
    const after = await first.fetch(new Request("https://shop.example/api/me", { headers: { cookie } }));
    assert.equal(after.status, 401);
  } finally {
    await first.close();
    await second.close();
    await deletePrefix(admin, prefix);
    await admin.quit();
  }
});
