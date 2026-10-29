import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window as HappyWindow } from "happy-dom";
import { compile } from "../src/compiler.ts";
import { applyAutoImports, discoverAutoImports } from "../src/autoimports.ts";
import { checkApp } from "../src/framework/check-app.ts";
import { prepareFrameworkTypeDeclarations } from "../src/framework/type-declarations.ts";
import { clientRoutesSource, discoverAppManifest } from "../src/framework/app-manifest.ts";
import { loadMeekoConfig } from "../src/framework/config.ts";
import { serverScriptModule } from "../src/framework/server-script.ts";
import type { ClientComponent, ClientRoute } from "../src/framework/client.ts";
import type { DocumentConfig, DocumentHead, HeadInput } from "../src/framework/head.ts";
import { defineMeekoConfig } from "../src/framework/config-type.ts";
import type { MeekoModuleContext } from "../src/framework/module.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import type { ErrorPageRecord, RouteRecord } from "../src/framework/router.ts";
import { createTempProject, linkRepositoryPackages } from "./helpers/temp-project.ts";
import { loadCheckedMeekoConfig } from "../src/framework/check-project.ts";

const fileUrl = (path: string): string => pathToFileURL(resolve(path)).href;

/** The runtime as the compiled components import it, by file URL: one instance for pages, server and browser. */
const runtime = async () => ({
  ...await import(fileUrl("src/framework/server.ts")) as typeof import("../src/framework/server.ts"),
  ...await import(fileUrl("src/framework/client.ts")) as typeof import("../src/framework/client.ts"),
  ...await import(fileUrl("src/framework/prerender.ts")) as typeof import("../src/framework/prerender.ts"),
  ...await import(fileUrl("src/framework/page-body.ts")) as typeof import("../src/framework/page-body.ts"),
  ...await import(fileUrl("src/framework/head.ts")) as typeof import("../src/framework/head.ts"),
});

const appShell = `<script lang="ts">
import type { Component } from "@meekojs/meeko";
import { useHead } from "@meekojs/meeko/framework";
const props = defineProps<{ outlet: Component<Record<string, unknown>> }>();
useHead({ title: "App", meta: [{ name: "description", content: "app" }], htmlAttrs: { class: "app" } });
</script>
<template><div class="app"><component is="props.outlet"></component></div></template>`;

const shell = `<script lang="ts">
import type { Component } from "@meekojs/meeko";
import { useHead, useSeoMeta } from "@meekojs/meeko/framework";
const props = defineProps<{ outlet: Component<Record<string, unknown>> }>();
useSeoMeta({ ogSiteName: "Meeko", robots: "index" });
useHead({ link: [{ rel: "canonical", href: "https://example.test/shell" }] });
</script>
<template><main><component is="props.outlet"></component></main></template>`;

const badge = `<script lang="ts">
import { useHead } from "@meekojs/meeko/framework";
useHead({ meta: [{ name: "robots", content: "noindex" }] });
</script>
<template><b class="badge">!</b></template>`;

