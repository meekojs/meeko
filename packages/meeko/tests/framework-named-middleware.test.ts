import assert from "node:assert/strict";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { createServerApp } from "../src/framework-server.ts";
import type { AppManifest } from "../src/framework-server.ts";
import { renderPage } from "../src/framework-server/app.ts";
import type { InternalServerApp } from "../src/framework-server/app.ts";
import { mountClientApp } from "../src/framework/client.ts";
import { defineRouteMiddleware } from "../src/framework/middleware.ts";
import type { RouteMiddleware } from "../src/framework/middleware.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";

const page = {
  renderWithState: () => ({ html: "<p>Page</p>", state: {} }),
  renderToString: () => "<p>Page</p>",
  hydrateScope: () => () => {},
};

test("named middleware runs after the global middleware, in declared order, in SSR and in browser navigation", async () => {
  const routes = createRouteManifest([
    { id: "/", file: "index.meeko", layouts: [] },
    { id: "/panel", file: "panel.meeko", layouts: [], middleware: ["auth.ts", "admin.ts"] },
    { id: "/admin", file: "admin.meeko", layouts: [], middleware: ["admin.ts"] },
  ]);
  const calls: string[] = [];
  const record = (name: string, block?: (url: URL) => Response | undefined): RouteMiddleware => ({ match, phase, request, url }) => {
    calls.push(`${name}:${phase}:${match.route.id}`);
    assert.equal(request !== undefined, phase === "server");
    return block?.(url);
  };
  const global = record("global");
  const named: Record<string, RouteMiddleware> = {
    "auth.ts": defineRouteMiddleware(record("auth", (url) => url.searchParams.has("guest") ? Response.redirect(new URL("/?login", url), 302) : undefined), { global: false }),
    "admin.ts": defineRouteMiddleware(record("admin"), { global: false }),
  };
  const loaded: string[] = [];
  const loaders = {
    loadMiddleware: async () => [global],
    loadNamedMiddleware: async (file: string) => { loaded.push(file); return named[file]!; },
  };
  const server = createFrameworkHandler({ routes, loadPage: async () => page, ...loaders });
  assert.equal((await server(new Request("https://example.test/panel"))).status, 200);
  assert.deepEqual(calls, ["global:server:/panel", "auth:server:/panel", "admin:server:/panel"]);
  // A route without named middleware runs the global middleware alone.
  calls.length = 0;
  loaded.length = 0;
  assert.equal((await server(new Request("https://example.test/"))).status, 200);
  assert.deepEqual(calls, ["global:server:/"]);
  assert.deepEqual(loaded, []);
  // A redirect from a named middleware stops the route before the next one.
  calls.length = 0;
  const redirected = await server(new Request("https://example.test/panel?guest"));
  assert.equal(redirected.status, 302);
  assert.equal(redirected.headers.get("location"), "https://example.test/?login");
  assert.deepEqual(calls, ["global:server:/panel", "auth:server:/panel"]);

  const browser = new HappyWindow({ url: "https://example.test/" });
  browser.document.write(await (await server(new Request("https://example.test/"))).text());
  const assigned: string[] = [];
  Object.defineProperty(browser.location, "assign", { value: (url: string) => { assigned.push(url); } });
  calls.length = 0;
  loaded.length = 0;
  const app = await mountClientApp({
    routes,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async () => page,
    fetch: async () => new Response(JSON.stringify({ version: 2, route: "/", props: {}, state: {} }), { headers: { "content-type": "application/meeko+json" } }),
    serverData: false,
    ...loaders,
    browser: browser as unknown as Window,
  });
  // Hydration runs no middleware: the server already did. The named ones load on navigation.
  assert.deepEqual(calls, []);
  assert.deepEqual(loaded, []);
  assert.equal(await app.navigate("/admin"), true);
  assert.deepEqual(calls, ["global:client:/admin", "admin:client:/admin"]);
  assert.deepEqual(loaded, ["admin.ts"]);
  calls.length = 0;
  assert.equal(await app.navigate("/panel?guest"), false);
  assert.deepEqual(calls, ["global:client:/panel", "auth:client:/panel"]);
  assert.deepEqual(assigned, ["https://example.test/?login"]);
  assert.equal(browser.location.pathname, "/admin");
  app.dispose();
  browser.happyDOM.abort();
});

test("a route with named middleware fails instead of skipping it when nothing loads it", async () => {
  const routes = createRouteManifest([{ id: "/panel", file: "panel.meeko", layouts: [], middleware: ["auth.ts"] }]);
  const errors: unknown[] = [];
  const server = createFrameworkHandler({ routes, loadPage: async () => page, onError: (error) => errors.push(error) });
  assert.equal((await server(new Request("https://example.test/panel"))).status, 500);
  assert.match(String(errors[0]), /Route \/panel has named middleware \(auth\.ts\) but no loadNamedMiddleware/);
});

test("the server app loads the named middleware of each route by module key, also while prerendering", async () => {
  const calls: string[] = [];
  const middleware = (name: string, options?: { global: false }) => ({
    default: defineRouteMiddleware(({ match, phase, url }) => {
      calls.push(`${name}:${phase}:${match.route.id}`);
      if (name === "auth" && url.searchParams.has("guest")) return Response.redirect(new URL("/login", url), 303);
    }, options),
  });
  const modules: Record<string, unknown> = {
    "/app/pages/index.meeko": page,
    "/app/pages/panel.meeko": page,
    "/app/pages/panel.route.ts": { route: { render: "prerender" } },
    "/app/middleware/10-locale.ts": middleware("locale"),
    "/app/middleware/auth.ts": middleware("auth", { global: false }),
  };
  const manifest: AppManifest = {
    version: 1,
    routes: [
      { id: "/", file: "/app/pages/index.meeko", layouts: [] },
      { id: "/panel", file: "/app/pages/panel.meeko", layouts: [], sidecar: "/app/pages/panel.route.ts", render: "prerender", middleware: ["/app/middleware/auth.ts"] },
    ],
    server: { api: [], rpc: [], socket: [] },
    routeMiddleware: ["/app/middleware/10-locale.ts"],
    serverMiddleware: [],
    client: { entry: "/assets/entry.js", css: [], preload: [] },
  };
  const app = await createServerApp({ manifest, production: false, load: async (key) => modules[key] });
  try {
    const redirected = await app.fetch(new Request("https://example.test/panel?guest", { headers: { accept: "text/html" } }));
    assert.equal(redirected.status, 303);
    assert.equal(redirected.headers.get("location"), "https://example.test/login");
    assert.deepEqual(calls, ["locale:server:/panel", "auth:server:/panel"]);
    calls.length = 0;
    assert.equal((await app.fetch(new Request("https://example.test/", { headers: { accept: "text/html" } }))).status, 200);
    assert.deepEqual(calls, ["locale:server:/"]);
    // The prerender renders through the same middleware chain.
    calls.length = 0;
    const prerendered = await (app as InternalServerApp)[renderPage](new Request("https://example.test/panel", { headers: { accept: "text/html" } }));
    assert.equal(prerendered.status, 200);
    assert.deepEqual(calls, ["locale:server:/panel", "auth:server:/panel"]);
  } finally {
    await app.close();
  }
});
