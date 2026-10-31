import { Window as HappyWindow } from "happy-dom";
import assert from "node:assert/strict";
import test from "node:test";

import type { ClientComponent } from "../src/app/runtime/client.ts";
import type { DevtoolsActivity } from "../src/core/devtools-protocol.ts";

import { ResourceCache } from "../src/app/composables/resources/engine.ts";
import { mountClientApp } from "../src/app/runtime/client.ts";
import { installDevtoolsActivitySink, traceNavigation, traceResourceCacheHit } from "../src/app/runtime/devtools-activity.ts";
import { registerDevtoolsInstance } from "../src/app/runtime/devtools.ts";
import { createRouteManifest } from "../src/app/runtime/router.ts";
import { createFrameworkHandler } from "../src/server/runtime/framework-render.ts";

test("navigation tracing is inert without DevTools and terminal events are emitted once", () => {
  const browser = { performance: { now: () => 10 } } as Window;
  assert.equal(traceNavigation(browser, "/users/[id]"), undefined);
  traceResourceCacheHit(browser);
  const events: Array<{ kind: string; activity: DevtoolsActivity }> = [];
  installDevtoolsActivitySink(browser, (kind, activity) => events.push({ kind, activity }));
  const trace = traceNavigation(browser, "/users/[id]")!;
  const data = trace.data("server");
  data("ready");
  data("error");
  trace.finish("commit");
  trace.finish("cancel");
  traceResourceCacheHit(browser);
  assert.deepEqual(events.map((event) => [event.kind, event.activity.phase, event.activity.source]), [
    ["navigation", "start", undefined], ["data", "start", "server"], ["data", "ready", "server"], ["navigation", "commit", undefined], ["data", "ready", "cache"],
  ]);
  assert.equal(events[0]!.activity.operationId, events[3]!.activity.operationId);
  assert.equal(events[1]!.activity.operationId, events[2]!.activity.operationId);
  assert.equal(events[3]!.activity.durationMs, 0);
});

test("cache observations retain eviction semantics and never receive resource keys or values", () => {
  const observations: unknown[][] = [];
  const cache = new ResourceCache(1, (...args: unknown[]) => { observations.push(args); });
  cache.set("private-key", { token: "private-value" });
  assert.deepEqual(cache.get("private-key"), { token: "private-value" });
  cache.set("next", 2);
  assert.equal(cache.get("private-key"), undefined);
  assert.equal(cache.get("next"), 2);
  assert.deepEqual(observations, [[], []]);
});

test("the development hook publishes isolated activity snapshots", async () => {
  const browser = new HappyWindow({ url: "https://example.test/" });
  const previous = ["window", "Node"].map((name) => ({ name, exists: Reflect.has(globalThis, name), value: Reflect.get(globalThis, name) }));
  Reflect.set(globalThis, "window", browser);
  Reflect.set(globalThis, "Node", browser.Node);
  let unregister: (() => void) | undefined;
  try {
    const root = browser.document.createElement("main");
    browser.document.body.append(root);
    unregister = registerDevtoolsInstance({ componentId: "fixture", name: "Fixture", file: "/Fixture.meeko", scope: { root: root as unknown as Element }, props: {}, bindings: {} });
    traceNavigation(browser as unknown as Window, "/users/[id]")!.finish("commit");
    const hook = (browser as unknown as Window).__MEEKO_DEVTOOLS__!;
    const event = hook.snapshot().events.find((item) => item.kind === "navigation" && item.activity?.phase === "commit")!;
    assert.equal(event.activity?.route, "/users/[id]");
    event.activity!.route = "/changed";
    assert.equal(hook.snapshot().events.find((item) => item.id === event.id)?.activity?.route, "/users/[id]");
  } finally {
    unregister?.();
    for (const entry of previous) {
      if (entry.exists) Reflect.set(globalThis, entry.name, entry.value);
      else Reflect.deleteProperty(globalThis, entry.name);
    }
    await browser.happyDOM.close();
  }
});

test("client navigation records route patterns, load source, failures and cancellations without URL or data leakage", async () => {
  const page = (name: string): ClientComponent => ({
    renderWithState: () => ({ html: `<p>${name}</p>`, state: {} }),
    renderToString: () => `<p>${name}</p>`,
    hydrateScope: () => () => {},
  });
  const modules: Record<string, ClientComponent> = { "home.meeko": page("Home"), "user.meeko": page("User"), "error.meeko": page("Error") };
  const routes = createRouteManifest([
    { id: "/", file: "home.meeko", layouts: [] },
    { id: "/users/[id]", file: "user.meeko", layouts: [], render: "client", sidecar: "user.route.ts" },
    { id: "/broken", file: "error.meeko", layouts: [], render: "client", sidecar: "broken.route.ts" },
    { id: "/slow", file: "user.meeko", layouts: [], render: "client", sidecar: "slow.route.ts" },
  ]);
  const browser = new HappyWindow({ url: "https://example.test/" });
  const server = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]! });
  browser.document.write(await (await server(new Request("https://example.test/"))).text());
  const events: DevtoolsActivity[] = [];
  installDevtoolsActivitySink(browser as unknown as Window, (_kind, activity) => events.push(activity));
  let releaseSlow!: () => void;
  let markSlowStarted!: () => void;
  const slowStarted = new Promise<void>((resolve) => { markSlowStarted = resolve; });
  const slowResult = new Promise<void>((resolve) => { releaseSlow = resolve; });
  const app = await mountClientApp({
    root: browser.document.getElementById("app")! as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent,
    routes, browser: browser as unknown as Window,
    loadPage: async (file) => modules[file]!,
    loadClientRoute: async (file) => ({ load: async () => {
      if (file === "broken.route.ts") throw new Error("a secret error detail");
      if (file === "slow.route.ts") { markSlowStarted(); await slowResult; }
      return { token: "a secret loader result" };
    } }),
  });
  try {
    assert.equal(await app.navigate("/users/private-user?token=private-query#private-hash"), true);
    assert.deepEqual(events.map((event) => event.phase), ["start", "start", "ready", "commit"]);
    assert.equal(events[1]!.source, "client");
    assert.equal(events[0]!.route, "/users/[id]");
    await assert.rejects(app.navigate("/broken"), /a secret error detail/);
    assert.deepEqual(events.slice(-2).map((event) => event.phase), ["error", "error"]);
    const slow = app.navigate("/slow?token=private-query");
    await slowStarted;
    assert.equal(await app.navigate("/"), true);
    releaseSlow();
    assert.equal(await slow, false);
    assert.deepEqual(events.filter((event) => event.route === "/slow").map((event) => event.phase), ["start", "start", "cancel", "cancel"]);
    const serialized = JSON.stringify(events);
    assert.doesNotMatch(serialized, /private-user|private-query|private-hash|a secret|https:/);
    assert.ok(events.filter((event) => event.phase !== "start").every((event) => Number.isFinite(event.durationMs)));
  } finally { app.dispose(); await browser.happyDOM.close(); }
});
