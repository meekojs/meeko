import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window as HappyWindow } from "happy-dom";
import { compile } from "../src/compiler.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import type { ApiOperation, RpcOperation } from "../src/framework/clients.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import type { RouteRecord } from "../src/framework/router.ts";
import { createRequestContext, defineRpc, dispatchRpc, MemorySessionStore, SessionManager } from "../src/framework-server.ts";
import type { Schema } from "../src/framework-server.ts";
import { createUseApiMutation, createUseRpcMutation } from "../src/framework.ts";
import type { ApiMutation, RetrySafeMutation, RpcMutation } from "../src/framework.ts";
import { createTempProject } from "./helpers/temp-project.ts";

const fileUrl = (path: string): string => pathToFileURL(resolve(path)).href;

/** The runtime as the compiled pages import it, by file URL: one instance for pages, server and browser. */
const runtime = async () => ({
  ...await import(fileUrl("src/framework/server.ts")) as typeof import("../src/framework/server.ts"),
  ...await import(fileUrl("src/framework/client.ts")) as typeof import("../src/framework/client.ts"),
  ...await import(fileUrl("src/framework/clients.ts")) as typeof import("../src/framework/clients.ts"),
  ...await import(fileUrl("src/reactivity.ts")) as typeof import("../src/reactivity.ts"),
  ...await import(fileUrl("src/lifecycle.ts")) as typeof import("../src/lifecycle.ts"),
});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

interface Call { readonly line: string; readonly headers: Headers }

/** Answers the endpoints of the test application: `answer` decides the next response. */
interface SaleServer {
  calls: Call[];
  answer: (url: URL) => Response | "network";
}

const globals = globalThis as unknown as { meekoSales?: SaleServer; meekoSalesFetch?: typeof fetch; saleView?: SaleView };

interface SaleView {
  readonly charge: RpcMutation<{ total: number }, { id: string }> & RetrySafeMutation<{ total: number }, { id: string }>;
  readonly remove: ApiMutation<ApiOperation<{ id: string }, undefined, undefined, undefined>>;
  readonly create: ApiMutation<ApiOperation<undefined, undefined, { total: number }, { id: string }>> & RetrySafeMutation<{ body: { total: number } }, { id: string }>;
  readonly again: SaleView["charge"];
}

function installServer(): SaleServer {
  const server: SaleServer = { calls: [], answer: () => Response.json({ id: "s1" }) };
  globals.meekoSales = server;
  globals.meekoSalesFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    server.calls.push({ line: `${init?.method ?? "GET"} ${url.pathname}${init?.body ? ` ${String(init.body)}` : ""}`, headers: new Headers(init?.headers) });
    if (url.pathname === "/_meeko/rpc/users.get") return Response.json({ name: "Ada" });
    const answer = server.answer(url);
    if (answer === "network") throw new TypeError("fetch failed");
    return answer;
  }) as typeof fetch;
  return server;
}

const dataModule = (framework: string): string => `import { createUseApiMutation, createUseRpcMutation, createUseRpcQuery } from ${framework};
const manifest = {
  api: [{ clientKey: "notes.byId", pathname: "/api/notes/[id]", method: "DELETE" }, { clientKey: "sales", pathname: "/api/sales", method: "POST" }],
  rpc: [{ id: "sales.checkout", pathname: "/_meeko/rpc/sales.checkout" }, { id: "users.get", pathname: "/_meeko/rpc/users.get" }],
} as const;
const globals = globalThis as unknown as { meekoSalesFetch: typeof fetch };
const options = { baseUrl: "https://example.test", fetch: ((input, init) => globals.meekoSalesFetch(input, init)) as typeof fetch, csrfToken: () => "csrf-1" };
export const useRpcMutation = createUseRpcMutation(manifest, options);
export const useRpcQuery = createUseRpcQuery(manifest, options);
export const useApiMutation = createUseApiMutation(manifest, options);
`;

