import assert from "node:assert/strict";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { bindComponent, renderComponent } from "../src/dom.ts";
import { provideErrorHandler } from "../src/component-errors.ts";
import type { Component, DomScope } from "../src/dom.ts";
import { mountClientApp } from "../src/framework/client.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { createNavigator, createRouteManifest, reportNavigationError } from "../src/framework/router.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";
import { useState } from "../src/framework/state.ts";

test("hydration preserves a common layout and cleans up exited page/layout scopes", async () => {
  const released: string[] = [];
  const page = (name: string): ClientComponent => ({
    renderWithState: () => ({ html: `<p data-page="${name}">${name}</p>`, state: {} }),
    renderToString: () => `<p data-page="${name}">${name}</p>`,
    hydrateScope: () => () => { released.push(name); },
  });
  const layout = (name: string): ClientComponent => ({
    renderWithState: (props) => ({
      html: `<section data-layout="${name}">${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, true)}</section>`,
      state: {},
    }),
    renderToString: (props) =>
      `<section data-layout="${name}">${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, false)}</section>`,
    hydrateScope: (scope: DomScope, props) => {
      const stop = bindComponent(scope, 0, () => props.outlet as Component<Record<string, unknown>>, () => ({}), "layout");
      return () => { stop(); released.push(name); };
    },
  });
  const modules: Record<string, ClientComponent> = {
    "a.meeko": page("A"),
    "b.meeko": page("B"),
    "c.meeko": page("C"),
    "shared.meeko": layout("shared"),
    "other.meeko": layout("other"),
    "app.meeko": layout("app"),
  };
  const routes = createRouteManifest([
    { id: "/a", file: "a.meeko", layouts: ["app.meeko", "shared.meeko"] },
    { id: "/b", file: "b.meeko", layouts: ["app.meeko", "shared.meeko"] },
    { id: "/c", file: "c.meeko", layouts: ["app.meeko", "other.meeko"] },
  ]);
  const server = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]! });
  const html = await (await server(new Request("https://example.test/a"))).text();
  const browser = new HappyWindow({ url: "https://example.test/a" });
  browser.document.write(html);
  const root = browser.document.getElementById("app")!;
  const payload = browser.document.getElementById("meeko-payload")!.textContent!;
  const shared = root.querySelector('[data-layout="shared"]');
  const appRoot = root.querySelector('[data-layout="app"]');
  const app = await mountClientApp({
    routes, root: root as unknown as Element, payload,
    loadPage: async (file) => modules[file]!,
    browser: browser as unknown as Window,
  });
  assert.deepEqual(released, []);
  assert.equal(await app.navigate("/b"), true);
  assert.equal(root.querySelector('[data-layout="shared"]'), shared);
  assert.equal(root.querySelector("[data-page]")?.getAttribute("data-page"), "B");
  assert.deepEqual(released, ["A"]);
  assert.equal(await app.navigate("/c"), true);
  assert.equal(root.querySelector('[data-layout="app"]'), appRoot);
  assert.ok(root.querySelector('[data-layout="other"]'));
  assert.deepEqual(released, ["A", "B", "shared"]);
  app.dispose();
  assert.deepEqual(released, ["A", "B", "shared", "C", "other", "app"]);
  browser.happyDOM.abort();
});

test("hydration rejects malformed or mismatched payloads", async () => {
  const browser = new HappyWindow({ url: "https://example.test/a" });
  const root = browser.document.createElement("div");
  const routes = createRouteManifest([{ id: "/a", file: "a.meeko", layouts: [] }]);
  await assert.rejects(mountClientApp({
    routes, root: root as unknown as Element, payload: "{",
    loadPage: async () => { throw new Error("should not load"); },
    browser: browser as unknown as Window,
  }), SyntaxError);
  await assert.rejects(mountClientApp({
    routes, root: root as unknown as Element,
    payload: { route: "/b", props: { params: {}, search: {} }, state: {} },
    loadPage: async () => { throw new Error("should not load"); },
    browser: browser as unknown as Window,
  }), /hydration mismatch/);
  browser.happyDOM.abort();
});

