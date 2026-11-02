import { Window as HappyWindow } from "happy-dom";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import type * as useLayout_tsTypes from "../src/app/composables/useLayout.ts";
import type { ClientComponent, ClientRoute } from "../src/app/runtime/client.ts";
import type * as client_tsTypes from "../src/app/runtime/client.ts";
import type * as layout_tsTypes from "../src/app/runtime/layout.ts";
import type { ErrorPageRecord, RouteRecord } from "../src/app/runtime/router.ts";
import type * as prerender_tsTypes from "../src/framework/prerender.ts";
import type * as framework_render_tsTypes from "../src/server/runtime/framework-render.ts";

import { createRouteManifest } from "../src/app/runtime/router.ts";
import { compile } from "../src/compiler.ts";
import { definePageBody, notFound } from "../src/server/runtime/page-body.ts";
import { createTempProject } from "./helpers/temp-project.ts";


const fileUrl = (path: string): string => pathToFileURL(resolve(path)).href;

/** The runtime as the compiled components import it, by file URL: one instance for pages, server and browser. */
const runtime = async () => ({
  ...await import(fileUrl("src/server/runtime/framework-render.ts")) as typeof framework_render_tsTypes,
  ...await import(fileUrl("src/app/runtime/client.ts")) as typeof client_tsTypes,
  ...await import(fileUrl("src/framework/prerender.ts")) as typeof prerender_tsTypes,
  ...await import(fileUrl("src/app/runtime/layout.ts")) as typeof layout_tsTypes,
  ...await import(fileUrl("src/app/composables/useLayout.ts")) as typeof useLayout_tsTypes,
});

const appShell = `<script lang="ts">
import type { Component } from "@meekojs/meeko";
const props = defineProps<{ outlet: Component<Record<string, unknown>> }>();
</script>
<template><div class="app"><component is="props.outlet"></component></div></template>`;

// The layout of the example in docs/framework.md: a title and an alert that the page controls.
const dashboard = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import type { Component } from "@meekojs/meeko";
export interface Props { outlet: Component<Record<string, unknown>>; title?: string; showAlert?: boolean }
const props = defineProps<Props>({ title: "Panel", showAlert: false });
const filter = signal("");
</script>
<template><header class="title">{props.title}</header><p class="alert" if:when="props.showAlert">Alerta</p><input class="sidebar" model="filter"><main><component is="props.outlet"></component></main><footer class="footer">{props.title}</footer></template>`;

const auth = `<script lang="ts">
import type { Component } from "@meekojs/meeko";
const props = defineProps<{ outlet: Component<Record<string, unknown>> }>();
</script>
<template><section class="auth"><component is="props.outlet"></component></section></template>`;

const plain = (name: string): string => `<template><p class="page">${name}</p></template>`;

// Writes the layout's title from its setup, and again from a click.
const writer = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import { useLayout } from "@meekojs/meeko/framework";
const layout = useLayout();
const name = signal("Escrito");
layout.set({ title: name.value });
const rename = () => { name.value = "Pulsado"; layout.set({ title: name.value, showAlert: true }); };
</script>
<template><p class="page">writer:{layout.name ?? "none"}:{String(layout.props.title)}</p><button class="rename" on:click="rename">Cambiar</button></template>`;

// A page without a named layout: useLayout() does nothing.
const loose = `<script lang="ts">
import { useLayout } from "@meekojs/meeko/framework";
const layout = useLayout();
layout.set({ title: "nadie" });
</script>
<template><p class="page">loose:{layout.name ?? "none"}</p></template>`;

// Writes undefined for the title: the layout falls back to its default.
const unset = `<script lang="ts">
import { useLayout } from "@meekojs/meeko/framework";
const layout = useLayout();
const user = { value: undefined as { name: string } | undefined };
layout.set({ title: user.value?.name, showAlert: true });
</script>
<template><p class="page">unset</p></template>`;

const note = `<script lang="ts">
const props = defineProps<{ data: { text: string } }>();
</script>
<template><p class="page">{props.data.text}</p></template>`;

const errorPage = `<script lang="ts">
const props = defineProps<{ status: number; message: string }>();
</script>
<template><p class="error">{props.status}</p></template>`;

