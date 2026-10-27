import assert from "node:assert/strict";
import test from "node:test";
import { Window as HappyWindow } from "happy-dom";
import type { DomScope } from "../src/dom.ts";
import { effect } from "../src/reactivity.ts";
import { mountClientApp } from "../src/framework/client.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { defer } from "../src/framework/deferred.ts";
import type { Deferred } from "../src/framework/deferred.ts";
import { definePage, PAYLOAD_VERSION } from "../src/framework/page.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { extractRouteRender } from "../src/framework/routes-discovery.ts";
import { createFrameworkHandler } from "../src/framework/server.ts";
import type { FrameworkHandlerOptions, PageRequestContext, PageRoute } from "../src/framework/server.ts";
import { StateStore, useState } from "../src/framework/state.ts";
import { ApiError, createRequestContext, MemorySessionStore, SessionManager } from "../src/framework-server.ts";
import type { RequestContext, SessionRecord } from "../src/framework-server.ts";

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
      const data = props.data as { slow?: Deferred<Slow>; fast?: Deferred<Slow> };
      observe?.("hydrate", describeDeferred(data.slow));
      const target = scope.root.querySelector("#slow")!;
      const fast = scope.root.querySelector("#fast")!;
      return effect(() => {
        target.textContent = describeDeferred(data.slow);
        fast.textContent = describeDeferred(data.fast);
      });
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
  assert.equal(response.headers.get("cache-control"), "no-store, no-transform");
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
    // A prerendered page cannot store a failure: only ssr renders the rejection inline.
    const rejected = render === "ssr";
    const fetch = createFrameworkHandler({
      routes,
      loadPage: async () => slowPage(),
      loadRoute: async () => ({ render, load: () => ({
        title: "Inline", slow: defer(later(10, { text: "ready" })),
        fast: rejected ? defer(Promise.reject(new ApiError("GONE", 410))) : defer(later(1, { text: "quick" })),
      }) }),
    });
    const response = await fetch(new Request("https://example.test/inline"));
    const html = await response.text();
    assert.match(html, new RegExp(`<p id="slow">ready</p><p id="fast">${rejected ? "error:GONE:410" : "quick"}</p>`), render);
    assert.doesNotMatch(html, /data-meeko-deferred/);
    assert.deepEqual(payloadOf(html).deferred, [
      { id: 0, path: ["data", "slow"], status: "resolved", value: { text: "ready" } },
      rejected
        ? { id: 1, path: ["data", "fast"], status: "rejected", error: { code: "GONE", status: 410 } }
        : { id: 1, path: ["data", "fast"], status: "resolved", value: { text: "quick" } },
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
  assert.equal(response.headers.get("cache-control"), "no-store, no-transform");
  await later(10, undefined);
  assert.deepEqual(reported, []);
});

