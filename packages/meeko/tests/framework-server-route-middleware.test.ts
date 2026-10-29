import assert from "node:assert/strict";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { createServerApp, defineApiRoute, defineServerRuntime, MemorySessionStore, SessionManager } from "../src/framework-server.ts";
import type { AppManifest, ServerApp, ServerPlatform } from "../src/framework-server.ts";
import { renderPage } from "../src/framework-server/app.ts";
import type { InternalServerApp } from "../src/framework-server/app.ts";
import { mountClientApp } from "../src/framework/client.ts";
import { defineRouteMiddleware, defineServerRouteMiddleware } from "../src/framework/middleware.ts";
import type { ServerRouteMiddlewareContext } from "../src/framework/middleware.ts";
import { notFound, redirect } from "../src/framework/page-body.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";

const origin = "http://local.test";

const page = (name: string) => ({
  renderWithState: () => ({ html: `<h1>${name}</h1>`, state: {} }),
  renderToString: () => `<h1>${name}</h1>`,
  hydrateScope: () => () => {},
});

const manifest: AppManifest = {
  version: 1,
  routes: [
    // Each route lists its whole server chain: the global session.server.ts, then its named ones.
    { id: "/", file: "/app/pages/index.meeko", layouts: [], serverMiddleware: ["/app/middleware/session.server.ts"] },
    { id: "/login", file: "/app/pages/login.meeko", layouts: [], serverMiddleware: ["/app/middleware/session.server.ts"] },
    // (dashboard)/+group.ts asks for "admin" (isomorphic) and "auth" (server only).
    { id: "/panel", file: "/app/pages/(dashboard)/panel.meeko", layouts: [], middleware: ["/app/middleware/admin.ts"], serverMiddleware: ["/app/middleware/session.server.ts", "/app/middleware/auth.server.ts"] },
    {
      id: "/feed", file: "/app/pages/(dashboard)/feed.meeko", layouts: [], sidecar: "/app/pages/(dashboard)/feed.route.ts", render: "stream",
      middleware: ["/app/middleware/admin.ts"], serverMiddleware: ["/app/middleware/session.server.ts", "/app/middleware/auth.server.ts"],
    },
    { id: "/docs", file: "/app/pages/docs.meeko", layouts: [], sidecar: "/app/pages/docs.route.ts", render: "prerender" },
    { id: "/editor", file: "/app/pages/editor.meeko", layouts: [], sidecar: "/app/pages/editor.route.ts", render: "client" },
  ],
  server: { api: [{ kind: "api", file: "/server/api/login.post.ts", pathname: "/api/login", method: "POST", clientKey: "login" }], rpc: [], socket: [] },
  routeMiddleware: ["/app/middleware/10-locale.ts"],
  serverMiddleware: [],
  client: { entry: "/assets/entry.js", css: [], preload: [] },
};

interface Services { readonly tenant: string }

/** What each middleware saw, in order: `name:phase:route`. */
interface Fixture {
  readonly app: ServerApp;
  readonly calls: string[];
  readonly contexts: ServerRouteMiddlewareContext<Services>[];
}

