import assert from "node:assert/strict";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import type { DomScope } from "../src/dom.ts";
import { effect } from "../src/reactivity.ts";
import { mountClientApp } from "../src/framework/client.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { defer } from "../src/framework/deferred.ts";
import type { Deferred } from "../src/framework/deferred.ts";
import { definePage } from "../src/framework/page.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { extractRouteRender } from "../src/framework/routes-discovery.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";
import type { FrameworkHandlerOptions, PageRoute } from "../src/framework/server.ts";
import { StateStore, useState } from "../src/framework/state.ts";
import { ApiError, createRequestContext, MemorySessionStore, SessionManager } from "../src/framework-server.ts";
import type { RequestContext } from "../src/framework-server.ts";

type Slow = { text: string };

function describeDeferred(value: Deferred<Slow> | undefined): string {
  if (!value) return "none";
  if (value.status === "resolved") return value.value!.text;
  if (value.status === "rejected") return `error:${value.error!.code}:${value.error!.status}`;
  return "pending";
}

/** A page that renders `props.data.slow` and keeps `#slow` in sync after hydration. */
function slowPage(observe?: (phase: string, status: string) => void): ClientComponent {
  const render = (props: Record<string, unknown>) => {
    const data = props.data as { title: string; slow?: Deferred<Slow>; fast?: Deferred<Slow> };
    return `<h1>${data.title}</h1><p id="slow">${describeDeferred(data.slow)}</p><p id="fast">${describeDeferred(data.fast)}</p>`;
  };
  return {
    renderWithState: (props) => ({ html: render(props), state: {} }),
    renderToString: render,
    hydrateScope: (scope: DomScope, props) => {
      const data = props.data as { slow?: Deferred<Slow> };
      observe?.("hydrate", describeDeferred(data.slow));
      const target = scope.root.querySelector("#slow")!;
      return effect(() => { target.textContent = describeDeferred(data.slow); });
    },
  };
}

const plainPage: ClientComponent = {
  renderWithState: () => ({ html: `<p id="plain">Plain</p>`, state: {} }),
  renderToString: () => `<p id="plain">Plain</p>`,
  hydrateScope: () => () => {},
};

function later<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function gate<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function handler(sidecar: PageRoute, options: Partial<FrameworkHandlerOptions> = {}, render: "stream" | "ssr" = "stream") {
  const routes = createRouteManifest([
    { id: "/stream", file: "stream.meeko", layouts: [], sidecar: "stream.route.ts", render },
    { id: "/plain", file: "plain.meeko", layouts: [] },
  ]);
  const modules: Record<string, ClientComponent> = { "stream.meeko": slowPage(), "plain.meeko": plainPage };
  return {
    routes,
    modules,
    fetch: createFrameworkHandler({
      routes,
      loadPage: async (file) => modules[file]!,
      loadRoute: async () => ({ render, ...sidecar }),
      clientEntry: "/entry.js",
      ...options,
    }),
  };
}

async function chunks(response: Response): Promise<string[]> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const result: string[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) return result;
    result.push(decoder.decode(value, { stream: true }));
  }
}

function payloadOf(html: string): Record<string, unknown> {
  const json = html.match(/<script id="meeko-payload" type="application\/json">(.*?)<\/script>/)?.[1];
  assert.ok(json, html);
  return JSON.parse(json) as Record<string, unknown>;
}

function deferredChunks(html: string): Array<{ id: string; line: Record<string, unknown> }> {
  return [...html.matchAll(/<script type="application\/json" data-meeko-deferred="(\d+)">(.*?)<\/script>/g)]
    .map((match) => ({ id: match[1]!, line: JSON.parse(match[2]!) as Record<string, unknown> }));
}

test("defer validates its timeout and exposes a pending signal-backed value", () => {
  const value = defer(Promise.resolve(1));
  assert.equal(value.status, "pending");
  assert.equal(value.value, undefined);
  assert.equal(value.error, undefined);
  assert.throws(() => defer(Promise.resolve(1), { timeoutMs: 0 }), RangeError);
  assert.throws(() => defer(Promise.resolve(1), { timeoutMs: Number.NaN }), RangeError);
  // A rejected source is observed by the server, never reported as unhandled.
  defer(Promise.reject(new Error("observed later")));
});

test("render extraction and definePage accept stream", () => {
  assert.equal(extractRouteRender("/p/index.route.ts", 'export const route = definePage({ render: "stream" });\n'), "stream");
  const route = definePage({ render: "stream", load: () => ({ slow: defer(Promise.resolve({ text: "x" })) }) });
  assert.equal(route.render, "stream");
});

