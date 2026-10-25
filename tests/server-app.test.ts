import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import {
  createServerApp, defineApiRoute, defineRpc, defineServerMiddleware, defineServerRuntime, defineSocketChannel,
  MemorySessionStore, SessionManager,
} from "../src/framework-server.ts";
import type { AppManifest, PrerenderedPage, Schema, ServerApp, ServerAppOptions, ServerPlatform } from "../src/framework-server.ts";
import { DOCUMENT_HEAD_PREFIX } from "../src/framework/server.ts";
import { createNodeAssetReader, serveNode, toNodeListener } from "../src/node.ts";

const idSchema: Schema<{ id: string }> = { "~standard": { version: 1, validate(value) {
  return value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string" ? { value: value as { id: string } } : { issues: [{}] };
} } };
const textSchema: Schema<{ text: string }> = { "~standard": { version: 1, validate(value) {
  return value && typeof value === "object" && typeof (value as { text?: unknown }).text === "string" ? { value: value as { text: string } } : { issues: [{}] };
} } };

const manifest: AppManifest = {
  version: 1,
  routes: [
    { id: "/", file: "/app/pages/index.meeko", layouts: [], sidecar: "/app/pages/index.route.ts", render: "prerender" },
    { id: "/about", file: "/app/pages/about.meeko", layouts: [], sidecar: "/app/pages/about.route.ts" },
  ],
  server: {
    api: [
      { kind: "api", file: "/server/api/login.post.ts", pathname: "/api/login", method: "POST", clientKey: "login" },
      { kind: "api", file: "/server/api/me.post.ts", pathname: "/api/me", method: "POST", clientKey: "me" },
    ],
    rpc: [{ kind: "rpc", file: "/server/rpc/users/get.ts", pathname: "/_meeko/rpc/users/get", id: "users.get" }],
    socket: [{ kind: "socket", file: "/server/socket/chat.ts", name: "chat", pathname: "/_meeko/socket/chat" }],
  },
  routeMiddleware: [],
  serverMiddleware: ["/server/middleware/10-header.ts"],
  client: { entry: "/assets/entry-abc.js", css: ["/assets/entry-abc.css"], preload: ["/assets/chunk-def.js"] },
};

interface Services { readonly who: string | undefined }

function modules(rendered: string[]): Record<string, unknown> {
  const page = (name: string) => ({
    renderWithState(props: Record<string, unknown>) {
      rendered.push(name);
      return { html: `<h1>${name}</h1><p id="data">${JSON.stringify(props.data ?? null)}</p>`, state: {} };
    },
  });
  return {
    "/app/pages/index.meeko": page("home"),
    "/app/pages/about.meeko": page("about"),
    "/app/pages/index.route.ts": { route: { render: "prerender" } },
    "/app/pages/about.route.ts": { route: {
      load: ({ context }: { context: { services: Services; platform: ServerPlatform } }) => ({ who: context.services.who, platform: context.platform.name }),
    } },
    "/server/api/login.post.ts": { default: defineApiRoute({ contentType: "response", async handler({ context }) {
      const session = await context.session.create({ user: "ada" });
      return Response.json({ csrf: session.csrfToken });
    } }) },
    "/server/api/me.post.ts": { default: defineApiRoute<undefined, undefined, undefined, undefined, Services>({ auth: "required", contentType: "response", handler: ({ context }) =>
      Response.json({ user: (context.session.current?.data as { user: string }).user, who: context.services.who, platform: context.platform.name }) }) },
    "/server/rpc/users/get.ts": { default: defineRpc({ input: idSchema, output: idSchema, handler: ({ input }) => input }) },
    "/server/socket/chat.ts": { default: defineSocketChannel({
      clientToServer: { message: textSchema }, serverToClient: { message: textSchema },
      handlers: { message: ({ payload, emit }) => emit("message", payload) },
    }) },
    "/server/middleware/10-header.ts": { default: defineServerMiddleware(async (_request, next) => {
      const response = await next();
      const headers = new Headers(response.headers);
      headers.set("x-test-middleware", "active");
      return new Response(response.body, { status: response.status, headers });
    }) },
  };
}