async function fixture(): Promise<Fixture> {
  const calls: string[] = [];
  const contexts: ServerRouteMiddlewareContext<Services>[] = [];
  const isomorphic = (name: string, options?: { global: false }) => ({
    default: defineRouteMiddleware(({ match, phase }) => { calls.push(`${name}:${phase}:${match.route.id}`); }, options),
  });
  const modules: Record<string, unknown> = {
    "/app/pages/index.meeko": page("home"),
    "/app/pages/login.meeko": page("login"),
    "/app/pages/(dashboard)/panel.meeko": page("panel"),
    "/app/pages/(dashboard)/feed.meeko": page("feed"),
    "/app/pages/(dashboard)/feed.route.ts": { route: { render: "stream", middleware: ["auth"], load: () => { calls.push("load:/feed"); return { n: 1 }; } } },
    "/app/pages/docs.meeko": page("docs"),
    "/app/pages/docs.route.ts": { route: { render: "prerender" } },
    "/app/pages/editor.meeko": page("editor"),
    "/app/pages/editor.route.ts": { route: { render: "client" } },
    "/app/middleware/10-locale.ts": isomorphic("locale"),
    "/app/middleware/admin.ts": isomorphic("admin", { global: false }),
    "/app/middleware/session.server.ts": {
      default: defineServerRouteMiddleware<Services>(({ match }) => { calls.push(`session:server:${match.route.id}`); }),
    },
    "/app/middleware/auth.server.ts": {
      default: defineServerRouteMiddleware<Services>((context) => {
        calls.push(`auth:server:${context.match.route.id}`);
        contexts.push(context);
        if (context.search.missing !== undefined) notFound();
        if (context.search.forbidden !== undefined) return new Response("Forbidden", { status: 403 });
        if (!context.session.current) redirect(`/login?next=${encodeURIComponent(context.url.pathname)}`);
      }, { global: false }),
    },
    "/server/api/login.post.ts": { default: defineApiRoute({ contentType: "response", async handler({ context }) {
      await context.session.create({ user: "ada" });
      return Response.json({ ok: true });
    } }) },
  };
  const runtime = defineServerRuntime<Record<string, string>, Services>(() => ({
    sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }),
    services: () => ({ tenant: "acme" }),
    onError: () => {},
  }));
  const platform: ServerPlatform<Record<string, string>> = { name: "node", env: {}, waitUntil: () => {} };
  const app = await createServerApp<Record<string, string>>({
    manifest, production: false, runtime, platform,
    load: async (key) => {
      if (!Object.hasOwn(modules, key)) throw new Error(`Missing ${key}`);
      return modules[key];
    },
  });
  return { app, calls, contexts };
}

async function login(app: ServerApp): Promise<string> {
  const response = await app.fetch(new Request(`${origin}/api/login`, { method: "POST", headers: { origin } }));
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  assert.ok(cookie);
  return cookie;
}

const html = { accept: "text/html" };
const data = { accept: "application/meeko+json" };

test("server route middleware guards the page in SSR with the session, after the isomorphic middleware", async () => {
  const { app, calls, contexts } = await fixture();
  try {
    // Without a session: redirect() stops the route before the page renders.
    const anonymous = await app.fetch(new Request(`${origin}/panel?tab=2`, { headers: html }));
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.get("location"), "/login?next=%2Fpanel");
    assert.doesNotMatch(await anonymous.text(), /panel/);
    // Isomorphic first (global, then named), then server (global, then named).
    assert.deepEqual(calls, ["locale:server:/panel", "admin:server:/panel", "session:server:/panel", "auth:server:/panel"]);

    const cookie = await login(app);
    calls.length = 0;
    contexts.length = 0;
    const signedIn = await app.fetch(new Request(`${origin}/panel?tab=2`, { headers: { ...html, cookie } }));
    assert.equal(signedIn.status, 200);
    assert.match(await signedIn.text(), /<h1>panel<\/h1>/);
    assert.deepEqual(calls, ["locale:server:/panel", "admin:server:/panel", "session:server:/panel", "auth:server:/panel"]);
    // The context of usePage(), with the session, services and platform of the request at hand.
    const [context] = contexts;
    assert.ok(context);
    assert.deepEqual(context.session.current?.data, { user: "ada" });
    assert.equal(context.context.session, context.session);
    assert.deepEqual(context.services, { tenant: "acme" });
    assert.equal(context.platform.name, "node");
    assert.equal(context.requestId, signedIn.headers.get("x-request-id"));
    assert.equal(context.url.pathname, "/panel");
    assert.deepEqual({ ...context.search }, { tab: "2" });
    assert.deepEqual({ ...context.params }, {});
    assert.equal(context.request.headers.get("cookie"), cookie);

    // A Response or notFound() stops the route too.
    assert.equal((await app.fetch(new Request(`${origin}/panel?forbidden`, { headers: { ...html, cookie } }))).status, 403);
    assert.equal((await app.fetch(new Request(`${origin}/panel?missing`, { headers: { ...html, cookie } }))).status, 404);

    // The page's data request, which client navigation makes, runs the same chain.
    calls.length = 0;
    const navigation = await app.fetch(new Request(`${origin}/panel`, { headers: data }));
    assert.equal(navigation.status, 302);
    assert.equal(navigation.headers.get("location"), "/login?next=%2Fpanel");
    assert.deepEqual(calls, ["locale:server:/panel", "admin:server:/panel", "session:server:/panel", "auth:server:/panel"]);
    const payload = await app.fetch(new Request(`${origin}/panel`, { headers: { ...data, cookie } }));
    assert.equal(payload.status, 200);
    assert.equal(((await payload.json()) as { route: string }).route, "/panel");

    // A route without named server middleware runs only the global ones.
    calls.length = 0;
    assert.equal((await app.fetch(new Request(`${origin}/`, { headers: html }))).status, 200);
    assert.deepEqual(calls, ["locale:server:/", "session:server:/"]);
  } finally {
    await app.close();
  }
});