test("StateStore.seal rejects new keys, seeds and writes with STATE_SEALED", () => {
  const store = new StateStore({ count: 1 });
  const count = store.get<number>("count", () => 0);
  store.seal();
  assert.equal(store.sealed, true);
  assert.equal(count.value, 1);
  assert.equal(store.get<number>("count", () => 0), count);
  assert.throws(() => { count.value = 2; }, (error: Error & { code?: string }) => error.code === "STATE_SEALED");
  assert.throws(() => store.get("other", () => 0), (error: Error & { code?: string }) => error.code === "STATE_SEALED");
  assert.throws(() => store.seed({ other: 1 }), (error: Error & { code?: string }) => error.code === "STATE_SEALED");
  assert.deepEqual({ ...store.snapshot() }, { count: 1 });
});

test("stream sends the document and payload before deferred chunks, in settle order", async () => {
  const { fetch } = handler({
    load: () => ({ title: "Streamed", slow: defer(later(40, { text: "slow done" })), fast: defer(later(5, { text: "fast done" })) }),
    head: () => ({ title: "Stream page" }),
  });
  const response = await fetch(new Request("https://example.test/stream"));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  const parts = await chunks(response);
  const first = parts[0]!;
  assert.match(first, /<title>Stream page<\/title>/);
  assert.match(first, /<p id="slow">pending<\/p><p id="fast">pending<\/p>/);
  assert.match(first, /<script type="module" async src="\/entry\.js"><\/script>/);
  assert.doesNotMatch(first, /data-meeko-deferred/);
  assert.doesNotMatch(first, /<\/body>/);
  const payload = payloadOf(first);
  assert.equal(payload.render, "stream");
  assert.deepEqual((payload.props as { data: unknown }).data, { title: "Streamed", slow: null, fast: null });
  assert.deepEqual(payload.deferred, [
    { id: 0, path: ["data", "slow"], status: "pending" },
    { id: 1, path: ["data", "fast"], status: "pending" },
  ]);
  const html = parts.join("");
  assert.deepEqual(deferredChunks(html), [
    { id: "1", line: { deferred: 1, value: { text: "fast done" } } },
    { id: "0", line: { deferred: 0, value: { text: "slow done" } } },
  ]);
  assert.ok(html.endsWith("</body></html>"));
  assert.ok(html.indexOf('id="meeko-payload"') < html.indexOf("data-meeko-deferred"));
});

test("ssr and prerender await deferred values inline before rendering", async () => {
  for (const render of ["ssr", "prerender"] as const) {
    const routes = createRouteManifest([{ id: "/inline", file: "inline.meeko", layouts: [], sidecar: "inline.route.ts", render }]);
    const fetch = createFrameworkHandler({
      routes,
      loadPage: async () => slowPage(),
      loadRoute: async () => ({ render, load: () => ({ title: "Inline", slow: defer(later(10, { text: "ready" })), fast: defer(Promise.reject(new ApiError("GONE", 410))) }) }),
    });
    const response = await fetch(new Request("https://example.test/inline"));
    const html = await response.text();
    assert.match(html, /<p id="slow">ready<\/p><p id="fast">error:GONE:410<\/p>/, render);
    assert.doesNotMatch(html, /data-meeko-deferred/);
    assert.deepEqual(payloadOf(html).deferred, [
      { id: 0, path: ["data", "slow"], status: "resolved", value: { text: "ready" } },
      { id: 1, path: ["data", "fast"], status: "rejected", error: { code: "GONE", status: 410 } },
    ]);
    const navigation = await fetch(new Request("https://example.test/inline", { headers: { accept: "application/meeko+json" } }));
    assert.match(navigation.headers.get("content-type") ?? "", /^application\/meeko\+json/);
  }
});

test("deferred rejections are serialized as { code, status } and 5xx failures are reported with the request id", async () => {
  const reported: Array<{ error: unknown; requestId: string }> = [];
  const { fetch } = handler({
    load: () => ({
      title: "Errors",
      slow: defer(Promise.reject(new Error("private database detail"))),
      fast: defer(Promise.reject(new ApiError("NOT_ALLOWED", 403))),
    }),
  }, { onError: (error, requestId) => reported.push({ error, requestId }) });
  const response = await fetch(new Request("https://example.test/stream"));
  const html = (await chunks(response)).join("");
  assert.doesNotMatch(html, /private database detail/);
  const lines = deferredChunks(html).map((chunk) => chunk.line).sort((a, b) => Number(a.deferred) - Number(b.deferred));
  assert.deepEqual(lines, [
    { deferred: 0, error: { code: "INTERNAL_ERROR", status: 500 } },
    { deferred: 1, error: { code: "NOT_ALLOWED", status: 403 } },
  ]);
  assert.equal(reported.length, 1);
  assert.equal((reported[0]!.error as Error).message, "private database detail");
  assert.equal(reported[0]!.requestId, response.headers.get("x-request-id"));
});