async function sessionHandler(sidecar: (sessions: SessionManager<unknown>) => PageRoute, onError?: (error: unknown) => void, store = new MemorySessionStore()) {
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

test("a session change inside a deferred value after the first byte fails only that value and keeps the stored session", async () => {
  for (const change of ["rotate", "revoke", "create"] as const) {
    const reported: unknown[] = [];
    const { fetch, cookie, record, sessions } = await sessionHandler(() => ({
      load: ({ context }: { context?: RequestContext }) => ({
        title: "Cookies",
        slow: defer(later(5, undefined).then(async () => {
          const session = context!.session;
          if (change === "rotate") await session.rotate();
          else if (change === "revoke") await session.revoke();
          else await session.create({ user: "mallory" });
          return { text: "changed" };
        })),
        fast: defer(later(25, { text: "unrelated" })),
      }),
    } as PageRoute), (error) => reported.push(error));
    const response = await fetch(new Request("https://example.test/stream", { headers: { cookie } }));
    assert.equal(response.headers.get("set-cookie"), null, change);
    const html = (await chunks(response)).join("");
    const lines = deferredChunks(html).map((chunk) => chunk.line).sort((a, b) => Number(a.deferred) - Number(b.deferred));
    assert.deepEqual(lines, [
      { deferred: 0, error: { code: "SESSION_LOCKED", status: 500 } },
      { deferred: 1, value: { text: "unrelated" } },
    ], change);
    // The browser keeps its cookie, so the stored session must survive.
    assert.equal((await sessions.store.get(record.id))?.id, record.id, change);
    assert.equal((reported[0] as { code?: string }).code, "SESSION_LOCKED", change);
  }
});

test("a session rotation started before the first byte is awaited and its cookie is sent", async () => {
  class SlowReplaceStore extends MemorySessionStore {
    override async replace(previousId: string, next: SessionRecord): Promise<boolean> {
      await later(20, undefined);
      return super.replace(previousId, next);
    }
  }
  const { fetch, cookie, record, sessions } = await sessionHandler(() => ({
    load: ({ context }: { context?: RequestContext }) => ({
      title: "Race",
      // The rotation is still writing the store when the page is ready to stream.
      slow: defer(context!.session.rotate().then((rotated) => ({ text: rotated.id }))),
    }),
  } as PageRoute), undefined, new SlowReplaceStore());
  const response = await fetch(new Request("https://example.test/stream", { headers: { cookie } }));
  assert.equal(response.status, 200);
  const html = (await chunks(response)).join("");
  const [line] = deferredChunks(html).map((chunk) => chunk.line);
  const rotatedId = (line!.value as Slow | undefined)?.text;
  assert.ok(rotatedId, JSON.stringify(line));
  assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`${sessions.cookieName}=${rotatedId};`));
  assert.equal(await sessions.store.get(record.id), undefined);
  assert.equal((await sessions.store.get(rotatedId))?.id, rotatedId);
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

async function until(check: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100 && !check(); attempt++) await later(2, undefined);
}

test("an ndjson stream that fails mid-way applies valid lines, reports bad ones and ends the rest as DEFERRED_INCOMPLETE", async () => {
  const slow = gate<Slow>();
  const fast = gate<Slow>();
  const { fetch, routes, modules } = handler({ load: () => ({ title: "Broken", slow: defer(slow.promise), fast: defer(fast.promise) }) });
  const browser = new HappyWindow({ url: "https://example.test/plain" });
  browser.document.write(await (await fetch(new Request("https://example.test/plain"))).text());
  const errors: unknown[] = [];
  const app = await mountClientApp({
    routes, root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    serverData: true,
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await fetch(new Request(input, init));
      if (!response.headers.get("content-type")?.includes("ndjson")) return response;
      const reader = response.body!.getReader();
      const payloadLine = new TextDecoder().decode((await reader.read()).value!);
      await reader.cancel();
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`${payloadLine}{broken\n{"deferred":1,"value":{"text":"fast line"}}\n`));
          setTimeout(() => controller.error(new Error("network lost")), 5);
        },
      });
      return new Response(body, { headers: response.headers });
    }) as typeof globalThis.fetch,
    browser: browser as unknown as Window,
    onNavigationError: (error) => errors.push(error),
  });
  assert.equal(await app.navigate("https://example.test/stream"), true);
  await until(() => browser.document.getElementById("slow")!.textContent !== "pending");
  assert.equal(browser.document.getElementById("fast")!.textContent, "fast line");
  assert.equal(browser.document.getElementById("slow")!.textContent, "error:DEFERRED_INCOMPLETE:502");
  assert.ok(errors.some((error) => error instanceof SyntaxError), String(errors));
  assert.ok(errors.some((error) => (error as Error).message === "network lost"), String(errors));
  app.dispose();
});

test("head runs after the render, sees its state and cannot change what was rendered", async () => {
  for (const render of ["ssr", "stream"] as const) {
    const routes = createRouteManifest([{ id: "/head", file: "head.meeko", layouts: [], sidecar: "head.route.ts", render }]);
    const fetch = createFrameworkHandler({
      routes,
      loadPage: async () => ({
        renderWithState: () => {
          useState("user", () => "alice");
          const theme = useState("theme", () => "from-render");
          return { html: `<p id="theme">${theme.value}</p>`, state: {} };
        },
      }),
      loadRoute: async () => ({
        render,
        load: () => ({ slow: defer(later(1, { text: "x" })) }),
        head: ({ state }: PageRequestContext) => {
          state.get("theme", () => "from-head");
          return { title: String(state.get("user", () => "nobody").value) };
        },
      }),
    });
    const html = (await chunks(await fetch(new Request("https://example.test/head")))).join("");
    assert.match(html, /<title>alice<\/title>/, render);
    assert.match(html, /<p id="theme">from-render<\/p>/, render);
    assert.deepEqual(payloadOf(html).sharedState, { user: "alice", theme: "from-render" }, render);
  }
});