function platform(env: Record<string, string>, background: Promise<unknown>[] = []): ServerPlatform<Record<string, string>> {
  return { name: "node", env, waitUntil(promise) { background.push(promise); } };
}

interface Fixture {
  readonly app: ServerApp;
  readonly rendered: string[];
  readonly factory: unknown[];
  readonly closed: string[];
}

async function fixture(options: Partial<ServerAppOptions<Record<string, string>>> = {}, runtimeOrigin?: string): Promise<Fixture> {
  const rendered: string[] = [];
  const factory: unknown[] = [];
  const closed: string[] = [];
  const table = modules(rendered);
  class TrackedStore extends MemorySessionStore {
    override async close(): Promise<void> { closed.push("sessions"); await super.close(); }
  }
  const runtime = defineServerRuntime<Record<string, string>, Services>((context) => {
    factory.push(context);
    return {
      sessions: new SessionManager({ store: new TrackedStore(), secure: false }),
      services: (_request, { platform }) => ({ who: platform.env.WHO ?? "unset" }),
      ...(runtimeOrigin ? { publicOrigin: runtimeOrigin } : {}),
      onError: () => {},
      close: () => { closed.push("runtime"); },
    };
  });
  const app = await createServerApp<Record<string, string>>({
    manifest, production: false, runtime, platform: platform({ WHO: "base" }),
    load: async (key) => {
      if (!Object.hasOwn(table, key)) throw new Error(`Missing ${key}`);
      return table[key];
    },
    ...options,
  });
  return { app, rendered, factory, closed };
}

async function login(app: ServerApp, origin = "http://local.test"): Promise<{ cookie: string; csrf: string }> {
  const response = await app.fetch(new Request(`${origin}/api/login`, { method: "POST", headers: { origin } }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return { cookie, csrf: ((await response.json()) as { csrf: string }).csrf };
}

test("createServerApp serves SSR, API, RPC and server middleware from a baked manifest", async () => {
  const { app, rendered, factory } = await fixture();
  assert.deepEqual(factory, [{ env: { WHO: "base" }, production: false, platform: "node", prerendering: false }]);
  const page = await app.fetch(new Request("http://local.test/about"), platform({ WHO: "request" }));
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("x-test-middleware"), "active");
  const html = await page.text();
  assert.match(html, /<p id="data">\{"who":"request","platform":"node"\}<\/p>/);
  assert.match(html, /<link rel="stylesheet" href="\/assets\/entry-abc\.css"><link rel="modulepreload" href="\/assets\/chunk-def\.js">/);
  assert.match(html, /<script type="module" src="\/assets\/entry-abc\.js"><\/script>/);
  assert.doesNotMatch(html, /meeko-routes/);
  assert.deepEqual(rendered, ["about"]);
  const { cookie, csrf } = await login(app);
  const headers = { cookie, origin: "http://local.test", "content-type": "application/json" };
  const me = await app.fetch(new Request("http://local.test/api/me", { method: "POST", headers: { ...headers, "x-meeko-csrf": csrf } }));
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { user: "ada", who: "base", platform: "node" });
  const missingToken = await app.fetch(new Request("http://local.test/_meeko/rpc/users/get", { method: "POST", headers, body: JSON.stringify({ id: "1" }) }));
  assert.equal(missingToken.status, 403);
  assert.equal(((await missingToken.json()) as { code: string }).code, "INVALID_CSRF");
  const rpc = await app.fetch(new Request("http://local.test/_meeko/rpc/users/get", { method: "POST", headers: { ...headers, "x-meeko-csrf": csrf }, body: JSON.stringify({ id: "1" }) }));
  assert.equal(rpc.status, 200);
  assert.equal(rpc.headers.get("x-test-middleware"), "active");
  assert.deepEqual(await rpc.json(), { id: "1" });
  assert.equal(factory.length, 1, "the runtime factory runs once per application");
  await app.close();
});

