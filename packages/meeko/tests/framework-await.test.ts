import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window as HappyWindow } from "happy-dom";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { CompletionItem, MarkupContent } from "vscode-languageserver/node";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/sfc.ts";
import { awaitStatus, minimumRule, prepareReserve, rememberedHeight, rememberHeight, reserveMinimum, reserveRules, reserveScript, reserveZoneKey, RESERVE_STORAGE_KEY } from "../src/framework/await.ts";
import type { AwaitResource } from "../src/framework/await.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { completion, componentNameCompletion, definition, directiveNameCompletion, hover } from "../src/language-server/features.ts";
import { createEditorModel } from "../src/language-server/model.ts";
import type { RouteRecord } from "../src/framework/router.ts";
import { signal } from "../src/reactivity.ts";
import { createTempProject } from "./helpers/temp-project.ts";
import { languageProject } from "./language-server-workspace.ts";

const fileUrl = (path: string): string => pathToFileURL(resolve(path)).href;

/** The MEEK code of a compile error, or `undefined` when the source compiles. */
function errorCode(source: string): string | undefined {
  try { compile(source, "/project/app/pages/index.meeko"); return undefined; }
  catch (error) {
    if (error instanceof MeekoCompileError) return error.diagnostic.code;
    throw error;
  }
}