test("a prerendered route with a rejected deferred value fails instead of storing the error", async () => {
  const reported: unknown[] = [];
  const routes = createRouteManifest([{ id: "/inline", file: "inline.meeko", layouts: [], sidecar: "inline.route.ts", render: "prerender" }]);
  const fetch = createFrameworkHandler({
    routes,
    loadPage: async () => slowPage(),
    loadRoute: async () => ({ render: "prerender", load: () => ({ title: "Inline", slow: defer(later(1, { text: "ready" })), fast: defer(Promise.reject(new ApiError("GONE", 410))) }) }),
    onError: (error) => reported.push(error),
  });
  const response = await fetch(new Request("https://example.test/inline"));
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /meeko-payload/);
  assert.match(String((reported[0] as Error).message), /\/inline.*data\.fast.*GONE/);
});

test("a deferred factory receives a signal that aborts when the client disconnects, without onError", async () => {
  const reported: unknown[] = [];
  let aborted: unknown;
  let loaderSignal: AbortSignal | undefined;
  const { fetch } = handler({
    load: ({ signal }) => {
      loaderSignal = signal;
      return {
        title: "Gone",
        slow: defer((work: AbortSignal) => new Promise<Slow>((_, reject) => {
          work.addEventListener("abort", () => { aborted = work.reason; reject(work.reason); }, { once: true });
        })),
      };
    },
  }, { onError: (error) => reported.push(error) });
  const response = await fetch(new Request("https://example.test/stream"));
  const reader = response.body!.getReader();
  await reader.read();
  await reader.cancel(new Error("client left"));
  await until(() => aborted !== undefined);
  assert.equal((aborted as Error | undefined)?.message, "client left");
  assert.equal(loaderSignal?.aborted, true);
  await later(5, undefined);
  assert.deepEqual(reported, []);
});

test("a deferred factory's signal aborts with DEFERRED_TIMEOUT when its time runs out", async () => {
  let aborted: unknown;
  const { fetch } = handler({
    load: () => ({
      title: "Slow",
      slow: defer((work: AbortSignal) => new Promise<Slow>(() => {
        work.addEventListener("abort", () => { aborted = work.reason; }, { once: true });
      }), { timeoutMs: 20 }),
    }),
  });
  const html = (await chunks(await fetch(new Request("https://example.test/stream")))).join("");
  assert.deepEqual(deferredChunks(html).map((chunk) => chunk.line), [{ deferred: 0, error: { code: "DEFERRED_TIMEOUT", status: 504 } }]);
  assert.equal((aborted as { code?: string } | undefined)?.code, "DEFERRED_TIMEOUT");
});

test("a HEAD request aborts the loader signal and deferred factories", async () => {
  let aborted = false;
  let loaderSignal: AbortSignal | undefined;
  const { fetch } = handler({
    load: ({ signal }) => {
      loaderSignal = signal;
      return { title: "Head", slow: defer((work: AbortSignal) => new Promise<Slow>(() => { work.addEventListener("abort", () => { aborted = true; }); })) };
    },
  });
  const response = await fetch(new Request("https://example.test/stream", { method: "HEAD" }));
  assert.equal(response.body, null);
  await until(() => aborted);
  assert.equal(aborted, true);
  assert.equal(loaderSignal?.aborted, true);
});

test("the payload format is version 2 and a version 1 payload is refused", async () => {
  assert.equal(PAYLOAD_VERSION, 2);
  const { fetch, routes, modules } = handler({ load: () => ({ title: "V", slow: defer(later(1, { text: "x" })) }) });
  const html = (await chunks(await fetch(new Request("https://example.test/stream")))).join("");
  assert.equal(payloadOf(html).v, 2);
  const browser = new HappyWindow({ url: "https://example.test/plain" });
  await assert.rejects(mountClientApp({
    routes, root: browser.document.body as unknown as Element,
    payload: { v: 1, route: "/plain", props: { params: {}, search: {} }, state: {} },
    loadPage: async (file) => modules[file]!,
    browser: browser as unknown as Window,
  }), /Unsupported Meeko payload version 1/);
});