const salePage = `<script lang="ts">
import { useApiMutation, useRpcMutation } from "./data.ts";
const charge = useRpcMutation("sales.checkout", { retrySafe: { key: "pos:sale" } });
const remove = useApiMutation("/api/notes/[id]", "DELETE");
const create = useApiMutation("/api/sales", "POST", { retrySafe: { key: "api:sale" } });
const again = useRpcMutation("sales.checkout", { retrySafe: { key: "pos:sale" } });
Object.assign(globalThis, { saleView: { charge, remove, create, again } });
</script>
<template><p class="uncertain">{charge.uncertain.value ? charge.uncertain.value.idempotencyKey : "none"}</p><p class="pending">{String(charge.pending.value)}</p></template>`;

// Awaits data, so a navigation to it runs a dry pass first.
const dataPage = `<script lang="ts">
import { useRpcMutation, useRpcQuery } from "./data.ts";
const user = await useRpcQuery("users.get", { id: 1 });
const charge = useRpcMutation("sales.checkout", { retrySafe: { key: "pos:sale" } });
</script>
<template><p class="user">{user.data.value.name}</p><p class="uncertain">{charge.uncertain.value ? "uncertain" : "none"}</p></template>`;

const homePage = `<template><p class="home">home</p></template>`;

const sources: Record<string, string> = { "sale.meeko": salePage, "data-page.meeko": dataPage, "home.meeko": homePage };