test("prerendered pages pass through middleware and carry the session CSRF token", async () => {
  const html = `${DOCUMENT_HEAD_PREFIX}<title>Home</title></head><body><div id="app">static home</div></body></html>`;
  const stored: PrerenderedPage = { html, headOffset: DOCUMENT_HEAD_PREFIX.length, etag: "\"home-v1\"", payload: "{\"v\":1,\"route\":\"/\"}" };
  const requested: string[] = [];
  const { app, rendered } = await fixture({ prerender: { get: async (pathname) => { requested.push(pathname); return pathname === "/" ? stored : undefined; } } });
  const anonymous = await app.fetch(new Request("http://local.test/"));
  assert.equal(anonymous.status, 200);
  assert.equal(anonymous.headers.get("x-test-middleware"), "active");
  assert.equal(anonymous.headers.get("cache-control"), "public, max-age=0, must-revalidate");
  assert.equal(anonymous.headers.get("etag"), "\"home-v1\"");
  assert.equal(anonymous.headers.get("vary"), "cookie");
  assert.equal(await anonymous.text(), html);
  const revalidated = await app.fetch(new Request("http://local.test/", { headers: { "if-none-match": "\"home-v1\"" } }));
  assert.equal(revalidated.status, 304);
  assert.equal(revalidated.headers.get("x-test-middleware"), "active");
  const head = await app.fetch(new Request("http://local.test/", { method: "HEAD" }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), "");
  const navigation = await app.fetch(new Request("http://local.test/", { headers: { accept: "application/meeko+json" } }));
  assert.equal(navigation.headers.get("content-type"), "application/meeko+json; charset=utf-8");
  assert.equal(await navigation.text(), stored.payload);
  const { cookie, csrf } = await login(app);
  const personal = await app.fetch(new Request("http://local.test/", { headers: { cookie } }));
  assert.equal(personal.headers.get("cache-control"), "private, no-store");
  assert.equal(personal.headers.get("etag"), null);
  assert.equal(await personal.text(), `${DOCUMENT_HEAD_PREFIX}<meta name="meeko-csrf-token" content="${csrf}"><title>Home</title></head><body><div id="app">static home</div></body></html>`);
  assert.deepEqual(rendered, [], "listed prerendered pages never run the renderer");
  const searched = await app.fetch(new Request("http://local.test/?draft=1"));
  assert.match(await searched.text(), /<h1>home<\/h1>/);
  assert.deepEqual(rendered, ["home"], "a search string falls back to SSR");
  assert.ok(requested.every((pathname) => pathname === "/"));
  await app.close();
});

test("publicOrigin behind a TLS-terminating proxy satisfies HTTP origin checks and accepts streamed bodies", async () => {
  const internal = "http://127.0.0.1:4173";
  const external = "https://app.example";
  const direct = await fixture();
  const session = await login(direct.app, internal);
  const proxied = (app: ServerApp) => app.fetch(new Request(`${internal}/_meeko/rpc/users/get`, {
    method: "POST", duplex: "half",
    headers: { cookie: session.cookie, origin: external, "x-meeko-csrf": session.csrf, "content-type": "application/json" },
    body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("{\"id\":\"streamed\"}")); controller.close(); } }),
  } as RequestInit));
  const rejected = await proxied(direct.app);
  assert.equal(rejected.status, 403);
  assert.equal(((await rejected.json()) as { code: string }).code, "INVALID_ORIGIN");
  await direct.app.close();
  for (const configured of [await fixture({ publicOrigin: `${external}/ignored-path` }), await fixture({}, external)]) {
    assert.equal(configured.app.publicOrigin, external);
    const login = await configured.app.fetch(new Request(`${internal}/api/login`, { method: "POST", headers: { origin: external } }));
    const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
    const csrf = ((await login.json()) as { csrf: string }).csrf;
    const accepted = await configured.app.fetch(new Request(`${internal}/_meeko/rpc/users/get`, {
      method: "POST", duplex: "half",
      headers: { cookie, origin: external, "x-meeko-csrf": csrf, "content-type": "application/json" },
      body: new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("{\"id\":\"streamed\"}")); controller.close(); } }),
    } as RequestInit));
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { id: "streamed" });
    await configured.app.close();
  }
  await assert.rejects(fixture({ publicOrigin: "ftp://app.example" }), /publicOrigin must use HTTP or HTTPS/);
});

