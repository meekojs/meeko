import { Window } from "happy-dom";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import type { ClientComponent } from "../src/app/runtime/client.ts";
import type { TrustedHtml } from "../src/index.ts";

import { PAYLOAD_VERSION } from "../src/app/definitions/define-page.ts";
import { mountClientApp } from "../src/app/runtime/client.ts";
import { defer } from "../src/app/runtime/deferred.ts";
import { createRouteManifest } from "../src/app/runtime/router.ts";
import { compile } from "../src/compiler.ts";
import { collectRenderedHtml, rawHtml } from "../src/core/server.ts";
import { createFrameworkHandler } from "../src/framework-server.ts";
import { documentHtml } from "../src/framework.ts";
import { prerenderRoutes } from "../src/framework/prerender.ts";
import { trustHtml } from "../src/index.ts";
import { documentHtmlIndex, documentHtmlPlaceholder } from "../src/shared/document-html.ts";

const article = trustHtml(`<h2 id="a">Título</h2><p>Un párrafo con <code>&lt;código&gt;</code>.</p>`);
const payloadScript = /<script id="meeko-payload" type="application\/json">([^<]*)<\/script>/;

interface PageData {
  doc: { html: string; other?: string };
  copy?: string;
}

/** A handler for one page whose render reads `html` as `render` says, with the real `rawHtml`. */
function handler(load: () => PageData, render: (data: PageData) => string = (data) => `<article data-meeko-h="0">${rawHtml(data.doc.html, "article")}</article>`): (request: Request) => Promise<Response> {
  const page = {
    renderWithState(props: Record<string, unknown>) {
      return { html: render(props.data as PageData), state: {} };
    },
  };
  return createFrameworkHandler({
    routes: createRouteManifest([{ id: "/guide", file: "/guide.meeko", layouts: [], sidecar: "/guide.route.ts" }]),
    loadPage: async () => page,
    loadRoute: async () => ({ load }),
    clientEntry: "/assets/entry.js",
  });
}

const requestDocument = (): Request => new Request("http://local/guide", { headers: { accept: "text/html" } });
const requestNavigation = (): Request => new Request("http://local/guide", { headers: { accept: "application/meeko+json" } });

async function documentPayload(response: Response): Promise<{ html: string; payload: Record<string, unknown> & { props: { data: PageData }; documentHtml?: unknown } }> {
  const html = await response.text();
  return { html, payload: JSON.parse(payloadScript.exec(html)![1]!) };
}

test("a marked value travels once in the document and whole in a navigation", async () => {
  const handle = handler(() => ({ doc: { html: documentHtml(article), other: "texto" } }));
  const first = await documentPayload(await handle(requestDocument()));
  assert.ok(first.html.includes(`<article data-meeko-h="0">${article}</article>`), "the document has the HTML");
  assert.equal(first.payload.props.data.doc.html, documentHtmlPlaceholder(0));
  assert.equal(first.payload.props.data.doc.other, "texto");
  assert.equal((first.payload.documentHtml as string[]).length, 1);
  assert.equal(first.html.split("Un párrafo").length - 1, 1, "only the HTML of the page has the text");
  const navigation = JSON.parse(await (await handle(requestNavigation())).text()) as { props: { data: PageData }; documentHtml?: unknown };
  assert.equal(navigation.props.data.doc.html, article);
  assert.equal(navigation.documentHtml, undefined);
});

test("every copy of a marked value is a placeholder of the same position", async () => {
  const handle = handler(() => {
    const html = documentHtml(article);
    return { doc: { html }, copy: html };
  });
  const { payload } = await documentPayload(await handle(requestDocument()));
  assert.equal(payload.props.data.copy, documentHtmlPlaceholder(0));
  assert.equal((payload.documentHtml as string[]).length, 1);
});