test("global server route middleware does not run on render: \"client\" or \"prerender\" pages", async () => {
  const { app, calls } = await fixture();
  try {
    assert.equal((await app.fetch(new Request(`${origin}/editor`, { headers: html }))).status, 200);
    assert.deepEqual(calls, ["locale:server:/editor"]);
    calls.length = 0;
    // Neither while prerendering, where there is no visitor's request.
    const prerendered = await (app as InternalServerApp)[renderPage](new Request(`${origin}/docs`, { headers: html }));
    assert.equal(prerendered.status, 200);
    assert.deepEqual(calls, ["locale:server:/docs"]);
  } finally {
    await app.close();
  }
});

test("client navigation follows the redirect of server route middleware from the page's data request", async () => {
  const { app, calls } = await fixture();
  const browser = new HappyWindow({ url: `${origin}/` });
  try {
    browser.document.write(await (await app.fetch(new Request(`${origin}/`, { headers: html }))).text());
    let cookie: string | undefined;
    const requests: string[] = [];
    const client = await mountClientApp({
      routes: createRouteManifest(manifest.routes.map(({ serverMiddleware: _server, ...route }) => route)),
      root: browser.document.getElementById("app") as unknown as Element,
      payload: browser.document.getElementById("meeko-payload")!.textContent!,
      loadPage: async () => page("any"),
      loadMiddleware: async () => [defineRouteMiddleware(({ match, phase }) => { calls.push(`locale:${phase}:${match.route.id}`); })],
      loadNamedMiddleware: async () => defineRouteMiddleware(({ match, phase }) => { calls.push(`admin:${phase}:${match.route.id}`); }, { global: false }),
      // The browser's fetch, without following the redirect: the client reads its location.
      fetch: async (input, init) => {
        const headers = new Headers(init?.headers);
        if (cookie) headers.set("cookie", cookie);
        requests.push(String(input));
        return app.fetch(new Request(String(input), { headers }));
      },
      serverData: true,
      browser: browser as unknown as Window,
    });
    calls.length = 0;
    assert.equal(await client.navigate("/panel"), false);
    // The browser runs the isomorphic middleware; the data request runs it again, then the server's.
    assert.deepEqual(calls.slice(0, 6), [
      "locale:client:/panel", "admin:client:/panel",
      "locale:server:/panel", "admin:server:/panel", "session:server:/panel", "auth:server:/panel",
    ]);
    // The redirect leads to /login, as one of <script server> does.
    await new Promise((settle) => setTimeout(settle, 50));
    assert.equal(browser.location.pathname, "/login");
    assert.equal(browser.location.search, "?next=%2Fpanel");
    assert.deepEqual(requests, [`${origin}/panel`, `${origin}/login?next=%2Fpanel`]);
    // /login runs only the global middleware of each kind.
    assert.deepEqual(calls.slice(6), ["locale:client:/login", "locale:server:/login", "session:server:/login"]);

    cookie = await login(app);
    assert.equal(await client.navigate("/panel"), true);
    assert.equal(browser.location.pathname, "/panel");
    client.dispose();
  } finally {
    browser.happyDOM.abort();
    await app.close();
  }
});

