import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";
import {
  clientAddress, createServerApp, defineApiRoute, defineRpc, defineServerMiddleware, MemorySessionStore, RedisSessionStore, SessionManager, SqlSessionStore,
} from "../src/framework-server.ts";
import type { AppManifest, Schema, ServerApp, ServerAppOptions, SqlRateLimitRow, SqlSessionDriver } from "../src/framework-server.ts";
import { addressBucket, clientAddressOf, normalizeAddress, resetEnvWarnings, setSocketAddress, trustProxyOf } from "../src/framework-server/env.ts";
import { createBunServer } from "../src/bun.ts";
import { serveNode, toNodeListener } from "../src/node.ts";
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

test("an invalid MEEKO_TRUST_PROXY in the adapter's request environment stops startup", async () => {
  // The application starts with a valid environment; the adapter serves requests with another one.
  const server = await app();
  const platform = { name: "node" as const, env: { MEEKO_TRUST_PROXY: "yes" }, waitUntil() {} };
  try {
    await assert.rejects(serveNode(server, { port: 0, platform }), /MEEKO_TRUST_PROXY must be true, false or the number of trusted proxies/);
    assert.throws(() => createBunServer(server, { platform: { ...platform, name: "bun" } }), /MEEKO_TRUST_PROXY/);
  } finally { await server.close(); }
});