test("serveNode applies publicOrigin to HTTP and Socket origin checks behind a proxy", async () => {
  const external = "https://app.example";
  for (const publicOrigin of [undefined, external]) {
    const { app } = await fixture();
    const server = await serveNode(app, { port: 0, ...(publicOrigin ? { publicOrigin } : {}) });
    try {
      const login = await fetch(`${server.url}/api/login`, { method: "POST", headers: { origin: external } });
      const cookie = login.headers.get("set-cookie")!.split(";")[0]!;
      const csrf = ((await login.json()) as { csrf: string }).csrf;
      const rpc = await fetch(`${server.url}/_meeko/rpc/users/get`, {
        method: "POST", headers: { cookie, origin: external, "x-meeko-csrf": csrf, "content-type": "application/json" }, body: JSON.stringify({ id: "proxy" }),
      });
      assert.equal(rpc.status, publicOrigin ? 200 : 403);
      const peer = new WebSocket(`${server.url.replace("http:", "ws:")}/_meeko/socket/chat`, { headers: { origin: external } });
      if (publicOrigin) {
        await once(peer, "open");
        const reply = once(peer, "message");
        peer.send(JSON.stringify({ event: "message", payload: { text: "through proxy" } }));
        assert.deepEqual(JSON.parse(String((await reply)[0])), { event: "message", payload: { text: "through proxy" } });
        const closed = once(peer, "close");
        peer.close();
        await closed;
      } else {
        const [error] = await once(peer, "error") as [Error];
        assert.match(error.message, /Unexpected server response: 403/);
      }
    } finally {
      await server.close();
    }
  }
});

test("serveNode binds the requested host, defaults to loopback and closes the application", async () => {
  const loopback = await fixture();
  const defaultServer = await serveNode(loopback.app, { port: 0 });
  const address = defaultServer.server.address();
  assert.ok(address && typeof address !== "string");
  assert.equal(address.address, "127.0.0.1");
  assert.equal(defaultServer.url, `http://127.0.0.1:${address.port}`);
  await defaultServer.close();
  assert.deepEqual(loopback.closed, ["sessions", "runtime"]);
  const named = await fixture();
  const namedServer = await serveNode(named.app, { host: "localhost", port: 0 });
  try {
    assert.match(namedServer.url, /^http:\/\/localhost:\d+$/);
    assert.equal((await fetch(`${namedServer.url}/about`)).status, 200);
  } finally {
    await namedServer.close();
  }
  await assert.rejects(serveNode((await fixture()).app, { port: 70000 }), /Invalid port: 70000/);
});

test("toNodeListener builds URLs from publicOrigin and rejects absolute targets outside it", async () => {
  const seen: string[] = [];
  const server = (await import("node:http")).createServer(toNodeListener((request) => {
    seen.push(request.url);
    return new Response("ok");
  }, { publicOrigin: "https://app.example/" }));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    assert.equal(await (await fetch(`http://127.0.0.1:${address.port}/path?x=1`)).text(), "ok");
    assert.deepEqual(seen, ["https://app.example/path?x=1"]);
    const raw = await new Promise<string>((done, fail) => {
      const socket = connect(address.port, "127.0.0.1", () => socket.write("GET http://evil.example/ HTTP/1.1\r\nHost: evil.example\r\nConnection: close\r\n\r\n"));
      let text = "";
      socket.setEncoding("utf8");
      socket.on("data", (chunk: string) => { text += chunk; });
      socket.once("end", () => done(text));
      socket.once("error", fail);
    });
    assert.match(raw, /^HTTP\/1\.1 400 Bad Request/);
    assert.match(raw, /"code":"INVALID_URL"/);
    assert.equal(seen.length, 1);
  } finally {
    server.close();
    await once(server, "close");
  }
});