test("client rejects invalid route input before navigation and preserves request state", async () => {
  const browser = new HappyWindow({ url: "https://example.test/start" });
  const root = browser.document.createElement("div");
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [], sidecar: "start.route.ts" },
    { id: "/users/[id]", file: "user.meeko", layouts: [], sidecar: "user.route.ts" },
  ]);
  const page: ClientComponent = {
    renderWithState: (props) => ({
      html: `<p>${useState("owner", () => "missing").value}:${(props.params as Record<string, string>).id ?? "start"}</p>`,
      state: {},
    }),
    renderToString: (props) => `<p>${useState("owner", () => "missing").value}:${(props.params as Record<string, string>).id ?? "start"}</p>`,
    hydrateScope: () => {
      assert.equal(useState("owner", () => "missing").value, "alice");
      return () => {};
    },
  };
  const server = createFrameworkHandler({
    routes,
    loadRoute: async () => ({ load: ({ state }) => { state.get("owner", () => "alice"); return undefined; } }),
    loadPage: async () => page,
  });
  const html = await (await server(new Request("https://example.test/start"))).text();
  browser.document.write(html);
  const app = await mountClientApp({
    routes,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async () => page,
    loadRoute: async () => ({
      params: {
        "~standard": {
          version: 1,
          validate: (value: unknown) => typeof value === "object" && value !== null && "id" in value && /^\d+$/.test(String(value.id))
            ? { value } : { issues: ["invalid"] },
        },
      },
    }),
    browser: browser as unknown as Window,
  });
  assert.equal(app.state.get("owner", () => "missing").value, "alice");
  await assert.rejects(app.navigate("/users/nope"), /INVALID_PARAMS/);
  assert.equal(browser.location.pathname, "/start");
  assert.equal(await app.navigate("/users/42"), true);
  assert.equal(browser.location.pathname, "/users/42");
  assert.match(browser.document.getElementById("app")!.textContent, /alice:42/);
  app.dispose();
  browser.happyDOM.abort();
});

test("client navigation fetches server loader data without importing a private sidecar", async () => {
  const browser = new HappyWindow({ url: "https://example.test/start" });
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/users/[id]", file: "user.meeko", layouts: [], sidecar: "user.route.ts" },
  ]);
  const page = (render: (props: Record<string, unknown>) => string): ClientComponent => ({
    renderWithState: (props) => ({ html: render(props), state: {} }),
    renderToString: render,
    hydrateScope: () => () => {},
  });
  const modules: Record<string, ClientComponent> = {
    "start.meeko": page(() => "<p>Start</p>"),
    "user.meeko": page((props) => `<p>${(props.data as { name: string }).name}:${useState("visits", () => 0).value}</p>`),
  };
  const server = createFrameworkHandler({
    routes,
    loadPage: async (file) => modules[file]!,
    loadRoute: async () => ({
      params: { "~standard": { version: 1, validate: (value: unknown) => typeof value === "object" && value !== null && "id" in value && /^\d+$/.test(String(value.id)) ? { value } : { issues: ["invalid"] } } },
      load: ({ params, state }) => { state.get("visits", () => 3); return { name: `User ${params.id}` }; },
    }),
  });
  browser.document.write(await (await server(new Request("https://example.test/start"))).text());
  const app = await mountClientApp({
    routes,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    serverData: true,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
    browser: browser as unknown as Window,
  });
  assert.equal(await app.navigate("/users/42"), true);
  assert.equal(browser.location.pathname, "/users/42");
  assert.match(browser.document.getElementById("app")!.textContent, /User 42:3/);
  assert.equal(app.state.get("visits", () => 0).value, 3);
  await assert.rejects(app.navigate("/users/nope"), /HTTP 400/);
  assert.equal(browser.location.pathname, "/users/42");
  app.dispose();
  browser.happyDOM.abort();
});

test("a failed page load does not seed state from its discarded server payload", async () => {
  const browser = new HappyWindow({ url: "https://example.test/start" });
  const root = browser.document.createElement("div");
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/broken", file: "broken.meeko", layouts: [] },
  ]);
  const start: ClientComponent = {
    renderWithState: () => ({ html: "<p>Start</p>", state: {} }),
    renderToString: () => "<p>Start</p>",
    hydrateScope: () => () => {},
  };
  const app = await mountClientApp({
    routes,
    root: root as unknown as Element,
    payload: { route: "/start", props: { params: {}, search: {} }, state: {} },
    loadPage: async (file) => {
      if (file === "broken.meeko") throw new Error("page import failed");
      return start;
    },
    serverData: true,
    fetch: async () => new Response(JSON.stringify({
      route: "/broken", props: { params: {}, search: {} }, state: {}, sharedState: { serverOnly: "discarded" },
    })),
    browser: browser as unknown as Window,
  });
  await assert.rejects(app.navigate("/broken"), /page import failed/);
  assert.equal(browser.location.pathname, "/start");
  assert.equal(app.state.get("serverOnly", () => "fallback").value, "fallback");
  app.dispose();
  browser.happyDOM.abort();
});