test("a deferred value times out with DEFERRED_TIMEOUT 504", async () => {
  const reported: unknown[] = [];
  const { fetch } = handler({
    load: () => ({ title: "Timeout", slow: defer(new Promise<Slow>(() => {}), { timeoutMs: 20 }) }),
  }, { onError: (error) => reported.push(error) });
  const html = (await chunks(await fetch(new Request("https://example.test/stream")))).join("");
  assert.deepEqual(deferredChunks(html).map((chunk) => chunk.line), [{ deferred: 0, error: { code: "DEFERRED_TIMEOUT", status: 504 } }]);
  assert.equal(reported.length, 1);
});

test("state written by a deferred task after the render is sealed fails with STATE_SEALED", async () => {
  const reported: unknown[] = [];
  const { fetch } = handler({
    load: ({ state }) => ({
      title: "Sealed",
      slow: defer(later(5, undefined).then(() => { state.get("late", () => 1); return { text: "never" }; })),
    }),
  }, { onError: (error) => reported.push(error) });
  const html = (await chunks(await fetch(new Request("https://example.test/stream")))).join("");
  assert.deepEqual(deferredChunks(html).map((chunk) => chunk.line), [{ deferred: 0, error: { code: "INTERNAL_ERROR", status: 500 } }]);
  assert.equal((reported[0] as { code?: string }).code, "STATE_SEALED");
});

test("state written during the synchronous render is transferred before sealing", async () => {
  const routes = createRouteManifest([{ id: "/stream", file: "stream.meeko", layouts: [], sidecar: "stream.route.ts", render: "stream" }]);
  const fetch = createFrameworkHandler({
    routes,
    loadPage: async () => ({
      renderWithState: () => { useState("theme", () => "dark"); return { html: "<p>ok</p>", state: {} }; },
    }),
    loadRoute: async () => ({ render: "stream", load: () => ({ slow: defer(later(1, { text: "x" })) }) }),
  });
  const html = (await chunks(await fetch(new Request("https://example.test/stream")))).join("");
  assert.deepEqual(payloadOf(html).sharedState, { theme: "dark" });
});

test("HEAD on a stream route sends final headers without a body and aborts deferred work", async () => {
  const reported: unknown[] = [];
  const { fetch } = handler({
    load: () => ({ title: "Head", slow: defer(new Promise<Slow>(() => {})) }),
  }, { onError: (error) => reported.push(error) });
  const response = await fetch(new Request("https://example.test/stream", { method: "HEAD" }));
  assert.equal(response.status, 200);
  assert.equal(response.body, null);
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  assert.equal(response.headers.get("cache-control"), "no-store");
  await later(10, undefined);
  assert.deepEqual(reported, []);
});

async function sessionHandler(sidecar: (sessions: SessionManager<unknown>) => PageRoute, onError?: (error: unknown) => void) {
  const store = new MemorySessionStore();
  const sessions = new SessionManager({ store, secure: false });
  const record = await (await sessions.load(new Request("https://example.test/"))).create({ user: "alice" });
  const cookie = `${sessions.cookieName}=${record.id}`;
  const { fetch } = handler(sidecar(sessions), {
    createContext: async (request): Promise<RequestContext> => createRequestContext(request, {}, await sessions.load(request)),
    ...(onError ? { onError } : {}),
  });
  return { fetch, cookie, record, sessions };
}

test("a session revoked before the first byte answers 401 instead of streaming", async () => {
  const { fetch, cookie } = await sessionHandler((sessions) => ({
    load: async ({ context }: { context?: RequestContext }) => {
      // Another device signs out while this loader runs.
      await sessions.store.revokeFamily!(context!.session.current!.familyId ?? context!.session.current!.id);
      return { title: "Private", slow: defer(later(1, { text: "secret" })) };
    },
  } as PageRoute));
  const response = await fetch(new Request("https://example.test/stream", { headers: { cookie } }));
  assert.equal(response.status, 401);
  const body = await response.text();
  assert.doesNotMatch(body, /Private|secret|meeko-payload/);
});

