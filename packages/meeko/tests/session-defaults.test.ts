import assert from "node:assert/strict";
import test from "node:test";
import { createServerApp, defineApiRoute, MemorySessionStore, SessionManager } from "../src/framework-server.ts";
import type { AppManifest, ServerAppOptions, ServerPlatform } from "../src/framework-server.ts";
import { resetEnvWarnings } from "../src/framework-server/env.ts";
import { fakeRedisModule } from "./helpers/fake-redis.ts";

const manifest: AppManifest = {
  version: 1,
  routes: [],
  server: {
    api: [
      { kind: "api", file: "/server/api/login.post.ts", pathname: "/api/login", method: "POST", clientKey: "login.post" },
      { kind: "api", file: "/server/api/me.get.ts", pathname: "/api/me", method: "GET", clientKey: "me.get" },
    ],
    rpc: [],
  },
  routeMiddleware: [],
  serverMiddleware: [],
  client: { entry: "/assets/entry.js", css: [], preload: [] },
};

const modules: Record<string, unknown> = {
  "/server/api/login.post.ts": { default: defineApiRoute({ contentType: "response", origin: "required", async handler({ context }) {
    await context.session.create({ user: "ada" });
    return new Response(null, { status: 204 });
  } }) },
  "/server/api/me.get.ts": { default: defineApiRoute({ auth: "required", contentType: "response", handler: ({ context }) => Response.json(context.session.current?.data) }) },
};

const load = async (key: string): Promise<unknown> => modules[key];

function platform(env: Record<string, string | undefined>, name: ServerPlatform["name"] = "node"): ServerPlatform<Record<string, string | undefined>> {
  return { name, env, waitUntil() {} };
}

function app(options: Partial<ServerAppOptions> & Pick<ServerAppOptions, "production">) {
  return createServerApp({ manifest, load, ...options });
}

async function signIn(server: Awaited<ReturnType<typeof app>>): Promise<string> {
  const response = await server.fetch(new Request("https://shop.example/api/login", { method: "POST", headers: { origin: "https://shop.example" } }));
  assert.equal(response.status, 204, await response.text());
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  return cookie;
}

test("development without server/runtime.ts keeps sessions in memory with secure cookie defaults", async () => {
  const server = await app({ production: false, platform: platform({}) });
  try {
    const cookie = await signIn(server);
    assert.match(cookie, /^__Host-meeko\.sid=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
    assert.doesNotMatch(cookie, /Domain=/i, "the cookie is host-only");
    const me = await server.fetch(new Request("https://shop.example/api/me", { headers: { cookie: cookie.split(";")[0]! } }));
    assert.deepEqual(await me.json(), { user: "ada" });
  } finally { await server.close(); }
});

test("a runtime without sessions keeps its services and gets Meeko's sessions", async () => {
  let closed = 0;
  const server = await app({
    production: false, platform: platform({ MEEKO_SESSION_TTL: "12h", MEEKO_SESSION_SAMESITE: "strict" }),
    runtime: () => ({ services: { region: "eu" }, close: () => { closed++; } }),
  });
  try {
    const cookie = await signIn(server);
    assert.match(cookie, /SameSite=Strict; Max-Age=43200; Secure$/);
  } finally { await server.close(); }
  assert.equal(closed, 1);
});

test("explicit sessions win, and the session variables they ignore are reported once", async () => {
  resetEnvWarnings();
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: unknown) => { warnings.push(String(message)); };
  try {
    const sessions = new SessionManager({ store: new MemorySessionStore(), production: false, ttlMs: 1000 });
    const server = await app({ production: false, platform: platform({ MEEKO_SESSION_TTL: "12h" }), runtime: () => ({ sessions }) });
    try { assert.match(await signIn(server), /Max-Age=1;/); }
    finally { await server.close(); }
  } finally { console.warn = original; }
  assert.deepEqual(warnings, ["[meeko] MEEKO_SESSION_TTL no se aplica: server/runtime.ts declara sus propias sesiones."]);
});

test("invalid session variables stop startup", async () => {
  await assert.rejects(app({ production: false, platform: platform({ MEEKO_SESSION_TTL: "forever" }) }), /MEEKO_SESSION_TTL must be a positive duration/);
  await assert.rejects(app({ production: false, platform: platform({ MEEKO_SESSION_SAMESITE: "None" }) }), /MEEKO_SESSION_SAMESITE must be Lax or Strict/);
  await assert.rejects(app({ production: false, runtime: () => ({ sessions: {} as never }) }), /must return \{ sessions: SessionManager \} or omit sessions/);
});