test("a failed page render rolls back state from its discarded server payload", async () => {
  const browser = new HappyWindow({ url: "https://example.test/start" });
  browser.document.head.innerHTML = '<meta name="meeko-csrf-token" content="current">';
  const root = browser.document.createElement("div");
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/broken", file: "broken.meeko", layouts: [] },
  ]);
  const start: ClientComponent = {
    renderWithState: () => ({ html: "<p>Start</p>", state: {} }),
    renderToString: () => "<p>Start</p>",
    hydrateScope: () => () => {},
  };
  const broken: ClientComponent = {
    renderWithState: () => { throw new Error("page render failed"); },
    renderToString: () => "<p>Broken</p>",
    hydrateScope: () => () => {},
  };
  const app = await mountClientApp({
    routes, root: root as unknown as Element,
    payload: { route: "/start", props: { params: {}, search: {} }, state: {} },
    loadPage: async (file) => file === "broken.meeko" ? broken : start,
    serverData: true,
    fetch: async () => new Response(JSON.stringify({
      route: "/broken", props: { params: {}, search: {} }, state: {}, sharedState: { serverOnly: "discarded" },
    }), { headers: { "x-meeko-csrf-token": "discarded" } }),
    browser: browser as unknown as Window,
  });
  await assert.rejects(app.navigate("/broken"), /page render failed/);
  assert.equal(browser.location.pathname, "/start");
  assert.equal(app.state.get("serverOnly", () => "fallback").value, "fallback");
  assert.equal(browser.document.querySelector('meta[name="meeko-csrf-token"]')?.getAttribute("content"), "current");
  app.dispose();
  browser.happyDOM.abort();
});

test("a discarded route response cannot overwrite the current CSRF token", async () => {
  const browser = new HappyWindow({ url: "https://example.test/start" });
  browser.document.head.innerHTML = '<meta name="meeko-csrf-token" content="initial">';
  const root = browser.document.createElement("div");
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/old", file: "old.meeko", layouts: [] },
    { id: "/new", file: "new.meeko", layouts: [] },
  ]);
  const page: ClientComponent = {
    renderWithState: () => ({ html: "<p>Page</p>", state: {} }),
    renderToString: () => "<p>Page</p>",
    hydrateScope: () => () => {},
  };
  let resolveOld!: (response: Response) => void;
  const oldResponse = new Promise<Response>((resolve) => { resolveOld = resolve; });
  const response = (route: string, token: string) => new Response(JSON.stringify({
    route, props: { params: {}, search: {} }, state: {}, sharedState: {},
  }), { headers: { "x-meeko-csrf-token": token } });
  const app = await mountClientApp({
    routes, root: root as unknown as Element,
    payload: { route: "/start", props: { params: {}, search: {} }, state: {} },
    loadPage: async () => page,
    serverData: true,
    fetch: async (input) => new URL(String(input)).pathname === "/old" ? oldResponse : response("/new", "new-token"),
    browser: browser as unknown as Window,
  });
  const discarded = app.navigate("/old");
  assert.equal(await app.navigate("/new"), true);
  resolveOld(response("/old", "old-token"));
  assert.equal(await discarded, false);
  assert.equal(browser.document.querySelector('meta[name="meeko-csrf-token"]')?.getAttribute("content"), "new-token");
  app.dispose();
  browser.happyDOM.abort();
});

test("a malformed route payload cannot change the CSRF token", async () => {
  const browser = new HappyWindow({ url: "https://example.test/start" });
  browser.document.head.innerHTML = '<meta name="meeko-csrf-token" content="current">';
  const root = browser.document.createElement("div");
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/broken", file: "broken.meeko", layouts: [] },
  ]);
  const page: ClientComponent = {
    renderWithState: () => ({ html: "<p>Start</p>", state: {} }),
    renderToString: () => "<p>Start</p>",
    hydrateScope: () => () => {},
  };
  const app = await mountClientApp({
    routes, root: root as unknown as Element,
    payload: { route: "/start", props: { params: {}, search: {} }, state: {} },
    loadPage: async () => page,
    serverData: true,
    fetch: async () => new Response("{", { headers: { "x-meeko-csrf-token": "discarded" } }),
    browser: browser as unknown as Window,
  });
  await assert.rejects(app.navigate("/broken"), SyntaxError);
  assert.equal(browser.document.querySelector('meta[name="meeko-csrf-token"]')?.getAttribute("content"), "current");
  app.dispose();
  browser.happyDOM.abort();
});

test("a rejected client loader cannot change application state", async () => {
  const browser = new HappyWindow({ url: "https://example.test/start" });
  const root = browser.document.createElement("div");
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/broken", file: "broken.meeko", layouts: [], sidecar: "broken.route.ts" },
  ]);
  const page: ClientComponent = {
    renderWithState: () => ({ html: "<p>Page</p>", state: {} }),
    renderToString: () => "<p>Page</p>",
    hydrateScope: () => () => {},
  };
  const app = await mountClientApp({
    routes, root: root as unknown as Element,
    payload: { route: "/start", props: { params: {}, search: {} }, state: {}, sharedState: { owner: "current" } },
    loadPage: async () => page,
    loadRoute: async () => ({ load: ({ state }) => {
      state.get("owner", () => "missing").value = "discarded";
      state.get("newKey", () => "discarded");
      throw new Error("loader failed");
    } }),
    browser: browser as unknown as Window,
  });
  await assert.rejects(app.navigate("/broken"), /loader failed/);
  assert.equal(app.state.get("owner", () => "missing").value, "current");
  assert.equal(app.state.get("newKey", () => "fallback").value, "fallback");
  app.dispose();
  browser.happyDOM.abort();
});