test("a route never skips its server middleware: without a loader or on a page without server data it fails", async () => {
  const errors: unknown[] = [];
  const guarded = createRouteManifest([
    { id: "/panel", file: "panel.meeko", layouts: [], serverMiddleware: ["auth.server.ts"] },
    { id: "/editor", file: "editor.meeko", layouts: [], render: "client", serverMiddleware: ["auth.server.ts"] },
  ]);
  const server = createFrameworkHandler({ routes: guarded, loadPage: async () => page("x"), onError: (error) => errors.push(error) });
  assert.equal((await server(new Request(`${origin}/panel`))).status, 500);
  assert.match(String(errors[0]), /Route \/panel has server route middleware \(auth\.server\.ts\) but no loadServerMiddleware/);
  const loaded = createFrameworkHandler({
    routes: guarded, loadPage: async () => page("x"), onError: (error) => errors.push(error),
    loadServerMiddleware: async () => defineServerRouteMiddleware(() => undefined, { global: false }),
  });
  assert.equal((await loaded(new Request(`${origin}/editor`))).status, 500);
  assert.match(String(errors[1]), /Route \/editor renders "client" but has server route middleware \(auth\.server\.ts\)/);
  // Without createContext there is no session to read: reading it fails instead of guessing.
  assert.equal((await loaded(new Request(`${origin}/panel`))).status, 200);
  const reading = createFrameworkHandler({
    routes: guarded, loadPage: async () => page("x"), onError: (error) => errors.push(error),
    loadServerMiddleware: async () => defineServerRouteMiddleware(({ session }) => { void session.current; }, { global: false }),
  });
  assert.equal((await reading(new Request(`${origin}/panel`))).status, 500);
  assert.match(String(errors[2]), /Server route middleware needs a request context/);
});

test("a host without loadServerMiddleware fails on a route with only global server middleware instead of skipping it", async () => {
  const errors: unknown[] = [];
  const loaded: string[] = [];
  // Discovery lists the global session.server.ts on every route that asks the server for its data.
  const routes = createRouteManifest([
    { id: "/", file: "index.meeko", layouts: [], serverMiddleware: ["/app/middleware/session.server.ts"] },
    { id: "/docs", file: "docs.meeko", layouts: [], render: "prerender" },
  ]);
  const server = createFrameworkHandler({ routes, loadPage: async () => page("x"), onError: (error) => errors.push(error) });
  assert.equal((await server(new Request(`${origin}/`))).status, 500);
  assert.match(String(errors[0]), /Route \/ has server route middleware \(\/app\/middleware\/session\.server\.ts\) but no loadServerMiddleware/);
  assert.equal((await server(new Request(`${origin}/docs`))).status, 200);
  const host = createFrameworkHandler({
    routes, loadPage: async () => page("x"), onError: (error) => errors.push(error),
    loadServerMiddleware: async (file) => { loaded.push(file); return defineServerRouteMiddleware(() => new Response("blocked", { status: 401 })); },
  });
  assert.equal((await host(new Request(`${origin}/`))).status, 401);
  assert.deepEqual(loaded, ["/app/middleware/session.server.ts"]);
});