test("cookies cannot change after the first chunk: a late session write fails its deferred value", async () => {
  const reported: unknown[] = [];
  const { fetch, cookie } = await sessionHandler(() => ({
    load: ({ context }: { context?: RequestContext }) => ({
      title: "Cookies",
      slow: defer(later(5, undefined).then(async () => { await context!.session.rotate(); return { text: "rotated" }; })),
    }),
  } as PageRoute), (error) => reported.push(error));
  const response = await fetch(new Request("https://example.test/stream", { headers: { cookie } }));
  assert.equal(response.headers.get("set-cookie"), null);
  const html = (await chunks(response)).join("");
  assert.deepEqual(deferredChunks(html).map((chunk) => chunk.line), [{ deferred: 0, error: { code: "INTERNAL_ERROR", status: 500 } }]);
  assert.match(String((reported[0] as Error).message), /after the response headers/);
});

test("navigation to a stream route answers application/meeko+ndjson, payload first", async () => {
  const { fetch } = handler({
    load: () => ({ title: "Lines", slow: defer(later(20, { text: "line done" })), fast: defer(Promise.reject(new ApiError("NOPE", 404))) }),
  });
  const response = await fetch(new Request("https://example.test/stream", { headers: { accept: "application/meeko+json" } }));
  assert.equal(response.headers.get("content-type"), "application/meeko+ndjson; charset=utf-8");
  assert.equal(response.headers.get("x-accel-buffering"), "no");
  const lines = (await response.text()).split("\n");
  assert.equal(lines.at(-1), "");
  const payload = JSON.parse(lines[0]!) as Record<string, unknown>;
  assert.equal(payload.render, "stream");
  assert.deepEqual(payload.deferred, [
    { id: 0, path: ["data", "slow"], status: "pending" },
    { id: 1, path: ["data", "fast"], status: "pending" },
  ]);
  assert.deepEqual(lines.slice(1, -1).map((line) => JSON.parse(line)), [
    { deferred: 1, error: { code: "NOPE", status: 404 } },
    { deferred: 0, value: { text: "line done" } },
  ]);
});

test("the CSP nonce reaches the async entry of a stream document", async () => {
  const { fetch } = handler({ load: () => ({ title: "Nonce", slow: defer(later(1, { text: "x" })) }) }, { document: { nonce: () => "abc123" } });
  const html = (await chunks(await fetch(new Request("https://example.test/stream")))).join("");
  assert.match(html, /<script type="module" async nonce="abc123" src="\/entry\.js"><\/script>/);
});

async function bootStream(url: string, html: string, options: { observe?: (phase: string, status: string) => void; loading?: boolean } = {}) {
  const browser = new HappyWindow({ url });
  if (options.loading) Object.defineProperty(browser.document, "readyState", { configurable: true, get: () => "loading" });
  browser.document.write(html);
  const routes = createRouteManifest([
    { id: "/stream", file: "stream.meeko", layouts: [], sidecar: "stream.route.ts", render: "stream" },
    { id: "/plain", file: "plain.meeko", layouts: [] },
  ]);
  const modules: Record<string, ClientComponent> = { "stream.meeko": slowPage(options.observe), "plain.meeko": plainPage };
  return { browser, routes, modules };
}

test("a deferred chunk that arrives before hydration is applied after hydrateScope", async () => {
  const { fetch } = handler({ load: () => ({ title: "Early", slow: defer(later(1, { text: "early value" })) }) });
  const html = (await chunks(await fetch(new Request("https://example.test/stream")))).join("");
  // The whole response, chunk included, is in the DOM before the entry runs.
  const phases: string[] = [];
  const { browser, routes, modules } = await bootStream("https://example.test/stream", html, { observe: (phase, status) => phases.push(`${phase}:${status}`) });
  const app = await mountClientApp({
    routes, root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => { await later(5, undefined); return modules[file]!; },
    browser: browser as unknown as Window,
  });
  assert.deepEqual(phases, ["hydrate:pending"]);
  assert.equal(browser.document.getElementById("slow")!.textContent, "early value");
  app.dispose();
});