test("a canceled client loader cannot overwrite a later navigation", async () => {
  const browser = new HappyWindow({ url: "https://example.test/start" });
  const root = browser.document.createElement("div");
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/slow", file: "slow.meeko", layouts: [], sidecar: "slow.route.ts" },
    { id: "/fast", file: "fast.meeko", layouts: [] },
  ]);
  const page: ClientComponent = {
    renderWithState: () => ({ html: "<p>Page</p>", state: {} }),
    renderToString: () => "<p>Page</p>",
    hydrateScope: () => () => {},
  };
  let started!: () => void;
  let finish!: () => void;
  const loading = new Promise<void>((resolve) => { started = resolve; });
  const gate = new Promise<void>((resolve) => { finish = resolve; });
  const app = await mountClientApp({
    routes, root: root as unknown as Element,
    payload: { route: "/start", props: { params: {}, search: {} }, state: {}, sharedState: { owner: "current" } },
    loadPage: async () => page,
    loadRoute: async () => ({ load: async ({ state }) => {
      state.get("owner", () => "missing").value = "stale";
      state.get("newKey", () => "stale");
      started();
      await gate;
    } }),
    browser: browser as unknown as Window,
  });
  const slow = app.navigate("/slow");
  await loading;
  assert.equal(await app.navigate("/fast"), true);
  finish();
  assert.equal(await slow, false);
  assert.equal(browser.location.pathname, "/fast");
  assert.equal(app.state.get("owner", () => "missing").value, "current");
  assert.equal(app.state.get("newKey", () => "fallback").value, "fallback");
  app.dispose();
  browser.happyDOM.abort();
});

test("a successful client loader commits state used by the next page", async () => {
  const browser = new HappyWindow({ url: "https://example.test/start" });
  const root = browser.document.createElement("div");
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/next", file: "next.meeko", layouts: [], sidecar: "next.route.ts" },
  ]);
  const page: ClientComponent = {
    renderWithState: () => ({ html: `<p>${useState("owner", () => "missing").value}</p>`, state: {} }),
    renderToString: () => "<p>Page</p>",
    hydrateScope: () => () => {},
  };
  const app = await mountClientApp({
    routes, root: root as unknown as Element,
    payload: { route: "/start", props: { params: {}, search: {} }, state: {}, sharedState: { owner: "current" } },
    loadPage: async () => page,
    loadRoute: async () => ({ load: ({ state }) => {
      state.get("owner", () => "missing").value = "next";
      state.get("created", () => 7);
    } }),
    browser: browser as unknown as Window,
  });
  assert.equal(await app.navigate("/next"), true);
  assert.equal(app.state.get("owner", () => "missing").value, "next");
  assert.equal(app.state.get("created", () => 0).value, 7);
  assert.match(root.textContent, /next/);
  app.dispose();
  browser.happyDOM.abort();
});

test("a failed next-page render restores changes made by its client loader", async () => {
  const browser = new HappyWindow({ url: "https://example.test/start" });
  const root = browser.document.createElement("div");
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/broken", file: "broken.meeko", layouts: [], sidecar: "broken.route.ts" },
  ]);
  const start: ClientComponent = {
    renderWithState: () => ({ html: "<p>Start</p>", state: {} }),
    renderToString: () => "<p>Start</p>",
    hydrateScope: () => () => {},
  };
  const broken: ClientComponent = {
    renderWithState: () => { throw new Error("render failed"); },
    renderToString: () => "<p>Broken</p>",
    hydrateScope: () => () => {},
  };
  const app = await mountClientApp({
    routes, root: root as unknown as Element,
    payload: { route: "/start", props: { params: {}, search: {} }, state: {}, sharedState: { owner: "current" } },
    loadPage: async (file) => file === "broken.meeko" ? broken : start,
    loadRoute: async () => ({ load: ({ state }) => {
      state.get("owner", () => "missing").value = "discarded";
      state.get("created", () => 7);
    } }),
    browser: browser as unknown as Window,
  });
  await assert.rejects(app.navigate("/broken"), /render failed/);
  assert.equal(app.state.get("owner", () => "missing").value, "current");
  assert.equal(app.state.get("created", () => 0).value, 0);
  app.dispose();
  browser.happyDOM.abort();
});

