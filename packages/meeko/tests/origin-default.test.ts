import assert from "node:assert/strict";
import test from "node:test";

import type { AppManifest, Schema, ServerApp, ServerAppOptions, ServerPlatform } from "../src/framework-server.ts";

import { createLocalCalls, createRequestContext, createServerApp, defineApiRoute, defineRpc, dispatchApiRoute, dispatchRpc, MemorySessionStore, SessionManager } from "../src/framework-server.ts";

// Since 1.8 every mutation checks Origin by default, with or without a session.

const anySchema: Schema<unknown> = { "~standard": { version: 1, validate: (value) => ({ value }) } };
const okSchema: Schema<{ ok: true }> = { "~standard": { version: 1, validate: (value) => ({ value: value as { ok: true } }) } };
const csrfSchema: Schema<{ csrf: string }> = { "~standard": { version: 1, validate: (value) => ({ value: value as { csrf: string } }) } };

const own = "https://shop.example";
const allowed = "https://admin.shop.example";

const api = (pathname: string, method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", file: string) => ({ kind: "api" as const, file, pathname, method, clientKey: `${file.slice(1)}.${method.toLowerCase()}` });

const manifest: AppManifest = {
  version: 1,
  routes: [],
  server: {
    api: [
      api("/api/items", "GET", "/items"),
      ...(["POST", "PUT", "PATCH", "DELETE"] as const).map((method) => api("/api/items", method, "/items")),
      api("/api/required", "POST", "/required"),
      api("/api/webhook", "POST", "/webhook"),
      api("/api/login", "POST", "/login"),
      api("/api/form", "POST", "/form"),
      api("/api/form-none", "POST", "/form-none"),
    ],
    rpc: [
      { kind: "rpc", file: "/rpc", pathname: "/_meeko/rpc/items/add", id: "items.add" },
      { kind: "rpc", file: "/rpc-none", pathname: "/_meeko/rpc/hooks/ping", id: "hooks.ping" },
    ],
  },
  routeMiddleware: [],
  serverMiddleware: [],
  client: { entry: "/assets/entry.js", css: [], preload: [] },
};

let handled = 0;
const ok = () => { handled++; return { ok: true as const }; };

const modules: Record<string, unknown> = {
  "/items": { default: defineApiRoute({ response: okSchema, handler: ok }) },
  "/required": { default: defineApiRoute({ origin: "required", response: okSchema, handler: ok }) },
  "/webhook": { default: defineApiRoute({ origin: "none", response: okSchema, handler: ok }) },
  "/login": { default: defineApiRoute({ response: csrfSchema, handler: async ({ context }) => ({ csrf: (await context.session.create({ user: "ada" })).csrfToken }) }) },
  "/form": { default: defineApiRoute({ form: true, status: 204, handler: () => { handled++; } }) },
  "/form-none": { default: defineApiRoute({ form: true, origin: "none", status: 204, handler: () => { handled++; } }) },
  "/rpc": { default: defineRpc({ input: anySchema, output: okSchema, handler: ok }) },
  "/rpc-none": { default: defineRpc({ input: anySchema, output: okSchema, origin: "none", handler: ok }) },
};

async function app(options: Partial<ServerAppOptions<Record<string, string>>> = {}): Promise<ServerApp> {
  const sessions = new SessionManager({ store: new MemorySessionStore(), production: false, allowedOrigins: [allowed] });
  return createServerApp({ manifest, production: false, load: async (key) => modules[key], runtime: () => ({ sessions, onError: () => {} }), ...options });
}

function send(server: ServerApp, path: string, method: string, headers: Record<string, string> = {}, platform?: ServerPlatform<Record<string, string>>): Promise<Response> {
  const json = path.startsWith("/_meeko/rpc/") ? { "content-type": "application/json" } : {};
  return server.fetch(new Request(`${own}${path}`, { method, headers: { ...json, ...headers }, ...(json["content-type"] ? { body: "{}" } : {}) }), platform);
}

async function code(response: Response): Promise<string | undefined> {
  return response.headers.get("content-type")?.includes("json") ? ((await response.json()) as { code?: string }).code : undefined;
}

/** Every way a request can lack this site's Origin, including a browser's same-origin metadata alone. */
const refusedHeaders: readonly Record<string, string>[] = [
  {},
  { origin: "null" },
  { origin: "https://evil.example" },
  { origin: "https://shop.example.evil.example" },
  { origin: "http://shop.example" },
  { "sec-fetch-site": "same-origin" },
  { "sec-fetch-site": "same-origin", referer: `${own}/cart` },
  { origin: "null", "sec-fetch-site": "same-origin" },
];

test("anonymous API mutations need an allowed Origin by default, for POST, PUT, PATCH and DELETE", async () => {
  const server = await app();
  try {
    handled = 0;
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      for (const headers of refusedHeaders) {
        const response = await send(server, "/api/items", method, headers);
        assert.equal(response.status, 403, `${method} ${JSON.stringify(headers)}`);
        assert.equal(await code(response), "INVALID_ORIGIN");
      }
      assert.equal((await send(server, "/api/items", method, { origin: own })).status, 200, method);
      assert.equal((await send(server, "/api/items", method, { origin: allowed })).status, 200, `${method} allowedOrigins`);
    }
    assert.equal(handled, 8, "a refused request never reaches the handler");
    // Safe methods are not checked: a navigation carries no Origin.
    assert.equal((await send(server, "/api/items", "GET")).status, 200);
    assert.equal((await send(server, "/api/items", "GET", { origin: "https://evil.example" })).status, 200);
  } finally { await server.close(); }
});

