import assert from "node:assert/strict";
import test from "node:test";
import {
  ApiError, createRequestContext, createServerApp, createSocketHub, defineApiRoute, defineServerRuntime, defineSocketChannel,
  MemorySessionStore, RedisSessionStore, SessionManager, SessionRevokedError,
} from "../src/framework-server.ts";
import type { AppManifest, RedisSessionClient, RedisSubscriberClient, SocketPeer } from "../src/framework-server.ts";

const origin = "https://example.test";
const withCookie = (sessions: SessionManager<unknown>, id: string, path = "/") =>
  new Request(`${origin}${path}`, { headers: { origin, cookie: `${sessions.cookieName}=${id}` } });

async function signIn(sessions: SessionManager<unknown>, user = "alice") {
  return (await sessions.load(new Request(origin))).create({ user });
}

function aborted(signal: AbortSignal): Promise<unknown> {
  return new Promise((resolve) => {
    if (signal.aborted) resolve(signal.reason);
    else signal.addEventListener("abort", () => resolve(signal.reason), { once: true });
  });
}

test("revoking a family aborts in-flight request contexts of that family only", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const alice = await signIn(sessions, "alice");
  const bob = await signIn(sessions, "bob");
  const inFlight = createRequestContext(withCookie(sessions, alice.id), {}, await sessions.load(withCookie(sessions, alice.id)));
  const other = createRequestContext(withCookie(sessions, bob.id), {}, await sessions.load(withCookie(sessions, bob.id)));
  const logout = createRequestContext(withCookie(sessions, alice.id), {}, await sessions.load(withCookie(sessions, alice.id)));
  assert.equal(inFlight.signal.aborted, false);

  await logout.session.revoke();
  assert.equal(inFlight.signal.aborted, true);
  assert.ok(inFlight.signal.reason instanceof SessionRevokedError);
  assert.ok(inFlight.signal.reason instanceof ApiError);
  assert.equal((inFlight.signal.reason as ApiError).code, "SESSION_REVOKED");
  assert.equal((inFlight.signal.reason as ApiError).status, 401);
  assert.equal(inFlight.request.signal.aborted, false);
  assert.equal(other.signal.aborted, false);
  assert.equal(logout.signal.aborted, false, "the revoking request keeps running to send its response");
});

test("a revocation published by the shared store reaches other managers sharing it", async () => {
  const store = new MemorySessionStore();
  const instanceA = new SessionManager({ store, secure: false });
  const instanceB = new SessionManager({ store, secure: false });
  const record = await signIn(instanceA);
  const onB = await instanceB.load(withCookie(instanceB, record.id));
  const context = createRequestContext(withCookie(instanceB, record.id), {}, onB);
  await store.revokeFamily(record.familyId!);
  assert.ok((await aborted(context.signal)) instanceof SessionRevokedError);
  await instanceA.close();
  await instanceB.close();
});

test("SessionHandle.verify re-reads the store before irreversible side effects", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const record = await signIn(sessions);
  const handle = await sessions.load(withCookie(sessions, record.id));
  await handle.verify();
  const rotator = await sessions.load(withCookie(sessions, record.id));
  await rotator.rotate();
  await assert.rejects(handle.verify(), (error: unknown) => error instanceof ApiError && error.code === "SESSION_REVOKED" && error.status === 401);
  await rotator.verify();
  await (await sessions.load(new Request(origin))).verify();
});

class FakeRedis implements RedisSessionClient {
  readonly values = new Map<string, string>();
  constructor(private readonly broker: Map<string, Set<(message: string, channel: string) => unknown>>) {}
  async get(key: string) { return this.values.get(key) ?? null; }
  async set(key: string, value: string) { this.values.set(key, value); }
  async del(key: string) { this.values.delete(key); }
  async eval(script: string, options: { keys: string[]; arguments: string[] }) {
    const [first, second, third] = options.keys;
    const args = options.arguments;
    if (script.startsWith("-- meeko:session:set")) { this.values.set(first!, args[0]!); this.values.set(second!, args[1]!); return 1; }
    if (script.startsWith("-- meeko:session:replace")) { this.values.set(second!, args[0]!); this.values.set(third!, args[5]!); this.values.delete(first!); return 1; }
    if (script.startsWith("-- meeko:session:revoke-family")) {
      assert.match(script, /PUBLISH/);
      const active = this.values.get(first!);
      this.values.delete(`${args[0]}${active ?? args[1]}`);
      this.values.delete(first!);
      for (const listener of this.broker.get(args[2]!) ?? []) setTimeout(() => listener(args[1]!, args[2]!), 1);
      return 1;
    }
    return 0;
  }
}