test("popstate reports render failures and restores the visible URL even if its observer throws", async () => {
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/broken", file: "broken.meeko", layouts: [] },
  ]);
  let address = new URL("https://example.test/start");
  let popstate: EventListener | undefined;
  const seen: unknown[] = [];
  const logged: unknown[][] = [];
  const browser = {
    get location() { return address; },
    history: {
      pushState(_state: unknown, _title: string, url: URL) { address = new URL(url); },
      replaceState(_state: unknown, _title: string, url: URL | string) { address = new URL(url, address); },
    },
    console: { error(...args: unknown[]) { logged.push(args); } },
    addEventListener(_name: string, listener: EventListener) { popstate = listener; },
    removeEventListener() { popstate = undefined; },
  } as unknown as Window;
  const navigator = createNavigator(routes, () => { throw new Error("private load failed"); }, browser, (error) => {
    seen.push(error);
    throw new Error("observer failed");
  });
  address = new URL("https://example.test/broken");
  popstate?.(new Event("popstate"));
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(address.pathname, "/start");
  assert.match(String(seen[0]), /private load failed/);
  assert.match(String(logged[0]?.[1]), /observer failed/);
  address = new URL("https://example.test/missing");
  popstate?.(new Event("popstate"));
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(address.pathname, "/start");
  assert.equal(seen.length, 1);
  navigator.dispose();
  assert.equal(popstate, undefined);
});

test("an unknown popstate route reloads the last committed URL when history restoration fails", async () => {
  const routes = createRouteManifest([{ id: "/start", file: "start.meeko", layouts: [] }]);
  let address = new URL("https://example.test/start");
  const historyFailure = new Error("history restoration failed");
  const reloadFailure = new Error("reload failed");
  let failReload = false;
  let renderCount = 0;
  const browser = {
    get location() { return {
      href: address.href, origin: address.origin, pathname: address.pathname,
      replace(target: string) {
        if (failReload) throw reloadFailure;
        address = new URL(target);
      },
    }; },
    history: { replaceState() { throw historyFailure; } },
    addEventListener() {}, removeEventListener() {},
  } as unknown as Window;
  const navigator = createNavigator(routes, () => { renderCount++; }, browser);
  try {
    address = new URL("https://example.test/unknown");
    await assert.rejects(navigator.navigate("/unknown", { replace: true }), (error: unknown) => error === historyFailure);
    assert.equal(address.pathname, "/start");
    assert.equal(renderCount, 0);

    address = new URL("https://example.test/unknown");
    failReload = true;
    await assert.rejects(navigator.navigate("/unknown", { replace: true }), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [historyFailure, reloadFailure]);
      return true;
    });
    assert.equal(renderCount, 0);
  } finally { navigator.dispose(); }
});

test("a failed popstate render preserves its error when history restoration also fails", async () => {
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/next", file: "next.meeko", layouts: [] },
  ]);
  let address = new URL("https://example.test/start");
  const renderFailure = new Error("render failed");
  const historyFailure = new Error("history restoration failed");
  const reloadFailure = new Error("reload failed");
  let failReload = false;
  const reloads: string[] = [];
  const browser = {
    get location() { return {
      href: address.href, origin: address.origin, pathname: address.pathname,
      replace(target: string) {
        reloads.push(target);
        if (failReload) throw reloadFailure;
        address = new URL(target);
      },
    }; },
    history: { replaceState() { throw historyFailure; } },
    addEventListener() {}, removeEventListener() {},
  } as unknown as Window;
  const navigator = createNavigator(routes, () => { throw renderFailure; }, browser);
  try {
    address = new URL("https://example.test/next");
    await assert.rejects(navigator.navigate("/next", { replace: true }), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [renderFailure, historyFailure]);
      return true;
    });
    assert.equal(address.pathname, "/start");
    assert.deepEqual(reloads, ["https://example.test/start"]);
    address = new URL("https://example.test/next");
    failReload = true;
    await assert.rejects(navigator.navigate("/next", { replace: true }), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [renderFailure, historyFailure, reloadFailure]);
      return true;
    });
  } finally { navigator.dispose(); }
});

test("a rejected popstate clears pending and preserves failed URL recovery", async () => {
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/next", file: "next.meeko", layouts: [] },
  ]);
  let address = new URL("https://example.test/start");
  const historyFailure = new Error("history restoration failed");
  const reloadFailure = new Error("reload failed");
  let failReload = false;
  let firstSignal: AbortSignal | undefined;
  const browser = {
    get location() { return {
      href: address.href, origin: address.origin, pathname: address.pathname,
      replace(target: string) {
        if (failReload) throw reloadFailure;
        address = new URL(target);
      },
    }; },
    history: { replaceState() { throw historyFailure; } },
    addEventListener() {}, removeEventListener() {},
  } as unknown as Window;
  const navigator = createNavigator(routes, ({ signal }) => {
    firstSignal ??= signal;
    return false;
  }, browser);
  try {
    address = new URL("https://example.test/next");
    await assert.rejects(navigator.navigate("/next", { replace: true }), (error: unknown) => error === historyFailure);
    assert.equal(address.pathname, "/start");
    assert.equal(firstSignal?.aborted, false);
    address = new URL("https://example.test/next");
    failReload = true;
    await assert.rejects(navigator.navigate("/next", { replace: true }), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [historyFailure, reloadFailure]);
      return true;
    });
    assert.equal(firstSignal?.aborted, false);
  } finally { navigator.dispose(); }
});