const sources: Record<string, string> = {
  "app.meeko": appShell, "dashboard.meeko": dashboard, "auth.meeko": auth,
  "a.meeko": plain("a"), "b.meeko": plain("b"), "g.meeko": plain("g"), "writer.meeko": writer, "loose.meeko": loose, "unset.meeko": unset,
  "note.meeko": note, "error.meeko": errorPage,
};

async function loadModules(): Promise<{ modules: Record<string, ClientComponent>; cleanup: () => Promise<void> }> {
  const project = await createTempProject("named-layouts-test");
  const directory = project.root;
  await writeFile(join(directory, "package.json"), '{"private":true,"type":"module"}\n');
  const runtimePath = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  const modules: Record<string, ClientComponent> = {};
  for (const [file, source] of Object.entries(sources)) {
    const code = compile(source, join(directory, file)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtimePath("src/internal.ts")}`)
      .replaceAll(`from "@meekojs/meeko/framework"`, `from ${runtimePath("src/framework.ts")}`)
      .replaceAll(`from "@meekojs/meeko"`, `from ${runtimePath("src/index.ts")}`);
    const target = join(directory, file.replace(/\.meeko$/, ".ts"));
    await writeFile(target, code);
    modules[file] = await import(pathToFileURL(target).href) as ClientComponent;
  }
  return { modules, cleanup: () => project.remove() };
}

const dashboardLayout = { name: "dashboard", file: "dashboard.meeko" };
const routes: readonly RouteRecord[] = createRouteManifest([
  { id: "/a", file: "a.meeko", layouts: ["app.meeko", "dashboard.meeko"], layout: dashboardLayout, sidecar: "a.route.ts", render: "prerender" },
  { id: "/b", file: "b.meeko", layouts: ["app.meeko", "auth.meeko"], layout: { name: "auth", file: "auth.meeko" }, render: "prerender" },
  // The props of its +group.ts files, without layoutProps of its own.
  { id: "/g", file: "g.meeko", layouts: ["app.meeko", "dashboard.meeko"], layout: { ...dashboardLayout, props: { showAlert: true, title: "Grupo" } } },
  { id: "/writer", file: "writer.meeko", layouts: ["app.meeko", "dashboard.meeko"], layout: dashboardLayout, render: "prerender" },
  { id: "/loose", file: "loose.meeko", layouts: ["app.meeko"] },
  { id: "/notes/[id]", file: "note.meeko", layouts: ["app.meeko", "dashboard.meeko"], layout: dashboardLayout, sidecar: "note.route.ts", render: "client" },
  { id: "/unset", file: "unset.meeko", layouts: ["app.meeko", "dashboard.meeko"], layout: { ...dashboardLayout, props: { title: "Grupo" } } },
  { id: "/absent", file: "a.meeko", layouts: ["app.meeko", "dashboard.meeko"], layout: dashboardLayout, sidecar: "absent.route.ts" },
  { id: "/dated", file: "a.meeko", layouts: ["app.meeko", "dashboard.meeko"], layout: dashboardLayout, sidecar: "dated.route.ts" },
  { id: "/stream", file: "a.meeko", layouts: ["app.meeko", "dashboard.meeko"], layout: dashboardLayout, sidecar: "stream.route.ts", render: "stream" },
  { id: "/exported", file: "a.meeko", layouts: ["app.meeko", "dashboard.meeko"], layout: dashboardLayout, sidecar: "exported.route.ts" },
  { id: "/missing", file: "a.meeko", layouts: ["app.meeko", "dashboard.meeko"], layout: dashboardLayout, sidecar: "missing.route.ts" },
  { id: "/failing", file: "a.meeko", layouts: ["app.meeko", "dashboard.meeko"], layout: dashboardLayout, sidecar: "failing.route.ts" },
]);
const appError: ErrorPageRecord = { file: "error.meeko", layouts: ["app.meeko", "dashboard.meeko"], layout: dashboardLayout };

const sidecars: Record<string, ClientRoute & { render?: string; layout?: unknown }> = {
  "a.route.ts": { render: "prerender", layout: "dashboard", layoutProps: { title: "Conexiones", showAlert: true } },
  "note.route.ts": {
    render: "client",
    load: async ({ params }) => ({ text: `Nota ${String(params.id)}` }),
    layoutProps: ({ data }: { data: { text: string } }) => ({ title: data.text }),
  },
  "absent.route.ts": { load: () => ({}), layoutProps: ({ data }: { data: { name?: string } }) => ({ title: data.name, showAlert: true }) },
  "dated.route.ts": { layoutProps: { title: new Date(0) as unknown as string } },
  "stream.route.ts": { render: "stream", load: () => ({ name: "Flujo" }), layoutProps: ({ data }: { data: { name: string } }) => ({ title: data.name }) },
  "missing.route.ts": definePageBody(undefined, async () => { notFound(); }, false) as ClientRoute,
  "failing.route.ts": { load: () => { throw new Error("private failure"); } },
  // What a page compiles to with top-level server code and `export const layoutProps`.
  "exported.route.ts": definePageBody(undefined, async () => ({ data: { doc: "cuerpo" }, layoutProps: { title: "Sólo para el layout" } }), false, true) as ClientRoute,
};

const flush = async (): Promise<void> => {
  for (let index = 0; index < 10; index++) await new Promise((done) => setTimeout(done, 0));
};

type Root = { querySelector(selector: string): (Element & { value?: string }) | null };
const text = (root: Root, selector: string): string | null | undefined => root.querySelector(selector)?.textContent;

async function serve(modules: Record<string, ClientComponent>) {
  const { createFrameworkHandler } = await runtime();
  return createFrameworkHandler({
    routes, errorPage: appError,
    loadPage: async (file) => modules[file]!,
    loadRoute: async (file) => sidecars[file]! as never,
  });
}

const opened: (() => void)[] = [];
function closeAll(): void {
  for (const close of opened.splice(0).reverse()) {
    try { close(); }
    catch { /* Already released. */ }
  }
}

async function boot(modules: Record<string, ClientComponent>, url: string, options: { document?: string; fetch?: typeof fetch; serverData?: true | "static" } = {}) {
  const { mountClientApp } = await runtime();
  const server = await serve(modules);
  const browser = new HappyWindow({ url });
  const response = await server(new Request(url, { headers: { accept: "text/html" } }));
  const html = options.document ?? await response.text();
  browser.document.write(html);
  const root = browser.document.getElementById("app")!;
  const errors: unknown[] = [];
  const app = await mountClientApp({
    routes, errorPage: appError, root: root as unknown as Element,
    payload: browser.document.getElementById("meeko-payload")!.textContent!,
    loadPage: async (file) => modules[file]!,
    loadClientRoute: async (file) => sidecars[file]!,
    serverData: options.serverData ?? true,
    fetch: options.fetch ?? (((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch),
    onNavigationError: (error) => { errors.push(error); },
    onError: (error) => { errors.push(error); },
    browser: browser as unknown as Window,
  });
  opened.push(() => browser.happyDOM.abort(), () => app.dispose());
  return { app, browser, root: root as unknown as Root, html, response, errors };
}

test("SSR renders the named layout with the page's layoutProps and hydrates them", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const { root, html, errors } = await boot(modules, "https://example.test/a");
    assert.match(html, /<header class="title">(?:<!--[^>]*-->)?Conexiones/);
    assert.match(html, /<p class="alert">Alerta<\/p>/);
    assert.match(html, /"layoutProps":\{"title":"Conexiones","showAlert":true\}/);
    assert.equal(text(root, ".title"), "Conexiones");
    assert.equal(text(root, ".alert"), "Alerta");
    assert.equal(text(root, ".page"), "a");
    assert.deepEqual(errors, []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("a page not found in SSR renders app/error.meeko inside the layouts and hydrates; another failure stays bare", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const server = await serve(modules);
    const page = (path: string) => server(new Request(`https://example.test${path}`, { headers: { accept: "text/html" } }));
    const response = await page("/missing");
    assert.equal(response.status, 404);
    assert.match(await response.text(), /class="sidebar"/);
    // Same document as a URL without a route: the browser hydrates it, also the layout's controls.
    const { root, html, app, errors } = await boot(modules, "https://example.test/missing");
    assert.match(html, /<script id="meeko-payload"/);
    assert.ok(root.querySelector(".sidebar"), html);
    assert.deepEqual(errors, []);
    // The next navigation works from there, with the layout mounted.
    const sidebar = root.querySelector(".sidebar");
    assert.equal(await app.navigate("/g"), true);
    assert.equal(root.querySelector(".sidebar"), sidebar);
    assert.equal(text(root, ".title"), "Grupo");
    // A 500 may come from the layout itself: the error document stays without layouts.
    const failed = await page("/failing");
    assert.equal(failed.status, 500);
    assert.doesNotMatch(await failed.text(), /class="sidebar"|meeko-payload/);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("a 404 falls back to the bare error page when the layout fails, and a nearer +error.meeko keeps the page's layouts", { timeout: 30_000 }, async () => {
  const { createFrameworkHandler } = await runtime();
  const html = (text: string) => ({ css: "", renderWithState: () => ({ html: text, state: {} }) }) as unknown as ClientComponent;
  const shell = {
    css: "",
    renderWithState: (props: { outlet: { renderWithState(): { html: string } } }) => ({ html: `<main>${props.outlet.renderWithState().html}</main>`, state: {} }),
  } as unknown as ClientComponent;
  const failing = { css: "", renderWithState: () => { throw new Error("layout failed"); } } as unknown as ClientComponent;
  const errorView = (name: string) => ({ css: "", renderWithState: (props: { status: number }) => ({ html: `<p>${name}:${props.status}</p>`, state: {} }) }) as unknown as ClientComponent;
  const modules: Record<string, ClientComponent> = { "page.meeko": html("<p>page</p>"), "shell.meeko": shell, "bad.meeko": failing, "error.meeko": errorView("app"), "+error.meeko": errorView("near") };
  const missing = definePageBody(undefined, async () => { notFound(); }, false);
  const handler = createFrameworkHandler({
    routes: createRouteManifest([
      { id: "/near", file: "page.meeko", layouts: ["shell.meeko"], error: "+error.meeko", sidecar: "missing.route.ts" },
      { id: "/near-bad", file: "page.meeko", layouts: ["bad.meeko"], error: "+error.meeko", sidecar: "missing.route.ts" },
      { id: "/root-bad", file: "page.meeko", layouts: ["shell.meeko"], sidecar: "missing.route.ts" },
    ]),
    errorPage: { file: "error.meeko", layouts: ["bad.meeko"] },
    loadPage: async (file) => modules[file]! as never,
    loadRoute: async () => missing as never,
    onError: () => {},
  });
  const body = async (path: string): Promise<{ status: number; text: string }> => {
    const response = await handler(new Request(`https://example.test${path}`, { headers: { accept: "text/html" } }));
    return { status: response.status, text: await response.text() };
  };
  // Nearer +error.meeko: inside the page's layouts, not hydrated.
  const near = await body("/near");
  assert.equal(near.status, 404);
  assert.match(near.text, /<main><p>near:404<\/p><\/main>/);
  assert.doesNotMatch(near.text, /meeko-payload/);
  // Its layout fails: the error page alone, never the failure.
  const bad = await body("/near-bad");
  assert.equal(bad.status, 404);
  assert.match(bad.text, /<p>near:404<\/p>/);
  assert.doesNotMatch(bad.text, /layout failed/);
  // The root layout of app/error.meeko fails: the same page, alone.
  const root = await body("/root-bad");
  assert.equal(root.status, 404);
  assert.match(root.text, /<p>app:404<\/p>/);
  assert.doesNotMatch(root.text, /layout failed|meeko-payload/);
});

test("export const layoutProps reaches the layout once: in SSR, hydration and a client navigation, outside the page data", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const { root, html, app, errors } = await boot(modules, "https://example.test/exported");
    assert.match(html, /<header class="title">(?:<!--[^>]*-->)?Sólo para el layout/);
    const payload = JSON.parse(/<script[^>]*id="meeko-payload"[^>]*>(.*?)<\/script>/s.exec(html)![1]!) as { props: { data: unknown }; layoutProps: unknown };
    assert.deepEqual(payload.props.data, { doc: "cuerpo" });
    assert.deepEqual(payload.layoutProps, { title: "Sólo para el layout" });
    assert.equal(text(root, ".title"), "Sólo para el layout");
    // A navigation brings them in its own payload, and the next page does not keep them.
    assert.equal(await app.navigate("/g"), true);
    assert.equal(text(root, ".title"), "Grupo");
    assert.equal(await app.navigate("/exported"), true);
    assert.equal(text(root, ".title"), "Sólo para el layout");
    assert.deepEqual(errors, []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("the same layout stays mounted with its state; another layout replaces it; props never stick", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const { app, root, errors } = await boot(modules, "https://example.test/a");
    const sidebar = root.querySelector(".sidebar")!;
    sidebar.value = "buscando";
    sidebar.dispatchEvent(new (sidebar.ownerDocument.defaultView as unknown as typeof globalThis).Event("input", { bubbles: true }));
    const header = root.querySelector(".title");
    // Same layout: the node and what the user typed stay; the props are those of the new page.
    assert.equal(await app.navigate("/g"), true);
    assert.equal(root.querySelector(".sidebar"), sidebar);
    assert.equal(root.querySelector(".title"), header);
    assert.equal(root.querySelector(".sidebar")!.value, "buscando");
    assert.equal(text(root, ".title"), "Grupo");
    assert.equal(text(root, ".page"), "g");
    // The writer page: what its setup writes reaches the layout, and nothing of /g stays.
    assert.equal(await app.navigate("/writer"), true);
    assert.equal(root.querySelector(".sidebar"), sidebar);
    assert.equal(text(root, ".title"), "Escrito");
    assert.equal(text(root, ".footer"), "Escrito");
    assert.equal(root.querySelector(".alert"), null, "showAlert of /g did not stick");
    (root.querySelector(".rename") as unknown as HTMLElement).click();
    await flush();
    assert.equal(text(root, ".title"), "Pulsado");
    assert.equal(text(root, ".alert"), "Alerta");
    assert.equal(root.querySelector(".sidebar"), sidebar, "a written prop does not remount the layout");
    // Another layout: the dashboard is released and auth renders.
    assert.equal(await app.navigate("/b"), true);
    assert.equal(root.querySelector(".sidebar"), null);
    assert.equal(text(root, ".auth"), "b");
    // Back to the dashboard: a new instance, with /a's props and the layout's defaults elsewhere.
    assert.equal(await app.navigate("/a"), true);
    assert.notEqual(root.querySelector(".sidebar"), sidebar);
    assert.equal(root.querySelector(".sidebar")!.value, "");
    assert.equal(text(root, ".title"), "Conexiones");
    // Without a named layout useLayout() does nothing, and the default props come back after it.
    assert.equal(await app.navigate("/loose"), true);
    assert.equal(text(root, ".page"), "loose:none");
    assert.equal(root.querySelector(".title"), null);
    assert.equal(await app.navigate("/writer"), true);
    assert.equal(text(root, ".title"), "Escrito");
    assert.deepEqual(errors, []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("what a page writes during SSR is in the HTML from the first byte and hydrates without a mismatch", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const { root, html, errors } = await boot(modules, "https://example.test/writer");
    // The header renders before the page: a second render applies the page's write.
    assert.match(html, /<header class="title">(?:<!--[^>]*-->)?Escrito/);
    assert.match(html, /<footer class="footer">(?:<!--[^>]*-->)?Escrito/);
    assert.match(html.replace(/<!--[^>]*-->/g, ""), /writer:dashboard:Escrito/);
    assert.match(html, /"layoutProps":\{"title":"Escrito"\}/);
    assert.equal(text(root, ".title"), "Escrito");
    (root.querySelector(".rename") as unknown as HTMLElement).click();
    await flush();
    assert.equal(text(root, ".title"), "Pulsado");
    assert.equal(text(root, ".page"), "writer:dashboard:Pulsado");
    assert.deepEqual(errors, []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("an undefined layout prop takes the layout's default, and one that is not JSON names the page, the layout and the prop", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    // useLayout().set() with an undefined value in SSR: the group's title gives way to the default.
    const written = await boot(modules, "https://example.test/unset");
    assert.equal(written.response.status, 200);
    assert.match(written.html, /<header class="title">(?:<!--[^>]*-->)?Panel/);
    assert.match(written.html, /"layoutProps":\{"showAlert":true\}/);
    assert.equal(text(written.root, ".title"), "Panel");
    assert.equal(text(written.root, ".alert"), "Alerta");
    assert.deepEqual(written.errors, []);
    // A layoutProps function that reads a missing field.
    const absent = await boot(modules, "https://example.test/absent");
    assert.equal(absent.response.status, 200);
    assert.match(absent.html, /"layoutProps":\{"showAlert":true\}/);
    assert.equal(text(absent.root, ".title"), "Panel");
    assert.deepEqual(absent.errors, []);
    // In the browser too: navigating to /unset leaves the default, not the previous page's title.
    assert.equal(await absent.app.navigate("/g"), true);
    assert.equal(text(absent.root, ".title"), "Grupo");
    assert.equal(await absent.app.navigate("/unset"), true);
    assert.equal(text(absent.root, ".title"), "Panel");
    assert.equal(text(absent.root, ".alert"), "Alerta");
    assert.deepEqual(absent.errors, []);
    // A value that the payload cannot carry.
    const { createFrameworkHandler } = await runtime();
    const failures: unknown[] = [];
    const server = createFrameworkHandler({
      routes, errorPage: appError, loadPage: async (file) => modules[file]!, loadRoute: async (file) => sidecars[file]! as never,
      onError: (error) => { failures.push(error); },
    });
    const response = await server(new Request("https://example.test/dated", { headers: { accept: "text/html" } }));
    assert.equal(response.status, 500);
    assert.equal(failures.length, 1);
    assert.match(String((failures[0] as Error).message), /layoutProps of \/dated .*"dashboard".*"title"/s);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("render: client applies layoutProps after its loader, and stream and error pages keep the layout", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  try {
    const client = await boot(modules, "https://example.test/notes/3");
    await flush();
    assert.match(client.html, /<header class="title">(?:<!--[^>]*-->)?Panel/, "the server renders the layout with its defaults");
    assert.equal(text(client.root, ".page"), "Nota 3");
    assert.equal(text(client.root, ".title"), "Nota 3");
    assert.equal(await client.app.navigate("/notes/4"), true);
    assert.equal(text(client.root, ".title"), "Nota 4");
    assert.deepEqual(client.errors, []);
    closeAll();

    const streamed = await boot(modules, "https://example.test/stream");
    assert.match(streamed.html, /<header class="title">(?:<!--[^>]*-->)?Flujo/);
    assert.equal(text(streamed.root, ".title"), "Flujo");
    // A URL without a route: app/error.meeko inside the default layouts, with the layout's own props.
    const missing = await boot(modules, "https://example.test/missing");
    assert.equal(missing.response.status, 404);
    assert.equal(text(missing.root, ".error"), "404");
    assert.equal(text(missing.root, ".title"), "Panel");
    assert.equal(await missing.app.navigate("/a"), true);
    assert.equal(text(missing.root, ".title"), "Conexiones");
    assert.deepEqual([...streamed.errors, ...missing.errors], []);
  } finally {
    closeAll();
    await cleanup();
  }
});

test("prerendered and static pages carry the layout props in their HTML and their payload files", { timeout: 30_000 }, async () => {
  const { modules, cleanup } = await loadModules();
  const output = await mkdtemp(join(tmpdir(), "meeko-named-layouts-prerender-"));
  try {
    const { prerenderRoutes } = await runtime();
    const server = await serve(modules);
    await prerenderRoutes({ routes, handler: server, loadRoute: async (file) => sidecars[file]! as never, outputRoot: output });
    const index = JSON.parse(await readFile(join(output, "manifest.json"), "utf8")) as { pages: Record<string, { file: string; payload?: string }> };
    const document = await readFile(join(output, index.pages["/writer"]!.file), "utf8");
    assert.match(document, /<header class="title">(?:<!--[^>]*-->)?Escrito/);
    // A static host: the payload of each page is a file beside its HTML.
    const staticFetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      try { return new Response(await readFile(join(output, ...url.pathname.split("/").filter(Boolean)), "utf8"), { headers: { "content-type": "application/json" } }); }
      catch { return new Response("Not Found", { status: 404 }); }
    }) as typeof fetch;
    const { app, root, errors } = await boot(modules, "https://example.test/writer", { document, serverData: "static", fetch: staticFetch });
    const sidebar = root.querySelector(".sidebar");
    assert.equal(text(root, ".title"), "Escrito");
    assert.equal(await app.navigate("/a"), true);
    assert.equal(root.querySelector(".sidebar"), sidebar);
    assert.equal(text(root, ".title"), "Conexiones");
    assert.equal(text(root, ".alert"), "Alerta");
    assert.equal(await app.navigate("/b"), true);
    assert.equal(text(root, ".auth"), "b");
    assert.deepEqual(errors, []);
  } finally {
    closeAll();
    await rm(output, { recursive: true, force: true });
    await cleanup();
  }
});

test("useLayout fails clearly outside a page", async () => {
  const { useLayout } = await runtime();
  assert.throws(() => useLayout(), /useLayout\(\) necesita una página que renderiza Meeko/);
});