const countPage = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import { useHead } from "@meekojs/meeko/framework";
import * as Badge from "./Badge.meeko";
const count = signal(0);
useHead(() => ({ title: \`\${count.value} items\`, htmlAttrs: { "data-count": String(count.value) } }));
</script>
<template><button class="add" on:click="() => count.value++">+</button><Badge if:when="count.value > 1"></Badge></template>`;

const ogPage = `<script lang="ts">
import { useHead, useSeoMeta } from "@meekojs/meeko/framework";
useSeoMeta({ title: "OG", ogTitle: "OG", ogImage: 'https://example.test/og.png?a=1&b="2"', canonical: "https://example.test/og", twitterCard: "summary_large_image" });
useHead({
  script: [{ children: "window.og = '<" + "/script><b>'" }, { type: "application/ld+json", children: '{"name":"<' + '/script>"}' }],
  style: [{ children: "p { color: red }" }],
  bodyAttrs: { "data-page": "og" },
});
</script>
<template><p class="og">og</p></template>`;

const plainPage = `<template><p class="plain">plain</p></template>`;

const declaredPage = `<script lang="ts">
import { useHead } from "@meekojs/meeko/framework";
useHead({ title: "Ignored", meta: [{ property: "og:title", content: "page" }] });
</script>
<template><p class="declared">declared</p></template>`;

const clientPage = `<script lang="ts">
import { useHead } from "@meekojs/meeko/framework";
useHead({ title: "Client page" });
</script>
<template><p class="client">client</p></template>`;

const errorPage = `<script lang="ts">
import { useHead } from "@meekojs/meeko/framework";
const props = defineProps<{ status: number; message: string }>();
useHead({ meta: [{ name: "robots", content: "noindex" }] });
</script>
<template><p class="error">{props.status}</p></template>`;

const sources: Record<string, string> = {
  "app.meeko": appShell, "shell.meeko": shell, "Badge.meeko": badge, "count.meeko": countPage, "og.meeko": ogPage,
  "plain.meeko": plainPage, "declared.meeko": declaredPage, "client.meeko": clientPage, "error.meeko": errorPage,
};

/** Compiles the components against the source runtime, so the test does not depend on dist/. */
async function loadModules(): Promise<{ modules: Record<string, ClientComponent>; cleanup: () => Promise<void> }> {
  const project = await createTempProject("head-test");
  const directory = project.root;
  await writeFile(join(directory, "package.json"), '{"private":true,"type":"module"}\n');
  const runtimePath = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  for (const [file, source] of Object.entries(sources)) {
    const code = compile(source, join(directory, file)).code
      .replaceAll(`from "@meekojs/meeko/internal"`, `from ${runtimePath("src/internal.ts")}`)
      .replaceAll(`from "@meekojs/meeko/framework"`, `from ${runtimePath("src/framework.ts")}`)
      .replaceAll(`from "@meekojs/meeko"`, `from ${runtimePath("src/index.ts")}`)
      .replace(`"./Badge.meeko"`, `"./Badge.ts"`);
    await writeFile(join(directory, file.replace(/\.meeko$/, ".ts")), code);
  }
  const modules: Record<string, ClientComponent> = {};
  for (const file of Object.keys(sources)) {
    modules[file] = await import(pathToFileURL(join(directory, file.replace(/\.meeko$/, ".ts"))).href) as ClientComponent;
  }
  return { modules, cleanup: () => project.remove() };
}

const layouts = ["app.meeko", "shell.meeko"];
const routes: readonly RouteRecord[] = createRouteManifest([
  { id: "/count", file: "count.meeko", layouts },
  { id: "/og", file: "og.meeko", layouts },
  { id: "/plain", file: "plain.meeko", layouts },
  { id: "/declared", file: "declared.meeko", layouts, sidecar: "declared.route.ts" },
  { id: "/body", file: "plain.meeko", layouts, sidecar: "body.route.ts" },
  { id: "/client", file: "client.meeko", layouts, sidecar: "client.route.ts", render: "client" },
  { id: "/about", file: "plain.meeko", layouts, sidecar: "about.route.ts", render: "prerender" },
  { id: "/broken", file: "plain.meeko", layouts, sidecar: "broken.route.ts", error: "error.meeko" },
  { id: "/stream", file: "og.meeko", layouts, sidecar: "stream.route.ts", render: "stream" },
]);
const appError: ErrorPageRecord = { file: "error.meeko", layouts: ["app.meeko"] };

const documentConfig: DocumentConfig = {
  lang: "es",
  head: {
    titleTemplate: "%s · Site",
    meta: [{ name: "description", content: "site" }],
    link: [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }],
    script: [{ children: "document.documentElement.dataset.boot = '1'" }],
    bodyAttrs: { class: "site" },
  },
};

async function sidecars(): Promise<Record<string, ClientRoute>> {
  const { definePageBody, useHead } = await runtime();
  return {
    "declared.route.ts": { head: () => ({ title: "Declared", description: "from route", meta: [{ property: "og:title", content: "route" }] }) },
    // useHead in top-level <script server> code, merged with `export const head`, which wins.
    "body.route.ts": definePageBody(undefined, async () => {
      useHead({ title: "Body hook", meta: [{ name: "robots", content: "none" }, { name: "author", content: "hook" }] });
      return { data: {}, head: { title: "Body", meta: [{ name: "author", content: "export" }] } };
    }, true) as ClientRoute,
    "client.route.ts": { render: "client" } as ClientRoute,
    "about.route.ts": { render: "prerender" } as ClientRoute,
    "broken.route.ts": { load: () => { throw new Error("private failure"); } },
    "stream.route.ts": { render: "stream", head: () => ({ title: "Streamed" }) } as ClientRoute,
  };
}

async function serve(modules: Record<string, ClientComponent>, document: { config?: DocumentConfig; nonce?: string } = { config: documentConfig }) {
  const { createFrameworkHandler } = await runtime();
  const routeFiles = await sidecars();
  return createFrameworkHandler({
    routes, errorPage: appError,
    loadPage: async (file) => modules[file]!,
    loadRoute: async (file) => routeFiles[file]! as never,
    clientEntry: "/entry.js",
    onError: () => {},
    document: {
      head: "<title>Host</title>",
      ...(document.config ? { config: document.config } : {}),
      ...(document.nonce ? { nonce: () => document.nonce } : {}),
    },
  });
}

const page = (url: string, accept = "text/html") => new Request(url, { headers: { accept } });

/** Apps and windows that a test opened; `closeAll` releases them even after a failed assertion. */
const opened: (() => void)[] = [];
function closeAll(): void {
  for (const close of opened.splice(0).reverse()) {
    try { close(); }
    catch { /* Already released by the test. */ }
  }
}

async function boot(modules: Record<string, ClientComponent>, url: string, options: { document?: string } = {}) {
  const { mountClientApp } = await runtime();
  const server = await serve(modules);
  const browser = new HappyWindow({ url });
  browser.document.write(options.document ?? await (await server(page(url))).text());
  const ssrHead = browser.document.head.innerHTML;
  const routeFiles = await sidecars();
  const errors: unknown[] = [];
  const app = await mountClientApp({
    routes, errorPage: appError, document: documentConfig,
    root: browser.document.getElementById("app") as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    loadClientRoute: async (file) => routeFiles[file]!,
    serverData: true,
    fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
    onNavigationError: (error) => { errors.push(error); },
    browser: browser as unknown as Window,
  });
  opened.push(() => browser.happyDOM.abort(), () => app.dispose());
  return { app, browser, document: browser.document, ssrHead, errors };
}

type Doc = HappyWindow["document"];
const metas = (document: Doc, selector: string): string[] => [...document.head.querySelectorAll(selector)].map((meta) => meta.getAttribute("content") ?? "");
const hrefs = (document: Doc, selector: string): string[] => [...document.head.querySelectorAll(selector)].map((link) => link.getAttribute("href") ?? "");

const flush = async (): Promise<void> => {
  for (let index = 0; index < 10; index++) await new Promise((done) => setTimeout(done, 0));
};

test("SSR writes the document config and useHead with precedence, deduplication, escaping and the CSP nonce", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const server = await serve(modules, { config: documentConfig, nonce: "n1" });
    const html = await (await server(page("https://example.test/og"))).text();
    // lang from the config, class from app.meeko; the body attributes merge config and page.
    assert.match(html, /^<!doctype html><html lang="es" class="app"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><!--meeko:head-->/);
    assert.match(html, /<body class="site" data-page="og"><div id="app">/);
    // The page's title, with the config template; the host title stays after the managed head.
    assert.match(html, /<!--meeko:head--><title>OG · Site<\/title>/);
    assert.match(html, /<!--\/meeko:head--><title>Host<\/title><\/head>/);
    // One description (app.meeko over the config), one canonical (the page over its layout) and
    // one icon: the config's replaces the default.
    assert.equal(html.match(/name="description"/g)?.length, 1);
    assert.match(html, /<meta name="description" content="app">/);
    assert.equal(html.match(/rel="canonical"/g)?.length, 1);
    assert.match(html, /<link rel="canonical" href="https:\/\/example.test\/og">/);
    assert.equal(html.match(/rel="icon"/g)?.length, 1);
    assert.match(html, /<link rel="icon" href="\/favicon.svg" type="image\/svg\+xml">/);
    // useSeoMeta: property for Open Graph, name for the others; attributes are escaped.
    assert.match(html, /<meta property="og:title" content="OG">/);
    assert.match(html, /<meta property="og:image" content="https:\/\/example.test\/og.png\?a=1&amp;b=&quot;2&quot;">/);
    assert.match(html, /<meta name="twitter:card" content="summary_large_image">/);
    assert.match(html, /<meta property="og:site_name" content="Meeko">/);
    assert.match(html, /<meta name="robots" content="index">/);
    // Inline code is not escaped, but cannot close its element; JSON escapes every <.
    assert.match(html, /<script nonce="n1">window.og = '<\\\/script><b>'<\/script>/);
    assert.match(html, /<script type="application\/ld\+json" nonce="n1">\{"name":"\\u003c\/script>"\}<\/script>/);
    assert.match(html, /<script nonce="n1">document.documentElement.dataset.boot = '1'<\/script>/);
    assert.match(html, /<style nonce="n1">p \{ color: red \}<\/style>/);
    // Three head scripts, the payload and the client entry: no inline content closed its script early.
    assert.equal(html.match(/<\/script>/g)?.length, 5);
    // A stream route writes the same head before its first byte.
    const streamed = await (await server(page("https://example.test/stream"))).text();
    assert.match(streamed, /^<!doctype html><html lang="es" class="app">.*<!--meeko:head--><title>Streamed · Site<\/title>.*<meta property="og:title" content="OG">/s);
    assert.match(streamed, /<body class="site" data-page="og">/);
  } finally {
    await cleanup();
  }
});