test("history failures after rendering reload the last committed route", async () => {
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/next", file: "next.meeko", layouts: [] },
  ]);
  let address = new URL("https://example.test/start");
  let visible = "start";
  let failHistory = true;
  const failure = new Error("history failed");
  const reloads: string[] = [];
  const browser = {
    get location() { return {
      href: address.href, origin: address.origin, pathname: address.pathname,
      replace(target: string) { reloads.push(target); address = new URL(target); visible = address.pathname.slice(1); },
    }; },
    history: {
      pushState(_state: unknown, _title: string, target: URL) {
        if (failHistory) throw failure;
        address = new URL(target);
      },
      replaceState(_state: unknown, _title: string, target: URL) {
        if (failHistory) throw failure;
        address = new URL(target);
      },
    },
    addEventListener() {}, removeEventListener() {},
  } as unknown as Window;
  const navigator = createNavigator(routes, ({ match }) => { visible = match.route.id.slice(1); }, browser);
  try {
    await assert.rejects(navigator.navigate("/next"), (error: unknown) => error === failure);
    assert.equal(address.pathname, "/start");
    assert.equal(visible, "start");
    assert.deepEqual(reloads, ["https://example.test/start"]);

    failHistory = false;
    assert.equal(await navigator.navigate("/next"), true);
    assert.equal(address.pathname, "/next");
    failHistory = true;
    await assert.rejects(navigator.navigate("/start", { replace: true }), (error: unknown) => error === failure);
    assert.equal(address.pathname, "/next");
    assert.equal(visible, "next");
    assert.deepEqual(reloads, ["https://example.test/start", "https://example.test/next"]);
  } finally { navigator.dispose(); }
});

test("history failure preserves the reload failure as a second cause", async () => {
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/next", file: "next.meeko", layouts: [] },
  ]);
  const historyFailure = new Error("history failed");
  const reloadFailure = new Error("reload failed");
  const browser = {
    location: {
      href: "https://example.test/start", origin: "https://example.test", pathname: "/start",
      replace() { throw reloadFailure; },
    },
    history: { pushState() { throw historyFailure; } },
    addEventListener() {}, removeEventListener() {},
  } as unknown as Window;
  const navigator = createNavigator(routes, () => {}, browser);
  try {
    await assert.rejects(navigator.navigate("/next"), (error: unknown) => {
      assert.ok(error instanceof AggregateError);
      assert.deepEqual(error.errors, [historyFailure, reloadFailure]);
      return true;
    });
  } finally { navigator.dispose(); }
});

test("mounted app requests the previous page after a committed DOM swap meets a history failure", async () => {
  const documentWindow = new HappyWindow({ url: "https://example.test/start" });
  const root = documentWindow.document.createElement("main");
  root.innerHTML = "<p>Start</p>";
  documentWindow.document.body.append(root);
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/next", file: "next.meeko", layouts: [] },
  ]);
  let address = new URL("https://example.test/start");
  let reloaded: string | undefined;
  const historyFailure = new Error("history failed");
  const browser = {
    document: documentWindow.document,
    get location() { return {
      href: address.href, origin: address.origin, pathname: address.pathname,
      replace(target: string) { reloaded = target; address = new URL(target); root.innerHTML = "<p>Start</p>"; },
    }; },
    history: { pushState() { throw historyFailure; }, replaceState() { throw historyFailure; } },
    addEventListener() {}, removeEventListener() {},
  } as unknown as Window;
  const component = (name: string): ClientComponent => ({
    renderWithState: () => ({ html: `<p>${name}</p>`, state: {} }),
    renderToString: () => `<p>${name}</p>`,
    hydrateScope: () => () => {},
  });
  const app = await mountClientApp({
    routes, root: root as unknown as Element,
    payload: { route: "/start", props: { params: {}, search: {} }, state: {} },
    loadPage: async (file) => file === "next.meeko" ? component("Next") : component("Start"),
    browser,
  });
  try {
    await assert.rejects(app.navigate("/next"), (error: unknown) => error === historyFailure);
    assert.equal(reloaded, "https://example.test/start");
    assert.equal(address.pathname, "/start");
    assert.equal(root.textContent, "Start");
  } finally {
    app.dispose();
    documentWindow.happyDOM.abort();
  }
});