test("asset readers run before middleware and the runtime closes once", async () => {
  const { app, closed } = await fixture({
    assets: { get: async (pathname) => pathname === "/robots.txt" ? new Response("asset") : null },
  });
  const asset = await app.fetch(new Request("http://local.test/robots.txt"));
  assert.equal(await asset.text(), "asset");
  assert.equal(asset.headers.get("x-test-middleware"), null);
  await Promise.all([app.close(), app.close()]);
  assert.deepEqual(closed, ["sessions", "runtime"]);
});

test("createServerApp requires a production runtime with sessions", async () => {
  await assert.rejects(createServerApp({ manifest, production: true, load: async () => ({}) }),
    /Production requires server\/runtime\.ts with a persistent SessionStore/);
  await assert.rejects(createServerApp({ manifest, production: false, load: async () => ({}), runtime: (() => ({})) as never }),
    /server\/runtime\.ts must return \{ sessions: SessionManager \}/);
  await assert.rejects(createServerApp({ manifest: { ...manifest, version: 2 } as never, production: false, load: async () => ({}) }),
    /Unsupported Meeko application manifest/);
  const prerendering = await createServerApp({ manifest: { ...manifest, server: { api: [], rpc: [] } }, production: true, prerendering: true, load: async () => ({}) });
  await prerendering.close();
});

test("the Node asset reader serves only manifest files with validators, HEAD and immutable caching", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-assets-"));
  try {
    await mkdir(join(root, "assets"), { recursive: true });
    await writeFile(join(root, "assets", "app-abc.js"), "console.log(1);");
    await writeFile(join(root, "status.txt"), "public");
    await writeFile(join(root, "secret.txt"), "private");
    const reader = createNodeAssetReader({ root, assets: {
      "/assets/app-abc.js": { type: "text/javascript; charset=utf-8", etag: "\"js\"", size: 15, immutable: true },
      "/status.txt": { type: "text/plain; charset=utf-8", etag: "\"status\"", size: 6 },
    } });
    const get = (path: string, init?: RequestInit) => reader.get(path, new Request(`http://local.test${path}`, init));
    const script = await get("/assets/app-abc.js");
    assert.ok(script);
    assert.equal(script.status, 200);
    assert.equal(script.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(script.headers.get("content-length"), "15");
    assert.equal(script.headers.get("etag"), "\"js\"");
    assert.equal(await script.text(), "console.log(1);");
    const status = await get("/status.txt");
    assert.equal(status?.headers.get("cache-control"), "public, max-age=0, must-revalidate");
    assert.equal(await status?.text(), "public");
    const head = await get("/status.txt", { method: "HEAD" });
    assert.equal(head?.status, 200);
    assert.equal(head?.headers.get("content-length"), "6");
    assert.equal(await head?.text(), "");
    const notModified = await get("/assets/app-abc.js", { headers: { "if-none-match": "W/\"other\", \"js\"" } });
    assert.equal(notModified?.status, 304);
    assert.equal(await notModified?.text(), "");
    for (const unlisted of ["/secret.txt", "/assets/../status.txt", "/%61ssets/app-abc.js", "/assets/app-abc.js/", "/"]) {
      assert.equal(await get(unlisted), null, unlisted);
    }
    assert.equal(await get("/status.txt", { method: "POST", body: "x" }), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
