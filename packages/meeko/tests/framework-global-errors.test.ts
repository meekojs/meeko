import assert from "node:assert/strict";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import { provideErrorHandler } from "../src/component-errors.ts";
import type { ErrorSource } from "../src/component-errors.ts";
import { mountClientApp } from "../src/framework/client.ts";
import type { ClientApp, ClientAppOptions, ClientComponent } from "../src/framework/client.ts";
import { ClientError, isClientError } from "../src/framework/clients.ts";
import { definePlugin } from "../src/framework/plugin.ts";
import type { PluginErrorInfo } from "../src/framework/plugin.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";

const page = (id: string, fail = false): ClientComponent => ({
  renderWithState: () => {
    if (fail) throw new Error("render failed");
    return { html: `<p id="${id}">${id}</p>`, state: {} };
  },
  renderToString: () => `<p id="${id}">${id}</p>`,
  hydrateScope: () => () => {},
});

const modules: Record<string, ClientComponent> = {
  "home.meeko": page("home"),
  "broken.meeko": page("broken", true),
  "error.meeko": page("error"),
};
const routes = createRouteManifest([
  { id: "/", file: "home.meeko", layouts: [] },
  { id: "/broken", file: "broken.meeko", layouts: [], error: "error.meeko" },
]);

/** An SSR document of `/` in a fresh window, ready to mount. */
async function browserWindow(): Promise<HappyWindow> {
  const handler = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]!, clientEntry: "/client.js" });
  const browser = new HappyWindow({ url: "https://example.test/" });
  browser.document.write(await (await handler(new Request("https://example.test/", { headers: { accept: "text/html" } }))).text());
  return browser;
}

function mount(browser: HappyWindow, options: Partial<ClientAppOptions> = {}): Promise<ClientApp> {
  return mountClientApp({
    routes,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    browser: browser as unknown as Window,
    ...options,
  });
}

/** Dispatches what a browser dispatches for an uncaught exception; returns whether it was prevented. */
function uncaught(browser: HappyWindow, error: unknown, init: { message?: string; filename?: string } = {}): boolean {
  // A browser can report any thrown value (or null) as `error`; happy-dom types it as Error.
  const event = new browser.ErrorEvent("error", { cancelable: true, error: error as Error, message: init.message ?? (error instanceof Error ? error.message : String(error)), filename: init.filename ?? "https://example.test/app.js" });
  browser.dispatchEvent(event);
  return event.defaultPrevented;
}

/** Dispatches what a browser dispatches for an unhandled rejection; returns whether it was prevented. */
function rejection(browser: HappyWindow, reason: unknown): boolean {
  const event = Object.assign(new browser.Event("unhandledrejection", { cancelable: true }), { reason, promise: Promise.resolve() });
  browser.dispatchEvent(event);
  return event.defaultPrevented;
}

