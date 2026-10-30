import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { createBunServer } from "../src/bun.ts";
import type { BunServerLike } from "../src/bun.ts";
import {
  createServerApp, defineApiRoute, defineRpc, defineServerMiddleware, defineServerRuntime, defineSocketChannel,
  MemorySessionStore, SessionManager,
} from "../src/framework-server.ts";
import type { AppManifest, PrerenderedPage, Schema, ServerApp, ServerAppOptions, ServerPlatform, SocketHub } from "../src/framework-server.ts";
import { prerenderRoutes } from "../src/framework/prerender.ts";
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
  const stored: PrerenderedPage = { html, headOffset: DOCUMENT_HEAD_PREFIX.length, etag: "\"home-v1\"", payload: "{\"v\":2,\"route\":\"/\"}" };
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
      // Without publicOrigin, the proxy's origin is foreign: even signing in from it is refused.
      const foreign = await fetch(`${server.url}/api/login`, { method: "POST", headers: { origin: external } });
      assert.equal(foreign.status, publicOrigin ? 200 : 403);
      const login = publicOrigin ? foreign : await fetch(`${server.url}/api/login`, { method: "POST", headers: { origin: new URL(server.url).origin } });
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

test("Bun's Socket handshake keeps the listening address and accepts the localhost that is printed", async () => {
  const { app } = await fixture();
  const bun = createBunServer(app, { platform: platform({}) });
  try {
    for (const listening of ["http://0.0.0.0:4173/", "http://127.0.0.1:4173/"]) {
      const handshake = async (origin: string): Promise<number | undefined> => {
        let upgraded = false;
        const server: BunServerLike = { url: new URL(listening), upgrade: () => { upgraded = true; return true; } };
        const response = await bun.fetch(new Request("http://127.0.0.1:4173/_meeko/socket/chat", { headers: { upgrade: "websocket", origin } }), server);
        return upgraded ? 101 : response?.status;
      };
      assert.equal(await handshake("http://localhost:4173"), 101, listening);
      assert.equal(await handshake("http://127.0.0.1:4173"), 101, listening);
      assert.equal(await handshake("http://[::1]:4173"), 101, listening);
      assert.equal(await handshake("http://localhost:4174"), 403, listening);
      assert.equal(await handshake("http://evil.test"), 403, listening);
    }
  } finally {
    await app.close();
  }
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

test("createServerApp requires a persistent session store in production", async () => {
  await assert.rejects(createServerApp({ manifest, production: true, load: async () => ({}) }),
    /Production requires a persistent session store: set MEEKO_REDIS_URL/);
  await assert.rejects(createServerApp({ manifest, production: false, load: async () => ({}), runtime: (() => ({ sessions: {} })) as never }),
    /server\/runtime\.ts must return \{ sessions: SessionManager \} or omit sessions/);
  await assert.rejects(createServerApp({ manifest, production: false, load: async () => ({}), runtime: (() => undefined) as never }),
    /server\/runtime\.ts must return an object/);
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

function rawRequest(port: number, text: string, untilHeaders = false): Promise<string> {
  return new Promise<string>((done, fail) => {
    const socket = connect(port, "127.0.0.1", () => socket.write(text));
    let reply = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => {
      reply += chunk;
      if (untilHeaders && reply.includes("\r\n\r\n")) { socket.destroy(); done(reply); }
    });
    socket.once("end", () => done(reply));
    socket.once("error", fail);
  });
}

async function listening(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return address.port;
}

function within<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  return Promise.race([
    promise,
    new Promise<never>((_done, fail) => { timer = setTimeout(() => fail(new Error(message)), milliseconds); }),
  ]).finally(() => clearTimeout(timer));
}

test("request targets starting with // keep the request origin in the Node listener", async () => {
  for (const publicOrigin of [undefined, "https://app.example"]) {
    const seen: string[] = [];
    const server = createServer(toNodeListener((request) => {
      seen.push(request.url);
      return new Response("ok");
    }, publicOrigin ? { publicOrigin } : {}));
    const port = await listening(server);
    try {
      const reply = await rawRequest(port, `GET //evil.example/api/x?y=1 HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`);
      assert.match(reply, /^HTTP\/1\.1 200 OK/, String(publicOrigin));
      assert.deepEqual(seen, [`${publicOrigin ?? `http://127.0.0.1:${port}`}//evil.example/api/x?y=1`]);
    } finally {
      server.close();
      await once(server, "close");
    }
  }
});

test("a // request target cannot satisfy the Origin check of another host", async () => {
  const { app } = await fixture();
  const server = await serveNode(app, { port: 0 });
  try {
    const port = Number(new URL(server.url).port);
    const reply = await rawRequest(port, `POST //evil.example/api/login HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nOrigin: http://evil.example\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`);
    // The pathname stays //evil.example/api/login: a page path, never the login API.
    assert.match(reply, /^HTTP\/1\.1 405 /);
    assert.doesNotMatch(reply, /set-cookie/i);
  } finally {
    await server.close();
  }
});

test("app.fetch keeps a // pathname under publicOrigin and without it", async () => {
  for (const publicOrigin of [undefined, "https://app.example"]) {
    const seen: string[] = [];
    const { app } = await fixture({
      ...(publicOrigin ? { publicOrigin } : {}),
      assets: { get: async (_pathname, request) => { seen.push(request.url); return null; } },
    });
    const forged = await app.fetch(new Request("http://local.test//evil.example/api/login", { method: "POST", headers: { origin: "https://evil.example" } }));
    assert.equal(forged.status, 405, String(publicOrigin));
    assert.equal(forged.headers.get("set-cookie"), null);
    assert.deepEqual(seen, [`${publicOrigin ?? "http://local.test"}//evil.example/api/login`]);
    await app.close();
  }
});

test("toNodeListener cancels the response body when the client leaves before headers or mid-stream", async () => {
  const cancelled: string[] = [];
  let entered!: () => void;
  const handlerEntered = new Promise<void>((done) => { entered = done; });
  let cancelledEarly!: () => void;
  const early = new Promise<void>((done) => { cancelledEarly = done; });
  let cancelledLate!: () => void;
  const late = new Promise<void>((done) => { cancelledLate = done; });
  const server = createServer(toNodeListener(async (request) => {
    if (new URL(request.url).pathname === "/early") {
      entered();
      await new Promise<void>((done) => request.signal.addEventListener("abort", () => done(), { once: true }));
      return new Response(new ReadableStream<Uint8Array>({
        pull(controller) { controller.enqueue(new Uint8Array(8)); },
        cancel() { cancelled.push("early"); cancelledEarly(); },
      }));
    }
    // The producer sends one chunk, then never resolves its next pull.
    return new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("first")); },
      pull() { return new Promise<void>(() => {}); },
      cancel() { cancelled.push("late"); cancelledLate(); },
    }));
  }));
  const port = await listening(server);
  try {
    const socket = connect(port, "127.0.0.1", () => socket.write(`GET /early HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`));
    await handlerEntered;
    socket.destroy();
    await within(early, 2_000, "the body returned after the abort was not cancelled");
    const reply = await rawRequest(port, `GET /late HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\n\r\n`, true);
    assert.match(reply, /^HTTP\/1\.1 200 OK/);
    await within(late, 2_000, "the pending stream was not cancelled after the client left");
    assert.deepEqual(cancelled.sort(), ["early", "late"]);
  } finally {
    server.closeAllConnections();
    server.close();
    await once(server, "close");
  }
});