test("a marked value the HTML does not show keeps travelling in the payload", async () => {
  // A closed if: the browser may mount it later.
  const hidden = await documentPayload(await handler(() => ({ doc: { html: documentHtml(article) } }), () => "<p>cerrado</p>")(requestDocument()));
  assert.equal(hidden.payload.props.data.doc.html, article);
  assert.equal(hidden.payload.documentHtml, undefined);
  // Content the browser would take out of a <p>: the SSR leaves it empty and hydration fills it.
  const block = trustHtml(`<div>bloque</div>`);
  const empty = await documentPayload(await handler(() => ({ doc: { html: documentHtml(block) } }), (data) => `<p data-meeko-h="0">${rawHtml(data.doc.html, "p")}</p>`)(requestDocument()));
  assert.ok(empty.html.includes(`<p data-meeko-h="0"></p>`));
  assert.equal(empty.payload.props.data.doc.html, block);
  // An empty value stays empty, so a condition on it reads the same on both sides.
  const none = await documentPayload(await handler(() => ({ doc: { html: documentHtml(trustHtml("")) } }))(requestDocument()));
  assert.equal(none.payload.props.data.doc.html, "");
});

test("a value without the mark is untouched, and marks do not reach another request", async () => {
  let mark = true;
  const handle = handler(() => ({ doc: { html: mark ? documentHtml(article) : article } }));
  assert.equal((await documentPayload(await handle(requestDocument()))).payload.props.data.doc.html, documentHtmlPlaceholder(0));
  mark = false;
  const plain = await documentPayload(await handle(requestDocument()));
  assert.equal(plain.payload.props.data.doc.html, article);
  assert.equal(plain.payload.documentHtml, undefined);
  // Outside a request, the same string and no mark to leak into a later one.
  assert.equal(documentHtml(article), article);
});

test("data that cannot travel still fails with a mark", async () => {
  const errors: unknown[] = [];
  const page = { renderWithState: () => ({ html: `<article data-meeko-h="0">${rawHtml(article, "article")}</article>`, state: {} }) };
  const handle = createFrameworkHandler({
    routes: createRouteManifest([{ id: "/guide", file: "/guide.meeko", layouts: [], sidecar: "/guide.route.ts" }]),
    loadPage: async () => page,
    loadRoute: async () => ({ load: () => ({ html: documentHtml(article), date: new Date(0) }) }),
    onError: (error) => errors.push(error),
  });
  const response = await handle(requestDocument());
  assert.equal(response.status, 500);
  assert.match(String(errors[0]), /Non-plain object|toJSON/);
});

test("a stream document leaves the value out, and its navigation has it on the first line", async () => {
  const stream = createFrameworkHandler({
    routes: createRouteManifest([{ id: "/guide", file: "/guide.meeko", layouts: [], sidecar: "/guide.route.ts", render: "stream" }]),
    loadPage: async () => ({ renderWithState: (props: Record<string, unknown>) => ({ html: `<article data-meeko-h="0">${rawHtml((props.data as PageData).doc.html, "article")}</article>`, state: {} }) }),
    loadRoute: async () => ({ render: "stream", load: () => ({ doc: { html: documentHtml(article) } }) }),
  });
  const { payload } = await documentPayload(await stream(requestDocument()));
  assert.equal(payload.props.data.doc.html, documentHtmlPlaceholder(0));
  const navigation = await (await stream(requestNavigation())).text();
  assert.equal((JSON.parse(navigation.split("\n", 1)[0]!) as { props: { data: PageData } }).props.data.doc.html, article);
});

test("a prerendered document stores the navigation payload with the whole value", async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const output = await mkdtemp(resolve(".meeko", "document-html-"));
  try {
    await prerenderRoutes({
      routes: createRouteManifest([{ id: "/guide", file: "/guide.meeko", layouts: [], render: "prerender" }]),
      handler: handler(() => ({ doc: { html: documentHtml(article) } })),
      outputRoot: output,
    });
    const stored = await readFile(join(output, "guide", "index.html"), "utf8");
    assert.equal(JSON.parse(payloadScript.exec(stored)![1]!).props.data.doc.html, documentHtmlPlaceholder(0));
    const navigation = JSON.parse(await readFile(join(output, "guide", "index.meeko.json"), "utf8")) as { props: { data: PageData } };
    assert.equal(navigation.props.data.doc.html, article);
  } finally {
    await rm(output, { recursive: true, force: true });
  }
});