test("client navigation handles a throwing error observer for guards and link clicks", async () => {
  const browser = new HappyWindow({ url: "https://example.test/start" });
  const root = browser.document.createElement("div");
  root.innerHTML = '<a href="/broken">Broken</a>';
  browser.document.body.append(root);
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/blocked", file: "blocked.meeko", layouts: [] },
    { id: "/broken", file: "broken.meeko", layouts: [] },
  ]);
  const logged: unknown[][] = [];
  browser.console.error = (...args: unknown[]) => { logged.push(args); };
  const app = await mountClientApp({
    routes,
    root: root as unknown as Element,
    payload: { route: "/start", props: { params: {}, search: {} }, state: {} },
    loadPage: async (file) => file === "broken.meeko" ? Promise.reject(new Error("page load failed")) : ({
      renderWithState: () => ({ html: "<p>Start</p>", state: {} }),
      renderToString: () => "<p>Start</p>",
      hydrateScope: () => () => {},
    }),
    loadMiddleware: async () => [({ match }) => match.route.id === "/blocked" ? new Response("denied", { status: 403 }) : undefined],
    onNavigationError: () => { throw new Error("observer failed"); },
    browser: browser as unknown as Window,
  });
  assert.equal(await app.navigate("/blocked"), false);
  const anchor = root.querySelector("a")!;
  anchor.dispatchEvent(new browser.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(browser.location.pathname, "/start");
  assert.equal(logged.length, 2);
  for (const entry of logged) assert.match(String(entry[1]), /observer failed/);
  app.dispose();
  browser.happyDOM.abort();
});

test("navigation errors use each mounted app's active component observer", async () => {
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/next", file: "next.meeko", layouts: [] },
    { id: "/broken", file: "broken.meeko", layouts: [] },
  ]);
  const seen: string[] = [];
  const mounts = await Promise.all(["A", "B"].map(async (name) => {
    const browser = new HappyWindow({ url: "https://example.test/start" });
    const root = browser.document.createElement("main");
    root.innerHTML = '<a href="/broken">Broken</a>';
    browser.document.body.append(root);
    const logs: unknown[][] = [];
    browser.console.error = (...args: unknown[]) => { logs.push(args); };
    const page = (label: string): ClientComponent => ({
      renderWithState: () => ({ html: '<a href="/broken">Broken</a>', state: {} }),
      renderToString: () => '<a href="/broken">Broken</a>',
      hydrateScope: () => {
        provideErrorHandler((error) => { seen.push(`${name}:${label}:${String(error)}`); });
        return () => {};
      },
    });
    const app = await mountClientApp({
      routes, root: root as unknown as Element,
      payload: { route: "/start", props: { params: {}, search: {} }, state: {} },
      loadPage: async (file) => {
        if (file === "broken.meeko") throw new Error("route failed");
        return page(file === "next.meeko" ? "next" : "start");
      },
      browser: browser as unknown as Window,
    });
    return { browser, root, logs, app };
  }));
  try {
    for (const mount of mounts) mount.root.querySelector("a")!.dispatchEvent(new mount.browser.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    await new Promise<void>((done) => setImmediate(done));
    assert.deepEqual(seen.map((entry) => entry.split(":").slice(0, 2).join(":")), ["A:start", "B:start"]);
    assert.deepEqual(mounts.map((mount) => mount.logs.length), [0, 0]);
    assert.equal(await mounts[0]!.app.navigate("/next"), true);
    mounts[0]!.root.querySelector("a")!.dispatchEvent(new mounts[0]!.browser.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    await new Promise<void>((done) => setImmediate(done));
    assert.match(seen[2]!, /^A:next:Error: route failed$/);
    assert.equal(seen.filter((entry) => entry.startsWith("A:start")).length, 1);
  } finally {
    for (const mount of mounts) {
      mount.app.dispose();
      mount.browser.happyDOM.abort();
    }
  }
});