test("deferred values under constructor or prototype keys hydrate", async () => {
  for (const slug of ["prototype", "constructor"]) {
    const routes = createRouteManifest([{ id: "/posts/[slug]", file: "post.meeko", layouts: [], sidecar: "post.route.ts", render: "stream" }]);
    const describe = (props: Record<string, unknown>): string => {
      const posts = (props.data as { posts: Record<string, Deferred<Slow>> }).posts;
      const key = (props.params as { slug: string }).slug;
      return describeDeferred(Object.hasOwn(posts, key) ? posts[key] : undefined);
    };
    const page: ClientComponent = {
      renderWithState: (props) => ({ html: `<p id="slow">${describe(props)}</p>`, state: {} }),
      renderToString: (props) => `<p id="slow">${describe(props)}</p>`,
      hydrateScope: (scope, props) => {
        const target = scope.root.querySelector("#slow")!;
        return effect(() => { target.textContent = describe(props); });
      },
    };
    const fetch = createFrameworkHandler({
      routes,
      loadPage: async () => page,
      loadRoute: async () => ({ render: "stream", load: ({ params }: PageRequestContext) => ({ posts: { [String(params.slug)]: defer(later(1, { text: `keyed ${String(params.slug)}` })) } }) }),
    });
    const html = (await chunks(await fetch(new Request(`https://example.test/posts/${slug}`)))).join("");
    assert.deepEqual(payloadOf(html).deferred, [{ id: 0, path: ["data", "posts", slug], status: "pending" }]);
    const browser = new HappyWindow({ url: `https://example.test/posts/${slug}` });
    browser.document.write(html);
    const app = await mountClientApp({
      routes, root: browser.document.getElementById("app") as unknown as Element,
      payload: browser.document.getElementById("meeko-payload")!.textContent!,
      loadPage: async () => page,
      browser: browser as unknown as Window,
    });
    assert.equal(browser.document.getElementById("slow")!.textContent, `keyed ${slug}`);
    app.dispose();
  }
});

test("a deferred value under a __proto__ key fails the render with 500", async () => {
  const reported: unknown[] = [];
  const { fetch } = handler({
    load: () => {
      const data: Record<string, unknown> = { title: "Proto" };
      Object.defineProperty(data, "__proto__", { value: { slow: defer(later(1, { text: "x" })) }, enumerable: true, writable: true, configurable: true });
      return data;
    },
  }, { onError: (error) => reported.push(error) });
  const response = await fetch(new Request("https://example.test/stream"));
  assert.equal(response.status, 500);
  assert.doesNotMatch(await response.text(), /meeko-payload/);
  assert.match(String((reported[0] as Error).message), /__proto__/);
});

test("deferred blocks outside <body> after the payload are ignored, also when added later", async () => {
  const { fetch } = handler({ load: () => ({ title: "Spoof", slow: defer(later(1, { text: "real" })) }) });
  const html = (await chunks(await fetch(new Request("https://example.test/stream")))).join("");
  const spoof = (id: number) => `<script type="application/json" data-meeko-deferred="${id}">{"deferred":${id},"value":{"text":"spoofed"}}</script>`;
  // User content rendered inside #app may contain a forged block before the real one.
  const forged = html.replace('<div id="app">', `<div id="app">${spoof(0)}`);
  const { browser, routes, modules } = await bootStream("https://example.test/stream", forged);
  const errors: unknown[] = [];
  const app = await mountClientApp({
    routes, root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    browser: browser as unknown as Window,
    onNavigationError: (error) => errors.push(error),
  });
  assert.equal(browser.document.getElementById("slow")!.textContent, "real");
  app.dispose();

  // While the document is still loading, a forged block added inside #app is not read either.
  const slow = gate<Slow>();
  const fast = gate<Slow>();
  const live = handler({ load: () => ({ title: "Spoof", slow: defer(slow.promise), fast: defer(fast.promise) }) });
  const response = await live.fetch(new Request("https://example.test/stream"));
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const first = decoder.decode((await reader.read()).value!);
  const loading = await bootStream("https://example.test/stream", first, { loading: true });
  const liveApp = await mountClientApp({
    routes: loading.routes, root: loading.browser.document.getElementById("app") as unknown as Element,
    payload: loading.browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => loading.modules[file]!,
    browser: loading.browser as unknown as Window,
    onNavigationError: (error) => errors.push(error),
  });
  const document = loading.browser.document;
  const container = document.createElement("div");
  container.innerHTML = spoof(0);
  document.getElementById("app")!.append(container.firstChild!);
  fast.resolve({ text: "fast real" });
  const fastChunk = decoder.decode((await reader.read()).value!).match(/data-meeko-deferred="1">(.*?)<\/script>/)![1]!;
  const script = document.createElement("script");
  script.setAttribute("type", "application/json");
  script.setAttribute("data-meeko-deferred", "1");
  script.textContent = fastChunk;
  document.body.append(script);
  await until(() => document.getElementById("fast")!.textContent !== "pending");
  assert.equal(document.getElementById("fast")!.textContent, "fast real");
  assert.equal(document.getElementById("slow")!.textContent, "pending");
  slow.resolve({ text: "ignored" });
  await reader.cancel();
  liveApp.dispose();
  assert.deepEqual(errors, []);
});

