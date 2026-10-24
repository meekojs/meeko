import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { createNavigator, createRouteManifest, href, matchRoute } from "../src/framework/router.ts";
import { createFrameworkHandler, discoverRoutes } from "../src/framework/server.ts";
import { createRequestContext, MemorySessionStore, SessionManager, useRequestState } from "../src/framework-server.ts";

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
  assert.equal((await handler(new Request("https://example.test/nope"))).status, 404);
  assert.equal((await handler(new Request("https://example.test/users/alice", { method: "POST" }))).status, 405);
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