async function loadModules(): Promise<{ modules: Record<string, ClientComponent>; cleanup: () => Promise<void> }> {
  const project = await createTempProject("mutations-test");
  const directory = project.root;
  const runtimePath = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  await writeFile(join(directory, "data.ts"), dataModule(runtimePath("src/framework.ts")));
  const modules: Record<string, ClientComponent> = {};
  for (const [file, source] of Object.entries(sources)) {
    const code = compile(source, join(directory, file)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtimePath("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko/framework"`, `from ${runtimePath("src/framework.ts")}`)
      .replace(`from "@meekojs/meeko"`, `from ${runtimePath("src/index.ts")}`);
    const target = join(directory, file.replace(/\.meeko$/, ".ts"));
    await writeFile(target, code);
    modules[file] = await import(pathToFileURL(target).href) as ClientComponent;
  }
  return { modules, cleanup: () => project.remove() };
}

const routes: readonly RouteRecord[] = createRouteManifest([
  { id: "/", file: "home.meeko", layouts: [] },
  { id: "/sale", file: "sale.meeko", layouts: [] },
  { id: "/data", file: "data-page.meeko", layouts: [] },
]);

const flush = async (): Promise<void> => {
  for (let index = 0; index < 10; index++) await new Promise((resolve) => setTimeout(resolve, 0));
};

async function boot(modules: Record<string, ClientComponent>, url: string, prepare: (browser: HappyWindow) => void = () => {}) {
  const { createFrameworkHandler, mountClientApp } = await runtime();
  const server = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]! });
  const browser = new HappyWindow({ url });
  prepare(browser);
  const response = await server(new Request(url, { headers: { accept: "text/html" } }));
  const document = await response.text();
  assert.equal(response.status, 200);
  const ssrCalls = globals.meekoSales!.calls.length;
  browser.document.write(document);
  const root = browser.document.getElementById("app")! as unknown as Element;
  const payload = browser.document.getElementById("meeko-payload")!.textContent!;
  const errors: unknown[] = [];
  const app = await mountClientApp({
    routes, root, payload,
    loadPage: async (file) => modules[file]!,
    onNavigationError: () => {},
    onError: (error) => { errors.push(error); },
    browser: browser as unknown as Window,
  });
  return { app, browser, root, ssrCalls, errors, view: () => globals.saleView! };
}

const text = (root: Element, selector: string): string | null | undefined => root.querySelector(selector)?.textContent;
const keyOf = (call: Call | undefined): string | null | undefined => call?.headers.get("idempotency-key");
const online = (browser: HappyWindow): void => { browser.dispatchEvent(new browser.Event("online")); };

test("a retry-safe RPC mutation keeps an intent without an answer and retries it with the same key", async () => {
  const server = installServer();
  const { modules, cleanup } = await loadModules();
  try {
    const { app, browser, root, ssrCalls, errors, view } = await boot(modules, "https://example.test/sale");
    assert.equal(ssrCalls, 0, "SSR never sends a mutation");
    const { charge } = view();
    assert.equal(charge.uncertain.value, null as unknown);

    server.answer = () => "network";
    await assert.rejects(charge.mutate({ total: 5 }), TypeError);
    const first = server.calls.at(-1)!;
    assert.equal(first.line, 'POST /_meeko/rpc/sales.checkout {"total":5}');
    assert.equal(first.headers.get("x-meeko-csrf"), "csrf-1");
    const header = keyOf(first)!;
    // A Structured Field string, as the IETF draft defines the header.
    assert.match(header, /^"[0-9a-f-]{36}"$/);
    const key = header.slice(1, -1);
    assert.match(key, UUID);
    assert.equal(charge.uncertain.value?.idempotencyKey, key);
    assert.deepEqual(charge.uncertain.value?.input, { total: 5 });
    assert.equal(text(root, ".uncertain"), key);
    const saved = JSON.parse(browser.localStorage.getItem("pos:sale")!) as { idempotencyKey: string; input: unknown };
    assert.equal(saved.idempotencyKey, key, "the intent is saved before it is sent");
    assert.ok(charge.error.value instanceof TypeError);

    // A new intent waits until the uncertain one is resolved.
    const before = server.calls.length;
    await assert.rejects(charge.mutate({ total: 6 }), /MUTATION_UNCERTAIN/);
    assert.equal(server.calls.length, before);

    // A 5xx is no answer either: the intent stays.
    server.answer = () => Response.json({ code: "INTERNAL_ERROR" }, { status: 503 });
    online(browser);
    await flush();
    assert.equal(keyOf(server.calls.at(-1)), header, "the browser coming back online retries with the same key");
    assert.equal(charge.uncertain.value?.idempotencyKey, key);
    assert.equal((charge.error.value as { status?: number } | null)?.status, 503);

    // 429 and 408 mean it was not processed: the intent stays as well.
    server.answer = () => Response.json({ code: "RATE_LIMITED" }, { status: 429 });
    await assert.rejects(charge.retry());
    assert.equal(charge.uncertain.value?.idempotencyKey, key);

    server.answer = () => Response.json({ id: "s1" });
    online(browser);
    await flush();
    assert.equal(keyOf(server.calls.at(-1)), header);
    assert.equal(charge.uncertain.value, null);
    assert.deepEqual(charge.data.value, { id: "s1" });
    assert.equal(charge.error.value, null);
    assert.equal(browser.localStorage.getItem("pos:sale"), null);
    assert.equal(text(root, ".uncertain"), "none");
    assert.equal(await charge.retry(), undefined, "nothing left to retry");

    // A new intent gets a new key; a direct answer never shows it as uncertain.
    const calls = server.calls.length;
    assert.deepEqual(await charge.mutate({ total: 7 }), { id: "s1" });
    assert.notEqual(keyOf(server.calls.at(-1)), header);
    assert.equal(server.calls.length, calls + 1);
    assert.equal(charge.uncertain.value, null);
    assert.deepEqual(errors, []);
    app.dispose();
    // A released component no longer listens to online.
    const released = server.calls.length;
    online(browser);
    await flush();
    assert.equal(server.calls.length, released);
    browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
});

test("a 4xx answer settles the intent and surfaces the error; discard forgets it", async () => {
  const server = installServer();
  const { modules, cleanup } = await loadModules();
  try {
    const { app, browser, view } = await boot(modules, "https://example.test/sale");
    const { charge } = view();
    server.answer = () => "network";
    await assert.rejects(charge.mutate({ total: 5 }));
    const key = charge.uncertain.value!.idempotencyKey;

    server.answer = () => Response.json({ code: "SHIFT_CLOSED", requestId: "r1" }, { status: 409 });
    await assert.rejects(charge.retry(), (error: unknown) => (error as { code?: string }).code === "SHIFT_CLOSED");
    assert.equal(keyOf(server.calls.at(-1)), `"${key}"`);
    assert.equal(charge.uncertain.value, null);
    assert.equal((charge.error.value as { code?: string } | null)?.code, "SHIFT_CLOSED");
    assert.equal(browser.localStorage.getItem("pos:sale"), null);

    server.answer = () => "network";
    await assert.rejects(charge.mutate({ total: 8 }));
    assert.ok(charge.uncertain.value);
    charge.discard();
    assert.equal(charge.uncertain.value, null);
    assert.equal(browser.localStorage.getItem("pos:sale"), null);
    app.dispose();
    browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
});

test("a reload resumes the saved intent on mount with its key; SSR and dry passes never send it", async () => {
  const server = installServer();
  const { modules, cleanup } = await loadModules();
  const key = "6f1d3c1e-8a7b-4c2d-9e0f-1a2b3c4d5e6f";
  const saved = JSON.stringify({ idempotencyKey: key, input: { total: 9 }, startedAt: 1, target: "RPC sales.checkout" });
  try {
    server.answer = () => Response.json({ id: "s9" });
    const { app, browser, root, ssrCalls, view } = await boot(modules, "https://example.test/sale", (browser) => {
      browser.localStorage.setItem("pos:sale", saved);
    });
    assert.equal(ssrCalls, 0);
    await flush();
    const retries = server.calls.filter((call) => call.line.startsWith("POST /_meeko/rpc/sales.checkout"));
    assert.equal(retries.length, 1, "two components with the key share one retry");
    assert.deepEqual(view().again.data.value, { id: "s9" }, "both see its result");
    assert.equal(keyOf(retries[0]), `"${key}"`);
    assert.equal(retries[0]!.line, 'POST /_meeko/rpc/sales.checkout {"total":9}');
    assert.equal(view().charge.uncertain.value, null);
    assert.equal(browser.localStorage.getItem("pos:sale"), null);
    assert.equal(text(root, ".uncertain"), "none");
    app.dispose();
    browser.happyDOM.abort();

    // A navigation renders the next page dry, to load its data, before it mounts it.
    server.calls.splice(0);
    const second = await boot(modules, "https://example.test/", (browser) => {
      browser.localStorage.setItem("pos:sale", saved);
    });
    server.answer = () => "network";
    assert.equal(await second.app.navigate("/data"), true);
    await flush();
    assert.equal(text(second.root, ".user"), "Ada");
    const sent = server.calls.filter((call) => call.line.startsWith("POST /_meeko/rpc/sales.checkout"));
    assert.equal(sent.length, 1, "only the mounted page retries, never the dry pass");
    assert.equal(keyOf(sent[0]), `"${key}"`);
    assert.equal(text(second.root, ".uncertain"), "uncertain");
    second.app.dispose();
    second.browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
});

test("an intent saved by another mutation under the same key is never sent to this endpoint", async () => {
  const server = installServer();
  const { modules, cleanup } = await loadModules();
  try {
    const foreign = JSON.stringify({ idempotencyKey: "6f1d3c1e-8a7b-4c2d-9e0f-1a2b3c4d5e6f", input: { total: 1 }, startedAt: 1, target: "POST /api/other" });
    const { app, browser, view } = await boot(modules, "https://example.test/sale", (browser) => {
      browser.localStorage.setItem("pos:sale", foreign);
    });
    await flush();
    assert.equal(server.calls.length, 0);
    assert.equal(view().charge.uncertain.value, null);
    app.dispose();
    browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
});

test("useApiMutation sends params and body with CSRF; retrySafe adds the idempotency key and survives blocked storage", async () => {
  const server = installServer();
  const { modules, cleanup } = await loadModules();
  try {
    const { app, browser, errors, view } = await boot(modules, "https://example.test/sale", (browser) => {
      Object.defineProperty(browser, "localStorage", { configurable: true, get() { throw new browser.DOMException("The operation is insecure.", "SecurityError"); } });
    });
    const { remove, create } = view();
    server.answer = () => new Response(null, { status: 204 });
    assert.equal(await remove.mutate({ params: { id: "7" } }), undefined);
    const removed = server.calls.at(-1)!;
    assert.equal(removed.line, "DELETE /api/notes/7");
    assert.equal(removed.headers.get("x-meeko-csrf"), "csrf-1");
    assert.equal(keyOf(removed), null, "a mutation without retrySafe sends no idempotency key");

    server.answer = () => "network";
    await assert.rejects(create.mutate({ body: { total: 3 } }));
    const posted = server.calls.at(-1)!;
    assert.equal(posted.line, 'POST /api/sales {"total":3}');
    const header = keyOf(posted)!;
    assert.match(header, /^"[0-9a-f-]{36}"$/);
    // Blocked storage: the intent lives in memory and is still retried with its key.
    assert.deepEqual(create.uncertain.value?.input, { body: { total: 3 } });
    server.answer = () => Response.json({ id: "a1" }, { status: 201 });
    online(browser);
    await flush();
    assert.equal(keyOf(server.calls.at(-1)), header);
    assert.equal(create.uncertain.value, null);
    assert.deepEqual(create.data.value, { id: "a1" });
    assert.deepEqual(errors, []);
    app.dispose();
    browser.happyDOM.abort();
  } finally {
    await cleanup();
  }
});

test("mutation composables validate their arguments and need a component script", async () => {
  const { createRoot, collectMounted } = await runtime();
  const manifest = {
    api: [{ clientKey: "notes", pathname: "/api/notes", method: "GET" }, { clientKey: "notes", pathname: "/api/notes", method: "POST" }],
    rpc: [{ id: "notes.add", pathname: "/_meeko/rpc/notes.add" }],
  } as const;
  const useApiMutation = createUseApiMutation(manifest) as unknown as (path: string, method: string, options?: unknown) => unknown;
  const useRpcMutation = createUseRpcMutation(manifest) as unknown as (procedure: string, options?: unknown) => unknown;
  assert.throws(() => useApiMutation("/api/notes", "POST"), /must be called while a component script runs/);
  createRoot((dispose) => {
    collectMounted(null, () => {
      assert.throws(() => useApiMutation("/api/notes", "GET"), /is a read; use useApi/);
      assert.throws(() => useApiMutation("/api/missing", "POST"), /no POST endpoint/);
      assert.throws(() => useRpcMutation("notes.add", { retrySafe: { key: "" } }), TypeError);
      // A render that only produces HTML never touches the storage.
      const add = useRpcMutation("notes.add", { retrySafe: { key: "notes:add" } }) as { uncertain: { value: unknown } };
      assert.equal(add.uncertain.value, null);
    });
    dispose();
  });
});

test("the server exposes a valid Idempotency-Key as context.idempotencyKey, with CSRF and same-origin checks intact", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
  const handle = await sessions.load(new Request("http://localhost/"));
  const record = await handle.create({ userId: "u1" });
  const input: Schema<{ total: number }> = { "~standard": { version: 1, validate: (value) => ({ value: value as { total: number } }) } };
  const output: Schema<{ id: string; replay: boolean }> = { "~standard": { version: 1, validate: (value) => ({ value: value as { id: string; replay: boolean } }) } };
  // The application deduplicates, for example with a unique key column; a Map plays that role here.
  const sales = new Map<string, string>();
  const checkout = defineRpc({
    input, output, auth: "required",
    handler: ({ context }) => {
      const key = context.idempotencyKey;
      if (!key) return { id: "no-key", replay: false };
      const existing = sales.get(key);
      if (existing) return { id: existing, replay: true };
      sales.set(key, `sale-${sales.size + 1}`);
      return { id: sales.get(key)!, replay: false };
    },
  });
  const call = (headers: Record<string, string>) => new Request("http://localhost/_meeko/rpc/sales/checkout", {
    method: "POST", body: '{"total":5}',
    headers: { "content-type": "application/json", cookie: `meeko.sid=${record.id}`, origin: "http://localhost", "x-meeko-csrf": record.csrfToken, ...headers },
  });
  const send = async (request: Request) => dispatchRpc(checkout, createRequestContext(request, {}, await sessions.load(request)), sessions);
  const key = "6F1D3C1E-8A7B-4C2D-9E0F-1A2B3C4D5E6F";
  const first = await send(call({ "idempotency-key": `"${key}"` }));
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { id: "sale-1", replay: false });
  // The same key, quoted or bare and in any case, is the same intent.
  assert.deepEqual(await (await send(call({ "idempotency-key": key.toLowerCase() }))).json(), { id: "sale-1", replay: true });
  assert.deepEqual([...sales.keys()], [key.toLowerCase()]);
  // A missing or malformed key is undefined.
  assert.deepEqual(await (await send(call({}))).json(), { id: "no-key", replay: false });
  assert.deepEqual(await (await send(call({ "idempotency-key": "not-a-uuid" }))).json(), { id: "no-key", replay: false });
  // The header does not bypass CSRF or the origin check.
  const forged = call({ "idempotency-key": `"${key}"`, "x-meeko-csrf": "wrong" });
  assert.equal((await send(forged)).status, 403);
  const crossOrigin = call({ "idempotency-key": `"${key}"`, origin: "https://evil.example" });
  assert.equal((await send(crossOrigin)).status, 403);
  assert.equal(createRequestContext(new Request("http://localhost/"), {}, await sessions.load(new Request("http://localhost/"))).idempotencyKey, undefined);
});

// Types only: these functions are never called.
type Contract = {
  sales: { post: ApiOperation<undefined, undefined, { total: number }, { id: string }> };
  "notes.byId": { delete: ApiOperation<{ id: string }, undefined, undefined, undefined>; get: ApiOperation<{ id: string }, undefined, undefined, string> };
};
const typedManifest = {
  api: [
    { clientKey: "sales", pathname: "/api/sales", method: "POST" },
    { clientKey: "notes.byId", pathname: "/api/notes/[id]", method: "DELETE" },
    { clientKey: "notes.byId", pathname: "/api/notes/[id]", method: "GET" },
  ],
  rpc: [{ id: "sales.checkout", pathname: "/_meeko/rpc/sales/checkout" }],
} as const;
export function typedMutations(): void {
  const useApiMutation = createUseApiMutation<Contract, typeof typedManifest>(typedManifest);
  const useRpcMutation = createUseRpcMutation<{ "sales.checkout": RpcOperation<{ total: number }, { id: string }> }>(typedManifest);
  const sale = useApiMutation("/api/sales", "POST", { retrySafe: { key: "pos:sale" } });
  const created: Promise<{ id: string }> = sale.mutate({ body: { total: 1 } });
  const body: { total: number } | undefined = sale.uncertain.value?.input.body;
  // @ts-expect-error the body is required
  void sale.mutate();
  const remove = useApiMutation("/api/notes/[id]", "DELETE");
  const removed: Promise<undefined> = remove.mutate({ params: { id: "1" } });
  // @ts-expect-error retry() exists only with retrySafe
  void remove.retry;
  // @ts-expect-error GET is a read: useApi
  useApiMutation("/api/notes/[id]", "GET");
  const charge = useRpcMutation("sales.checkout", { retrySafe: { key: "pos:charge", storage: "session" } });
  const total: number | undefined = charge.uncertain.value?.input.total;
  const plain = useRpcMutation("sales.checkout");
  // @ts-expect-error uncertain exists only with retrySafe
  void plain.uncertain;
  void [created, body, removed, total];
}