function fakeSubscriber(broker: Map<string, Set<(message: string, channel: string) => unknown>>, log: string[]): RedisSubscriberClient {
  return {
    async subscribe(channel, listener) {
      log.push(`SUBSCRIBE ${channel}`);
      let set = broker.get(channel);
      if (!set) { set = new Set(); broker.set(channel, set); }
      set.add(listener);
    },
    async unsubscribe(channel, listener) { log.push(`UNSUBSCRIBE ${channel}`); broker.get(channel)?.delete(listener); },
  };
}

test("RedisSessionStore publishes revocations from the revoke script and notifies subscribed instances", async () => {
  const broker = new Map<string, Set<(message: string, channel: string) => unknown>>();
  const redis = new FakeRedis(broker);
  const log: string[] = [];
  assert.equal(new RedisSessionStore(redis, { prefix: "app:" }).subscribeRevocations, undefined);
  const storeA = new RedisSessionStore(redis, { prefix: "app:" });
  const storeB = new RedisSessionStore(redis, { prefix: "app:", subscriber: fakeSubscriber(broker, log) });
  const instanceA = new SessionManager({ store: storeA, secure: false, production: true });
  const instanceB = new SessionManager({ store: storeB, secure: false, production: true });
  const record = await signIn(instanceA);
  const context = createRequestContext(withCookie(instanceB, record.id), {}, await instanceB.load(withCookie(instanceB, record.id)));
  assert.deepEqual(log, ["SUBSCRIBE app:revoked"]);

  await (await instanceA.load(withCookie(instanceA, record.id))).revoke();
  assert.ok((await aborted(context.signal)) instanceof SessionRevokedError);
  await instanceB.close();
  assert.deepEqual(log, ["SUBSCRIBE app:revoked", "UNSUBSCRIBE app:revoked"]);
});

test("live sockets of a revoked family are closed with 1008 without waiting for another event", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const record = await signIn(sessions);
  const channel = defineSocketChannel({ clientToServer: {}, serverToClient: {}, auth: "required" });
  const hub = createSocketHub({ channels: { chat: channel }, sessions, services: {} });
  const closed: Array<[number | undefined, string | undefined]> = [];
  const socket: SocketPeer = { send() {}, close(code, reason) { closed.push([code, reason]); } };
  await hub.accept("chat", withCookie(sessions, record.id, "/_meeko/socket/chat"), socket);
  await (await sessions.load(withCookie(sessions, record.id))).revoke();
  assert.deepEqual(closed, [[1008, "Session revoked"]]);
});

test("an API request in flight answers 401 SESSION_REVOKED once its session is revoked", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  let started!: () => void;
  const running = new Promise<void>((resolve) => { started = resolve; });
  const manifest: AppManifest = {
    version: 1, routes: [], routeMiddleware: [], serverMiddleware: [],
    client: { entry: "/assets/entry.js", css: [], preload: [] },
    server: { api: [{ kind: "api", file: "/server/api/slow.get.ts", pathname: "/api/slow", method: "GET", clientKey: "slow" }], rpc: [], socket: [] },
  };
  const modules: Record<string, unknown> = {
    "/server/api/slow.get.ts": { default: defineApiRoute({ contentType: "response", async handler({ context }) {
      started();
      await new Promise((_resolve, reject) => context.signal.addEventListener("abort", () => reject(context.signal.reason), { once: true }));
      return new Response("unreachable");
    } }) },
  };
  const app = await createServerApp({
    manifest, production: false, load: async (key) => modules[key],
    runtime: defineServerRuntime(() => ({ sessions, onError: () => {} })),
  });
  const record = await signIn(sessions);
  const response = app.fetch(withCookie(sessions, record.id, "/api/slow"));
  await running;
  await (await sessions.load(withCookie(sessions, record.id))).revoke();
  const answered = await response;
  assert.equal(answered.status, 401);
  assert.equal(((await answered.json()) as { code: string }).code, "SESSION_REVOKED");
  await app.close();
});
