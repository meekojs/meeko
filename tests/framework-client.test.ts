import assert from "node:assert/strict";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { bindComponent, renderComponent } from "../src/dom.ts";
import type { Component, DomScope } from "../src/dom.ts";
import { mountClientApp } from "../src/framework/client.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { createRouteManifest } from "../src/framework/router.ts";
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