function stubApp(overrides: Partial<ServerApp> = {}): ServerApp {
  return { manifest, fetch: async () => new Response("ok"), reportError: () => {}, close: async () => {}, ...overrides };
}

test("serveNode ends held-open streaming responses after the shutdown timeout", async () => {
  let cancelled!: () => void;
  const streamCancelled = new Promise<void>((done) => { cancelled = done; });
  let closedApp = false;
  const app = stubApp({
    fetch: async () => new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode("first")); },
      pull() { return new Promise<void>(() => {}); },
      cancel() { cancelled(); },
    })),
    close: async () => { closedApp = true; },
  });
  const server = await serveNode(app, { port: 0, shutdownTimeout: 100 });
  const response = await fetch(server.url);
  const reader = response.body!.getReader();
  assert.equal(new TextDecoder().decode((await reader.read()).value), "first");
  const started = Date.now();
  await within(server.close(), 5_000, "close waited for the open stream");
  assert.ok(Date.now() - started >= 90, "open responses get the grace period first");
  await assert.rejects(reader.read());
  assert.equal(closedApp, true);
  await within(streamCancelled, 2_000, "the cut stream was not cancelled");
  await assert.rejects(serveNode(stubApp(), { port: 0, shutdownTimeout: -1 }), /Invalid shutdownTimeout: -1/);
});