test("client addresses: hop counts, true, normalization and IPv6 /64 buckets", () => {
  const request = (xff?: string, socket?: string) => setSocketAddress(new Request("https://x.test/", { headers: xff ? { "x-forwarded-for": xff } : {} }), socket);
  assert.equal(clientAddressOf(request("1.1.1.1", "10.0.0.1"), {}), "10.0.0.1");
  assert.equal(clientAddressOf(request("1.1.1.1, 2.2.2.2, 3.3.3.3", "10.0.0.1"), { MEEKO_TRUST_PROXY: "2" }), "2.2.2.2");
  assert.equal(clientAddressOf(request("1.1.1.1, 2.2.2.2", "10.0.0.1"), { MEEKO_TRUST_PROXY: "true" }), "1.1.1.1");
  assert.equal(clientAddressOf(request(undefined, "10.0.0.1"), { MEEKO_TRUST_PROXY: "1" }), "10.0.0.1", "no header: the socket");
  assert.equal(clientAddressOf(request("not-an-ip", "10.0.0.1"), { MEEKO_TRUST_PROXY: "1" }), "10.0.0.1", "garbage falls back to the connection, not to the global bucket");
  assert.equal(clientAddressOf(request("unknown"), { MEEKO_TRUST_PROXY: "1" }), undefined, "no connection address either: unknown");
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

test("clientAddress applies MEEKO_TRUST_PROXY: hop counts, and spoofed headers when no proxy is trusted", () => {
  const request = (xff?: string, socket?: string) => setSocketAddress(new Request("https://x.test/", { headers: xff ? { "x-forwarded-for": xff } : {} }), socket);
  // Not served by a ServerApp and no env: only the connection, whatever the client sends.
  assert.equal(clientAddress(request("6.6.6.6", "10.0.0.1")), "10.0.0.1");
  assert.equal(clientAddress(request("6.6.6.6")), undefined, "a spoofed header never becomes the address");
  assert.equal(clientAddress(request("6.6.6.6", "10.0.0.1"), {}), "10.0.0.1");
  assert.equal(clientAddress(request("6.6.6.6", "10.0.0.1"), { MEEKO_TRUST_PROXY: "0" }), "10.0.0.1");
  // n trusted proxies: the nth entry from the right; what the client wrote to its left is ignored.
  assert.equal(clientAddress(request("6.6.6.6, 203.0.113.9", "10.0.0.1"), { MEEKO_TRUST_PROXY: "1" }), "203.0.113.9");
  assert.equal(clientAddress(request("6.6.6.6, 203.0.113.9, 10.0.0.5", "10.0.0.1"), { MEEKO_TRUST_PROXY: "2" }), "203.0.113.9");
  assert.equal(clientAddress(request("203.0.113.9, 10.0.0.5", "10.0.0.1"), { MEEKO_TRUST_PROXY: "5" }), "203.0.113.9", "fewer entries than hops: the leftmost");
  assert.equal(clientAddress(request("203.0.113.9, 10.0.0.5", "10.0.0.1"), { MEEKO_TRUST_PROXY: "true" }), "203.0.113.9");
  assert.equal(clientAddress(request("[2001:DB8::1]:443", "10.0.0.1"), { MEEKO_TRUST_PROXY: "1" }), "2001:db8::1");
  assert.equal(clientAddress(request("::ffff:192.0.2.1", "10.0.0.1"), { MEEKO_TRUST_PROXY: "1" }), "192.0.2.1");
  assert.throws(() => clientAddress(request("6.6.6.6", "10.0.0.1"), { MEEKO_TRUST_PROXY: "yes" }), /MEEKO_TRUST_PROXY/);
});

test("clientAddress in server middleware uses the application's MEEKO_TRUST_PROXY, like context.clientAddress", async () => {
  const table = routes([]);
  table["/outer"] = { default: defineServerMiddleware(async (request, next) => {
    const outer = clientAddress(request);
    // A replaced request keeps both its connection and its application's environment.
    const response = await next(new Request(request, { headers: new Headers(request.headers) }));
    return Response.json({ outer, ...await response.json() as object });
  }) };
  table["/inner"] = { default: defineServerMiddleware(async (request, next) => {
    const inner = clientAddress(request);
    const response = await next();
    return Response.json({ inner, ...await response.json() as object });
  }) };
  const serve = (env: Record<string, string>) => createServerApp({
    manifest: { ...manifest, serverMiddleware: ["/outer", "/inner"] }, production: false, load: async (key) => table[key],
    platform: { name: "node", env, waitUntil() {} },
  });
  const trusted = await serve({ MEEKO_TRUST_PROXY: "2" });
  try {
    const response = await trusted.fetch(get("/api/whoami", "10.0.0.2", { "x-forwarded-for": "6.6.6.6, 203.0.113.9, 10.0.0.5" }));
    assert.deepEqual(await response.json(), { outer: "203.0.113.9", inner: "203.0.113.9", address: "203.0.113.9" });
    // The platform an adapter passes to fetch() is the one that applies, as for context.clientAddress.
    const perRequest = await trusted.fetch(get("/api/whoami", "10.0.0.2", { "x-forwarded-for": "6.6.6.6, 203.0.113.9" }), { name: "node", env: {}, waitUntil() {} });
    assert.deepEqual(await perRequest.json(), { outer: "10.0.0.2", inner: "10.0.0.2", address: "10.0.0.2" });
  } finally { await trusted.close(); }
  const untrusted = await serve({});
  try {
    const response = await untrusted.fetch(get("/api/whoami", "10.0.0.2", { "x-forwarded-for": "6.6.6.6" }));
    assert.deepEqual(await response.json(), { outer: "10.0.0.2", inner: "10.0.0.2", address: "10.0.0.2" }, "a spoofed header is ignored");
  } finally { await untrusted.close(); }
});

test("X-Forwarded-For entries with a port, as Azure Application Gateway writes them, name the client", () => {
  const request = (xff: string) => setSocketAddress(new Request("https://x.test/", { headers: { "x-forwarded-for": xff } }), "10.0.0.1");
  const trust = { MEEKO_TRUST_PROXY: "1" };
  assert.equal(clientAddressOf(request("203.0.113.7:5678"), trust), "203.0.113.7");
  assert.equal(clientAddressOf(request("9.9.9.9, 203.0.113.7:443"), trust), "203.0.113.7");
  assert.equal(clientAddressOf(request("[2001:DB8::1]:5678"), trust), "2001:db8::1");
  assert.equal(clientAddressOf(request("[2001:db8::1]"), trust), "2001:db8::1");
  assert.equal(clientAddressOf(request("2001:db8::1"), trust), "2001:db8::1", "a bare IPv6 address has no port to strip");
  assert.equal(clientAddressOf(request("203.0.113.7:port"), trust), "10.0.0.1", "an invalid entry: the connection address");
  assert.equal(clientAddressOf(request("[2001:db8::1]junk"), trust), "10.0.0.1");
  assert.equal(clientAddressOf(request("300.0.0.1:80"), trust), "10.0.0.1");
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

test("a server middleware that passes a new Request to next() keeps the per-client counter", async () => {
  const calls: string[] = [];
  const table = routes(calls);
  table["/replace"] = { default: defineServerMiddleware((request, next) => {
    const headers = new Headers(request.headers);
    headers.set("x-trace", "1");
    return next(new Request(request, { headers }));
  }) };
  const server = await createServerApp({
    manifest: { ...manifest, serverMiddleware: ["/replace"] }, production: false, load: async (key) => table[key],
    platform: { name: "node", env: {}, waitUntil() {} },
  });
  try {
    const whoami = await server.fetch(get("/api/whoami", "203.0.113.7"));
    assert.deepEqual(await whoami.json(), { address: "203.0.113.7" }, "the replaced request still knows its client");
    assert.equal((await server.fetch(post("/api/login", { text: "a" }, "203.0.113.7"))).status, 200);
    assert.equal((await server.fetch(post("/api/login", { text: "b" }, "203.0.113.7"))).status, 200);
    assert.equal((await server.fetch(post("/api/login", { text: "c" }, "203.0.113.7"))).status, 429);
    // Another client is not locked out by the first one: no shared global bucket.
    assert.equal((await server.fetch(post("/api/login", { text: "d" }, "198.51.100.1"))).status, 200);
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
  assert.deepEqual(warnings, ["[meeko] El store de sesiones no implementa rateLimit: los límites de rateLimit se cuentan en la memoria de cada instancia. Con SqlSessionStore, implemente SqlSessionDriver.rateLimit para compartirlos."]);
  assert.equal(new SqlSessionStore(driver).rateLimit, undefined, "without a driver rateLimit the store has none");
});

/**
 * A SQL driver whose counters live in a Map shared like a table. `rateLimit` mimics
 * `INSERT … ON CONFLICT DO UPDATE … RETURNING`: after the round trip, it reads and writes the row in
 * one synchronous step, so concurrent hits never see the same count.
 */
function sqlDriver(table = new Map<string, SqlRateLimitRow>()) {
  const sessions = new Map<string, unknown>();
  const hits: { key: Uint8Array; windowMs: number; now: number }[] = [];
  const driver: SqlSessionDriver = {
    read: async (id) => sessions.get(id) as never, write: async (row) => { sessions.set(row.id, row); }, remove: async (id) => { sessions.delete(id); },
    replace: async () => true, revokeFamily: async () => {},
    async rateLimit(key, windowMs, now) {
      await new Promise((resolve) => setTimeout(resolve, 1));
      hits.push({ key, windowMs, now });
      const id = Buffer.from(key).toString("hex");
      const row = table.get(id);
      const next = !row || row.windowEndsAt <= now ? { count: 1, windowEndsAt: now + windowMs } : { count: row.count + 1, windowEndsAt: row.windowEndsAt };
      table.set(id, next);
      return { ...next };
    },
  };
  return { driver, table, hits };
}

test("SqlSessionStore delegates rateLimit to its driver: one counter for every instance, 429 with Retry-After and no warning", async () => {
  resetEnvWarnings();
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: unknown) => { warnings.push(String(message)); };
  const table = new Map<string, SqlRateLimitRow>();
  const first = sqlDriver(table);
  const second = sqlDriver(table);
  const calls: string[] = [];
  try {
    const one = await app({ calls, runtime: () => ({ sessions: new SessionManager({ store: new SqlSessionStore(first.driver), production: true }) }) });
    const two = await app({ calls, runtime: () => ({ sessions: new SessionManager({ store: new SqlSessionStore(second.driver), production: true }) }) });
    try {
      assert.equal((await one.fetch(post("/api/login", { text: "a" }, "203.0.113.7"))).status, 200);
      assert.equal((await two.fetch(post("/api/login", { text: "b" }, "203.0.113.7"))).status, 200);
      const limited = await one.fetch(post("/api/login", { wrong: true }, "203.0.113.7"));
      assert.equal(limited.status, 429, "the counter lives in the database, not in each instance");
      const retryAfter = Number(limited.headers.get("retry-after"));
      assert.ok(retryAfter >= 59 && retryAfter <= 60, String(retryAfter));
      assert.equal((await limited.json() as { code: string }).code, "RATE_LIMITED");
      assert.deepEqual(calls, ["login", "login"]);
      assert.equal((await two.fetch(post("/api/login", { text: "c" }, "198.51.100.1"))).status, 200, "another client, another row");
    } finally {
      await one.close();
      await two.close();
    }
  } finally { console.warn = original; }
  assert.deepEqual(warnings, []);
  const hits = [...first.hits, ...second.hits];
  assert.equal(hits.length, 4);
  assert.ok(hits.every(({ key, windowMs }) => key instanceof Uint8Array && key.length === 32 && windowMs === 60_000), "a SHA-256 digest and the route's window");
  assert.equal(table.size, 2);
  assert.ok(![...table.keys()].some((key) => Buffer.from(key, "hex").toString("latin1").includes("203.0.113.7")), "no address in clear");
});

test("SqlSessionStore.rateLimit keeps fixed windows, restarts ended ones and counts concurrent hits atomically", async () => {
  const { driver } = sqlDriver();
  const store = new SqlSessionStore(driver);
  const realNow = Date.now;
  let now = 1_700_000_000_000;
  Date.now = () => now;
  try {
    assert.deepEqual(await store.rateLimit!("k", 1000), { count: 1, resetInMs: 1000 });
    now += 400;
    assert.deepEqual(await store.rateLimit!("k", 1000), { count: 2, resetInMs: 600 }, "the window does not slide");
    now += 600;
    assert.deepEqual(await store.rateLimit!("k", 1000), { count: 1, resetInMs: 1000 }, "an ended window restarts at 1");
    assert.deepEqual(await store.rateLimit!("other", 1000), { count: 1, resetInMs: 1000 });
    const counts = (await Promise.all(Array.from({ length: 20 }, () => store.rateLimit!("burst", 60_000)))).map((hit) => hit.count);
    assert.deepEqual(counts.sort((a, b) => a - b), Array.from({ length: 20 }, (_, index) => index + 1));
  } finally { Date.now = realNow; }
  await assert.rejects(store.rateLimit!("k", 0), RangeError);
});

test("SqlSessionStore validates the driver's rateLimit and accepts bigint columns as text", async () => {
  const base = sqlDriver().driver;
  assert.throws(() => new SqlSessionStore({ ...base, rateLimit: "yes" as never }), /rateLimit must be a function/);
  const now = Date.now();
  const textual = new SqlSessionStore({ ...base, rateLimit: async () => ({ count: "3", windowEndsAt: String(now + 5000) }) as never });
  const hit = await textual.rateLimit!("k", 5000);
  assert.equal(hit.count, 3);
  assert.ok(hit.resetInMs > 4000 && hit.resetInMs <= 5000, String(hit.resetInMs));
  for (const result of [undefined, {}, { count: 0, windowEndsAt: now }, { count: 1, windowEndsAt: Number.NaN }, { count: 1, windowEndsAt: null }]) {
    const store = new SqlSessionStore({ ...base, rateLimit: async () => result as never });
    await assert.rejects(store.rateLimit!("k", 1000), /SqlSessionDriver.rateLimit must resolve/);
  }
  const failing = new SqlSessionStore({ ...base, rateLimit: async () => { throw new Error("database down"); } });
  const reported: unknown[] = [];
  const server = await app({ runtime: () => ({ sessions: new SessionManager({ store: failing, production: true }), onError: (error) => { reported.push(error); } }) });
  try {
    assert.equal((await server.fetch(post("/api/login", { text: "a" }, "203.0.113.7"))).status, 500, "fail closed");
    assert.equal(reported.length, 1);
  } finally { await server.close(); }
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