test("Origin decides, whatever Sec-Fetch-Site says", async () => {
  const server = await app();
  try {
    // An allowed origin of another site is cross-site for the browser, and still passes.
    assert.equal((await send(server, "/api/items", "POST", { origin: allowed, "sec-fetch-site": "same-site" })).status, 200);
    assert.equal((await send(server, "/api/items", "POST", { origin: own, "sec-fetch-site": "same-origin" })).status, 200);
    assert.equal((await send(server, "/api/items", "POST", { origin: "https://evil.example", "sec-fetch-site": "same-origin" })).status, 403);
  } finally { await server.close(); }
});

test("RPC calls need an allowed Origin by default", async () => {
  const server = await app();
  try {
    for (const headers of refusedHeaders) {
      const response = await send(server, "/_meeko/rpc/items/add", "POST", headers);
      assert.equal(response.status, 403, JSON.stringify(headers));
      assert.equal(await code(response), "INVALID_ORIGIN");
    }
    assert.equal((await send(server, "/_meeko/rpc/items/add", "POST", { origin: own })).status, 200);
    assert.equal((await send(server, "/_meeko/rpc/items/add", "POST", { origin: allowed })).status, 200);
  } finally { await server.close(); }
});

test("origin: \"required\" is the default made explicit, and origin: \"none\" opts a route out", async () => {
  const server = await app();
  try {
    for (const headers of refusedHeaders) {
      assert.equal((await send(server, "/api/required", "POST", headers)).status, 403, JSON.stringify(headers));
      assert.equal((await send(server, "/api/webhook", "POST", headers)).status, 200, `webhook ${JSON.stringify(headers)}`);
      assert.equal((await send(server, "/_meeko/rpc/hooks/ping", "POST", headers)).status, 200, `rpc ${JSON.stringify(headers)}`);
    }
    assert.equal((await send(server, "/api/required", "POST", { origin: own })).status, 200);
  } finally { await server.close(); }
});