test("serveNode releases the port and closes the application when Socket setup fails after listen", async () => {
  const probe = createServer();
  const port = await listening(probe);
  probe.close();
  await once(probe, "close");
  let closed = 0;
  const app = stubApp({
    close: async () => { closed += 1; },
    socket: { hub: {} as SocketHub, pathnamePrefix: "/_meeko/socket", maxMessageBytes: 0 },
  });
  await assert.rejects(serveNode(app, { port }), /Invalid socket message limit/);
  assert.equal(closed, 1);
  const reuse = createServer();
  reuse.listen(port, "127.0.0.1");
  await once(reuse, "listening");
  reuse.close();
  await once(reuse, "close");
});

test("Socket background tasks are awaited on close and report failures to the observer", async () => {
  const observed: unknown[] = [];
  const finished: string[] = [];
  let started!: () => void;
  const taskStarted = new Promise<void>((done) => { started = done; });
  const table: Record<string, unknown> = {
    ...modules([]),
    "/server/socket/chat.ts": { default: defineSocketChannel({
      clientToServer: { message: textSchema }, serverToClient: { message: textSchema },
      handlers: { message: ({ context }) => {
        context.platform.waitUntil(new Promise((done) => setTimeout(done, 150)).then(() => {
          finished.push("task");
          throw new Error("background failed");
        }));
        started();
      } },
    }) },
  };
  const runtime = defineServerRuntime(() => ({
    sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }),
    onError: (error: unknown) => { observed.push(error); },
  }));
  const logged: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    // Without a platform the detached default would only log the failure to the console.
    const app = await createServerApp({ manifest, production: false, runtime, load: async (key) => table[key] });
    const server = await serveNode(app, { port: 0 });
    const peer = new WebSocket(`${server.url.replace("http:", "ws:")}/_meeko/socket/chat`, { headers: { origin: server.url } });
    await once(peer, "open");
    peer.send(JSON.stringify({ event: "message", payload: { text: "background" } }));
    await taskStarted;
    await server.close();
    assert.deepEqual(finished, ["task"]);
    assert.equal(observed.length, 1);
    assert.equal((observed[0] as Error).message, "background failed");
    assert.deepEqual(logged, []);
  } finally {
    console.error = original;
  }
});

test("prerendered HTML with non-ASCII head content receives the CSRF meta tag before </head>", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-prerender-utf16-"));
  try {
    const title = "Café ñandú 🐱 日本";
    await prerenderRoutes({
      routes: manifest.routes,
      outputRoot: root,
      handler: async (request) => request.headers.get("accept") === "application/meeko+json"
        ? new Response("{}", { headers: { "content-type": "application/meeko+json" } })
        : new Response(`<!doctype html><html><head><title>${title}</title></head><body>${title}</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } }),
    });
    const index = JSON.parse(await readFile(join(root, "manifest.json"), "utf8")) as { pages: Record<string, { file: string; headOffset: number; etag: string }> };
    const entry = index.pages["/"]!;
    // Adapters read the stored file as a string: the offset counts UTF-16 code units, not bytes.
    const html = await readFile(join(root, entry.file), "utf8");
    assert.notEqual(Buffer.byteLength(html.slice(0, entry.headOffset)), entry.headOffset);
    const { app } = await fixture({ prerender: { get: async (pathname) => pathname === "/" ? { html, headOffset: entry.headOffset, etag: entry.etag } : undefined } });
    const { cookie, csrf } = await login(app);
    const personal = await (await app.fetch(new Request("http://local.test/", { headers: { cookie } }))).text();
    assert.equal(personal, `<!doctype html><html><head><title>${title}</title><meta name="meeko-csrf-token" content="${csrf}"></head><body>${title}</body></html>`);
    await app.close();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