test("rawHtml reports only what reaches the HTML", () => {
  const seen = new Map<string, boolean>();
  collectRenderedHtml(seen, () => {
    rawHtml("<b>a</b>", "div");
    rawHtml("<div>b</div>", "p");
    rawHtml("<div>c</div>", "article");
    rawHtml("<div>c</div>", "p");
    rawHtml("<div>d</div>", "p");
    rawHtml("<div>d</div>", "article");
    rawHtml(null, "div");
  });
  assert.deepEqual([...seen], [["<b>a</b>", true], ["<div>b</div>", false], ["<div>c</div>", false], ["<div>d</div>", false]]);
  rawHtml("<i>fuera</i>", "div");
  assert.equal(seen.has("<i>fuera</i>"), false);
});

test("the placeholder is recognized exactly", () => {
  assert.equal(documentHtmlIndex(documentHtmlPlaceholder(3)), 3);
  assert.equal(documentHtmlIndex(`${documentHtmlPlaceholder(3)}<b>x</b>`), undefined);
  assert.equal(documentHtmlIndex("<!--meeko:document-html:x-->"), undefined);
});

test("documentHtml only takes HTML declared trusted", () => {
  // @ts-expect-error A plain string has not been declared trusted.
  const plain: TrustedHtml = documentHtml("<b>x</b>");
  assert.equal(plain, "<b>x</b>");
});

interface RuntimeModule {
  renderToString(props: Record<string, unknown>): string;
  hydrate(root: Element, props: Record<string, unknown>): () => void;
}