test("the route head wins over useHead, also in top-level server code, and travels in the payload", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const server = await serve(modules);
    const html = await (await server(page("https://example.test/declared"))).text();
    assert.match(html, /<title>Declared · Site<\/title>/);
    assert.match(html, /<meta name="description" content="from route">/);
    assert.match(html, /<meta property="og:title" content="route">/);
    assert.doesNotMatch(html, /content="page"|Ignored/);
    const payload = await (await server(page("https://example.test/declared", "application/meeko+json"))).json() as { head: unknown };
    assert.deepEqual(payload.head, { title: "Declared", description: "from route", meta: [{ property: "og:title", content: "route" }] });

    const body = await (await server(page("https://example.test/body"))).text();
    assert.match(body, /<title>Body · Site<\/title>/);
    assert.match(body, /<meta name="robots" content="none">/);
    assert.match(body, /<meta name="author" content="export">/);
    assert.doesNotMatch(body, /content="hook"/);
  } finally {
    await cleanup();
  }
});

test("hydration adopts the SSR head without duplicates and useHead updates it reactively", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const { document, ssrHead, errors } = await boot(modules, "https://example.test/count");
    assert.equal(document.head.innerHTML, ssrHead, "hydration leaves the SSR head as it is");
    assert.equal(document.title, "0 items · Site");
    assert.equal(document.documentElement.getAttribute("data-count"), "0");
    assert.equal(document.documentElement.getAttribute("lang"), "es");
    (document.querySelector(".add") as unknown as HTMLElement).click();
    assert.equal(document.title, "1 items · Site");
    assert.equal(document.documentElement.getAttribute("data-count"), "1");
    assert.deepEqual(metas(document, 'meta[name="robots"]'), ["index"]);
    // A component mounted later outranks its layout; its entry leaves when it unmounts.
    (document.querySelector(".add") as unknown as HTMLElement).click();
    assert.ok(document.querySelector(".badge"));
    assert.deepEqual(metas(document, 'meta[name="robots"]'), ["noindex"]);
    assert.equal(document.title, "2 items · Site");
    assert.deepEqual(errors, []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("navigation removes the entries of the released page and restores what they replaced", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const { app, document, ssrHead, errors } = await boot(modules, "https://example.test/og");
    assert.equal(document.head.innerHTML, ssrHead);
    assert.equal(await app.navigate("/plain"), true);
    assert.equal(document.title, "App · Site");
    assert.deepEqual(hrefs(document, 'link[rel="canonical"]'), ["https://example.test/shell"]);
    assert.deepEqual(metas(document, 'meta[property="og:image"]'), []);
    assert.deepEqual(metas(document, 'meta[name="description"]'), ["app"]);
    assert.equal(document.head.querySelectorAll("style").length, 0);
    assert.equal(document.body.getAttribute("data-page"), null);
    assert.equal(document.body.getAttribute("class"), "site");
    assert.equal(await app.navigate("/declared"), true);
    assert.equal(document.title, "Declared · Site");
    assert.deepEqual(metas(document, 'meta[name="description"]'), ["from route"]);
    assert.deepEqual(metas(document, 'meta[property="og:title"]'), ["route"]);
    assert.equal(await app.navigate("/og"), true);
    assert.equal(document.title, "OG · Site");
    assert.deepEqual(hrefs(document, 'link[rel="canonical"]'), ["https://example.test/og"]);
    assert.deepEqual(metas(document, 'meta[property="og:title"]'), ["OG"]);
    assert.deepEqual(metas(document, 'meta[name="description"]'), ["app"]);
    assert.equal(document.body.getAttribute("data-page"), "og");
    assert.equal(hrefs(document, 'link[rel="icon"]').length, 1);
    // Back to the first page: the same tags as its SSR document, once each.
    assert.equal(await app.navigate("/plain"), true);
    assert.equal(await app.navigate("/og"), true);
    for (const selector of ['meta[property="og:image"]', 'meta[name="twitter:card"]', 'link[rel="canonical"]', 'meta[name="description"]']) {
      assert.equal(document.head.querySelectorAll(selector).length, 1, selector);
    }
    assert.equal(document.head.querySelectorAll("script:not([type])").length, 2);
    assert.deepEqual(errors, []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("a render: client shell has the layouts' head, and the page's after it commits", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const server = await serve(modules);
    const shellHtml = await (await server(page("https://example.test/client"))).text();
    assert.match(shellHtml, /<html lang="es" class="app">/);
    assert.match(shellHtml, /<title>App · Site<\/title>/);
    const { document, errors } = await boot(modules, "https://example.test/client");
    await flush();
    assert.ok(document.querySelector(".client"));
    assert.equal(document.title, "Client page · Site");
    assert.deepEqual(errors, []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("prerendered documents keep the head and insert the CSRF meta tag after the charset and defaults", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  const output = await mkdtemp(join(tmpdir(), "meeko-head-prerender-"));
  try {
    const { prerenderRoutes } = await runtime();
    const server = await serve(modules);
    const routeFiles = await sidecars();
    await prerenderRoutes({ routes, handler: server, loadRoute: async (file) => routeFiles[file]! as never, outputRoot: output });
    const index = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")) as { pages: Record<string, { file: string; headOffset: number }> };
    const entry = index.pages["/about"]!;
    const html = await readFile(join(output, entry.file), "utf8");
    const prefix = '<!doctype html><html lang="es" class="app"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">';
    assert.ok(html.startsWith(prefix));
    assert.equal(entry.headOffset, prefix.length);
    assert.match(html, /<title>App · Site<\/title>/);
    const { document, ssrHead } = await boot(modules, "https://example.test/about", { document: html });
    assert.equal(document.head.innerHTML, ssrHead);
  } finally {
    closeAll();
    await rm(output, { recursive: true, force: true });
    await cleanup();
  }
});

test("error pages render the document config and their own useHead", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const server = await serve(modules, { config: documentConfig, nonce: "n2" });
    const missing = await server(page("https://example.test/missing"));
    assert.equal(missing.status, 404);
    const notFound = await missing.text();
    assert.match(notFound, /<html lang="es" class="app">/);
    assert.match(notFound, /<title>Error · Site<\/title>/);
    assert.match(notFound, /<meta name="robots" content="noindex">/);
    const broken = await server(page("https://example.test/broken"));
    assert.equal(broken.status, 500);
    const failure = await broken.text();
    assert.match(failure, /^<!doctype html><html lang="es"><head><meta charset="utf-8">/);
    assert.match(failure, /<title>Error · Site<\/title>/);
    assert.match(failure, /<script nonce="n2">document.documentElement.dataset.boot = '1'<\/script>/);
    assert.match(failure, /<body class="site">/);
    assert.doesNotMatch(failure, /private failure/);
    // Hydrated from the 404 document, navigation keeps the managed head consistent.
    const { app, document, ssrHead } = await boot(modules, "https://example.test/missing");
    assert.equal(document.head.innerHTML, ssrHead);
    assert.equal(await app.navigate("/plain"), true);
    assert.equal(document.title, "App · Site");
    assert.deepEqual(metas(document, 'meta[name="robots"]'), ["index"]);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("without a document config every document starts as before", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const { DOCUMENT_HEAD_PREFIX, createFrameworkHandler } = await runtime();
    const server = createFrameworkHandler({
      routes: createRouteManifest([{ id: "/", file: "plain.meeko", layouts: [] }]),
      loadPage: async (file) => modules[file]!,
    });
    const html = await (await server(page("https://example.test/"))).text();
    assert.equal(html, `${DOCUMENT_HEAD_PREFIX}<!--meeko:head--><!--/meeko:head--></head><body><div id="app"><p class="plain">plain</p></div><script id="meeko-payload" type="application/json">{"v":2,"route":"/","render":"ssr","url":"/","props":{"params":{},"search":{}},"state":{},"sharedState":{},"head":{}}</script></body></html>`);
  } finally {
    await cleanup();
  }
});

test("tags created in the browser carry the CSP nonce of the document and changed scripts are new elements", async () => {
  const { BrowserHead } = await runtime();
  const browser = new HappyWindow({ url: "https://example.test/" });
  browser.document.write('<!doctype html><html><head><meta charset="utf-8"><!--meeko:head--><!--/meeko:head--></head><body><script type="module" nonce="n9" src="/entry.js"></script></body></html>');
  const document = browser.document as unknown as Document;
  const head = new BrowserHead(document, undefined);
  const entry = head.register(0);
  head.update(entry, { script: [{ key: "a", children: "window.a = 1" }], style: [{ children: "p{}" }] });
  const first = document.head.querySelector("script")!;
  assert.equal(first.getAttribute("nonce"), "n9");
  assert.equal(document.head.querySelector("style")!.getAttribute("nonce"), "n9");
  head.update(entry, { script: [{ key: "a", children: "window.a = 2" }] });
  const second = document.head.querySelector("script")!;
  assert.notEqual(second, first);
  assert.equal(second.textContent, "window.a = 2");
  assert.equal(document.head.querySelectorAll("script, style").length, 1);
  head.remove(entry);
  assert.equal(document.head.querySelectorAll("script, style").length, 0);
  browser.happyDOM.abort();
});

test("useSeoMeta maps each field to name, property or the canonical link", async () => {
  const { seoMetaHead } = await runtime();
  assert.deepEqual(seoMetaHead({
    title: "T", description: "D", ogTitle: "OT", ogImageWidth: 1200, ogLocale: "es_ES", twitterSite: "@meeko",
    themeColor: "#000", canonical: "https://example.test/", robots: null, ogUrl: undefined,
  }), {
    title: "T",
    meta: [
      { name: "description", content: "D" },
      { property: "og:title", content: "OT" },
      { property: "og:image:width", content: "1200" },
      { property: "og:locale", content: "es_ES" },
      { name: "twitter:site", content: "@meeko" },
      { name: "theme-color", content: "#000" },
    ],
    link: [{ rel: "canonical", href: "https://example.test/" }],
  });
  assert.throws(() => seoMetaHead({ ogtitle: "x" } as never), /unknown field ogtitle/);
});

test("meta media is rendered and keeps one entry per media in the deduplication", async () => {
  const { documentHeadEntries, renderHeadDocument, resolveHead } = await runtime();
  const config: DocumentConfig = { head: { meta: [
    { name: "theme-color", content: "#fff", media: "(prefers-color-scheme: light)" },
    { name: "theme-color", content: "#000", media: "(prefers-color-scheme: dark)" },
  ] } };
  const route = { meta: [{ name: "theme-color", content: "#111", media: "(prefers-color-scheme: dark)" }] };
  const { prefix, head } = renderHeadDocument(resolveHead(documentHeadEntries(config, route)), undefined);
  const html = prefix + head;
  assert.match(html, /<meta name="theme-color" content="#fff" media="\(prefers-color-scheme: light\)">/);
  assert.match(html, /<meta name="theme-color" content="#111" media="\(prefers-color-scheme: dark\)">/);
  assert.doesNotMatch(html, /content="#000"/, "the route replaces the entry with the same media");
});

test("head inputs are validated: attribute names, event handlers and serializable configs", async () => {
  const { normalizeHeadInput, normalizeDocumentConfig, resolveHead } = await runtime();
  assert.throws(() => normalizeHeadInput({ htmlAttrs: { onclick: "x()" } }, "useHead"), /event handler attribute onclick/);
  assert.throws(() => normalizeHeadInput({ bodyAttrs: { "a b": "x" } }, "useHead"), /invalid attribute name/);
  assert.throws(() => normalizeHeadInput({ description: "x" }, "useHead"), /useSeoMeta/);
  assert.throws(() => normalizeHeadInput({ script: [{}] }, "useHead"), /needs either src or children/);
  assert.throws(() => normalizeDocumentConfig({ head: { titleTemplate: (title: string) => title } }, "document"), /titleTemplate must be a string/);
  // Natural keys: meta name, link rel+href (canonical and icon unique), script src; explicit keys win.
  const head = resolveHead([
    { level: 0, order: 0, input: { meta: [{ name: "Robots", content: "a" }], link: [{ rel: "alternate", href: "/a" }, { rel: "alternate", href: "/b" }], script: [{ src: "/x.js" }] } },
    { level: 1, order: 0, input: { meta: [{ name: "robots", content: "b" }, { key: "k", name: "robots", content: "c" }], link: [{ rel: "alternate", href: "/a", hreflang: "en" }], script: [{ src: "/x.js", defer: true }] } },
  ]);
  assert.deepEqual(head.tags.filter((tag) => !tag.fallback).map((tag) => tag.attributes.map(([name, value]) => `${name}=${String(value)}`).join(" ")), [
    "name=robots content=b", "name=robots content=c",
    "rel=alternate href=/a hreflang=en", "rel=alternate href=/b",
    "src=/x.js defer=true",
  ]);
});

test("the document config title is the site title: never templated, and the fallback of empty page titles", async () => {
  const { resolveHead, documentHeadEntries, resolveDocumentConfig } = await runtime();
  const site: DocumentConfig = { head: { title: "Mi Sitio", titleTemplate: "%s - Mi Sitio" } };
  const title = (config: DocumentConfig | undefined, route: HeadInput | undefined, ...levels: Array<HeadInput | undefined>): string | undefined =>
    resolveHead([...documentHeadEntries(config, route), ...levels.map((input, level) => ({ level, order: level, input }))]).title;
  // An untitled page shows the site title as is, not "Mi Sitio - Mi Sitio".
  assert.equal(title(site, undefined), "Mi Sitio");
  assert.equal(title(site, undefined, {}, { meta: [{ name: "robots", content: "noindex" }] }), "Mi Sitio");
  // Titles of app.meeko, layouts, pages and the route are templated.
  assert.equal(title(site, undefined, undefined, { title: "Precios" }), "Precios - Mi Sitio");
  assert.equal(title(site, { title: "Ruta" }, { title: "App" }), "Ruta - Mi Sitio");
  // An empty winning title falls back to the site title, untemplated, also over a layout's title.
  assert.equal(title(site, undefined, { title: "" }), "Mi Sitio");
  assert.equal(title(site, { title: "" }, { title: "Blog" }), "Mi Sitio");
  assert.equal(title(site, undefined, { title: "Blog" }, { title: "" }), "Mi Sitio");
  // A layout's template (even a function) applies to page titles, never to the site title.
  const brackets: HeadInput = { titleTemplate: (value) => `[${value}]` };
  assert.equal(title(site, undefined, brackets), "Mi Sitio");
  assert.equal(title(site, undefined, brackets, { title: "Precios" }), "[Precios]");
  // Without a site title: an untitled page has none, an empty title stays empty and untemplated.
  const templateOnly: DocumentConfig = { head: { titleTemplate: "%s - Mi Sitio" } };
  assert.equal(title(templateOnly, undefined), undefined);
  assert.equal(title(templateOnly, undefined, { title: "" }), "");
  assert.equal(title(templateOnly, undefined, { title: "Precios" }), "Precios - Mi Sitio");
  // A module's title joins document.head: a site title too, and document.head's own wins.
  assert.equal(title(resolveDocumentConfig(templateOnly, [{ title: "Módulo" }]), undefined), "Módulo");
  assert.equal(title(resolveDocumentConfig(site, [{ title: "Módulo" }]), undefined), "Mi Sitio");
  assert.equal(title(resolveDocumentConfig(templateOnly, [{ title: "Módulo" }]), { title: "Precios" }), "Precios - Mi Sitio");
});

test("client navigation applies the same title rule to the document", async () => {
  const { BrowserHead } = await runtime();
  const browser = new HappyWindow({ url: "https://example.test/" });
  try {
    const document = browser.document;
    const head = new BrowserHead(document as unknown as Document, { head: { title: "Mi Sitio", titleTemplate: "%s - Mi Sitio" } });
    head.setRoute({});
    assert.equal(document.title, "Mi Sitio");
    head.setRoute({ title: "Precios" });
    assert.equal(document.title, "Precios - Mi Sitio");
    head.setRoute({ title: "" });
    assert.equal(document.title, "Mi Sitio");
    // The route head's empty title wins over a layout's; without it, the layout's is templated.
    const entry = head.register(1);
    head.update(entry, { title: "Layout" });
    assert.equal(document.title, "Mi Sitio");
    head.setRoute({});
    assert.equal(document.title, "Layout - Mi Sitio");
    head.remove(entry);
    assert.equal(document.title, "Mi Sitio");
    head.dispose();
  } finally {
    await browser.happyDOM.abort();
  }
});

// Type-level checks, compiled by `tsc -p tsconfig.test.json` and never run.
if (false) {
  const module = undefined as unknown as MeekoModuleContext;
  defineMeekoConfig({ document: { head: { title: "Mi Sitio", titleTemplate: "%s - Mi Sitio" } } });
  // @ts-expect-error document is baked into the build as JSON: titleTemplate is only a string.
  defineMeekoConfig({ document: { head: { titleTemplate: (title: string) => (title ? `${title} - Mi Sitio` : "Mi Sitio") } } });
  defineMeekoConfig({
    document: {
      head: {
        // @ts-expect-error The method form of the report is a type error at titleTemplate.
        titleTemplate(title) { return title ? `${title} - Mi Sitio` : "Mi Sitio"; },
      },
    },
  });
  const head: DocumentHead = { title: "Mi Sitio", titleTemplate: "%s - Mi Sitio" };
  // A document head is still a head input; useHead keeps the function form.
  const input: HeadInput = { ...head, titleTemplate: (title) => title };
  void input;
  module.addHead({ title: "Módulo", meta: [{ name: "generator", content: "x" }] });
  // @ts-expect-error A module head joins document: titleTemplate is only a string.
  module.addHead({ titleTemplate: (title: string) => title });
}

test("useHead at the top level of <script server> gives the block top-level code", () => {
  const source = '<script server lang="ts">\nuseHead({ meta: [{ name: "robots", content: "noindex" }] });\n</script>\n<template><p>x</p></template>\n';
  assert.ok(serverScriptModule(source, "/app/pages/index.meeko"));
  const nested = '<script server lang="ts">\nconst later = () => useHead({ title: "x" });\n</script>\n<template><p>x</p></template>\n';
  assert.equal(serverScriptModule(nested, "/app/pages/index.meeko"), undefined);
});

test("document config is validated and baked into the server and client manifests", { timeout: 30_000 }, async () => {
  const project = await createTempProject("head-config");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await mkdir(join(root, "app", "pages"), { recursive: true });
    await writeFile(join(root, "app", "pages", "index.meeko"), "<template><h1>Inicio</h1></template>\n");
    await writeFile(join(root, "meeko.config.mjs"), 'export default { document: { lang: "es", head: { titleTemplate: "%s · Meeko", script: [{ children: "1" }] } } };\n');
    const { manifest } = await discoverAppManifest(root, { entry: "/entry.js", css: [], preload: [] });
    assert.deepEqual(manifest.document, { lang: "es", head: { titleTemplate: "%s · Meeko", script: [{ children: "1" }] } });
    assert.match(await clientRoutesSource(root), /export const documentConfig = \{"lang":"es"/);
    await writeFile(join(root, "meeko.config.mjs"), "export default { document: { head: { titleTemplate: (title) => title } } };\n");
    await assert.rejects(loadMeekoConfig(root), /document\.head: titleTemplate must be a string/);
  } finally {
    await project.remove();
  }
});

test("meeko check reports a function titleTemplate of document.head as a type error at its line in meeko.config.ts", { timeout: 120_000 }, async () => {
  const project = await createTempProject("head-config-types");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await linkRepositoryPackages(root);
    const config = "import { defineMeekoConfig } from '@meekojs/meeko/framework'\n\nexport default defineMeekoConfig({\n  document: {\n    head: {\n      title: 'Mi Sitio',\n      titleTemplate(title) {\n        return title ? `${title} - Mi Sitio` : 'Mi Sitio'\n      },\n    },\n  },\n})\n";
    await writeFile(join(root, "meeko.config.ts"), config);
    const error = await loadCheckedMeekoConfig(root).then(() => undefined, (failure: unknown) => failure as Error);
    assert.ok(error, "the configuration does not load");
    const file = join(root, "meeko.config.ts");
    // The TypeScript error at titleTemplate (line 7) comes first, then the runtime one.
    const lines = error.message.split("\n");
    assert.ok(lines[0]!.startsWith(`${file}:7:7 TS2322: `), error.message);
    assert.match(error.message, /document\.head: titleTemplate must be a string here, since it is serialized$/);
    // A valid configuration loads as before.
    await writeFile(file, config.replace(/titleTemplate\(title\) \{[\s\S]*?\n      \},/, "titleTemplate: '%s - Mi Sitio',"));
    const later = new Date(Date.now() + 5_000);
    await utimes(file, later, later);
    assert.deepEqual((await loadCheckedMeekoConfig(root)).document, { head: { title: "Mi Sitio", titleTemplate: "%s - Mi Sitio" } });
  } finally {
    await project.remove();
  }
});

test("useHead and useSeoMeta are framework autoimports that a project composable of the same name replaces", { timeout: 30_000 }, async () => {
  const project = await createTempProject("head-autoimport");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    const filename = join(root, "app", "pages", "index.meeko");
    const registry = await discoverAutoImports(root);
    assert.match(applyAutoImports('useHead({ title: "x" });', filename, registry, "client"), /import \{ useHead as useHead \} from "@meekojs\/meeko\/framework"/);
    assert.match(applyAutoImports('useSeoMeta({ title: "x" });', filename, registry, "server"), /import \{ useSeoMeta as useSeoMeta \} from "@meekojs\/meeko\/framework"/);
    await mkdir(join(root, "app", "composables"), { recursive: true });
    await writeFile(join(root, "app", "composables", "head.ts"), "export function useHead() { return 1; }\n");
    const own = await discoverAutoImports(root);
    assert.equal(own.filter((entry) => entry.name === "useHead").length, 1);
    assert.match(applyAutoImports("useHead();", filename, own, "client"), /composables\/head\.js/);
  } finally {
    await project.remove();
  }
});

const headPage = (title: string) => `<script lang="ts">
const count = signal(0);
useHead(() => ({ title: ${title}, meta: [{ name: "robots", content: "noindex" }] }));
useSeoMeta({ ogTitle: "Inicio", twitterCard: "summary" });
</script>
<template><button on:click="() => count.value++">{count.value}</button></template>
`;

test("meeko check types the useHead and useSeoMeta autoimports in a page", { timeout: 120_000 }, async () => {
  const project = await createTempProject("head-check");
  const root = project.root;
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await mkdir(join(root, "app", "pages"), { recursive: true });
    const file = join(root, "app", "pages", "index.meeko");
    await writeFile(file, headPage("`${count.value} clics`"));
    await prepareFrameworkTypeDeclarations(root);
    assert.deepEqual((await checkApp(root)).map((item) => `${item.filename}:${item.code}: ${item.message}`), []);
    await writeFile(file, headPage("count.value"));
    const invalid = await checkApp(root);
    assert.ok(invalid.some((item) => item.filename === file && /TS2322|TS2345/.test(item.code) && /title/.test(item.message)), JSON.stringify(invalid));
  } finally {
    await project.remove();
  }
});
