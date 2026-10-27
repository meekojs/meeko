import assert from "node:assert/strict";
import test from "node:test";
import { createServerApp, defineApiRoute, defineRpc, MemorySessionStore, SessionHandle, SessionManager, SessionSecurityError } from "../src/framework-server.ts";
import type { AppManifest, Schema, ServerApp } from "../src/framework-server.ts";
import { resetEnvWarnings } from "../src/framework-server/env.ts";

const emptySchema: Schema<Record<string, never>> = { "~standard": { version: 1, validate: (value) => ({ value: value as Record<string, never> }) } };
const okSchema: Schema<{ ok: true }> = { "~standard": { version: 1, validate: (value) => ({ value: value as { ok: true } }) } };

const manifest: AppManifest = {
  version: 1,
  routes: [],
  server: {
    api: [
      { kind: "api", file: "/plain", pathname: "/api/login", method: "POST", clientKey: "login.post" },
      { kind: "api", file: "/required", pathname: "/api/login-required", method: "POST", clientKey: "loginRequired.post" },
      { kind: "api", file: "/none", pathname: "/api/native-login", method: "POST", clientKey: "nativeLogin.post" },
      { kind: "api", file: "/callback", pathname: "/api/oauth/callback", method: "GET", clientKey: "oauth.callback.get" },
      { kind: "api", file: "/switch", pathname: "/api/switch", method: "POST", clientKey: "switch.post" },
    ],
    rpc: [{ kind: "rpc", file: "/rpc-login", pathname: "/_meeko/rpc/login", id: "login" }],
  },
  routeMiddleware: [],
  serverMiddleware: [],
  client: { entry: "/assets/entry.js", css: [], preload: [] },
};

const login = (origin?: "required" | "none") => defineApiRoute({
  ...(origin ? { origin } : {}), response: okSchema,
  handler: async ({ context }) => { await context.session.create({ user: "ada" }); return { ok: true as const }; },
});

const modules: Record<string, unknown> = {
  "/plain": { default: login() },
  "/required": { default: login("required") },
  "/none": { default: login("none") },
  "/callback": { default: login() },
  "/switch": { default: defineApiRoute({ auth: "required", response: okSchema, handler: async ({ context }) => { await context.session.create({ user: "grace" }); return { ok: true as const }; } }) },
  "/rpc-login": { default: defineRpc({ input: emptySchema, output: okSchema, handler: async ({ context }) => { await context.session.create({ user: "ada" }); return { ok: true as const }; } }) },
};

async function app(store = new MemorySessionStore()): Promise<ServerApp> {
  const sessions = new SessionManager({ store, production: false, allowedOrigins: ["https://admin.shop.example"] });
  return createServerApp({ manifest, production: false, load: async (key) => modules[key], runtime: () => ({ sessions, onError: () => {} }) });
}

function post(path: string, headers: Record<string, string> = {}, body: unknown = undefined): Request {
  return new Request(`https://shop.example${path}`, {
    method: "POST",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function expectRejected(response: Response): Promise<void> {
  assert.equal(response.status, 403);
  assert.equal((await response.json() as { code: string }).code, "INVALID_ORIGIN");
  assert.equal(response.headers.get("set-cookie"), null, "no session cookie");
}

test("session.create() in a mutation without an allowed Origin is refused, so another site cannot plant a session", async () => {
  resetEnvWarnings();
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: unknown) => { warnings.push(String(message)); };
  const store = new MemorySessionStore();
  const server = await app(store);
  try {
    await expectRejected(await server.fetch(post("/api/login")));
    await expectRejected(await server.fetch(post("/api/login", { origin: "https://evil.example" })));
    await expectRejected(await server.fetch(post("/api/login", { origin: "null" })));
    await expectRejected(await server.fetch(post("/_meeko/rpc/login", { origin: "https://evil.example" }, {})));
  } finally {
    console.warn = original;
    await server.close();
  }
  assert.equal(warnings.length, 1, "development explains the refusal once");
  assert.match(warnings[0]!, /session\.create\(\) rechazó una petición sin un Origin permitido \(403 INVALID_ORIGIN\)/);
  assert.match(warnings[0]!, /origin: "none"/);
});

test("a browser request from the application's origin, or an allowed one, still signs in without declaring origin", async () => {
  const server = await app();
  try {
    for (const origin of ["https://shop.example", "https://admin.shop.example"]) {
      const response = await server.fetch(post("/api/login", { origin }));
      assert.equal(response.status, 200, origin);
      assert.match(response.headers.get("set-cookie") ?? "", /^__Host-meeko\.sid=/);
    }
    const rpc = await server.fetch(post("/_meeko/rpc/login", { origin: "https://shop.example" }, {}));
    assert.equal(rpc.status, 200);
  } finally { await server.close(); }
});

test("origin: \"required\" rejects before the handler, and origin: \"none\" is the explicit opt-out", async () => {
  const server = await app();
  try {
    await expectRejected(await server.fetch(post("/api/login-required")));
    assert.equal((await server.fetch(post("/api/login-required", { origin: "https://shop.example" }))).status, 200);
    const native = await server.fetch(post("/api/native-login"));
    assert.equal(native.status, 200, "an app without Origin, by explicit choice");
    assert.match(native.headers.get("set-cookie") ?? "", /^__Host-meeko\.sid=/);
  } finally { await server.close(); }
});

test("safe methods such as an OAuth or magic-link callback create sessions without Origin", async () => {
  const server = await app();
  try {
    const response = await server.fetch(new Request("https://shop.example/api/oauth/callback?state=abc"));
    assert.equal(response.status, 200);
    assert.match(response.headers.get("set-cookie") ?? "", /^__Host-meeko\.sid=/);
  } finally { await server.close(); }
});

test("an authenticated mutation that passed Origin and CSRF may replace its session", async () => {
  const server = await app();
  try {
    const first = await server.fetch(post("/api/login", { origin: "https://shop.example" }));
    const cookie = (first.headers.get("set-cookie") ?? "").split(";")[0]!;
    const csrf = first.headers.get("x-meeko-csrf-token")!;
    // Without its Origin the same mutation never reaches the handler.
    const forged = await server.fetch(post("/api/switch", { cookie, "x-meeko-csrf": csrf }));
    assert.equal(forged.status, 403);
    const switched = await server.fetch(post("/api/switch", { origin: "https://shop.example", cookie, "x-meeko-csrf": csrf }));
    assert.equal(switched.status, 200);
    assert.match(switched.headers.get("set-cookie") ?? "", /^__Host-meeko\.sid=/);
  } finally { await server.close(); }
});

test("a handle that no request bound, as in a custom host, creates sessions as before", async () => {
  const manager = new SessionManager({ store: new MemorySessionStore(), production: false });
  const record = await new SessionHandle(manager).create({ user: "ada" });
  assert.equal((record.data as { user: string }).user, "ada");
  // A loaded handle checks its request: a cross-site POST cannot create.
  const loaded = await manager.load(new Request("https://shop.example/login", { method: "POST", headers: { origin: "https://evil.example" } }));
  await assert.rejects(loaded.create({ user: "mallory" }), (error: unknown) => error instanceof SessionSecurityError && error.code === "INVALID_ORIGIN");
  const allowed = await manager.load(new Request("https://shop.example/login", { method: "POST", headers: { origin: "https://shop.example" } }));
  assert.ok(await allowed.create({ user: "ada" }));
});