test("chunks streamed after boot are discovered by the body observer", async () => {
  let release!: (value: Slow) => void;
  const pending = new Promise<Slow>((resolve) => { release = resolve; });
  const { fetch } = handler({ load: () => ({ title: "Late", slow: defer(pending) }) });
  const response = await fetch(new Request("https://example.test/stream"));
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const first = decoder.decode((await reader.read()).value!);
  const { browser, routes, modules } = await bootStream("https://example.test/stream", first, { loading: true });
  const errors: unknown[] = [];
  const app = await mountClientApp({
    routes, root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    browser: browser as unknown as Window,
    onNavigationError: (error) => errors.push(error),
  });
  assert.equal(browser.document.getElementById("slow")!.textContent, "pending");
  release({ text: "late value" });
  let rest = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    rest += decoder.decode(value, { stream: true });
  }
  const chunk = rest.match(/<script type="application\/json" data-meeko-deferred="0">(.*?)<\/script>/)!;
  const script = browser.document.createElement("script");
  script.setAttribute("type", "application/json");
  script.setAttribute("data-meeko-deferred", "0");
  // The parser may insert the element before its text arrives.
  browser.document.body.append(script);
  await later(0, undefined);
  assert.equal(browser.document.getElementById("slow")!.textContent, "pending");
  script.textContent = chunk[1]!;
  await later(0, undefined);
  assert.equal(browser.document.getElementById("slow")!.textContent, "late value");
  assert.deepEqual(errors, []);
  app.dispose();
});

test("a document that ends without a chunk rejects its pending values as DEFERRED_INCOMPLETE", async () => {
  const { fetch } = handler({ load: () => ({ title: "Cut", slow: defer(later(50, { text: "never sent" })) }) });
  const response = await fetch(new Request("https://example.test/stream"));
  const reader = response.body!.getReader();
  const first = new TextDecoder().decode((await reader.read()).value!);
  await reader.cancel();
  const { browser, routes, modules } = await bootStream("https://example.test/stream", first);
  const app = await mountClientApp({
    routes, root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    browser: browser as unknown as Window,
  });
  assert.equal(browser.document.getElementById("slow")!.textContent, "error:DEFERRED_INCOMPLETE:502");
  app.dispose();
});

test("client navigation to a stream route commits on the payload line and resolves the rest as lines arrive", async () => {
  const slow = gate<Slow>();
  const { fetch, routes, modules } = handler({ load: () => ({ title: "Navigated", slow: defer(slow.promise) }) });
  const browser = new HappyWindow({ url: "https://example.test/plain" });
  browser.document.write(await (await fetch(new Request("https://example.test/plain"))).text());
  const requests: string[] = [];
  const app = await mountClientApp({
    routes, root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    serverData: true,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      requests.push(request.headers.get("accept") ?? "");
      return fetch(request);
    }) as typeof globalThis.fetch,
    browser: browser as unknown as Window,
  });
  assert.equal(await app.navigate("https://example.test/stream"), true);
  assert.deepEqual(requests, ["application/meeko+json"]);
  assert.equal(browser.document.querySelector("h1")!.textContent, "Navigated");
  assert.equal(browser.document.getElementById("slow")!.textContent, "pending");
  slow.resolve({ text: "arrived" });
  for (let attempt = 0; attempt < 50 && browser.document.getElementById("slow")!.textContent === "pending"; attempt++) await later(2, undefined);
  assert.equal(browser.document.getElementById("slow")!.textContent, "arrived");
  app.dispose();
});

test("leaving a stream route cancels the pending ndjson read", async () => {
  const slow = gate<Slow>();
  let cancelled = false;
  const { fetch, routes, modules } = handler({ load: () => ({ title: "Leaving", slow: defer(slow.promise) }) });
  const browser = new HappyWindow({ url: "https://example.test/plain" });
  browser.document.write(await (await fetch(new Request("https://example.test/plain"))).text());
  const app = await mountClientApp({
    routes, root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    serverData: true,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetch(new Request(input, init));
      if (!response.headers.get("content-type")?.includes("ndjson")) return response;
      const reader = response.body!.getReader();
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const { done, value } = await reader.read();
          if (done) controller.close(); else controller.enqueue(value);
        },
        cancel(reason) { cancelled = true; return reader.cancel(reason); },
      });
      return new Response(body, { headers: response.headers });
    }) as typeof globalThis.fetch,
    browser: browser as unknown as Window,
  });
  await app.navigate("https://example.test/stream");
  await app.navigate("https://example.test/plain");
  for (let attempt = 0; attempt < 50 && !cancelled; attempt++) await later(2, undefined);
  assert.equal(cancelled, true);
  slow.resolve({ text: "ignored" });
  app.dispose();
});
