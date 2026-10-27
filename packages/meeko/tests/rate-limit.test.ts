import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import {
  createServerApp, defineApiRoute, defineRpc, MemorySessionStore, RedisSessionStore, SessionManager, SqlSessionStore,
} from "../src/framework-server.ts";
import type { AppManifest, Schema, ServerApp, ServerAppOptions, SqlSessionDriver } from "../src/framework-server.ts";
import { addressBucket, clientAddressOf, normalizeAddress, resetEnvWarnings, setSocketAddress, trustProxyOf } from "../src/framework-server/env.ts";
import { toNodeListener } from "../src/node.ts";
import { FakeRedis, FakeRedisServer } from "./helpers/fake-redis.ts";

const textSchema: Schema<{ text: string }> = { "~standard": { version: 1, validate(value) {
  return value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string" ? { value: value as { text: string } } : { issues: [{ message: "text" }] };
} } };

const manifest: AppManifest = {
  version: 1,
  routes: [],
  server: {
    api: [
      { kind: "api", file: "/login", pathname: "/api/login", method: "POST", clientKey: "login.post" },
      { kind: "api", file: "/user", pathname: "/api/users/[id]", method: "GET", clientKey: "users.byId.get" },
      { kind: "api", file: "/keyed", pathname: "/api/keyed", method: "GET", clientKey: "keyed.get" },
      { kind: "api", file: "/broken", pathname: "/api/broken", method: "GET", clientKey: "broken.get" },
      { kind: "api", file: "/whoami", pathname: "/api/whoami", method: "GET", clientKey: "whoami.get" },
    ],
    rpc: [{ kind: "rpc", file: "/echo", pathname: "/_meeko/rpc/echo", id: "echo" }],
  },
  routeMiddleware: [],
  serverMiddleware: [],
  client: { entry: "/assets/entry.js", css: [], preload: [] },
};

function routes(calls: string[]): Record<string, unknown> {
  return {
    "/login": { default: defineApiRoute({ body: textSchema, response: textSchema, rateLimit: { limit: 2, window: "1m" }, handler: ({ body }) => { calls.push("login"); return body; } }) },
    "/user": { default: defineApiRoute({ contentType: "response", rateLimit: { limit: 1, window: "1m" }, handler: () => { calls.push("user"); return new Response("ok"); } }) },
    "/keyed": { default: defineApiRoute({ contentType: "response", rateLimit: { limit: 1, window: "1m", key: ({ request }) => request.headers.get("x-user") ?? "" }, handler: () => { calls.push("keyed"); return new Response("ok"); } }) },
    "/broken": { default: defineApiRoute({ contentType: "response", rateLimit: { limit: 0, window: "1m" }, handler: () => new Response("unreachable") }) },
    "/whoami": { default: defineApiRoute({ contentType: "response", handler: ({ context }) => Response.json({ address: context.clientAddress ?? null }) }) },
    "/echo": { default: defineRpc({ input: textSchema, output: textSchema, rateLimit: { limit: 1, window: "50ms" }, handler: ({ input }) => { calls.push("echo"); return input; } }) },
  };
}

async function app(options: Partial<ServerAppOptions> & { env?: Record<string, string | undefined>; calls?: string[] } = {}): Promise<ServerApp> {
  const table = routes(options.calls ?? []);
  return createServerApp({
    manifest, production: false, load: async (key) => table[key],
    platform: { name: "node", env: options.env ?? {}, waitUntil() {} },
    ...options,
  });
}

