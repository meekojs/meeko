import assert from "node:assert/strict";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { createContext, inject } from "../src/reactivity.ts";
import { mountClientApp } from "../src/framework/client.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { definePlugin } from "../src/framework/plugin.ts";
import type { PluginErrorInfo, PluginRegistration } from "../src/framework/plugin.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";

const themeKey = createContext<string>("theme");

const page = (id: string, read: () => string = () => inject(themeKey)): ClientComponent => ({
  renderWithState: () => ({ html: `<p id="${id}">${read()}</p>`, state: {} }),
  renderToString: () => `<p id="${id}">${read()}</p>`,
  hydrateScope: () => { hydrated.push(`${id}:${read()}`); return () => {}; },
});

const hydrated: string[] = [];

function fixture(plugins: readonly PluginRegistration[], onError?: (error: unknown, requestId: string) => void) {
  const modules: Record<string, ClientComponent> = {
    "home.meeko": page("home"),
    "broken.meeko": page("broken", () => { throw new Error("render failed"); }),
    "error.meeko": page("error", () => `error with theme ${String(inject(themeKey))}`),
  };
  const routes = createRouteManifest([
    { id: "/", file: "home.meeko", layouts: [] },
    { id: "/broken", file: "broken.meeko", layouts: [], error: "error.meeko" },
  ]);
  const handler = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]!, clientEntry: "/client.js", plugins, ...(onError ? { onError } : {}) });
  return { modules, routes, handler };
}

test("server plugins run per page request, provide values to the render and observe its failures", async () => {
  const runs: string[] = [];
  const observed: PluginErrorInfo[] = [];
  const host: string[] = [];
  const { handler } = fixture([
    {
      plugin: definePlugin<{ prefix: string }>(async (app, options) => {
        await Promise.resolve();
        runs.push(`${app.side} ${app.route.path.value} ${new URL(app.request!.url).pathname}`);
        app.provide(themeKey, `${options.prefix}${app.route.path.value}`);
        app.onError((_error, info) => { observed.push(info); });
      }),
      options: { prefix: "dark:" },
    },
  ], (_error, requestId) => { host.push(requestId); });
  const html = await (await handler(new Request("https://example.test/", { headers: { accept: "text/html" } }))).text();
  assert.match(html, /<p id="home">dark:\/<\/p>/);
  await handler(new Request("https://example.test/?again=1", { headers: { accept: "text/html" } }));
  assert.deepEqual(runs, ["server / /", "server / /"]);
  const failed = await handler(new Request("https://example.test/broken", { headers: { accept: "text/html" } }));
  assert.equal(failed.status, 500);
  assert.match(await failed.text(), /error with theme dark:\/broken/, "the error page also receives the plugin values");
  assert.equal(host.length, 1);
  assert.deepEqual(observed, [{ side: "server", requestId: host[0] }]);
});

test("a failing server plugin fails the request and leaves the error page without its values", async () => {
  const { handler } = fixture([{ plugin: definePlugin(() => { throw new Error("plugin failed"); }), name: "app/plugins/bad.ts" }]);
  const response = await handler(new Request("https://example.test/broken", { headers: { accept: "text/html" } }));
  assert.equal(response.status, 500);
  // The error page could not inject the value, so the plain 500 answers.
  assert.equal(await response.text(), "Internal Server Error");
  // A default export that is not definePlugin(...) is reported to the host observer by name.
  const reported: unknown[] = [];
  const invalid = fixture([{ plugin: { setup() {} }, name: "app/plugins/plain.ts" }], (error) => { reported.push(error); }).handler;
  const plain = await invalid(new Request("https://example.test/", { headers: { accept: "text/html" } }));
  assert.equal(plain.status, 500);
  assert.doesNotMatch(await plain.text(), /plain\.ts/);
  assert.match(String(reported[0]), /app\/plugins\/plain\.ts must default-export definePlugin/);
});

test("client plugins run before hydration, follow the committed route and join the application observer", async () => {
  hydrated.length = 0;
  const { modules, routes, handler } = fixture([{ plugin: definePlugin((app) => { app.provide(themeKey, "dark:/"); }) }]);
  const browser = new HappyWindow({ url: "https://example.test/" });
  browser.document.write(await (await handler(new Request("https://example.test/", { headers: { accept: "text/html" } }))).text());
  const order: string[] = [];
  const observed: string[] = [];
  const app = await mountClientApp({
    routes,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    browser: browser as unknown as Window,
    onError: (_error, source) => { observed.push(`host:${source}`); },
    plugins: [
      { plugin: definePlugin((app) => { order.push(`first ${app.side} ${app.route.path.value} ${String(app.request)}`); app.provide(themeKey, "dark:/"); }) },
      { plugin: definePlugin((app) => { order.push("second"); app.onError((_error, info) => { observed.push(`plugin:${info.side}:${info.side === "client" ? info.source : ""}`); }); }) },
    ],
  });
  assert.deepEqual(order, ["first client / undefined", "second"]);
  assert.deepEqual(hydrated, ["home:dark:/"]);
  // A click navigation that fails reaches the host observer and the plugin observer.
  const link = browser.document.createElement("a");
  link.href = "/broken";
  browser.document.body.append(link);
  link.click();
  await new Promise((done) => setTimeout(done, 50));
  assert.deepEqual(observed, ["host:navigation", "plugin:client:navigation"]);
  app.dispose();
  browser.happyDOM.abort();
});