test("with a session, every mutation needs Origin and CSRF, also on a route with origin: \"none\"", async () => {
  const server = await app();
  try {
    // Signing in is a mutation too: without Origin it never creates the session.
    const refused = await send(server, "/api/login", "POST");
    assert.equal(refused.status, 403);
    assert.equal(refused.headers.get("set-cookie"), null);
    const login = await send(server, "/api/login", "POST", { origin: own });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const { csrf } = (await login.json()) as { csrf: string };
    for (const path of ["/api/items", "/api/webhook", "/_meeko/rpc/items/add", "/_meeko/rpc/hooks/ping"]) {
      for (const headers of [{}, { origin: "https://evil.example" }, { "sec-fetch-site": "same-origin" }]) {
        const response = await send(server, path, "POST", { cookie, "x-meeko-csrf": csrf, ...headers });
        assert.equal(response.status, 403, `${path} ${JSON.stringify(headers)}`);
        assert.equal(await code(response), "INVALID_ORIGIN");
      }
      const noToken = await send(server, path, "POST", { cookie, origin: own });
      assert.equal(await code(noToken), "INVALID_CSRF", path);
      assert.equal((await send(server, path, "POST", { cookie, origin: own, "x-meeko-csrf": csrf })).status, 200, path);
    }
  } finally { await server.close(); }
});

test("native forms need this site's Origin; origin: \"none\" exempts them only without a session", async () => {
  const server = await app();
  const form = (path: string, headers: Record<string, string>, fields = "") => server.fetch(new Request(`${own}${path}`, {
    method: "POST", body: `return=${encodeURIComponent("/done")}${fields}`, headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
  }));
  const foreign = [{}, { origin: "null" }, { origin: "https://evil.example" }, { "sec-fetch-site": "same-origin" }];
  try {
    handled = 0;
    for (const path of ["/api/form", "/api/form-none"]) {
      const accepted = await form(path, { origin: own });
      assert.equal(accepted.status, 303, path);
      assert.equal(accepted.headers.get("location"), "/done");
    }
    for (const headers of foreign) {
      const refused = await form("/api/form", headers);
      assert.equal(refused.status, 403, JSON.stringify(headers));
      assert.equal(await code(refused), "INVALID_ORIGIN");
      // A form-encoded webhook (Twilio, Slack) sends no Origin and no session cookie.
      const webhook = await form("/api/form-none", headers);
      assert.equal(webhook.status, 303, `none ${JSON.stringify(headers)}`);
    }
    assert.equal(handled, 2 + foreign.length);

    // With a session, Origin is required even on origin: "none", before the body is read.
    const login = await send(server, "/api/login", "POST", { origin: own });
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const { csrf } = (await login.json()) as { csrf: string };
    handled = 0;
    for (const headers of foreign) {
      const refused = await form("/api/form-none", { cookie, ...headers }, `&_csrf=${csrf}`);
      assert.equal(refused.status, 403, `session ${JSON.stringify(headers)}`);
      assert.equal(await code(refused), "INVALID_ORIGIN");
    }
    const noToken = await form("/api/form-none", { cookie, origin: own });
    assert.equal(noToken.status, 403);
    assert.equal(await code(noToken), "INVALID_CSRF");
    assert.equal((await form("/api/form-none", { cookie, origin: own }, `&_csrf=${csrf}`)).status, 303);
    assert.equal(handled, 1);
  } finally { await server.close(); }
});