for (const retainedLayout of [false, true]) {
  test(`failed ${retainedLayout ? "retained outlet" : "root"} hydration requests a full reload of the last stable route`, async () => {
    const browser = new HappyWindow({ url: "https://example.test/start" });
    const requested: string[] = [];
    Object.defineProperty(browser.location, "replace", {
      value: (url: string) => { requested.push(url); },
    });
    const root = browser.document.createElement("div");
    browser.document.body.append(root);
    const layoutFile = retainedLayout ? ["layout.meeko"] : [];
    const routes = createRouteManifest([
      { id: "/start", file: "start.meeko", layouts: layoutFile },
      { id: "/stable", file: "stable.meeko", layouts: layoutFile },
      { id: "/broken", file: "broken.meeko", layouts: layoutFile },
      { id: "/load-error", file: "load-error.meeko", layouts: layoutFile },
    ]);
    const page = (name: string, fail = false): ClientComponent => ({
      renderWithState: () => ({ html: `<p>${name}</p>`, state: {} }),
      renderToString: () => `<p>${name}</p>`,
      hydrateScope: () => {
        if (fail) throw new Error("page hydration failed");
        return () => {};
      },
    });
    const layout: ClientComponent = {
      renderWithState: (props) => ({
        html: `<section>${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, true)}</section>`,
        state: {},
      }),
      renderToString: (props) => `<section>${renderComponent(0, props.outlet as Component<Record<string, unknown>>, {}, false)}</section>`,
      hydrateScope: (scope, props) => bindComponent(scope, 0, () => props.outlet as Component<Record<string, unknown>>, () => ({}), "layout"),
    };
    const modules: Record<string, ClientComponent> = {
      "start.meeko": page("start"),
      "stable.meeko": page("stable"),
      "broken.meeko": page("broken", true),
      "layout.meeko": layout,
    };
    const server = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]! });
    browser.document.write(await (await server(new Request("https://example.test/start"))).text());
    const app = await mountClientApp({
      routes,
      root: browser.document.getElementById("app") as unknown as Element,
      payload: browser.document.getElementById("meeko-payload")!.textContent!,
      loadPage: async (file) => {
        if (file === "load-error.meeko") throw new Error("page load failed");
        return modules[file]!;
      },
      browser: browser as unknown as Window,
    });
    assert.equal(await app.navigate("/stable"), true);
    assert.equal(browser.location.pathname, "/stable");
    await assert.rejects(app.navigate("/load-error"), /page load failed/);
    assert.deepEqual(requested, []);
    await assert.rejects(app.navigate("/broken"), /page hydration failed/);
    assert.deepEqual(requested, ["https://example.test/stable"]);
    app.dispose();
    browser.happyDOM.abort();
  });
}

test("failed reload keeps both the hydration error and recovery error", async () => {
  const browser = new HappyWindow({ url: "https://example.test/start" });
  Object.defineProperty(browser.location, "replace", {
    value: () => { throw new Error("browser denied navigation"); },
  });
  const root = browser.document.createElement("div");
  const routes = createRouteManifest([
    { id: "/start", file: "start.meeko", layouts: [] },
    { id: "/broken", file: "broken.meeko", layouts: [] },
  ]);
  const page = (broken: boolean): ClientComponent => ({
    renderWithState: () => ({ html: "<p>Page</p>", state: {} }),
    renderToString: () => "<p>Page</p>",
    hydrateScope: () => {
      if (broken) throw new Error("original hydration error");
      return () => {};
    },
  });
  const app = await mountClientApp({
    routes, root: root as unknown as Element,
    payload: { route: "/start", props: { params: {}, search: {} }, state: {} },
    loadPage: async (file) => page(file === "broken.meeko"),
    browser: browser as unknown as Window,
  });
  await assert.rejects(app.navigate("/broken"), (error: unknown) => {
    assert.ok(error instanceof AggregateError);
    assert.match(String(error.errors[0]), /original hydration error/);
    assert.match(String(error.errors[1]), /browser denied navigation/);
    return true;
  });
  app.dispose();
  browser.happyDOM.abort();
});

test("an async navigation error observer rejection is reported without an unhandled rejection", async () => {
  const browser = new HappyWindow({ url: "https://example.test/start" });
  const logged: unknown[][] = [];
  const originalError = browser.console.error;
  browser.console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    reportNavigationError(browser as unknown as Window, new Error("navigation failed"), async () => {
      throw new Error("observer rejected");
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.match(String(logged[0]?.[0]), /navigation error observer failed/);
    assert.match(String(logged[0]?.[1]), /observer rejected/);
    assert.match(String(logged[0]?.[2]), /navigation failed/);
  } finally {
    browser.console.error = originalError;
    browser.happyDOM.abort();
  }
});

test("a malformed link does not throw from the browser click callback", async () => {
  const browser = new HappyWindow({ url: "https://example.test/start" });
  const originalAdd = browser.document.addEventListener.bind(browser.document) as unknown as
    (type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => void;
  let clickListener: ((event: MouseEvent) => void) | undefined;
  browser.document.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    if (type === "click" && typeof listener === "function") clickListener = listener as (event: MouseEvent) => void;
    originalAdd(type, listener, options);
  }) as unknown as typeof browser.document.addEventListener;
  const root = browser.document.createElement("div");
  root.innerHTML = '<a href="http://[">Broken URL</a>';
  browser.document.body.append(root);
  const app = await mountClientApp({
    routes: createRouteManifest([{ id: "/start", file: "start.meeko", layouts: [] }]),
    root: root as unknown as Element,
    payload: { route: "/start", props: { params: {}, search: {} }, state: {} },
    loadPage: async () => ({
      renderWithState: () => ({ html: "<p>Start</p>", state: {} }),
      renderToString: () => "<p>Start</p>",
      hydrateScope: () => () => {},
    }),
    browser: browser as unknown as Window,
  });
  const anchor = root.querySelector("a")!;
  assert.ok(clickListener);
  const event = new browser.MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  Object.defineProperty(event, "target", { value: anchor });
  assert.doesNotThrow(() => clickListener!(event as unknown as MouseEvent));
  app.dispose();
  browser.happyDOM.abort();
});