function post(path: string, body: unknown, address?: string, headers: Record<string, string> = {}): Request {
  return setSocketAddress(new Request(`https://shop.example${path}`, {
    method: "POST", headers: { origin: "https://shop.example", "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }), address);
}

function get(path: string, address?: string, headers: Record<string, string> = {}): Request {
  return setSocketAddress(new Request(`https://shop.example${path}`, { headers }), address);
}

test("rateLimit answers 429 RATE_LIMITED with Retry-After before validating the input or running the handler", async () => {
  const calls: string[] = [];
  const server = await app({ calls });
  try {
    assert.equal((await server.fetch(post("/api/login", { text: "a" }, "203.0.113.7"))).status, 200);
    assert.equal((await server.fetch(post("/api/login", { text: "b" }, "203.0.113.7"))).status, 200);
    const limited = await server.fetch(post("/api/login", { wrong: true }, "203.0.113.7"));
    assert.equal(limited.status, 429);
    const retryAfter = Number(limited.headers.get("retry-after"));
    assert.ok(retryAfter >= 59 && retryAfter <= 60, String(retryAfter));
    const body = await limited.json() as { code: string; status: number; requestId: string };
    assert.equal(body.code, "RATE_LIMITED");
    assert.equal(body.status, 429);
    assert.equal(limited.headers.get("x-request-id"), body.requestId);
    assert.deepEqual(calls, ["login", "login"], "the handler never ran for the limited request");
    // Another client has its own counter.
    assert.equal((await server.fetch(post("/api/login", { text: "c" }, "198.51.100.1"))).status, 200);
  } finally { await server.close(); }
});

test("RPC procedures accept rateLimit, and the window resets", async () => {
  const calls: string[] = [];
  const server = await app({ calls });
  try {
    assert.equal((await server.fetch(post("/_meeko/rpc/echo", { text: "a" }, "203.0.113.7"))).status, 200);
    assert.equal((await server.fetch(post("/_meeko/rpc/echo", { text: "a" }, "203.0.113.7"))).status, 429);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal((await server.fetch(post("/_meeko/rpc/echo", { text: "a" }, "203.0.113.7"))).status, 200);
    assert.deepEqual(calls, ["echo", "echo"]);
  } finally { await server.close(); }
});

test("a dynamic route shares one counter, and without a known client address every client shares the route's bucket", async () => {
  const server = await app();
  try {
    assert.equal((await server.fetch(get("/api/users/1", "203.0.113.7"))).status, 200);
    assert.equal((await server.fetch(get("/api/users/2", "203.0.113.7"))).status, 429, "/users/1 and /users/2 are one route");
    assert.equal((await server.fetch(get("/api/users/3"))).status, 200);
    assert.equal((await server.fetch(get("/api/users/4"))).status, 429, "no address: the shared global bucket");
  } finally { await server.close(); }
});

test("X-Forwarded-For is ignored unless MEEKO_TRUST_PROXY trusts the proxies in front", async () => {
  const untrusted = await app();
  try {
    assert.equal((await untrusted.fetch(get("/api/users/1", "10.0.0.2", { "x-forwarded-for": "203.0.113.1" }))).status, 200);
    // A client rotating the header it controls stays in the proxy's bucket.
    assert.equal((await untrusted.fetch(get("/api/users/1", "10.0.0.2", { "x-forwarded-for": "203.0.113.2" }))).status, 429);
  } finally { await untrusted.close(); }
  const trusted = await app({ env: { MEEKO_TRUST_PROXY: "1" } });
  try {
    // With one trusted proxy, the rightmost entry is the client it saw; spoofed entries to its left are ignored.
    assert.equal((await trusted.fetch(get("/api/users/1", "10.0.0.2", { "x-forwarded-for": "1.1.1.1, 203.0.113.1" }))).status, 200);
    assert.equal((await trusted.fetch(get("/api/users/1", "10.0.0.2", { "x-forwarded-for": "2.2.2.2, 203.0.113.1" }))).status, 429);
    assert.equal((await trusted.fetch(get("/api/users/1", "10.0.0.2", { "x-forwarded-for": "203.0.113.2" }))).status, 200);
    const whoami = await trusted.fetch(get("/api/whoami", "10.0.0.2", { "x-forwarded-for": "9.9.9.9, 203.0.113.9" }));
    assert.deepEqual(await whoami.json(), { address: "203.0.113.9" });
  } finally { await trusted.close(); }
  await assert.rejects(app({ env: { MEEKO_TRUST_PROXY: "yes" } }), /MEEKO_TRUST_PROXY must be true, false or the number of trusted proxies/);
});

test("client addresses: hop counts, true, normalization and IPv6 /64 buckets", () => {
  const request = (xff?: string, socket?: string) => setSocketAddress(new Request("https://x.test/", { headers: xff ? { "x-forwarded-for": xff } : {} }), socket);
  assert.equal(clientAddressOf(request("1.1.1.1", "10.0.0.1"), {}), "10.0.0.1");
  assert.equal(clientAddressOf(request("1.1.1.1, 2.2.2.2, 3.3.3.3", "10.0.0.1"), { MEEKO_TRUST_PROXY: "2" }), "2.2.2.2");
  assert.equal(clientAddressOf(request("1.1.1.1, 2.2.2.2", "10.0.0.1"), { MEEKO_TRUST_PROXY: "true" }), "1.1.1.1");
  assert.equal(clientAddressOf(request(undefined, "10.0.0.1"), { MEEKO_TRUST_PROXY: "1" }), "10.0.0.1", "no header: the socket");
  assert.equal(clientAddressOf(request("not-an-ip", "10.0.0.1"), { MEEKO_TRUST_PROXY: "1" }), undefined, "garbage is not an address");
  assert.equal(normalizeAddress("::ffff:192.0.2.1"), "192.0.2.1");
  assert.equal(normalizeAddress("[2001:DB8::1]"), "2001:db8::1");
  assert.equal(normalizeAddress("fe80::1%eth0"), "fe80::1");
  assert.equal(normalizeAddress("300.1.1.1"), undefined);
  assert.equal(addressBucket("2001:db8:1:2:aaaa::1"), "2001:db8:1:2::/64");
  assert.equal(addressBucket("2001:db8:1:2:bbbb::9"), addressBucket("2001:db8:1:2:aaaa::1"), "one /64, one counter");
  assert.equal(addressBucket("192.0.2.1"), "192.0.2.1");
  assert.equal(trustProxyOf({}), false);
  assert.equal(trustProxyOf({ MEEKO_TRUST_PROXY: "0" }), false);
  assert.equal(trustProxyOf({ MEEKO_TRUST_PROXY: "true" }), true);
  assert.equal(trustProxyOf({ MEEKO_TRUST_PROXY: "3" }), 3);
  assert.throws(() => trustProxyOf({ MEEKO_TRUST_PROXY: "-1" }), /MEEKO_TRUST_PROXY/);
});

test("a custom key counts per subject, and an invalid limit or empty key is a server fault", async () => {
  const calls: string[] = [];
  const reported: unknown[] = [];
  const server = await app({ calls, runtime: () => ({ onError: (error) => { reported.push(error); } }) });
  try {
    assert.equal((await server.fetch(get("/api/keyed", "203.0.113.7", { "x-user": "ada" }))).status, 200);
    assert.equal((await server.fetch(get("/api/keyed", "203.0.113.8", { "x-user": "ada" }))).status, 429, "the key, not the address");
    assert.equal((await server.fetch(get("/api/keyed", "203.0.113.7", { "x-user": "grace" }))).status, 200);
    const empty = await server.fetch(get("/api/keyed", "203.0.113.7"));
    assert.equal(empty.status, 500);
    assert.equal((await empty.json() as { code: string }).code, "INVALID_RATE_LIMIT");
    const broken = await server.fetch(get("/api/broken"));
    assert.equal(broken.status, 500);
    assert.equal((await broken.json() as { code: string }).code, "INVALID_RATE_LIMIT");
    assert.equal(reported.length, 2, "both faults reach onError");
  } finally { await server.close(); }
});

test("the Node adapter reports the connection address as context.clientAddress", async () => {
  const server = await app();
  const http = createServer(toNodeListener((request) => server.fetch(request)));
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  try {
    const { port } = http.address() as { port: number };
    const response = await fetch(`http://127.0.0.1:${port}/api/whoami`, { headers: { "x-forwarded-for": "9.9.9.9" } });
    assert.deepEqual(await response.json(), { address: "127.0.0.1" });
  } finally {
    http.close();
    await once(http, "close");
    await server.close();
  }
});

test("RedisSessionStore counts atomically under the session prefix, shared by every instance", async () => {
  const redis = new FakeRedisServer();
  const client = new FakeRedis(redis, {});
  await client.connect();
  const sessions = () => new SessionManager({ store: new RedisSessionStore(client, { prefix: "shop:prod:" }), production: true });
  const first = await app({ runtime: () => ({ sessions: sessions() }) });
  const second = await app({ runtime: () => ({ sessions: sessions() }) });
  try {
    assert.equal((await first.fetch(post("/api/login", { text: "a" }, "203.0.113.7"))).status, 200);
    assert.equal((await second.fetch(post("/api/login", { text: "a" }, "203.0.113.7"))).status, 200);
    assert.equal((await first.fetch(post("/api/login", { text: "a" }, "203.0.113.7"))).status, 429, "the counter lives in Redis");
    const keys = [...redis.records.keys()].filter((key) => key.startsWith("shop:prod:ratelimit:"));
    assert.equal(keys.length, 1);
    assert.match(keys[0]!, /^shop:prod:ratelimit:[A-Za-z0-9_-]{43}$/, "a digest: no address in clear");
    assert.ok(redis.scripts.includes("meeko:rate-limit"));
  } finally {
    await first.close();
    await second.close();
  }
});

test("a store that is down rejects the limited request instead of letting it through", async () => {
  const redis = new FakeRedisServer();
  const client = new FakeRedis(redis, {});
  await client.connect();
  const calls: string[] = [];
  const reported: unknown[] = [];
  const server = await app({ calls, runtime: () => ({ sessions: new SessionManager({ store: new RedisSessionStore(client, { prefix: "shop:prod:" }), production: true }), onError: (error) => { reported.push(error); } }) });
  try {
    redis.down = true;
    const response = await server.fetch(post("/api/login", { text: "a" }, "203.0.113.7"));
    assert.equal(response.status, 500);
    assert.equal((await response.json() as { code: string }).code, "INTERNAL_ERROR");
    assert.deepEqual(calls, []);
    assert.equal(reported.length, 1, "the failure reaches onError");
  } finally { await server.close(); }
});

test("a store without rateLimit counts in memory and warns once in production", async () => {
  resetEnvWarnings();
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: unknown) => { warnings.push(String(message)); };
  const rows = new Map<string, unknown>();
  const driver: SqlSessionDriver = {
    read: async (id) => rows.get(id) as never, write: async (row) => { rows.set(row.id, row); }, remove: async (id) => { rows.delete(id); },
    replace: async () => true, revokeFamily: async () => {},
  };
  try {
    const server = await app({ runtime: () => ({ sessions: new SessionManager({ store: new SqlSessionStore(driver), production: true }) }) });
    try {
      assert.equal((await server.fetch(get("/api/users/9", "198.51.100.200"))).status, 200);
      assert.equal((await server.fetch(get("/api/users/9", "198.51.100.200"))).status, 429);
    } finally { await server.close(); }
  } finally { console.warn = original; }
  assert.deepEqual(warnings, ["[meeko] El store de sesiones no implementa rateLimit: los límites de rateLimit se cuentan en la memoria de cada instancia."]);
});

test("MemorySessionStore implements SessionStore.rateLimit with fixed windows", async () => {
  const store = new MemorySessionStore();
  assert.deepEqual((await store.rateLimit("k", 1000)).count, 1);
  const second = await store.rateLimit("k", 1000);
  assert.equal(second.count, 2);
  assert.ok(second.resetInMs > 0 && second.resetInMs <= 1000);
  assert.equal((await store.rateLimit("other", 1000)).count, 1);
  await store.close();
  assert.equal((await store.rateLimit("k", 1000)).count, 1, "close() forgets the counters");
});