test("uncaught exceptions and unhandled rejections of the page reach onError and plugin observers", async () => {
  const browser = await browserWindow();
  const observed: Array<[unknown, ErrorSource]> = [];
  const plugin: Array<[unknown, PluginErrorInfo]> = [];
  const app = await mount(browser, {
    onError: (error, source) => { observed.push([error, source]); },
    plugins: [{ plugin: definePlugin((setup) => { setup.onError((error, info) => { plugin.push([error, info]); }); }) }],
  });
  const thrown = new Error("timer failure");
  const reason = new Error("fetch failure");
  // A delivered failure is prevented, so the browser does not log it a second time.
  assert.equal(uncaught(browser, thrown), true);
  assert.equal(rejection(browser, reason), true);
  // A rejection with a primitive reason is delivered as is.
  assert.equal(rejection(browser, "plain reason"), true);
  assert.deepEqual(observed, [[thrown, "uncaught"], [reason, "rejection"], ["plain reason", "rejection"]]);
  assert.deepEqual(plugin, [
    [thrown, { side: "client", source: "uncaught" }],
    [reason, { side: "client", source: "rejection" }],
    ["plain reason", { side: "client", source: "rejection" }],
  ]);
  // A real exception of a timer in the window goes the same way.
  const fromTimer = new Error("happy-dom timer");
  const originalError = console.error;
  console.error = () => {};
  try {
    browser.setTimeout(() => { throw fromTimer; }, 0);
    await new Promise((done) => setTimeout(done, 20));
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(observed.at(-1), [fromTimer, "uncaught"]);
  app.dispose();
  browser.happyDOM.abort();
});

test("a failure Meeko already reported is not reported again when it escapes to window", async () => {
  const browser = await browserWindow();
  const observed: Array<[unknown, ErrorSource]> = [];
  const app = await mount(browser, { onError: (error, source) => { observed.push([error, source]); } });
  // A failed click navigation reaches onError with "navigation".
  const link = browser.document.createElement("a");
  link.href = "/broken";
  browser.document.body.append(link);
  link.click();
  await new Promise((done) => setTimeout(done, 50));
  assert.equal(observed.length, 1);
  const [reported, source] = observed[0]!;
  assert.equal(source, "navigation");
  // The same error thrown again (or left rejected) by the app is the browser's duplicate: it is
  // prevented without a second report.
  assert.equal(uncaught(browser, reported), true);
  assert.equal(rejection(browser, reported), true);
  assert.equal(observed.length, 1);
  app.dispose();
  browser.happyDOM.abort();
});

test("without an observer, for opaque cross-origin errors and for prevented events the browser keeps its report", async () => {
  const browser = await browserWindow();
  const bare = await mount(browser);
  // No onError, no plugin observer and no provideErrorHandler: nothing changes.
  assert.equal(uncaught(browser, new Error("unobserved")), false);
  assert.equal(rejection(browser, new Error("unobserved")), false);
  bare.dispose();

  const second = await browserWindow();
  const observed: unknown[] = [];
  const app = await mount(second, { onError: (error) => { observed.push(error); } });
  // A script of another origin without CORS: no error, file or message to report.
  assert.equal(uncaught(second, null, { message: "Script error.", filename: "" }), false);
  // Another listener already handled the event.
  const handled = (event: { preventDefault(): void }): void => { event.preventDefault(); };
  second.addEventListener("error", handled, { capture: true });
  assert.equal(uncaught(second, new Error("handled by the app")), true);
  second.removeEventListener("error", handled);
  assert.equal(observed.length, 0);
  // An event without an error object but with a real message is reported with that message.
  assert.equal(uncaught(second, null, { message: "Uncaught SyntaxError: bad" }), true);
  assert.equal((observed[0] as Error).message, "Uncaught SyntaxError: bad");
  app.dispose();
  browser.happyDOM.abort();
  second.happyDOM.abort();
});

test("without onError, the first active provideErrorHandler receives them, as with navigation", async () => {
  const browser = await browserWindow();
  const observed: Array<[unknown, ErrorSource]> = [];
  const app = await mountClientApp({
    routes,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => file === "home.meeko"
      ? { ...modules[file]!, hydrateScope: () => { provideErrorHandler((error, source) => { observed.push([error, source]); }); return () => {}; } }
      : modules[file]!,
    browser: browser as unknown as Window,
  });
  const failure = new Error("library failure");
  assert.equal(rejection(browser, failure), true);
  assert.deepEqual(observed, [[failure, "rejection"]]);
  app.dispose();
  // The provider left with its root.
  assert.equal(rejection(browser, new Error("after dispose")), false);
  browser.happyDOM.abort();
});

test("an observer that throws is logged with the original error and never escapes", async () => {
  const browser = await browserWindow();
  const app = await mount(browser, { onError: () => { throw new Error("observer failed"); } });
  const logged: unknown[][] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    const failure = new Error("original");
    assert.equal(uncaught(browser, failure), true);
    assert.equal(logged.length, 1);
    assert.equal(logged[0]![0], "Meeko application error observer failed");
    assert.equal((logged[0]![1] as Error).message, "observer failed");
    assert.equal(logged[0]![2], failure);
  } finally {
    console.error = original;
  }
  app.dispose();
  browser.happyDOM.abort();
});

test("dispose removes the listeners and a mounted-again app registers them once", async () => {
  const browser = await browserWindow();
  const observed: unknown[] = [];
  const first = await mount(browser, { onError: (error) => { observed.push(["first", error]); } });
  first.dispose();
  assert.equal(uncaught(browser, new Error("after dispose")), false);
  assert.equal(observed.length, 0);
  // As after a full reload of the entry: a new app, a single delivery.
  const fresh = await browserWindow();
  const second = await mount(fresh, { onError: (error) => { observed.push(["second", error]); } });
  const failure = new Error("once");
  assert.equal(uncaught(fresh, failure), true);
  assert.deepEqual(observed, [["second", failure]]);
  second.dispose();
  assert.equal(uncaught(fresh, new Error("gone")), false);
  assert.equal(observed.length, 1);
  browser.happyDOM.abort();
  fresh.happyDOM.abort();
});

test("a failed hydration removes the global listeners it added", async () => {
  const browser = await browserWindow();
  const observed: unknown[] = [];
  await assert.rejects(mount(browser, {
    onError: (error) => { observed.push(error); },
    loadPage: async () => { throw new Error("chunk failed"); },
  }), /chunk failed/);
  assert.equal(uncaught(browser, new Error("after a failed mount")), false);
  assert.equal(observed.length, 0);
  browser.happyDOM.abort();
});

test("isClientError narrows a ClientError by code, also one from another copy of Meeko", () => {
  const error: unknown = new ClientError("UNAUTHENTICATED", 401, "f3c1b2a0-0000-4000-8000-000000000000");
  assert.equal(isClientError(error), true);
  assert.equal(isClientError(error, "UNAUTHENTICATED"), true);
  assert.equal(isClientError(error, "NOT_FOUND"), false);
  if (isClientError(error, "UNAUTHENTICATED")) {
    const code: "UNAUTHENTICATED" = error.code;
    assert.equal(code, "UNAUTHENTICATED");
    assert.equal(error.status, 401);
  }
  assert.equal(isClientError(new Error("UNAUTHENTICATED")), false);
  assert.equal(isClientError({ code: "UNAUTHENTICATED", status: 401 }), false);
  assert.equal(isClientError(null), false);
  // The brand of another copy: same Symbol.for key, another class.
  const foreign = Object.assign(Object.create({ [Symbol.for("meeko.client-error")]: true }) as object, { code: "NOT_FOUND", status: 404 });
  assert.equal(isClientError(foreign, "NOT_FOUND"), true);
});
