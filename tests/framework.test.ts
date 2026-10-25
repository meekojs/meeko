import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createNavigator, createRouteManifest, href, matchRoute } from "../src/framework/router.ts";
import { createFrameworkHandler, discoverRoutes } from "../src/framework/server.ts";
import { currentRequest } from "../src/framework-server/context.ts";
import { ApiError, createRequestContext, MemorySessionStore, SessionManager, useRequestState } from "../src/framework-server.ts";

test("file routes discover groups, layouts, errors, sidecars, and resolve specificity", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-routes-"));
  const files = [
    "app/app.meeko",
    "app/pages/+layout.meeko",
    "app/pages/+error.meeko",
    "app/pages/index.meeko",
    "app/pages/(marketing)/about.meeko",
    "app/pages/users/+layout.meeko",
    "app/pages/users/[id].meeko",
    "app/pages/users/[id].route.ts",
    "app/pages/users/new.meeko",
    "app/pages/docs/[...slug].meeko",
  ];
  try {
    for (const file of files) {
      const path = join(root, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "");
    }
    const routes = await discoverRoutes(root);
    assert.equal(routes.length, 5);
    assert.equal(matchRoute(routes, "/users/new")?.route.id, "/users/new");
    assert.deepEqual(matchRoute(routes, "/users/alice")?.params, { id: "alice" });
    assert.deepEqual(matchRoute(routes, "/docs/a/b")?.params, { slug: "a/b" });
    assert.equal(matchRoute(routes, "/users/%2F"), undefined);
    assert.equal(matchRoute(routes, "/missing"), undefined);
    const user = routes.find((route) => route.id === "/users/[id]")!;
    assert.equal(user.layouts.length, 3);
    assert.ok(user.layouts[0]?.endsWith("app.meeko"));
    assert.ok(user.error?.endsWith("+error.meeko"));
    assert.ok(user.sidecar?.endsWith("[id].route.ts"));
    assert.equal(href(routes, "/users/[id]", { params: { id: "a b" }, search: { tab: "profile" } }), "/users/a%20b?tab=profile");
    assert.throws(() => href(routes, "/users/[id]"), /Missing route parameter/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("app/layouts/default.meeko wraps every page and rejects a second root layout", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-default-layout-"));
  const paths = ["app/app.meeko", "app/layouts/default.meeko", "app/pages/index.meeko", "app/pages/users/index.meeko"];
  try {
    for (const file of paths) {
      const path = join(root, file);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, "");
    }
    const routes = await discoverRoutes(root);
    assert.deepEqual(routes.map((route) => route.id).sort(), ["/", "/users"]);
    for (const route of routes) {
      assert.deepEqual(route.layouts, [join(root, "app/app.meeko"), join(root, "app/layouts/default.meeko")]);
    }
    await writeFile(join(root, "app/pages/+layout.meeko"), "");
    await assert.rejects(discoverRoutes(root), /Both .*default\.meeko.*\+layout\.meeko.*root layout/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("route collisions include route groups and parameter names", () => {
  const base = { file: "a.meeko", layouts: [] };
  assert.throws(() => createRouteManifest([
    { ...base, id: "/users/[id]" },
    { ...base, id: "/users/[name]", file: "b.meeko" },
  ]), /Route collision/);
});

test("Fetch SSR shares route match, loader data and safe payload", async () => {
  const routes = createRouteManifest([{ id: "/users/[id]", file: "user.meeko", layouts: [] }]);
  const handler = createFrameworkHandler({
    routes,
    loadPage: async () => ({ renderWithState: (props) => ({ html: `<h1>${props.params && (props.params as Record<string, string>).id}</h1>`, state: { count: 1 } }) }),
    clientEntry: "/client.js",
  });
  const response = await handler(new Request("https://example.test/users/alice"));
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<h1>alice<\/h1>/);
  assert.match(html, /"route":"\/users\/\[id\]"/);
  assert.match(html, /src="\/client.js"/);
  const missing = await handler(new Request("https://example.test/nope"));
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
  const disallowed = await handler(new Request("https://example.test/users/alice", { method: "POST" }));
  assert.equal(disallowed.status, 405);
  assert.equal(disallowed.headers.get("allow"), "GET, HEAD");
  assert.match(disallowed.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
});

test("compiled layout outlet composes page SSR without leaking its module in payload", async () => {
  const routes = createRouteManifest([{ id: "/", file: "page.meeko", layouts: ["+layout.meeko"] }]);
  const handler = createFrameworkHandler({
    routes,
    loadPage: async (file) => file === "page.meeko"
      ? { css: "p{color:red} </style><script>alert(1)</script>", renderWithState: () => ({ html: "<p>Page</p>", state: { value: 1 } }) }
      : { css: "main{display:block}", renderWithState: (props) => {
        const outlet = props.outlet as { renderWithState(): { html: string } };
        return { html: `<main>${outlet.renderWithState().html}</main>`, state: {} };
      } },
  });
  const html = await (await handler(new Request("https://example.test/"))).text();
  assert.match(html, /<main><p>Page<\/p><\/main>/);
  assert.match(html, /<style>main\{display:block\}<\/style><style>p\{color:red\}/);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
  assert.doesNotMatch(html, /renderWithState/);
});

test("request context keeps concurrent loader state and sessions isolated", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const alice = await sessions.load(new Request("https://example.test/"));
  const bob = await sessions.load(new Request("https://example.test/"));
  const aliceRecord = await alice.create({ user: "alice" });
  const bobRecord = await bob.create({ user: "bob" });
  let arrived = 0;
  let release!: () => void;
  const together = new Promise<void>((resolve) => { release = resolve; });
  const routes = createRouteManifest([{ id: "/", file: "page.meeko", layouts: [], sidecar: "index.route.ts" }]);
  const handler = createFrameworkHandler({
    routes,
    createContext: async (request) => createRequestContext(request, {}, await sessions.load(request)),
    loadRoute: async () => ({
      async load({ context }) {
        assert.ok(context);
        const user = (context.session.current?.data as { user: string }).user;
        assert.equal(useRequestState(context, "user", () => user), user);
        if (++arrived === 2) release();
        await together;
        if (user === "alice") await context.session.rotate();
        return { user };
      },
      head: ({ context, data }) => ({ title: `${(data as { user: string }).user}:${context?.requestId}` }),
    }),
    loadPage: async () => ({ renderWithState: (props) => ({ html: `<p>${(props.data as { user: string }).user}</p>`, state: {} }) }),
  });
  const [aliceResponse, bobResponse] = await Promise.all([
    handler(new Request("https://example.test/", { headers: { cookie: `meeko.sid=${aliceRecord.id}` } })),
    handler(new Request("https://example.test/", { headers: { cookie: `meeko.sid=${bobRecord.id}` } })),
  ]);
  const [aliceHtml, bobHtml] = await Promise.all([aliceResponse.text(), bobResponse.text()]);
  assert.match(aliceHtml, /<p>alice<\/p>/);
  assert.doesNotMatch(aliceHtml, /bob/);
  assert.match(bobHtml, /<p>bob<\/p>/);
  assert.doesNotMatch(bobHtml, /alice/);
  assert.ok(aliceResponse.headers.get("set-cookie")?.includes("meeko.sid="));
  assert.equal(bobResponse.headers.get("set-cookie"), null);
  assert.notEqual(aliceResponse.headers.get("x-request-id"), bobResponse.headers.get("x-request-id"));
});

test("loader can return a redirect response", async () => {
  const routes = createRouteManifest([{ id: "/old", file: "old.meeko", layouts: [], sidecar: "old.route.ts" }]);
  const handler = createFrameworkHandler({
    routes,
    loadPage: async () => { throw new Error("Redirect must skip page loading"); },
    loadRoute: async () => ({ load: () => Response.redirect("https://example.test/new", 302) }),
  });
  const response = await handler(new Request("https://example.test/old"));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), "https://example.test/new");
});

test("nearest error route handles failures without exposing exception details", async () => {
  const routes = createRouteManifest([{ id: "/", file: "page.meeko", layouts: [], error: "+error.meeko" }]);
  const handler = createFrameworkHandler({
    routes,
    loadPage: async (file) => file === "+error.meeko"
      ? { renderWithState: () => ({ html: "<h1>Unavailable</h1>", state: {} }) }
      : { renderWithState: () => { throw new Error("private database password"); } },
  });
  const response = await handler(new Request("https://example.test/"));
  assert.equal(response.status, 500);
  const html = await response.text();
  assert.match(html, /Unavailable/);
  assert.doesNotMatch(html, /private database password/);
});

test("error route keeps each SSR request context and correlation ID", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const alice = await (await sessions.load(new Request("https://example.test/"))).create({ user: "alice" });
  const bob = await (await sessions.load(new Request("https://example.test/"))).create({ user: "bob" });
  const routes = createRouteManifest([{ id: "/", file: "page.meeko", layouts: [], error: "+error.meeko" }]);
  const observed: { error: unknown; requestId: string }[] = [];
  const handler = createFrameworkHandler({
    routes,
    createContext: async (request) => createRequestContext(request, {}, await sessions.load(request)),
    loadPage: async (file) => {
      if (file !== "+error.meeko") return { renderWithState: () => { throw new Error("private render failure"); } };
      const loadedFor = currentRequest().context.request;
      return { renderWithState: () => {
        const context = currentRequest().context;
        assert.equal(context.request, loadedFor);
        const user = (context.session.current?.data as { user: string }).user;
        return { html: `<h1>${user}:${context.requestId}</h1>`, state: {} };
      } };
    },
    onError(error, requestId) { observed.push({ error, requestId }); },
  });
  const [aliceResponse, bobResponse] = await Promise.all([
    handler(new Request("https://example.test/", { headers: { cookie: `meeko.sid=${alice.id}` } })),
    handler(new Request("https://example.test/", { headers: { cookie: `meeko.sid=${bob.id}` } })),
  ]);
  assert.equal(aliceResponse.status, 500);
  assert.equal(bobResponse.status, 500);
  const aliceHtml = await aliceResponse.text();
  const bobHtml = await bobResponse.text();
  assert.match(aliceHtml, new RegExp(`alice:${aliceResponse.headers.get("x-request-id")}`));
  assert.match(bobHtml, new RegExp(`bob:${bobResponse.headers.get("x-request-id")}`));
  assert.doesNotMatch(aliceHtml, /bob|private render failure/);
  assert.doesNotMatch(bobHtml, /alice|private render failure/);
  assert.deepEqual(new Set(observed.map(({ requestId }) => requestId)),
    new Set([aliceResponse.headers.get("x-request-id"), bobResponse.headers.get("x-request-id")]));
  assert.equal(observed.length, 2);
});

test("page failures preserve public status and correlation IDs without exposing private details", async () => {
  const routes = createRouteManifest([{ id: "/", file: "page.meeko", layouts: [] }]);
  const observed: { error: unknown; requestId: string }[] = [];
  const forbidden = createFrameworkHandler({
    routes,
    loadPage: async () => { throw new ApiError("FORBIDDEN", 403, "private policy details"); },
  });
  const json = await forbidden(new Request("https://example.test/", { headers: { accept: "application/meeko+json" } }));
  assert.equal(json.status, 403);
  const body = await json.json() as { code: string; status: number; requestId: string };
  assert.deepEqual({ code: body.code, status: body.status }, { code: "FORBIDDEN", status: 403 });
  assert.equal(json.headers.get("x-request-id"), body.requestId);
  assert.doesNotMatch(JSON.stringify(body), /private/);

  const unavailable = createFrameworkHandler({
    routes,
    createContext: async () => { throw new Error("private storage details"); },
    loadPage: async () => { throw new Error("page should not load"); },
    onError(error, requestId) { observed.push({ error, requestId }); },
  });
  const response = await unavailable(new Request("https://example.test/"));
  assert.equal(response.status, 500);
  assert.equal(await response.text(), "Internal Server Error");
  assert.match(response.headers.get("x-request-id") ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(observed[0]?.requestId, response.headers.get("x-request-id"));
  assert.ok(observed[0]?.error instanceof Error);
});

test("a rejected page error observer cannot create an unhandled rejection", async () => {
  const routes = createRouteManifest([{ id: "/", file: "page.meeko", layouts: [] }]);
  const handler = createFrameworkHandler({
    routes,
    loadPage: async () => { throw new Error("private page failure"); },
    onError: async () => { throw new Error("page observer failure"); },
  });
  const response = await handler(new Request("https://example.test/"));
  assert.equal(response.status, 500);
  assert.equal(await response.text(), "Internal Server Error");
  await new Promise<void>((resolve) => setImmediate(resolve));
});

test("an invalid route manifest is normalized before loading a page", async () => {
  const observed: { error: unknown; requestId: string }[] = [];
  const handler = createFrameworkHandler({
    routes: [{ id: "missing-leading-slash", file: "page.meeko", layouts: [] }],
    loadPage: async () => { throw new Error("page should not load"); },
    onError(error, requestId) { observed.push({ error, requestId }); },
  });
  const response = await handler(new Request("https://example.test/", { headers: { accept: "application/meeko+json" } }));
  assert.equal(response.status, 500);
  const body = await response.json() as { code: string; status: number; requestId: string };
  assert.deepEqual({ code: body.code, status: body.status }, { code: "INTERNAL_ERROR", status: 500 });
  assert.equal(response.headers.get("x-request-id"), body.requestId);
  assert.equal(observed[0]?.requestId, body.requestId);
  assert.match(String(observed[0]?.error), /Route must start with/);
  assert.doesNotMatch(JSON.stringify(body), /missing-leading-slash/);
});

test("browser navigation retains matching layout identities and releases its listener", async () => {
  const routes = createRouteManifest([
    { id: "/users/[id]", file: "user.meeko", layouts: ["app.meeko", "users.meeko"] },
    { id: "/users/new", file: "new.meeko", layouts: ["app.meeko", "users.meeko"] },
    { id: "/about", file: "about.meeko", layouts: ["app.meeko"] },
  ]);
  const events: number[] = [];
  let address = new URL("https://example.test/users/alice");
  const listeners = new Map<string, EventListener>();
  const browser = {
    get location() { return address; },
    history: {
      pushState(_state: unknown, _unused: string, url: URL) { address = new URL(url); },
      replaceState(_state: unknown, _unused: string, url: URL) { address = new URL(url); },
    },
    addEventListener(name: string, listener: EventListener) { listeners.set(name, listener); },
    removeEventListener(name: string) { listeners.delete(name); },
  } as unknown as Window;
  const navigator = createNavigator(routes, ({ retainedLayouts }) => { events.push(retainedLayouts); }, browser);
  assert.equal(await navigator.navigate("/users/new"), true);
  assert.equal(await navigator.navigate("/about"), true);
  assert.deepEqual(events, [2, 1]);
  assert.equal(address.pathname, "/about");
  navigator.dispose();
  assert.equal(listeners.has("popstate"), false);
  await assert.rejects(navigator.navigate("/users/alice"), /disposed/);
});
