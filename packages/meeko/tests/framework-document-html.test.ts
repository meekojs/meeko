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
  assert.deepEqual(first.payload.documentHtml, [["props", "data", "doc", "html"]]);
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
  assert.deepEqual(payload.documentHtml, [["props", "data", "doc", "html"]]);
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
<template><section if:when="open.value"><article each:of="props.data.items" each:as="item" each:key="item.id" data-id="{item.id}"><div if:when="item.kind === 'html'" class="trusted" html="item.body"></div><p if:when="item.kind === 'text'">{item.body}</p></article></section><button type="button" class="toggle" on:click="() => open.value = !open.value">t</button></template>`;
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
async function mountDocument(page: ClientComponent, documentResponse: Response, recover: (input: string, init?: RequestInit) => Promise<Response>, options: { serverData?: boolean | "static" } = {}): Promise<MountedDocument> {
  const browser = new Window({ url: "http://local/guide" });
  browser.document.write(await documentResponse.text());
  await browser.happyDOM.waitUntilComplete();
  let reloads = 0;
  let requests = 0;
  Object.defineProperty(browser.location, "reload", { value: () => { reloads++; } });
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