const placeholder = documentHtmlPlaceholder(0);
const toggling = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ body: string }>();
const open = signal(true);
</script>
<template><section if:when="open.value"><article class="doc" html="props.body"></article></section><button type="button" class="toggle" on:click="() => open.value = !open.value">t</button></template>`;

async function loadComponent(source: string): Promise<{ component: RuntimeModule; provide: { run<T>(reader: (index: number) => Promise<string | undefined>, body: () => T): T }; cleanup: () => Promise<void> }> {
  await mkdir(resolve(".meeko"), { recursive: true });
  const directory = await mkdtemp(resolve(".meeko", "document-html-"));
  const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  const code = compile(source, join(directory, "Doc.meeko")).code
    .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
    .replaceAll(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`);
  await writeFile(join(directory, "Doc.ts"), code);
  const component = await import(pathToFileURL(join(directory, "Doc.ts")).href) as RuntimeModule;
  const { createRoot } = await import("../src/core/reactivity.ts");
  const { provideDocumentHtmlReader } = await import("../src/app/runtime/renderer.ts");
  return {
    component,
    provide: { run: (reader, body) => createRoot(() => { provideDocumentHtmlReader(reader); return body(); }) },
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

test("hydration adopts the server's content without touching it", async () => {
  const { component, cleanup } = await loadComponent(toggling);
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    root.innerHTML = component.renderToString({ body: article });
    const heading = root.querySelector("h2");
    const content = root.querySelector("article")!.innerHTML;
    const changes: unknown[] = [];
    const observer = new window.MutationObserver((records) => changes.push(...records));
    observer.observe(root, { childList: true, subtree: true, characterData: true, attributes: true });
    const release = component.hydrate(root as unknown as Element, { body: placeholder });
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(root.querySelector("h2"), heading, "the nodes of the article stay");
    assert.equal(root.querySelector("article")!.innerHTML, content);
    assert.deepEqual(changes, [], "hydration writes nothing");
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("painting a marked value again asks the server, never the DOM", async () => {
  const { component, provide, cleanup } = await loadComponent(toggling);
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    window.document.body.append(root);
    root.innerHTML = component.renderToString({ body: article });
    // A script of the page rewrites the article: this must not reach the next render.
    root.querySelector("article")!.innerHTML = `<img src="x" onerror="alert(1)">`;
    const asked: number[] = [];
    const release = provide.run(async (index) => {
      asked.push(index);
      return article;
    }, () => component.hydrate(root as unknown as Element, { body: placeholder }));
    assert.deepEqual(asked, [], "the first hydration asks nothing");
    const toggle = (root.querySelector("button.toggle") as unknown as HTMLButtonElement);
    toggle.click();
    assert.equal(root.querySelector("article"), null);
    toggle.click();
    assert.deepEqual(asked, [0]);
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(root.querySelector("article")!.innerHTML, article);
    assert.equal(root.querySelector("img"), null, "the DOM's content did not come back");
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

// A real handler, a compiled page and `mountClientApp`: what a browser does with a first document.
const appRoutes = createRouteManifest([{ id: "/guide", file: "/guide.meeko", layouts: [], sidecar: "/guide.route.ts" }]);
const trustedList = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ data: { items: { id: number; kind: string; body: string }[] } }>();
const open = signal(true);
</script>
<template><section if:when="open.value"><article each:of="props.data.items" each:as="item" each:key="item.id" bind:data-id="item.id"><div if:when="item.kind === 'html'" class="trusted" html="item.body"></div><p if:when="item.kind === 'text'">{item.body}</p></article></section><button type="button" class="toggle" on:click="() => open.value = !open.value">t</button></template>`;
const togglingData = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ data: { html: string } }>();
const open = signal(true);
</script>
<template><section if:when="open.value"><article html="props.data.html"></article></section><button type="button" class="toggle" on:click="() => open.value = !open.value">t</button></template>`;
const twoContainers = `<script lang="ts">
const props = defineProps<{ data: { html: string } }>();
</script>
<template><article html="props.data.html"></article><p html="props.data.html"></p></template>`;

interface MountedDocument {
  browser: Window;
  payload: Record<string, unknown> & { documentHtml?: unknown };
  reloads: () => number;
  errors: unknown[];
  requests: () => number;
  /** Closes and opens the `if:` of the page, and waits for what it asks the server. */
  repaint: () => Promise<void>;
  close: () => void;
}

const settle = (): Promise<void> => new Promise((done) => setTimeout(done, 25));
const jsonResponse = (value: unknown, init: ResponseInit = {}): Response => new Response(JSON.stringify(value), { headers: { "content-type": "application/meeko+json" }, ...init });

async function loadPage(source: string, name: string, directory: string): Promise<ClientComponent> {
  const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  const code = compile(source, join(directory, `${name}.meeko`)).code
    .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
    .replaceAll(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`);
  await writeFile(join(directory, `${name}.ts`), code);
  return await import(pathToFileURL(join(directory, `${name}.ts`)).href) as ClientComponent;
}

/** Runs `body` with a temporary folder for compiled pages. */
async function withPages<T>(body: (page: (source: string, name: string) => Promise<ClientComponent>, directory: string) => Promise<T>): Promise<T> {
  await mkdir(resolve(".meeko"), { recursive: true });
  const directory = await mkdtemp(resolve(".meeko", "document-html-"));
  try { return await body((source, name) => loadPage(source, name, directory), directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

/**
 * The document that `documentResponse` answers, hydrated in a new window, with `recover` answering
 * what the browser asks the server afterwards.
 */
async function mountDocument(page: ClientComponent, documentResponse: Response, recover: (input: string, init?: RequestInit) => Promise<Response>, options: { serverData?: boolean | "static"; storedClaim?: string | null; noStorage?: boolean } = {}): Promise<MountedDocument> {
  const browser = new Window({ url: "http://local/guide" });
  browser.document.write(await documentResponse.text());
  await browser.happyDOM.waitUntilComplete();
  let reloads = 0;
  let requests = 0;
  Object.defineProperty(browser.location, "reload", { value: () => { reloads++; } });
  if (options.storedClaim) browser.sessionStorage.setItem("meeko:document-html-reload", options.storedClaim);
  if (options.noStorage) Object.defineProperty(browser, "sessionStorage", { get() { throw new Error("Storage is blocked"); } });
  const errors: unknown[] = [];
  const payload = JSON.parse(browser.document.getElementById("meeko-payload")!.textContent!) as MountedDocument["payload"];
  const app = await mountClientApp({
    routes: appRoutes,
    root: browser.document.getElementById("app") as unknown as Element,
    payload,
    loadPage: async () => page,
    browser: browser as unknown as globalThis.Window,
    serverData: options.serverData ?? true,
    onNavigationError: (error) => errors.push(error),
    fetch: (async (input: string, init?: RequestInit) => { requests++; return await recover(input, init); }) as typeof fetch,
  });
  return {
    browser, payload, errors,
    reloads: () => reloads,
    requests: () => requests,
    repaint: async () => {
      const toggle = browser.document.querySelector("button.toggle") as unknown as HTMLButtonElement;
      toggle.click();
      toggle.click();
      await settle();
    },
    close: () => { app.dispose(); browser.happyDOM.abort(); },
  };
}

const answerWith = (handle: (request: Request) => Promise<Response>) => (input: string, init?: RequestInit): Promise<Response> => handle(new Request(input, init));

/** What a stream document has sent up to its payload, while its deferred values stay pending. */
async function readDocumentUntilPayload(response: Response): Promise<string> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let html = "";
  while (!html.includes("</script>")) {
    const { done, value } = await reader.read();
    if (done) break;
    html += decoder.decode(value, { stream: true });
  }
  await reader.cancel();
  return html;
}

const plainText = "<b>user text, never declared trusted</b>";
const listHandler = (load: () => unknown, page: ClientComponent): ((request: Request) => Promise<Response>) => createFrameworkHandler({
  routes: appRoutes,
  loadPage: async () => page,
  loadRoute: async () => ({ load }),
});

test("a reordered list never paints unmarked text as HTML, and the value follows its identity", () => withPages(async (page) => {
  const list = await page(trustedList, "List");
  let reorder = false;
  const handle = listHandler(() => {
    const trusted = { id: 1, kind: "html", body: documentHtml(trustHtml("<h2>trusted article</h2>")) };
    const text = { id: 2, kind: "text", body: plainText };
    return { items: reorder ? [text, trusted] : [trusted, text] };
  }, list);
  const mounted = await mountDocument(list, await handle(requestDocument()), answerWith(handle));
  try {
    reorder = true;
    await mounted.repaint();
    assert.equal(mounted.browser.document.querySelector("div.trusted")!.innerHTML, "<h2>trusted article</h2>");
    assert.ok(!mounted.browser.document.querySelector("div.trusted b"));
    assert.equal(mounted.browser.document.querySelector("article p")!.textContent, plainText, "the text stays text");
    assert.equal(mounted.reloads(), 0);
  } finally { mounted.close(); }
}));

test("two marked values that swap keep their own article", () => withPages(async (page) => {
  const list = await page(trustedList, "Swap");
  let swap = false;
  const handle = listHandler(() => {
    const one = { id: 1, kind: "html", body: documentHtml(trustHtml("<h2>one</h2>")) };
    const two = { id: 2, kind: "html", body: documentHtml(trustHtml("<h2>two</h2>")) };
    return { items: swap ? [two, one] : [one, two] };
  }, list);
  const mounted = await mountDocument(list, await handle(requestDocument()), answerWith(handle));
  try {
    swap = true;
    await mounted.repaint();
    assert.equal(mounted.browser.document.querySelector(`article[data-id="1"] div`)!.innerHTML, "<h2>one</h2>");
    assert.equal(mounted.browser.document.querySelector(`article[data-id="2"] div`)!.innerHTML, "<h2>two</h2>");
    assert.equal(mounted.reloads(), 0);
  } finally { mounted.close(); }
}));

test("a position that is no longer marked inserts nothing and loads the document once", () => withPages(async (page) => {
  const list = await page(trustedList, "Gone");
  let removed = false;
  const handle = listHandler(() => ({
    items: removed
      ? [{ id: 2, kind: "text", body: plainText }]
      : [{ id: 1, kind: "html", body: documentHtml(trustHtml("<h2>trusted article</h2>")) }, { id: 2, kind: "text", body: plainText }],
  }), list);
  const mounted = await mountDocument(list, await handle(requestDocument()), answerWith(handle));
  try {
    removed = true;
    await mounted.repaint();
    assert.ok(!mounted.browser.document.querySelector("div.trusted b"));
    assert.equal(mounted.browser.document.querySelector("div.trusted")!.textContent, "");
    assert.equal(mounted.reloads(), 1);
    assert.deepEqual(mounted.errors, []);
  } finally { mounted.close(); }
}));

test("republished content is not painted over the old page, and a reload that did not help is not repeated", () => withPages(async (page) => {
  const toggling = await page(togglingData, "Republished");
  // As with a value that differs in every response: no document ever matches.
  let version = 1;
  const handle = listHandler(() => ({ html: documentHtml(trustHtml(`<h2>version ${version++}</h2>`)) }), toggling);
  const mounted = await mountDocument(toggling, await handle(requestDocument()), answerWith(handle));
  let claim: string | null;
  try {
    await mounted.repaint();
    assert.equal(mounted.browser.document.querySelector("article")!.textContent, "");
    assert.equal(mounted.reloads(), 1);
    assert.deepEqual(mounted.errors, []);
    claim = mounted.browser.sessionStorage.getItem("meeko:document-html-reload");
    assert.ok(claim);
  } finally { mounted.close(); }
  // What that reload loads: the storage of the tab survives it.
  const reloaded = await mountDocument(toggling, await handle(requestDocument()), answerWith(handle), { storedClaim: claim });
  try {
    await reloaded.repaint();
    assert.equal(reloaded.reloads(), 0, "no loop");
    assert.equal(reloaded.browser.document.querySelector("article")!.textContent, "");
    assert.equal(reloaded.errors.length, 1, "the observer hears about it");
    assert.match(String(reloaded.errors[0]), /Document HTML could not be recovered/);
  } finally { reloaded.close(); }
  // Long after that reload, this is a new publication.
  const later = await mountDocument(toggling, await handle(requestDocument()), answerWith(handle), { storedClaim: `${Date.now() - 120_000} http://local/guide` });
  try {
    await later.repaint();
    assert.equal(later.reloads(), 1);
  } finally { later.close(); }
}));

test("without storage a reload cannot be counted, so it does not happen", () => withPages(async (page) => {
  const toggling = await page(togglingData, "NoStorage");
  let version = 1;
  const handle = listHandler(() => ({ html: documentHtml(trustHtml(`<h2>version ${version++}</h2>`)) }), toggling);
  const mounted = await mountDocument(toggling, await handle(requestDocument()), answerWith(handle), { noStorage: true });
  try {
    await mounted.repaint();
    assert.equal(mounted.reloads(), 0);
    assert.equal(mounted.errors.length, 1);
    assert.equal(mounted.browser.document.querySelector("article")!.textContent, "");
  } finally { mounted.close(); }
}));

test("several elements that wait for one stale response reload once", () => withPages(async (page) => {
  const two = await page(`<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ data: { a: string; b: string } }>();
const open = signal(true);
</script>
<template><section if:when="open.value"><article html="props.data.a"></article><aside html="props.data.b"></aside></section><button type="button" class="toggle" on:click="() => open.value = !open.value">t</button></template>`, "TwoValues");
  let version = 1;
  const handle = listHandler(() => {
    const current = version++;
    return { a: documentHtml(trustHtml(`<h2>a ${current}</h2>`)), b: documentHtml(trustHtml(`<h2>b ${current}</h2>`)) };
  }, two);
  const mounted = await mountDocument(two, await handle(requestDocument()), answerWith(handle));
  try {
    await mounted.repaint();
    assert.equal(mounted.requests(), 1);
    assert.equal(mounted.reloads(), 1);
    assert.deepEqual(mounted.errors, []);
  } finally { mounted.close(); }
}));

test("a response of another route inserts nothing", () => withPages(async (page) => {
  const toggling = await page(togglingData, "Foreign");
  const handle = listHandler(() => ({ html: documentHtml(trustHtml("<h2>guide</h2>")) }), toggling);
  const foreign = { v: PAYLOAD_VERSION, route: "/signin", url: "/signin", props: { params: {}, search: {}, data: { html: plainText } }, state: {} };
  const mounted = await mountDocument(toggling, await handle(requestDocument()), async () => jsonResponse(foreign));
  try {
    await mounted.repaint();
    assert.ok(!mounted.browser.document.querySelector("article b"));
    assert.equal(mounted.browser.document.querySelector("article")!.textContent, "");
    assert.equal(mounted.reloads(), 1);
  } finally { mounted.close(); }
}));

test("a redirect inserts nothing, also when its target declares the same value", () => withPages(async (page) => {
  const toggling = await page(togglingData, "Redirected");
  const handle = listHandler(() => ({ html: documentHtml(trustHtml("<h2>guide</h2>")) }), toggling);
  const first = await handle(requestDocument());
  const whole = await (await handle(requestNavigation())).text();
  const followed = (): Response => {
    const response = new Response(whole, { headers: { "content-type": "application/meeko+json" } });
    Object.defineProperty(response, "redirected", { value: true });
    Object.defineProperty(response, "url", { value: "http://local/signin" });
    return response;
  };
  const mounted = await mountDocument(toggling, first, async () => followed());
  try {
    await mounted.repaint();
    assert.equal(mounted.browser.document.querySelector("article")!.textContent, "");
    assert.equal(mounted.reloads(), 1);
  } finally { mounted.close(); }
  // A custom fetch may hand back the 3xx itself.
  const manual = await mountDocument(toggling, await handle(requestDocument()), async () => new Response(null, { status: 302, headers: { location: "/signin" } }));
  try {
    await manual.repaint();
    assert.equal(manual.browser.document.querySelector("article")!.textContent, "");
    assert.equal(manual.reloads(), 1);
  } finally { manual.close(); }
}));

test("a failed request leaves the element empty, reports it and the next render tries again", () => withPages(async (page) => {
  const toggling = await page(togglingData, "Transient");
  const handle = listHandler(() => ({ html: documentHtml(trustHtml("<h2>guide</h2>")) }), toggling);
  let failing = true;
  const mounted = await mountDocument(toggling, await handle(requestDocument()), async (input, init) => failing ? new Response("", { status: 503 }) : await handle(new Request(input, init)));
  try {
    await mounted.repaint();
    assert.equal(mounted.browser.document.querySelector("article")!.textContent, "");
    assert.equal(mounted.reloads(), 0, "a server that is down has no document to load either");
    assert.equal(mounted.errors.length, 1);
    failing = false;
    await mounted.repaint();
    assert.equal(mounted.browser.document.querySelector("article")!.innerHTML, "<h2>guide</h2>");
    assert.equal(mounted.errors.length, 1);
  } finally { mounted.close(); }
}));

test("a prerendered site recovers the value from its stored file, and only what the file declares", () => withPages(async (page, directory) => {
  const toggling = await page(togglingData, "Stored");
  const handle = listHandler(() => ({ html: documentHtml(trustHtml("<h2>stored</h2>")) }), toggling);
  const output = join(directory, "site");
  await prerenderRoutes({ routes: createRouteManifest([{ id: "/guide", file: "/guide.meeko", layouts: [], render: "prerender" }]), handler: handle, outputRoot: output });
  const stored = (): Response => new Response(storedDocument, { headers: { "content-type": "text/html" } });
  const storedDocument = await readFile(join(output, "guide", "index.html"), "utf8");
  const file = await readFile(join(output, "guide", "index.meeko.json"), "utf8");
  const asked: string[] = [];
  const mounted = await mountDocument(toggling, stored(), async (input) => {
    asked.push(input);
    return new Response(file, { headers: { "content-type": "application/json" } });
  }, { serverData: "static" });
  try {
    await mounted.repaint();
    assert.deepEqual(asked, ["http://local/guide/index.meeko.json"]);
    assert.equal(mounted.browser.document.querySelector("article")!.innerHTML, "<h2>stored</h2>");
    assert.equal(mounted.reloads(), 0);
  } finally { mounted.close(); }
  // The same file without the declaration has a string at that position and nothing that marks it.
  const parsed = JSON.parse(file) as { markedHtml?: unknown };
  delete parsed.markedHtml;
  const undeclared = await mountDocument(toggling, stored(), async () => new Response(JSON.stringify(parsed), { headers: { "content-type": "application/json" } }), { serverData: "static" });
  try {
    await undeclared.repaint();
    assert.equal(undeclared.browser.document.querySelector("article")!.textContent, "");
    assert.equal(undeclared.reloads(), 1);
  } finally { undeclared.close(); }
}));

test("a navigation declares its marked values by identity, and costs nothing without them", async () => {
  const handle = handler(() => {
    const html = documentHtml(article);
    return { doc: { html, other: "texto" }, copy: html };
  });
  const { payload } = await documentPayload(await handle(requestDocument()));
  const navigation = JSON.parse(await (await handle(requestNavigation())).text()) as { markedHtml: Record<string, unknown>; documentHtml?: unknown };
  assert.deepEqual(navigation.markedHtml, { [(payload.documentHtml as string[])[0]!]: ["props", "data", "doc", "html"] });
  assert.equal(navigation.documentHtml, undefined, "prerender reads this field as a payload that leaves out values");
  const plain = await (await handler(() => ({ doc: { html: article } }))(requestNavigation())).text();
  assert.equal(plain.includes("markedHtml"), false);
});

test("a value that one element left empty travels whole, as without the mark", () => withPages(async (page) => {
  const two = await page(twoContainers, "Two");
  const block = "<div>safe</div>";
  const render = async (marked: boolean): Promise<{ article: string; paragraph: string; requests: number; payload: MountedDocument["payload"] }> => {
    const handle = listHandler(() => ({ html: marked ? documentHtml(trustHtml(block)) : block }), two);
    const mounted = await mountDocument(two, await handle(requestDocument()), answerWith(handle));
    try {
      await settle();
      return { article: mounted.browser.document.querySelector("article")!.innerHTML, paragraph: mounted.browser.document.querySelector("p")!.innerHTML, requests: mounted.requests(), payload: mounted.payload };
    } finally { mounted.close(); }
  };
  const marked = await render(true);
  const plain = await render(false);
  assert.equal(marked.article, block);
  assert.equal(marked.paragraph, block, "hydration fills the element the SSR left empty");
  assert.equal(marked.requests, 0);
  assert.equal(marked.payload.documentHtml, undefined);
  assert.deepEqual({ article: marked.article, paragraph: marked.paragraph, requests: marked.requests }, { article: plain.article, paragraph: plain.paragraph, requests: plain.requests });
}));

test("recovering a value does not wait for the stream, and closes it", () => withPages(async (page) => {
  const toggling = await page(togglingData, "Streamed");
  const signals: AbortSignal[] = [];
  const handle = createFrameworkHandler({
    routes: createRouteManifest([{ id: "/guide", file: "/guide.meeko", layouts: [], sidecar: "/guide.route.ts", render: "stream" }]),
    loadPage: async () => toggling,
    loadRoute: async () => ({
      render: "stream",
      load: () => ({ html: documentHtml(trustHtml("<h2>streamed</h2>")), never: defer((signal) => {
        signals.push(signal);
        return new Promise<void>(() => {});
      }, { timeoutMs: 60_000 }) }),
    }),
  });
  const opening = await handle(requestDocument());
  const head = await readDocumentUntilPayload(opening);
  const mounted = await mountDocument(toggling, new Response(head, { headers: { "content-type": "text/html" } }), answerWith(handle));
  try {
    await mounted.repaint();
    assert.equal(mounted.browser.document.querySelector("article")!.innerHTML, "<h2>streamed</h2>", "the first line has the value");
    assert.equal(signals.at(-1)!.aborted, true, "the rest of the stream was cancelled");
  } finally { mounted.close(); }
}));

test("dispose abandons a request in flight, without reloading or reporting", () => withPages(async (page) => {
  const toggling = await page(togglingData, "Disposed");
  const handle = listHandler(() => ({ html: documentHtml(trustHtml("<h2>guide</h2>")) }), toggling);
  let aborted: AbortSignal | undefined;
  const mounted = await mountDocument(toggling, await handle(requestDocument()), (_input, init) => {
    aborted = init?.signal ?? undefined;
    return new Promise(() => {});
  });
  const toggle = mounted.browser.document.querySelector("button.toggle") as unknown as HTMLButtonElement;
  toggle.click();
  toggle.click();
  await settle();
  const { errors, reloads } = mounted;
  mounted.close();
  await settle();
  assert.equal(aborted?.aborted, true, "dispose aborts the request");
  assert.deepEqual(errors, []);
  assert.equal(reloads(), 0);
}));

test("an imitated placeholder that names nothing stays an inert comment", async () => {
  const { component, provide, cleanup } = await loadComponent(toggling);
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    window.document.body.append(root);
    root.innerHTML = component.renderToString({ body: placeholder });
    const release = provide.run(async () => undefined, () => component.hydrate(root as unknown as Element, { body: placeholder }));
    await new Promise((done) => setTimeout(done, 0));
    assert.equal(root.querySelector("article")!.innerHTML, placeholder);
    assert.equal(root.querySelector("article")!.textContent, "");
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});