test("server route middleware runs before the first byte of a render: \"stream\" page, and cuts its ndjson navigation", async () => {
  const { app, calls } = await fixture();
  try {
    // The document: a redirect instead of a streamed 200, and the loader never runs.
    const anonymous = await app.fetch(new Request(`${origin}/feed`, { headers: html }));
    assert.equal(anonymous.status, 302);
    assert.equal(anonymous.headers.get("location"), "/login?next=%2Ffeed");
    assert.deepEqual(calls, ["locale:server:/feed", "admin:server:/feed", "session:server:/feed", "auth:server:/feed"]);

    // The data request of a navigation, which would stream ndjson: cut the same way.
    calls.length = 0;
    const navigation = await app.fetch(new Request(`${origin}/feed`, { headers: data }));
    assert.equal(navigation.status, 302);
    assert.equal(navigation.headers.get("location"), "/login?next=%2Ffeed");
    assert.doesNotMatch(navigation.headers.get("content-type") ?? "", /ndjson/);
    assert.ok(!calls.includes("load:/feed"));

    const cookie = await login(app);
    calls.length = 0;
    const streamed = await app.fetch(new Request(`${origin}/feed`, { headers: { ...data, cookie } }));
    assert.equal(streamed.status, 200);
    assert.match(streamed.headers.get("content-type") ?? "", /application\/meeko\+ndjson/);
    assert.match(await streamed.text(), /"route":"\/feed"/);
    assert.deepEqual(calls, ["locale:server:/feed", "admin:server:/feed", "session:server:/feed", "auth:server:/feed", "load:/feed"]);
  } finally {
    await app.close();
  }
});

test("server route middleware guards HEAD requests too", async () => {
  const { app, calls } = await fixture();
  try {
    for (const path of ["/panel", "/feed"]) {
      calls.length = 0;
      const anonymous = await app.fetch(new Request(`${origin}${path}`, { method: "HEAD", headers: html }));
      assert.equal(anonymous.status, 302, path);
      assert.equal(anonymous.headers.get("location"), `/login?next=${encodeURIComponent(path)}`);
      assert.ok(calls.includes(`auth:server:${path}`), path);
      assert.ok(!calls.includes(`load:${path}`), path);
    }
    const cookie = await login(app);
    const signedIn = await app.fetch(new Request(`${origin}/panel`, { method: "HEAD", headers: { ...html, cookie } }));
    assert.equal(signedIn.status, 200);
    assert.equal(await signedIn.text(), "");
  } finally {
    await app.close();
  }
});

test("a page whose middleware its manifest does not list fails instead of running without it", async () => {
  const errors: unknown[] = [];
  const ran: string[] = [];
  // A spread the build could not read: the page says "auth", the manifest has no middleware.
  const routes = createRouteManifest([{ id: "/panel", file: "panel.meeko", layouts: [], sidecar: "panel.route.ts" }]);
  const server = createFrameworkHandler({
    routes, loadPage: async () => page("panel"), onError: (error) => errors.push(error),
    loadRoute: async () => ({ middleware: ["auth"], load: () => { ran.push("load"); return {}; } }),
  });
  const response = await server(new Request(`${origin}/panel`));
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /<h1>panel/);
  assert.deepEqual(ran, []);
  assert.match(String(errors[0]), /Route \/panel declares middleware \["auth"\] that its manifest does not list, so it did not run; rebuild the application/);
  // Listed by its file (a prefixed server one included), it goes on.
  const listed = createFrameworkHandler({
    routes: createRouteManifest([{ id: "/panel", file: "panel.meeko", layouts: [], sidecar: "panel.route.ts", serverMiddleware: ["/app/middleware/10-auth.server.ts"] }]),
    loadPage: async () => page("panel"), onError: (error) => errors.push(error),
    loadRoute: async () => ({ middleware: ["auth"] }),
    loadServerMiddleware: async () => defineServerRouteMiddleware(() => undefined, { global: false }),
  });
  assert.equal((await listed(new Request(`${origin}/panel`))).status, 200);
});