test("a session revoked mid-stream sends SESSION_REVOKED 401 lines and aborts the loader signal without onError", async () => {
  const reported: unknown[] = [];
  const slow = gate<Slow>();
  let loaderSignal: AbortSignal | undefined;
  const { fetch, cookie, record, sessions } = await sessionHandler(() => ({
    load: ({ signal }: { signal: AbortSignal }) => {
      loaderSignal = signal;
      return { title: "Revoked", slow: defer(slow.promise) };
    },
  } as PageRoute), (error) => reported.push(error));
  const response = await fetch(new Request("https://example.test/stream", { headers: { cookie } }));
  assert.equal(response.status, 200);
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let html = decoder.decode((await reader.read()).value!);
  await sessions.store.revokeFamily!(record.familyId ?? record.id);
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  assert.deepEqual(deferredChunks(html).map((chunk) => chunk.line), [{ deferred: 0, error: { code: "SESSION_REVOKED", status: 401 } }]);
  assert.equal(loaderSignal?.aborted, true);
  assert.deepEqual(reported, []);
  slow.resolve({ text: "too late" });
});

test("a deferred value with </script> and U+2028 stays inside its data block", async () => {
  const text = "</script><script>alert(1)</script>\u2028\u2029&<!--";
  const { fetch, routes, modules } = handler({ load: () => ({ title: "Escape", slow: defer(later(1, { text })) }) });
  const html = (await chunks(await fetch(new Request("https://example.test/stream")))).join("");
  const block = html.slice(html.indexOf('data-meeko-deferred="0">'));
  assert.doesNotMatch(block.slice("data-meeko-deferred=\"0\">".length, block.indexOf("</script>")), /<|\u2028|\u2029/);
  assert.deepEqual(deferredChunks(html).map((chunk) => chunk.line), [{ deferred: 0, value: { text } }]);
  const browser = new HappyWindow({ url: "https://example.test/stream" });
  browser.document.write(html);
  const app = await mountClientApp({
    routes, root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    browser: browser as unknown as Window,
  });
  assert.equal(browser.document.getElementById("slow")!.textContent, text);
  assert.equal(browser.document.querySelectorAll("script[data-meeko-deferred]").length, 1);
  app.dispose();
});

test("a browser loader's deferred factory is aborted when the route is left", async () => {
  let aborted: unknown;
  const { fetch, routes, modules } = handler({ load: () => ({ title: "Plain" }) });
  const browser = new HappyWindow({ url: "https://example.test/plain" });
  browser.document.write(await (await fetch(new Request("https://example.test/plain"))).text());
  const app = await mountClientApp({
    routes, root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    loadRoute: async () => ({
      load: () => ({
        title: "Browser",
        slow: defer((work: AbortSignal) => new Promise<Slow>(() => {
          work.addEventListener("abort", () => { aborted = work.reason ?? true; }, { once: true });
        })),
      }),
    }),
    browser: browser as unknown as Window,
  });
  assert.equal(await app.navigate("https://example.test/stream"), true);
  assert.equal(browser.document.getElementById("slow")!.textContent, "pending");
  assert.equal(aborted, undefined);
  assert.equal(await app.navigate("https://example.test/plain"), true);
  await until(() => aborted !== undefined);
  assert.notEqual(aborted, undefined);
  app.dispose();
});