test("local calls send the application's own Origin, so a page requested with GET can call a mutation", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const manifest = {
    api: [{ kind: "api" as const, file: "api.ts", pathname: "/api/items", method: "POST" as const, clientKey: "items" }],
    rpc: [{ kind: "rpc" as const, file: "rpc.ts", pathname: "/_meeko/rpc/items/add", id: "items.add" }],
  };
  const seen: (string | null)[] = [];
  const modules = new Map<string, unknown>([
    ["api.ts", { default: defineApiRoute({ response: okSchema, handler: ({ context }) => { seen.push(context.request.headers.get("origin")); return { ok: true as const }; } }) }],
    ["rpc.ts", { default: defineRpc({ input: anySchema, output: okSchema, handler: ({ context }) => { seen.push(context.request.headers.get("origin")); return { ok: true as const }; } }) }],
  ]);
  const local = async (request: Request) => createLocalCalls({ manifest, sessions, context: createRequestContext(request, {}, await sessions.load(request)), load: async (file) => modules.get(file) });
  // A document request: no Origin. And one whose Origin is foreign, which must not travel on.
  for (const headers of [{}, { origin: "https://evil.example" }]) {
    const calls = await local(new Request("http://localhost/page", { headers }));
    assert.equal((await calls.api("items", "POST", { body: {} })).status, 200, JSON.stringify(headers));
    assert.equal((await calls.rpc("items.add", {})).status, 200, JSON.stringify(headers));
  }
  assert.deepEqual(seen, ["http://localhost", "http://localhost", "http://localhost", "http://localhost"]);
  // With a session the CSRF token of the original request is still required.
  const record = await (await sessions.load(new Request("http://localhost/"))).create({ user: "ada" });
  const page = await local(new Request("http://localhost/page", { headers: { cookie: `meeko.sid=${record.id}` } }));
  const refused = await page.rpc("items.add", {});
  assert.equal(refused.status, 403);
  assert.equal(await code(refused), "INVALID_CSRF");
  const signed = await local(new Request("http://localhost/page", { method: "POST", headers: { cookie: `meeko.sid=${record.id}`, origin: "http://localhost", "x-meeko-csrf": record.csrfToken } }));
  assert.equal((await signed.rpc("items.add", {})).status, 200);
});

test("behind a proxy, publicOrigin decides and MEEKO_TRUST_PROXY does not let forwarded headers change it", async () => {
  const internal = "http://127.0.0.1:4173";
  const external = "https://app.example";
  const platform = (env: Record<string, string>): ServerPlatform<Record<string, string>> => ({ name: "node", env, waitUntil: () => {} });
  const forwarded = { "x-forwarded-for": "203.0.113.7", "x-forwarded-host": "app.example", "x-forwarded-proto": "https" };
  const post = (server: ServerApp, headers: Record<string, string>) => server.fetch(new Request(`${internal}/api/items`, { method: "POST", headers }), platform({ MEEKO_TRUST_PROXY: "1" }));

  // Without publicOrigin the public origin is foreign: X-Forwarded-Host and -Proto do not change that.
  const direct = await app({ platform: platform({ MEEKO_TRUST_PROXY: "1" }) });
  try {
    assert.equal((await post(direct, { origin: external, ...forwarded })).status, 403);
    assert.equal((await post(direct, { origin: internal, ...forwarded })).status, 200);
  } finally { await direct.close(); }

  const proxied = await app({ publicOrigin: external, platform: platform({ MEEKO_TRUST_PROXY: "1" }) });
  try {
    assert.equal(proxied.publicOrigin, external);
    assert.equal((await post(proxied, { origin: external, ...forwarded })).status, 200);
    for (const headers of [{}, { origin: internal }, { origin: "https://evil.example", "x-forwarded-host": "evil.example" }]) {
      assert.equal((await post(proxied, { ...forwarded, ...headers })).status, 403, JSON.stringify(headers));
    }
  } finally { await proxied.close(); }
});

test("the low-level dispatchers apply the same default, for every host and adapter", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const route = defineApiRoute({ response: okSchema, handler: () => ({ ok: true as const }) });
  const rpc = defineRpc({ input: anySchema, output: okSchema, handler: () => ({ ok: true as const }) });
  const request = (path: string, headers: Record<string, string>) => new Request(`http://localhost${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: "{}" });
  for (const [headers, status] of [[{}, 403], [{ origin: "null" }, 403], [{ origin: "http://evil.test" }, 403], [{ origin: "http://localhost" }, 200]] as const) {
    const apiRequest = request("/api/items", headers);
    assert.equal((await dispatchApiRoute(route, createRequestContext(apiRequest, {}, await sessions.load(apiRequest)), sessions)).status, status, JSON.stringify(headers));
    const rpcRequest = request("/_meeko/rpc/items/add", headers);
    assert.equal((await dispatchRpc(rpc, createRequestContext(rpcRequest, {}, await sessions.load(rpcRequest)), sessions)).status, status, JSON.stringify(headers));
  }
});