test("<MeekoAwait> is the component that Meeko ships: for is an expression, its snippets go through, MEEK116 without for", () => {
  const { code } = compile(`<script lang="ts">
const items = useApi("/api/items");
const stats = useApi("/api/stats");
</script>
<template><MeekoAwait for="items" reserve="320px" class="zone"><snippet name="pending"><p>…</p></snippet><ul><li each:of="items.data.value" each:as="item">{item}</li></ul></MeekoAwait><MeekoAwait bind:for="[items, stats]"><p>{stats.data.value}</p></MeekoAwait></template>`, "/project/app/pages/index.meeko");
  assert.match(code, /__meeko\.renderComponent<any>\(\d+, __meeko_MeekoAwait, __meeko\.componentTag\(\(\) => __meeko_MeekoAwait\)\(\{ "for": items, "reserve": "320px", "class": "zone" \}/);
  assert.match(code, /\{ "for": \[items, stats\] \}/);
  assert.match(code, /"pending": __meeko\.snippet\(/);
  assert.match(code, /"default": __meeko\.snippet\(/);
  assert.match(code, /__meekoChildren[^\n]*= \(\) => \[__meeko_MeekoAwait\]/);
  // Only meeko check narrows: the module that runs has no guard.
  assert.doesNotMatch(code, /!!\(items\.data\.value\)/);
  const checked = compile(`<script lang="ts">
const items = useApi("/api/items");
</script>
<template><MeekoAwait for="items"><snippet name="pending">…</snippet><p>{items.data.value.length}</p></MeekoAwait><p>{items.data.value?.length}</p></template>`, "/project/app/pages/index.meeko", { typeCheck: true }).code;
  assert.match(checked, /"default": __meeko\.snippet\(\(\) => \(!!\(items\.data\.value\) \?/);
  assert.match(checked, /"pending": __meeko\.snippet\(\(\) => __meeko\.escapeHtml/, "the pending snippet is not narrowed");
  assert.equal(errorCode("<template><MeekoAwait><p>x</p></MeekoAwait></template>"), "MEEK116");
  assert.equal(errorCode('<template><MeekoAwait for=""><p>x</p></MeekoAwait></template>'), "MEEK116");
  // A project component with the name keeps working, with MEEK106.
  const own = compile('<template><MeekoAwait for="x" /></template>', "/project/app/pages/index.meeko", { projectComponents: ["MeekoAwait"] });
  assert.match(own.code, /renderComponent<any>\(0, MeekoAwait, __meeko\.componentTag\(\(\) => MeekoAwait\)\(\{ "for": "x" \}/);
  assert.deepEqual(own.warnings?.map((warning) => warning.code), ["MEEK106"]);
});

test("MEEK117 hints a layout shift only for a list of unawaited data that nothing in the page or layout handles", () => {
  const hints = (template: string, script = 'const items = useApi("/api/items");', filename = "/project/app/pages/index.meeko") =>
    (compile(`<script lang="ts">\n${script}\n</script>\n<template>${template}</template>`, filename).warnings ?? []).filter((warning) => warning.code === "MEEK117");
  const list = '<ul><li each:of="items.data.value ?? []" each:as="item">{item}</li></ul>';
  const [hint] = hints(list);
  assert.ok(hint);
  assert.equal(hint.severity, "warning");
  assert.deepEqual({ line: hint.location.line, column: hint.location.column }, { line: 2, column: 15 });
  assert.match(hint.message, /items se carga con useApi sin await[^]*<MeekoAwait for="items" reserve>[^]*if:when="items\.pending\.value"/);
  assert.equal(hints(list, 'const items = useApi("/api/items");', "/project/app/layouts/default.meeko").length, 1, "a layout too");
  assert.equal(hints(list, 'const items = useRpcQuery("items.list");').length, 1, "useRpcQuery too");
  // Handled: never a hint.
  const quiet: Array<[string, string?, string?]> = [
    [list, 'const items = await useApi("/api/items");'],
    [`<MeekoAwait for="items">${list}</MeekoAwait>`],
    [`<p if:when="items.pending.value">…</p>${list}`],
    [`<div if:when="items.data.value">${list}</div>`],
    [list.replace("<ul>", '<ul bind:aria-busy="items.refreshing.value">')],
    [`${list}<AppList bind:resource="items" />`],
    [list, 'const items = useApi("/api/items");\nconst busy = computed(() => items.pending.value);'],
    [list, 'const items = useApi("/api/items");\nwatchLoading(items);'],
    ["<p>{items.data.value?.length ?? 0}</p>"],
    [list, 'const items = useApi("/api/items");', "/project/app/components/List.meeko"],
  ];
  for (const [template, script, filename] of quiet) assert.deepEqual(hints(template, script, filename), [], `${script ?? ""} ${template} ${filename ?? ""}`);
});

/** A resource with plain signals, as `useApi` returns it, for the pure state. */
function resource(state: { data?: unknown; error?: Error | null; pending?: boolean }): AwaitResource & { refreshes: number } {
  const value = { refreshes: 0, data: signal(state.data ?? null), error: signal(state.error ?? null), pending: signal(state.pending ?? false), refresh: async () => { value.refreshes++; } };
  return value;
}

test("the state of a zone: pending until every resource has data, error for a failure without data, refreshing with data", () => {
  assert.deepEqual(awaitStatus([resource({ pending: true })]), { state: "pending", refreshing: false, error: null });
  const failure = new Error("boom");
  assert.deepEqual(awaitStatus([resource({ error: failure })]), { state: "error", refreshing: false, error: failure });
  // Retrying: the failure stays in error while the resource loads again, and the zone waits.
  assert.equal(awaitStatus([resource({ error: failure, pending: true })]).state, "pending");
  assert.deepEqual(awaitStatus([resource({ data: [1] })]), { state: "ready", refreshing: false, error: null });
  assert.deepEqual(awaitStatus([resource({ data: [1], pending: true })]), { state: "ready", refreshing: true, error: null });
  // A failed reload keeps the data: the content stays, the resource's error says why.
  assert.equal(awaitStatus([resource({ data: [1], error: failure })]).state, "ready");
  // A list: one without data keeps the zone pending; a failure wins, so retry is offered at once.
  assert.equal(awaitStatus([resource({ data: [1] }), resource({ pending: true })]).state, "pending");
  assert.equal(awaitStatus([resource({ error: failure }), resource({ pending: true })]).state, "error");
  assert.equal(awaitStatus([resource({ data: [1], pending: true }), resource({ data: 2 })]).refreshing, true);
});

test("reserve: a CSS length or nothing, a stable key per route, requests and instance, and rules that never use a style attribute", () => {
  assert.equal(reserveMinimum(undefined), undefined);
  assert.equal(reserveMinimum(true), undefined);
  assert.equal(reserveMinimum(""), undefined);
  assert.equal(reserveMinimum("0px"), undefined);
  assert.equal(reserveMinimum(" 320px "), "320px");
  assert.equal(reserveMinimum("12.5rem"), "12.5rem");
  for (const wrong of ["320", "big", "320px;color:red", "calc(1px)", "1px}*{x:y", 320]) {
    assert.throws(() => reserveMinimum(wrong), /reserve must be empty or a CSS length/, String(wrong));
  }
  const key = reserveZoneKey("/items", ['GET /api/items {}'], "m-0");
  assert.match(key, /^[a-z0-9]{1,13}$/);
  assert.equal(reserveZoneKey("/items", ['GET /api/items {}'], "m-0"), key, "stable");
  assert.notEqual(reserveZoneKey("/other", ['GET /api/items {}'], "m-0"), key, "per route");
  assert.notEqual(reserveZoneKey("/items", ['GET /api/items {"query":{"q":"b"}}'], "m-0"), key, "per request");
  assert.notEqual(reserveZoneKey("/items", ['GET /api/items {}'], "m-1"), key, "per instance");
  assert.equal(reserveRules({ abc: 240, "bad key": 10, neg: -1, big: 1e9 }, ["10rem", "1px}x"]),
    `${minimumRule("10rem")}[data-meeko-await=pending][data-meeko-reserve][data-meeko-reserve="abc"]{min-block-size:max(240px,var(--meeko-await-min,0px))}`);
});

/** Runs the inline script of `<head>` against a window, as the browser does before the first paint. */
function runHeadScript(browser: HappyWindow): void {
  const run = new Function("window", "document", "sessionStorage", "CSSStyleSheet", reserveScript) as (...args: unknown[]) => void;
  let storage: unknown;
  try { storage = browser.sessionStorage; }
  catch (error) { storage = { getItem: () => { throw error; } }; }
  run(browser, browser.document, storage, browser.CSSStyleSheet);
}

const registryOf = (browser: HappyWindow) => (browser as unknown as Record<symbol, { memory: Record<string, number>; sheet?: CSSStyleSheet } | undefined>)[Symbol.for("meeko.await")];

test("the memory: sessionStorage and memory, read by the head script before the first paint, bounded and safe when storage is blocked", async () => {
  const browser = new HappyWindow({ url: "https://example.test/items" });
  try {
    const window = browser as unknown as Window;
    rememberHeight(window, "abc", 240.456);
    assert.equal(rememberedHeight(window, "abc"), 240.46);
    assert.deepEqual(JSON.parse(browser.sessionStorage.getItem(RESERVE_STORAGE_KEY)!), { abc: 240.46 });
    const sheet = registryOf(browser)!.sheet!;
    assert.ok(browser.document.adoptedStyleSheets.includes(sheet as never), "the rules are adopted, not written to an attribute");
    assert.equal(sheet.cssRules.length, 1);
    // The zone with that key, while pending, gets the remembered height; with data, its own.
    browser.document.body.innerHTML = '<div data-meeko-await="pending" data-meeko-reserve="abc">x</div>';
    const zone = browser.document.body.firstElementChild!;
    assert.equal(browser.getComputedStyle(zone).getPropertyValue("min-block-size"), "max(240.46px,0px)");
    zone.setAttribute("data-meeko-await", "ready");
    assert.notEqual(browser.getComputedStyle(zone).getPropertyValue("min-block-size"), "max(240.46px,0px)");
    rememberHeight(window, "abc", 0);
    assert.equal(rememberedHeight(window, "abc"), undefined, "an empty zone forgets its height");
    for (let index = 0; index < 120; index++) rememberHeight(window, `z${index}`, 10 + index);
    const kept = Object.keys(JSON.parse(browser.sessionStorage.getItem(RESERVE_STORAGE_KEY)!) as object);
    assert.equal(kept.length, 100);
    assert.equal(kept[0], "z20", "the oldest zones go first");
  } finally {
    await browser.happyDOM.close();
  }

  // A full load: the head script reads the memory and adopts the same rules, and the runtime reuses them.
  const reload = new HappyWindow({ url: "https://example.test/items" });
  try {
    reload.sessionStorage.setItem(RESERVE_STORAGE_KEY, JSON.stringify({ abc: 240, "x y": 3, def: "9" }));
    runHeadScript(reload);
    const registry = registryOf(reload)!;
    assert.deepEqual(registry.memory, { abc: 240 });
    assert.equal(registry.sheet!.cssRules.length, 1);
    assert.equal([...registry.sheet!.cssRules].map((rule) => rule.cssText).join(""), [...(() => {
      const expected = new reload.CSSStyleSheet();
      expected.replaceSync(reserveRules({ abc: 240 }));
      return expected.cssRules;
    })()].map((rule) => rule.cssText).join(""));
    runHeadScript(reload);
    assert.equal(reload.document.adoptedStyleSheets.length, 1, "the script runs once per page, also when a navigation inserts it again");
    prepareReserve(reload as unknown as Window, "10rem");
    assert.equal(reload.document.adoptedStyleSheets.length, 1, "the runtime completes the same sheet");
    assert.equal(registry.sheet!.cssRules.length, 3);
  } finally {
    await reload.happyDOM.close();
  }

  // Storage blocked (private mode, a sandbox): no error, the memory lives for the page.
  const blocked = new HappyWindow({ url: "https://example.test/items" });
  try {
    Object.defineProperty(blocked, "sessionStorage", { get() { throw new DOMException("denied", "SecurityError"); } });
    assert.doesNotThrow(() => runHeadScript(blocked));
    assert.equal(registryOf(blocked), undefined);
    const window = blocked as unknown as Window;
    assert.doesNotThrow(() => rememberHeight(window, "abc", 100));
    assert.equal(rememberedHeight(window, "abc"), 100);
    assert.equal(registryOf(blocked)!.sheet!.cssRules.length, 1);
  } finally {
    await blocked.happyDOM.close();
  }
});

interface DataServer {
  calls: string[];
  signals: AbortSignal[];
  gate: Promise<void> | undefined;
  failures: number;
}

const globals = globalThis as unknown as { meekoAwaitData?: DataServer; meekoAwaitFetch?: typeof fetch };

/** Answers `/api/items?q=…` with three items, after `gate`; `failures` answers 500 that many times. */
function installDataServer(): { server: DataServer; open: () => void; close: () => void } {
  const server: DataServer = { calls: [], signals: [], gate: undefined, failures: 0 };
  let release: () => void = () => {};
  globals.meekoAwaitData = server;
  globals.meekoAwaitFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    server.calls.push(`${url.pathname}${url.search}`);
    if (init?.signal) server.signals.push(init.signal);
    if (server.gate) await server.gate;
    init?.signal?.throwIfAborted();
    if (server.failures > 0) {
      server.failures--;
      return Response.json({ code: "BOOM" }, { status: 500 });
    }
    const q = url.searchParams.get("q") ?? "";
    return Response.json([`${q}1`, `${q}2`, `${q}3`]);
  }) as typeof fetch;
  return {
    server,
    close: () => { server.gate = new Promise((done) => { release = done; }); },
    open: () => { server.gate = undefined; release(); },
  };
}

const dataModule = (framework: string): string => `import { createUseApi } from ${framework};
const manifest = { api: [{ clientKey: "items", pathname: "/api/items", method: "GET" }], rpc: [] } as const;
const globals = globalThis as unknown as { meekoAwaitFetch: typeof fetch };
export const useApi = createUseApi(manifest, { baseUrl: "https://example.test", fetch: ((input, init) => globals.meekoAwaitFetch(input, init)) as typeof fetch });
`;

const pages: Record<string, string> = {
  "card.meeko": `<script lang="ts">
import { signal } from "@meekojs/meeko";
import { useApi } from "./data.ts";
const q = signal("a");
const show = signal(true);
const items = useApi("/api/items", { query: { q } });
const strict = useApi("/api/items", { query: { q: "s" } }, { keepPrevious: false });
</script>
<template><section class="card"><MeekoAwait if:when="show.value" for="items" reserve class="zone"><snippet name="pending"><p class="skeleton">…</p></snippet><snippet name="error" params="error, retry"><p role="alert" class="failure">{error.message}<button class="retry" on:click="retry">R</button></p></snippet><snippet name="default" params="refreshing"><ul class="list" bind:data-refreshing="String(refreshing)"><li each:of="items.data.value" each:as="item" each:key="item">{item}</li></ul></snippet></MeekoAwait><p class="strict">{strict.data.value ? strict.data.value.join(",") : "none"}</p><button class="next" on:click="() => q.value = q.value === 'a' ? 'b' : 'a'">n</button><button class="refresh" on:click="() => items.refresh()">r</button><button class="hide" on:click="() => show.value = false">h</button></section></template>`,
  "loaded.meeko": `<script lang="ts">
import { useApi } from "./data.ts";
const items = await useApi("/api/items", { query: { q: "s" } });
</script>
<template><MeekoAwait for="items" reserve="10rem"><snippet name="pending"><p class="skeleton">…</p></snippet><ul class="list"><li each:of="items.data.value" each:as="item" each:key="item">{item}</li></ul></MeekoAwait></template>`,
  "toggle.meeko": `<script lang="ts">
import { signal } from "@meekojs/meeko";
import { useApi } from "./data.ts";
const on = signal(false);
const items = useApi("/api/items", { query: { q: "t" } });
</script>
<template><MeekoAwait for="items" bind:reserve="on.value ? '12rem' : false" class="zone"><ul class="list"><li each:of="items.data.value" each:as="item" each:key="item">{item}</li></ul></MeekoAwait><button class="reserve" on:click="() => on.value = !on.value">r</button></template>`,
  "plain.meeko": `<script lang="ts">
import { useApi } from "./data.ts";
const items = useApi("/api/items", { query: { q: "p" } });
</script>
<template><MeekoAwait for="items"><ul class="list"><li each:of="items.data.value" each:as="item" each:key="item">{item}</li></ul></MeekoAwait></template>`,
};

async function loadPages(): Promise<{ modules: Record<string, ClientComponent>; cleanup: () => Promise<void> }> {
  const project = await createTempProject("await-test");
  const directory = project.root;
  await writeFile(join(directory, "package.json"), '{"private":true,"type":"module"}\n');
  const runtimePath = (path: string): string => JSON.stringify(fileUrl(path));
  await writeFile(join(directory, "data.ts"), dataModule(runtimePath("src/framework.ts")));
  const modules: Record<string, ClientComponent> = {};
  for (const [file, source] of Object.entries(pages)) {
    const code = compile(source, join(directory, file)).code
      .replaceAll(`from "@meekojs/meeko/internal"`, `from ${runtimePath("src/internal.ts")}`)
      .replaceAll(`from "@meekojs/meeko/builtins/await"`, `from ${runtimePath("src/builtins/await.compiled.ts")}`)
      .replaceAll(`from "@meekojs/meeko/framework"`, `from ${runtimePath("src/framework.ts")}`)
      .replaceAll(`from "@meekojs/meeko"`, `from ${runtimePath("src/index.ts")}`);
    const target = join(directory, file.replace(/\.meeko$/, ".ts"));
    await writeFile(target, code);
    modules[file] = await import(pathToFileURL(target).href) as ClientComponent;
  }
  return { modules, cleanup: () => project.remove() };
}

const routes: readonly RouteRecord[] = createRouteManifest([
  { id: "/card", file: "card.meeko", layouts: [] },
  { id: "/loaded", file: "loaded.meeko", layouts: [] },
  { id: "/plain", file: "plain.meeko", layouts: [] },
  { id: "/toggle", file: "toggle.meeko", layouts: [] },
]);

const runtime = async () => ({
  ...await import(fileUrl("src/framework/server.ts")) as typeof import("../src/framework/server.ts"),
  ...await import(fileUrl("src/framework/client.ts")) as typeof import("../src/framework/client.ts"),
});

const flush = async (): Promise<void> => {
  for (let index = 0; index < 10; index++) await new Promise((done) => setTimeout(done, 0));
};

/** Server render, document, hydration: what hydration changed and what the page shows after. */
async function boot(modules: Record<string, ClientComponent>, url: string) {
  const { createFrameworkHandler, mountClientApp } = await runtime();
  const server = createFrameworkHandler({ routes, loadPage: async (file) => modules[file]!, onError: () => {}, document: { nonce: () => "n1" } });
  const html = await (await server(new Request(url, { headers: { accept: "text/html" } }))).text();
  const browser = new HappyWindow({ url });
  browser.document.write(html);
  const root = browser.document.getElementById("app")!;
  const ssr = root.innerHTML;
  const mutations: string[] = [];
  const observer = new browser.MutationObserver((records) => {
    for (const record of records) mutations.push(record.type === "attributes" ? `${(record.target as unknown as Element).localName}@${record.attributeName}` : record.type);
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true });
  const errors: unknown[] = [];
  const app = await mountClientApp({
    routes, root: root as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    serverData: true,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
    onError: (error) => { errors.push(error); },
    browser: browser as unknown as Window,
  });
  const hydration = mutations.splice(0);
  const close = async (): Promise<void> => {
    observer.disconnect();
    app.dispose();
    await browser.happyDOM.close();
  };
  return { browser, document: browser.document, root, html, ssr, hydration, mutations, errors, close };
}

test("SSR paints the pending snippet with aria-busy and the reserve key, and hydration changes nothing until the data arrives", { timeout: 60_000 }, async () => {
  const { server, open, close } = installDataServer();
  const { modules, cleanup } = await loadPages();
  try {
    close();
    const page = await boot(modules, "https://example.test/card");
    try {
      const zone = page.document.querySelector(".zone")!;
      // The instance part of the key is the zone's useId, whose form is not a contract.
      const key = /data-meeko-reserve="([a-z0-9]{1,13})"/.exec(page.ssr)?.[1] ?? "";
      assert.ok(key, "the server paints the reserve key");
      assert.match(page.ssr, new RegExp(`<div class="zone" data-meeko-await="pending" aria-busy="true" data-meeko-reserve="${key}" data-meeko="\\d+">(?:<!--[^>]*-->)*<p class="skeleton">…</p>`));
      // The script of the memory is in <head>, with the nonce, before the body is painted.
      assert.ok(page.html.includes(`<script nonce="n1">${reserveScript}</script>`), page.html.slice(0, 2000));
      assert.ok(page.html.indexOf(reserveScript) < page.html.indexOf("<body"), "the script runs before the first paint");
      assert.deepEqual(page.hydration, [], "hydration found the HTML of the server");
      assert.deepEqual(server.calls, ["/api/items?q=a", "/api/items?q=s"], "SSR did not load it; the browser does once mounted");
      assert.equal(zone.getAttribute("data-meeko-reserve"), key, "the same key in the browser");

      open();
      await flush();
      assert.equal(zone.getAttribute("data-meeko-await"), "ready");
      assert.equal(zone.getAttribute("aria-busy"), null);
      assert.deepEqual([...page.document.querySelectorAll(".list li")].map((item) => item.textContent), ["a1", "a2", "a3"]);
      assert.equal(page.document.querySelector(".skeleton"), null);
      assert.equal(page.document.querySelector(".zone") === zone, true, "the zone keeps its element");

      // A refresh keeps the list (keepPrevious) and says so: refreshing, aria-busy.
      close();
      (page.document.querySelector(".refresh") as unknown as HTMLButtonElement).click();
      await flush();
      const list = page.document.querySelector(".list")!;
      assert.equal(zone.getAttribute("aria-busy"), "true");
      assert.equal(zone.getAttribute("data-meeko-refreshing"), "");
      assert.equal(list.getAttribute("data-refreshing"), "true");
      assert.equal(page.document.querySelectorAll(".list li").length, 3);
      open();
      await flush();
      assert.equal(zone.getAttribute("data-meeko-refreshing"), null);
      assert.equal(page.document.querySelector(".list"), list, "the content was never mounted again");

      // A change of the input also keeps the previous list until the new one arrives, by default.
      close();
      (page.document.querySelector(".next") as unknown as HTMLButtonElement).click();
      await flush();
      assert.deepEqual([...page.document.querySelectorAll(".list li")].map((item) => item.textContent), ["a1", "a2", "a3"]);
      assert.equal(zone.getAttribute("data-meeko-await"), "ready");
      assert.equal(zone.getAttribute("data-meeko-refreshing"), "");
      // The key follows the request: the memory of each input is its own.
      const next = zone.getAttribute("data-meeko-reserve") ?? "";
      assert.match(next, /^[a-z0-9]{1,13}$/);
      assert.notEqual(next, key);
      open();
      await flush();
      assert.deepEqual([...page.document.querySelectorAll(".list li")].map((item) => item.textContent), ["b1", "b2", "b3"]);
      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
    }
  } finally {
    await cleanup();
  }
});

test("data already resolved in SSR renders the content, without a request and without changes when hydrating", { timeout: 60_000 }, async () => {
  const { server } = installDataServer();
  const { modules, cleanup } = await loadPages();
  try {
    const page = await boot(modules, "https://example.test/loaded");
    try {
      assert.match(page.ssr, /<div data-meeko-await="ready" data-meeko-reserve="[a-z0-9]+" data-meeko-reserve-min="10rem" data-meeko="\d+">(?:<!--[^>]*-->)*<ul class="list"/);
      assert.doesNotMatch(page.ssr, /aria-busy|skeleton/);
      // reserve="10rem": its rule is an inline <style> of <head> with the nonce, never a style attribute.
      assert.ok(page.html.includes(`<style nonce="n1">${minimumRule("10rem")}</style>`), page.html.slice(0, 2000));
      assert.doesNotMatch(page.html, /style="/);
      assert.deepEqual(page.hydration, []);
      await flush();
      assert.deepEqual(server.calls, ["/api/items?q=s"], "only the server loaded it");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
    }
  } finally {
    await cleanup();
  }
});

test("without reserve there is no key, no script and no style; the default error says what failed and retries", { timeout: 60_000 }, async () => {
  const { server, open, close } = installDataServer();
  const { modules, cleanup } = await loadPages();
  try {
    server.failures = 1;
    const page = await boot(modules, "https://example.test/plain");
    try {
      assert.doesNotMatch(page.html, /data-meeko-reserve|meeko\.await/);
      await flush();
      const zone = page.document.querySelector("[data-meeko-await]")!;
      assert.equal(zone.getAttribute("data-meeko-await"), "error");
      const alert = zone.querySelector("[role=alert]")!;
      assert.match(alert.textContent!, /No se pudieron cargar los datos\./);
      // The retry button has the focus; when it leaves, the zone takes it instead of <body>.
      const button = alert.querySelector("button") as unknown as HTMLButtonElement;
      button.focus();
      close();
      button.click();
      await flush();
      assert.equal(zone.getAttribute("data-meeko-await"), "pending");
      assert.equal(page.document.activeElement, zone);
      assert.equal(zone.getAttribute("tabindex"), "-1");
      open();
      await flush();
      assert.equal(zone.getAttribute("data-meeko-await"), "ready");
      assert.equal(page.document.activeElement, zone, "the focus stays in the zone with its data");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
    }
  } finally {
    await cleanup();
  }
});

test("keepPrevious: false empties data when the input changes; refresh keeps it", { timeout: 60_000 }, async () => {
  const { open, close } = installDataServer();
  try {
    const { createUseApi } = await import(fileUrl("src/framework/resources.ts")) as typeof import("../src/framework/resources.ts");
    const { collectMounted, runMounted } = await import(fileUrl("src/lifecycle.ts")) as typeof import("../src/lifecycle.ts");
    const reactivity = await import(fileUrl("src/reactivity.ts")) as typeof import("../src/reactivity.ts");
    const useApi = createUseApi({ api: [{ clientKey: "items", pathname: "/api/items", method: "GET" }] } as const, { baseUrl: "https://example.test", fetch: ((input: RequestInfo | URL, init?: RequestInit) => globals.meekoAwaitFetch!(input, init)) as typeof fetch }) as unknown as (path: string, input: unknown, options?: unknown) => import("../src/framework/resources.ts").DataResource<string[]>;
    const q = reactivity.signal("a");
    const mounted: Array<() => void> = [];
    const [strict, kept, dispose] = reactivity.createRoot((dispose) => collectMounted(mounted, () => [
      useApi("/api/items", { query: { q } }, { keepPrevious: false }),
      useApi("/api/items", { query: { q } }),
      dispose,
    ] as const));
    runMounted(mounted);
    await flush();
    assert.deepEqual(strict.data.value, ["a1", "a2", "a3"]);
    assert.equal(strict.refreshing.value, false);
    close();
    q.value = "b";
    await flush();
    assert.equal(strict.data.value, null, "keepPrevious: false empties the data of the previous input");
    assert.equal(strict.pending.value, true);
    assert.equal(strict.refreshing.value, false, "a first load, not a reload");
    assert.deepEqual(kept.data.value, ["a1", "a2", "a3"], "the default keeps it");
    assert.equal(kept.refreshing.value, true);
    open();
    await flush();
    assert.deepEqual(strict.data.value, ["b1", "b2", "b3"]);
    close();
    void strict.refresh();
    await flush();
    assert.deepEqual(strict.data.value, ["b1", "b2", "b3"], "refresh always keeps the data");
    assert.equal(strict.refreshing.value, true);
    open();
    await flush();
    assert.equal(strict.refreshing.value, false);
    assert.throws(() => reactivity.createRoot(() => collectMounted([], () => useApi("/api/items", {}, "nope"))), /last argument must be an object/);
    dispose();
  } finally {
    open();
  }
});

test("unmounting the zone while it loads aborts the request and paints nothing, without errors", { timeout: 60_000 }, async () => {
  const { server, open, close } = installDataServer();
  const { modules, cleanup } = await loadPages();
  try {
    close();
    const page = await boot(modules, "https://example.test/card");
    try {
      const zone = page.document.querySelector(".zone")!;
      const key = zone.getAttribute("data-meeko-reserve")!;
      (page.document.querySelector(".hide") as unknown as HTMLButtonElement).click();
      await flush();
      assert.equal(page.document.querySelector(".zone"), null);
      // The resource belongs to the page, which is still mounted: the zone only leaves.
      open();
      await flush();
      assert.equal(page.document.querySelector(".list"), null);
      assert.equal(rememberedHeight(page.browser as unknown as Window, key), undefined, "nothing measured without data on screen");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
    }
    // The page itself leaves while it loads: its requests are aborted.
    close();
    const leaving = await boot(modules, "https://example.test/card");
    await leaving.close();
    assert.ok(server.signals.slice(-2).every((signal) => signal.aborted), "the requests of the page were aborted");
    open();
    await flush();
    assert.deepEqual(leaving.errors, []);
  } finally {
    await cleanup();
  }
});

/** The script of the type tests: two resources as `useApi` types them, without a server. */
const typedScript = `<script lang="ts">
import type { DataResource } from "@meekojs/meeko/framework";
const items = null! as DataResource<string[]>;
const stats = null! as DataResource<{ total: number }>;
</script>
`;

test("meeko check reads the data of for as loaded inside <MeekoAwait>, types its snippets and its props", { timeout: 180_000 }, async () => {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "await-check-"));
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { types: ["node"], paths: {
      "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko/builtins/*": ["../../src/builtins/*.compiled.ts"],
      "@meekojs/meeko/framework": ["../../src/framework.ts"], "@meekojs/meeko": ["../../src/index.ts"],
    } } })}\n`);
    const check = async (template: string) => (await checkSource(`${typedScript}<template>${template}</template>`, join(root, "Card.meeko"))).map((item) => `${item.code}@${item.location.offset}: ${item.message}`);
    assert.deepEqual(await check(`<MeekoAwait for="items" reserve="320px">
  <snippet name="pending"><p>…</p></snippet>
  <snippet name="error" params="error, retry"><p role="alert">{error.message}<button on:click="retry">R</button></p></snippet>
  <ul><li each:of="items.data.value" each:as="item">{item.toUpperCase()}</li></ul>
</MeekoAwait>
<MeekoAwait bind:for="[items, stats]" reserve><p>{items.data.value.length} de {stats.data.value.total}</p></MeekoAwait>
<MeekoAwait for="stats"><snippet name="default" params="refreshing"><p bind:aria-busy="refreshing ? 'true' : undefined">{stats.data.value.total}</p></snippet></MeekoAwait>`), []);
    // Outside the zone the data may still be null.
    const outside = await check('<MeekoAwait for="items"><p>{items.data.value.length}</p></MeekoAwait><p>{items.data.value.length}</p>');
    assert.equal(outside.length, 1, JSON.stringify(outside));
    assert.match(outside[0]!, /^TS18047/);
    const wrong: Array<[string, RegExp]> = [
      ['<MeekoAwait for="42"><p>x</p></MeekoAwait>', /^TS2322/],
      ['<MeekoAwait for="items" bind:reserve="3"><p>x</p></MeekoAwait>', /^TS2322/],
      ['<MeekoAwait for="items"><snippet name="error" params="error, retry, extra"><p>x</p></snippet><p>x</p></MeekoAwait>', /error/],
      ['<MeekoAwait for="items"><snippet name="default" params="refreshing"><p>{refreshing.toFixed()}</p></snippet></MeekoAwait>', /toFixed/],
      ['<MeekoAwait for="items"><snippet name="loading">x</snippet><p>x</p></MeekoAwait>', /loading/],
    ];
    for (const [template, message] of wrong) {
      const diagnostics = await check(template);
      assert.ok(diagnostics.some((item) => message.test(item)), `${template}: ${JSON.stringify(diagnostics)}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the editor reads the data of for as loaded inside <MeekoAwait>, and for as an expression", () => {
  const source = `${typedScript}<template>
  <MeekoAwait for="items" reserve><snippet name="pending">…</snippet><p>{items.data.value.length}</p></MeekoAwait>
  <span>{items.data.value.length}</span>
</template>`;
  const model = createEditorModel(source, resolve("examples/regions/Await.meeko"));
  try {
    const diagnostics = model.service.getSemanticDiagnostics(model.virtualFilename);
    assert.deepEqual(diagnostics.map((item) => [item.code, model.toSource(item.start ?? -1)]), [[18047, source.indexOf("items.data.value", source.indexOf("<span>"))]]);
    // `for="items"` is the resource itself: hover and go to definition work on it.
    const reference = model.toGenerated(source.indexOf('"items"') + 2);
    assert.notEqual(reference, undefined);
    const info = model.service.getQuickInfoAtPosition(model.virtualFilename, reference!);
    assert.match(info?.displayParts?.map((part) => part.text).join("") ?? "", /DataResource<string\[\]>/);
  } finally { model.dispose(); }
});

test("the editor completes <MeekoAwait>, its props and its snippets, and explains it on hover", { timeout: 60_000 }, async () => {
  const text = `${typedScript}<template><MeekoAwait for="items" r><snippet name="d"></snippet></MeekoAwait></template>`;
  const workspace = await languageProject("lsp-await-", { "app/pages/index.meeko": text });
  try {
    const opened = await workspace.open("app/pages/index.meeko");
    const typing = TextDocument.create(opened.document.uri, "meeko", 2, `${typedScript}<template><Meek</template>`);
    const typed = typing.positionAt(typing.getText().indexOf("<Meek") + 5);
    const names = componentNameCompletion(workspace.project, typing, opened.component.filename, typed)!.map((item) => item.label);
    assert.ok(names.includes("MeekoAwait"), JSON.stringify(names));
    const attributes = directiveNameCompletion(opened.document, opened.at('"items" r', 9))!.map((item) => item.label);
    assert.deepEqual(attributes.slice(0, 4), ["reserve", "bind:messages", "class", "id"], "for is already there");
    const snippets = (completion(opened, opened.at('name="d"', 6)) ?? []).map((item: CompletionItem) => item.label);
    assert.deepEqual(snippets.sort(), ["default", "error", "pending"]);
    const docs = (hover(opened, opened.at("MeekoAwait", 3))?.contents as MarkupContent | undefined)?.value ?? "";
    assert.match(docs, /^```ts\n<MeekoAwait\n {2}for: AwaitResource \| readonly AwaitResource\[\]\n {2}reserve\?: string \| boolean/);
    assert.match(docs, /\n {2}default\(refreshing: boolean\)\n {2}pending\?\(\)\n {2}error\?\(error: Error, retry: \(\) => void\)\n<\/MeekoAwait>\n```/);
    assert.match(docs, /Etiqueta de Meeko · componente · props: \[`MeekoAwaitProps`\]/);
    assert.match(docs, /\[Guía de `<MeekoAwait>`\]\([^)]+#meekoawait\)/);
    const [target] = definition(opened, opened.at("MeekoAwait", 3)) ?? [];
    assert.ok(target, "go to definition opens MeekoAwaitProps");
    const declaration = await readFile(new URL(target.uri), "utf8");
    assert.equal(TextDocument.create(target.uri, "typescript", 0, declaration).getText(target.range), "MeekoAwaitProps");
  } finally {
    await workspace.dispose();
  }
});

test("bind:reserve follows its value: the zone key, the head script, the rules and the minimum", { timeout: 60_000 }, async () => {
  const data = installDataServer();
  const { modules, cleanup } = await loadPages();
  try {
    const page = await boot(modules, "https://example.test/toggle");
    try {
      const zone = page.root.querySelector(".zone")!;
      const registry = (): unknown => (page.browser as unknown as Record<symbol, unknown>)[Symbol.for("meeko.await")];
      assert.equal(zone.getAttribute("data-meeko-reserve"), null);
      assert.ok(!page.html.includes(reserveScript), "no reserve, no head script");
      (page.root.querySelector(".reserve") as unknown as HTMLElement).click();
      await flush();
      assert.ok(zone.getAttribute("data-meeko-reserve"), "the zone takes its key");
      assert.equal(zone.getAttribute("data-meeko-reserve-min"), "12rem");
      assert.ok(registry(), "the rules of the reserve are ready in the window");
      assert.ok(page.document.head.innerHTML.includes(reserveScript), "the head script joins the document");
      (page.root.querySelector(".reserve") as unknown as HTMLElement).click();
      await flush();
      assert.equal(zone.getAttribute("data-meeko-reserve"), null);
      assert.ok(!page.document.head.innerHTML.includes(reserveScript), "and leaves it");
      assert.deepEqual(page.errors, []);
    } finally {
      await page.close();
    }
  } finally {
    data.open();
    await cleanup();
  }
});