test("production without a persistent store refuses to start", async () => {
  await assert.rejects(app({ production: true, platform: platform({}) }),
    /Production requires a persistent session store: set MEEKO_REDIS_URL/);
  let closed = false;
  await assert.rejects(app({ production: true, platform: platform({}), runtime: () => ({ close: () => { closed = true; } }) }),
    /Production requires a persistent session store/);
  assert.ok(closed, "the runtime's own resources are released");
  // Prerendering serves no clients, so memory is enough.
  const prerendering = await app({ production: true, prerendering: true, platform: platform({}) });
  await prerendering.close();
});

test("production with MEEKO_REDIS_URL explains a missing redis package, Workers and bad URLs without leaking the URL", async () => {
  const url = "redis://user:s3cret@redis.internal:6379";
  await assert.rejects(app({ production: true, platform: platform({ MEEKO_REDIS_URL: url }) }), (error: Error) => {
    assert.match(error.message, /does not install the redis package: add it with npm install redis/);
    assert.doesNotMatch(error.message, /s3cret/);
    return true;
  });
  await assert.rejects(app({ production: true, platform: platform({ MEEKO_REDIS_URL: url }, "cloudflare"), loadRedis: async () => fakeRedisModule().module }),
    /Cloudflare Workers do not offer/);
  await assert.rejects(app({ production: true, platform: platform({ MEEKO_REDIS_URL: "http://user:s3cret@x" }), loadRedis: async () => fakeRedisModule().module }), (error: Error) => {
    assert.match(error.message, /must be a redis:\/\/ or rediss:\/\/ URL/);
    assert.doesNotMatch(error.message, /s3cret/);
    return true;
  });
  await assert.rejects(app({ production: true, platform: platform({ MEEKO_REDIS_URL: url }), loadRedis: async () => { throw new Error("Cannot find package 'redis'"); } }),
    /redis package could not be loaded/);
});

test("production with MEEKO_REDIS_URL connects before serving, stores sessions in Redis and closes both connections", async () => {
  const { server: redis, module } = fakeRedisModule();
  const url = "redis://user:s3cret@redis.internal:6379";
  let runtimeClosed = false;
  const server = await app({
    production: true, appName: "my-app", loadRedis: async () => module,
    platform: platform({ MEEKO_REDIS_URL: url }),
    runtime: () => ({ close: () => { runtimeClosed = true; assert.ok(redis.clients.every((client) => !client.closed), "the app's close runs first"); } }),
  });
  const [client, subscriber] = redis.clients;
  assert.ok(client && subscriber, "a client and a dedicated revocation subscriber");
  assert.equal(redis.clients.length, 2);
  assert.ok(client.connected && subscriber.connected, "both connected before the app serves");
  assert.equal(client.options.url, url);
  assert.equal(client.options.disableOfflineQueue, true, "without a connection requests fail at once");
  assert.equal(subscriber.options.disableOfflineQueue, false);
  try {
    const cookie = await signIn(server);
    assert.match(cookie, /; Secure$/);
    const id = /meeko\.sid=([^;]+)/.exec(cookie)![1]!;
    assert.ok(redis.records.has(`meeko:my-app:prod:${id}`), [...redis.records.keys()].join(", "));
    // Revocations reach every instance through the subscriber.
    assert.ok(redis.channels.get("meeko:my-app:prod:revoked")?.size, "subscribed to revocations");
  } finally { await server.close(); }
  assert.ok(runtimeClosed);
  assert.ok(client.closed && subscriber.closed);
});

test("MEEKO_REDIS_PREFIX replaces the default prefix and a failed connection stops startup", async () => {
  const { server: redis, module } = fakeRedisModule();
  const server = await app({ production: true, loadRedis: async () => module, platform: platform({ MEEKO_REDIS_URL: "rediss://redis.internal", MEEKO_REDIS_PREFIX: "shop:prod:" }) });
  try {
    const id = /meeko\.sid=([^;]+)/.exec(await signIn(server))![1]!;
    assert.ok(redis.records.has(`shop:prod:${id}`));
  } finally { await server.close(); }
  await assert.rejects(app({ production: true, loadRedis: async () => module, platform: platform({ MEEKO_REDIS_URL: "redis://x", MEEKO_REDIS_PREFIX: "no colon" }) }),
    /MEEKO_REDIS_PREFIX must contain no whitespace and end with ':'/);
  const failing = fakeRedisModule();
  failing.server.failConnect = true;
  const errors: string[] = [];
  const original = console.error;
  console.error = (message: unknown) => { errors.push(String(message)); };
  try {
    await assert.rejects(app({ production: true, loadRedis: async () => failing.module, platform: platform({ MEEKO_REDIS_URL: "redis://user:s3cret@x" }) }),
      /Could not connect to the Redis server of MEEKO_REDIS_URL/);
  } finally { console.error = original; }
  assert.ok(failing.server.clients.every((client) => client.closed));
  assert.ok(errors.every((line) => !line.includes("s3cret")));
});
