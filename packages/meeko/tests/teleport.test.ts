import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { TextDocument } from "vscode-languageserver-textdocument";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/sfc.ts";
import type { ComponentRelease } from "../src/dom.ts";
import { mountClientApp } from "../src/framework/client.ts";
import type { ClientComponent } from "../src/framework/client.ts";
import { prerenderRoutes } from "../src/framework/prerender.ts";
import { createRouteManifest } from "../src/framework/router.ts";
import { createPageHandler } from "../src/framework/server.ts";
import type { PageModule } from "../src/framework/server.ts";
import { placeTeleports } from "../src/framework/teleports.ts";
import { checkApp } from "../src/framework/check-app.ts";
import { teleportCompletion, teleportHover } from "../src/language-server/teleport.ts";
import { collectTeleports, isTeleportTarget, renderTeleport, TeleportCollector } from "../src/teleport.ts";
import type { TeleportEntry } from "../src/teleport.ts";
import { linkRepositoryPackages, tempProject } from "./helpers/temp-project.ts";

interface RuntimeModule {
  css: string;
  renderToString(props: Record<string, unknown>): string;
  hydrate(root: Element, props: Record<string, unknown>): () => void;
  hydrateScope(scope: { root: Element }, props: Record<string, unknown>): ComponentRelease;
}

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);

/**
 * Compiles `.meeko` sources (by path, such as `Page.meeko`) against the source runtime and writes
 * the other files as they are, so the modules share one runtime with the test.
 */
async function load(sources: Record<string, string>): Promise<{ modules: Record<string, RuntimeModule>; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "meeko-teleport-"));
  // ES modules, like the runtime that the test imports, so both share one instance of it.
  await writeFile(join(directory, "package.json"), '{"type":"module"}\n');
  for (const [name, source] of Object.entries(sources)) {
    const file = join(directory, name);
    await mkdir(dirname(file), { recursive: true });
    const code = name.endsWith(".meeko")
      ? compile(source, file).code
      : source;
    await writeFile(name.endsWith(".meeko") ? file.replace(/\.meeko$/, ".ts") : file, code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko/framework"`, `from ${runtime("src/framework.ts")}`)
      .replaceAll(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`)
      .replaceAll(/from "\.\/(\w+)\.meeko"/g, `from "./$1.ts"`));
  }
  const modules: Record<string, RuntimeModule> = {};
  for (const name of Object.keys(sources)) {
    if (name.endsWith(".meeko")) modules[name.replace(/\.meeko$/, "")] = await import(pathToFileURL(join(directory, name.replace(/\.meeko$/, ".ts"))).href) as RuntimeModule;
  }
  return { modules, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function compileError(source: string): { code: string; offset: number; message: string } | undefined {
  try {
    compile(source, "/project/app/pages/index.meeko");
    return undefined;
  } catch (error) {
    if (!(error instanceof MeekoCompileError)) throw error;
    return { code: error.diagnostic.code, offset: error.diagnostic.location.offset, message: error.message };
  }
}

function click(root: { querySelector(selector: string): unknown }, selector: string): void {
  (root.querySelector(selector) as HTMLButtonElement).click();
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 3; index++) await new Promise((done) => setTimeout(done, 0));
};

/** A page that injects a button in the toolbar of its layout and can dock it in its place. */
const page = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const count = signal(0);
const docked = signal(false);
</script>
<template><section class="page"><p class="docked">{docked.value}</p><MeekoTeleport to="#toolbar" bind:disabled="docked.value"><button type="button" class="save" on:click="() => count.value++">Guardar {count.value}</button></MeekoTeleport><button type="button" class="dock" on:click="() => docked.value = !docked.value">dock</button></section></template>
<style scoped>.save { color: red; }</style>`;

test("<MeekoTeleport> compiles its content in the template and renders it through renderTeleport", () => {
  const { code } = compile(page, "/project/app/pages/index.meeko");
  assert.match(code, /__meeko\.renderTeleport\(0, "#toolbar", docked\.value, \(\) => "<button" \+ " type=\\"button\\"" \+ " class=\\"save\\"" \+ " data-meeko=\\"0\\"" \+ " data-meeko-s-[0-9a-f]{8}=\\"\\""/);
  assert.match(code, /__meeko\.bindTeleport\(__scope, 0, \(\) => \("#toolbar"\), \(\) => \(docked\.value\), \(\) => "<button"/);
  // A static disabled is `true`; without it the teleport is enabled.
  assert.match(compile(`<template><MeekoTeleport to="body" disabled><b>x</b></MeekoTeleport></template>`, "/p/A.meeko").code, /renderTeleport\(0, "body", true, /);
  assert.match(compile(`<template><MeekoTeleport to="body" /><p>after</p></template>`, "/p/A.meeko").code, /renderTeleport\(0, "body", false, \(\) => ""\) \+ "<p"/);
  // A dynamic target, inside a condition and a list.
  const dynamic = compile(`<script lang="ts">const where = "body" as const; const items = [1];</script><template><template if:when="where"><MeekoTeleport bind:to="where"><i each:of="items" each:as="item">{item}</i></MeekoTeleport></template></template>`, "/p/B.meeko").code;
  assert.match(dynamic, /renderIf\(\d+, where, \(\) => __meeko\.renderTeleport\(\d+, where, false, \(\) => __meeko\.renderFor/);
  assert.match(dynamic, /bindTeleport\(__scope, \d+, \(\) => \(where\), \(\) => false/);
});

test("<MeekoTeleport> rejects what it does not admit with MEEK114, also a to that is not a target", () => {
  const cases: Array<[string, string]> = [
    [`<MeekoTeleport><b>x</b></MeekoTeleport>`, "<MeekoTeleport>"],
    [`<MeekoTeleport to=".toolbar">x</MeekoTeleport>`, ".toolbar"],
    [`<MeekoTeleport to="#a b">x</MeekoTeleport>`, "#a b"],
    [`<MeekoTeleport to="<img src=x onerror=alert(1)>">x</MeekoTeleport>`, "<img"],
    [`<MeekoTeleport to="#1x">x</MeekoTeleport>`, "#1x"],
    [`<MeekoTeleport to="">x</MeekoTeleport>`, `to=""`],
    [`<MeekoTeleport to="body" bind:to="'#x'">x</MeekoTeleport>`, "bind:to"],
    [`<MeekoTeleport to="body" class="x">x</MeekoTeleport>`, "class="],
    [`<MeekoTeleport to="body" ref:box>x</MeekoTeleport>`, "ref:box"],
    [`<MeekoTeleport to="body" disabled="false">x</MeekoTeleport>`, "disabled="],
    [`<MeekoTeleport to="body" disabled bind:disabled="true">x</MeekoTeleport>`, "bind:disabled"],
    [`<MeekoTeleport to="body" on:click="() => 1">x</MeekoTeleport>`, "on:click"],
  ];
  for (const [template, at] of cases) {
    const source = `<template>${template}</template>`;
    const error = compileError(source);
    assert.equal(error?.code, "MEEK114", `${template}: ${error?.message}`);
    assert.equal(error.offset, source.indexOf(at), `${template}: ${error.message}`);
  }
  // `<snippet>` belongs to a component tag; the content of a teleport is the template's own.
  assert.equal(compileError(`<template><MeekoTeleport to="body"><snippet name="x">y</snippet></MeekoTeleport></template>`)?.code, "MEEK061");
  assert.equal(isTeleportTarget("#toolbar"), true);
  for (const value of ["#", "body ", "#a.b", "html", "#a:b", "<b>", 7, undefined]) assert.equal(isTeleportTarget(value), false, String(value));
  assert.throws(() => renderTeleport(0, "#a b" as never, false, () => ""), /to must be "body" or "#id"/);
});

test("a project component named MeekoTeleport wins over the built-in tag, with MEEK106", () => {
  const result = compile(`<template><MeekoTeleport to="#x" title="t">x</MeekoTeleport></template>`, "/project/app/pages/index.meeko", { projectComponents: ["MeekoTeleport"] });
  assert.match(result.code, /__meeko\.renderComponent<any>\(0, MeekoTeleport/);
  assert.doesNotMatch(result.code, /renderTeleport/);
  assert.equal(result.warnings?.[0]?.code, "MEEK106");
  assert.match(result.warnings![0]!.message, /su contenido en otro lugar del documento/);
});

test("without a document the content renders in place, and hydration moves the same nodes to the target and back with disabled", async () => {
  const { modules, cleanup } = await load({ "Page.meeko": page });
  const window = new Window();
  try {
    const document = window.document;
    document.body.innerHTML = `<header><div id="toolbar"><span class="own">own</span></div></header><main></main>`;
    const root = document.querySelector("main")!;
    const html = modules["Page"]!.renderToString({});
    assert.match(html, /<!--meeko:teleport:0--><!--meeko:portal--><button type="button" class="save" data-meeko="0" data-meeko-s-[0-9a-f]{8}="">Guardar <!--meeko:text:1-->0<!--\/meeko:text:1--><\/button><!--\/meeko:portal--><!--\/meeko:teleport:0-->/);
    root.innerHTML = html;
    const button = root.querySelector(".save");
    const release = modules["Page"]!.hydrate(root as unknown as Element, {});
    const toolbar = document.getElementById("toolbar")!;
    assert.equal(toolbar.querySelector(".save"), button, "the same element, now in the target");
    assert.equal(toolbar.firstElementChild?.className, "own", "after the target's own content");
    assert.equal(root.querySelector(".save"), null);
    click(toolbar, ".save");
    assert.equal(button!.textContent, "Guardar 1", "events and reactive text keep the author's scope");
    // disabled moves the same nodes back to their place, and enabling it again to the target.
    click(root, ".dock");
    assert.equal(root.querySelector(".save"), button);
    assert.equal(toolbar.querySelector(".save"), null);
    click(root, ".save");
    assert.equal(button!.textContent, "Guardar 2");
    click(root, ".dock");
    assert.equal(toolbar.querySelector(".save"), button);
    release();
    assert.equal(document.querySelector(".save"), null, "releasing the page removes its content from the target");
    assert.doesNotMatch(document.body.innerHTML, /meeko:portal/);
    assert.equal(toolbar.innerHTML, `<span class="own">own</span>`);
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

/** Two targets around the component and three teleports, two of them to the same target. */
const targets = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const label = signal("a");
</script>
<template><div id="before"></div><MeekoTeleport to="#after"><b class="first">{label.value}</b></MeekoTeleport><MeekoTeleport to="#before"><b class="second" on:click="() => label.value += 'b'">2</b></MeekoTeleport><MeekoTeleport to="#after"><b class="third">3</b></MeekoTeleport><p class="place">{label.value}</p><div id="after"><i>own</i></div></template>`;

test("a server document places the content in its targets, rendered before or after, in order, and hydrates it untouched", async () => {
  const { modules, cleanup } = await load({ "Targets.meeko": targets });
  const window = new Window();
  try {
    const collector = new TeleportCollector();
    const rendered = collectTeleports(collector, () => modules["Targets"]!.renderToString({}));
    assert.deepEqual(collector.entries.map((entry) => [entry.key, entry.to]), [["t0", "#after"], ["t1", "#before"], ["t2", "#after"]]);
    const placed = placeTeleports(rendered, collector.entries, { production: false });
    assert.equal(placed.body, "");
    const html = placed.html;
    assert.match(html, /^<div id="before"[^>]*><!--meeko:portal:t1--><b class="second" data-meeko="0"[^>]*>2<\/b><!--\/meeko:portal:t1--><\/div>/);
    assert.match(html, /<div id="after"[^>]*><i[^>]*>own<\/i><!--meeko:portal:t0--><b class="first"[^>]*><!--meeko:text:0-->a<!--\/meeko:text:0--><\/b><!--\/meeko:portal:t0--><!--meeko:portal:t2--><b class="third"[^>]*>3<\/b><!--\/meeko:portal:t2--><\/div>$/);
    assert.match(html, /<!--meeko:teleport:0--><!--meeko:portal-ref:t0--><!--\/meeko:teleport:0-->/);
    const root = window.document.createElement("main");
    window.document.body.appendChild(root);
    root.innerHTML = html;
    const before = window.document.getElementById("before")!;
    const after = window.document.getElementById("after")!;
    const nodes = [before.querySelector(".second"), after.querySelector(".first"), after.querySelector(".third")];
    const release = modules["Targets"]!.hydrate(root as unknown as Element, {});
    // Hydration only drops the references of the places: every target keeps its nodes.
    assert.deepEqual([before.querySelector(".second"), after.querySelector(".first"), after.querySelector(".third")], nodes);
    assert.equal(root.innerHTML, html.replace(/<!--meeko:portal-ref:t\d-->/g, ""));
    click(before, ".second");
    assert.equal(after.querySelector(".first")!.textContent, "ab");
    assert.equal(root.querySelector(".place")!.textContent, "ab");
    release();
    assert.equal(before.innerHTML, "");
    assert.equal(after.innerHTML, "<i>own</i>");
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

/** Teleports that appear and disappear with if:when and each:of. */
const regions = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const open = signal(false);
const items = signal(["a", "b"]);
</script>
<template><button type="button" class="toggle" on:click="() => open.value = !open.value">t</button><button type="button" class="add" on:click="() => items.value = [...items.value, 'c']">a</button><button type="button" class="drop" on:click="() => items.value = items.value.slice(1)">d</button><MeekoTeleport if:when="open.value" to="body"><aside class="panel">{items.value.length}</aside></MeekoTeleport><MeekoTeleport each:of="items.value" each:as="item" each:key="item" to="#list"><i class="row">{item}</i></MeekoTeleport></template>`;

test("teleports inside if:when and each:of appear and disappear in their targets without orphans", async () => {
  const { modules, cleanup } = await load({ "Regions.meeko": regions });
  const window = new Window();
  try {
    const document = window.document;
    const collector = new TeleportCollector();
    const rendered = collectTeleports(collector, () => modules["Regions"]!.renderToString({}));
    const placed = placeTeleports(`<ul id="list"></ul><main>${rendered}</main>`, collector.entries, { production: false });
    document.body.innerHTML = `${placed.html}${placed.body}<script id="tail"></script>`;
    const list = document.getElementById("list")!;
    const rows = (): string[] => Array.from(list.querySelectorAll(".row")).map((row) => row.textContent ?? "");
    assert.deepEqual(rows(), ["a", "b"]);
    const root = document.querySelector("main")!;
    const release = modules["Regions"]!.hydrate(root as unknown as Element, {});
    assert.deepEqual(rows(), ["a", "b"]);
    click(root, ".toggle");
    const panel = document.querySelector(".panel")!;
    assert.equal(panel.parentNode, document.body, "rendered in place, then moved to the end of <body>");
    assert.equal(panel.textContent, "2");
    click(root, ".add");
    assert.deepEqual(rows(), ["a", "b", "c"]);
    assert.equal(panel.textContent, "3");
    click(root, ".drop");
    assert.deepEqual(rows(), ["b", "c"]);
    click(root, ".toggle");
    assert.equal(document.querySelector(".panel"), null);
    click(root, ".toggle");
    assert.equal(document.querySelectorAll(".panel").length, 1);
    release();
    assert.deepEqual(rows(), []);
    assert.equal(document.querySelector(".panel"), null);
    assert.doesNotMatch(document.body.innerHTML, /meeko:portal/);
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

const context = `import { createContext } from "@meekojs/meeko";
export const Tone = createContext<string>("tone");
`;

const child = `<script lang="ts">
import { inject } from "@meekojs/meeko";
import { Tone } from "./context.ts";
const props = defineProps<{ log: string[] }>();
const tone = inject(Tone);
function fail(): void { throw new Error("boom"); }
</script>
<template><button type="button" class="child" on:click="fail">{tone}</button></template>`;

const toolbar = `<script lang="ts">
const snippets = defineSnippets<{ actions: [] }>();
</script>
<template><MeekoTeleport to="#toolbar"><div class="actions"><render snippet="snippets.actions" /></div></MeekoTeleport></template>`;

const author = `<script lang="ts">
import { provide, provideErrorHandler, signal } from "@meekojs/meeko";
import { Tone } from "./context.ts";
import * as Child from "./Child.meeko";
import * as Toolbar from "./Toolbar.meeko";
const props = defineProps<{ log: string[] }>();
provide(Tone, "dark");
provideErrorHandler((error) => { props.log.push(\`handled:\${(error as Error).message}\`); });
const saved = signal(0);
</script>
<template><Toolbar><snippet name="actions"><button type="button" class="snippet" on:click="() => saved.value++">{saved.value}</button></snippet></Toolbar><MeekoTeleport to="#toolbar"><Child bind:log="props.log" /></MeekoTeleport><p class="saved">{saved.value}</p></template>`;

test("teleported content keeps provide/inject, error handlers and snippets of the component that declares it", async () => {
  const { modules, cleanup } = await load({ "context.ts": context, "Child.meeko": child, "Toolbar.meeko": toolbar, "Author.meeko": author });
  const window = new Window();
  try {
    const document = window.document;
    const log: string[] = [];
    const collector = new TeleportCollector();
    const rendered = collectTeleports(collector, () => modules["Author"]!.renderToString({ log }));
    const placed = placeTeleports(`<nav id="toolbar"></nav><main>${rendered}</main>`, collector.entries, { production: false });
    document.body.innerHTML = placed.html;
    const bar = document.getElementById("toolbar")!;
    assert.equal(bar.querySelector(".child")!.textContent, "dark", "inject reads the provider of the author in SSR");
    const root = document.querySelector("main")!;
    const release = modules["Author"]!.hydrate(root as unknown as Element, { log });
    click(bar, ".snippet");
    assert.equal(root.querySelector(".saved")!.textContent, "1", "a snippet teleported by a child updates its parent");
    assert.equal(bar.querySelector(".snippet")!.textContent, "1");
    click(bar, ".child");
    await flush();
    assert.deepEqual(log, ["handled:boom"], "the author's error handler receives the failure of teleported content");
    release();
    assert.equal(bar.innerHTML, "");
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("placeTeleports finds its target by id past comments, raw text and nested elements, and drops orphan content", () => {
  const entry = (key: string, to: TeleportEntry["to"], html = `<!--meeko:portal:${key}-->${key}<!--/meeko:portal:${key}-->`): TeleportEntry => ({ key, to, html });
  const place = (key: string): string => `<!--meeko:portal-ref:${key}-->`;
  const app = `<!-- <div id="bar"></div> --><script>const x = '<div id="bar">';</script><textarea><div id="bar"></textarea><div class='a' id='bar' data-x="<"><div>inner</div><DIV>x</DIV></div><p>${place("t0")}${place("t1")}${place("t3")}</p>`;
  const placed = placeTeleports(app, [entry("t0", "#bar"), entry("t1", "body"), entry("t2", "#bar"), entry("t3", "#bar")], { production: false });
  assert.equal(placed.html, app.replace("<DIV>x</DIV></div>", "<DIV>x</DIV><!--meeko:portal:t0-->t0<!--/meeko:portal:t0--><!--meeko:portal:t3-->t3<!--/meeko:portal:t3--></div>"), "t2 has no place: a child that suspended dropped it");
  assert.equal(placed.body, "<!--meeko:portal:t1-->t1<!--/meeko:portal:t1-->");
  // A teleport inside the content of another one: its place and its target are there.
  const nested = placeTeleports(place("t0"), [entry("t0", "body", `<!--meeko:portal:t0--><section id="inner"></section>${place("t1")}<!--/meeko:portal:t0-->`), entry("t1", "#inner")], { production: false });
  assert.equal(nested.body, `<!--meeko:portal:t0--><section id="inner"><!--meeko:portal:t1-->t1<!--/meeko:portal:t1--></section>${place("t1")}<!--/meeko:portal:t0-->`);
  // A missing target, or one without content, fails in development and renders in place in production.
  assert.throws(() => placeTeleports(`<p>${place("t0")}</p>`, [entry("t0", "#missing")], { production: false }), /<MeekoTeleport to="#missing">: the page renders no element with id "missing"/);
  assert.throws(() => placeTeleports(`<input id="field"><p>${place("t0")}</p>`, [entry("t0", "#field")], { production: false }), /is <input>, which cannot hold content/);
  const warnings: string[] = [];
  const fallback = placeTeleports(`<p>${place("t0")}</p>`, [entry("t0", "#missing")], { production: true, warn: (message) => warnings.push(message) });
  assert.equal(fallback.html, "<p><!--meeko:portal:t0-->t0<!--/meeko:portal:t0--></p>");
  assert.match(warnings[0]!, /The content renders in its place/);
});

test("content that the server rendered in place because its target was missing hydrates there", async () => {
  const { modules, cleanup } = await load({ "Page.meeko": page });
  const window = new Window();
  const warn = console.warn;
  const warnings: string[] = [];
  console.warn = (message: string) => { warnings.push(message); };
  try {
    const collector = new TeleportCollector();
    const rendered = collectTeleports(collector, () => modules["Page"]!.renderToString({}));
    const placed = placeTeleports(rendered, collector.entries, { production: true, warn: () => {} });
    const root = window.document.createElement("main");
    window.document.body.appendChild(root);
    root.innerHTML = placed.html;
    const release = modules["Page"]!.hydrate(root as unknown as Element, {});
    click(root, ".save");
    assert.equal(root.querySelector(".save")!.textContent, "Guardar 1");
    assert.deepEqual(warnings, ['<MeekoTeleport to="#toolbar">: the target is not in the document, so the content stays in its place']);
    // A target that appears later receives it with the next change of to or disabled.
    window.document.body.insertAdjacentHTML("afterbegin", `<div id="toolbar"></div>`);
    click(root, ".dock");
    click(root, ".dock");
    assert.ok(window.document.getElementById("toolbar")!.querySelector(".save"));
    release();
    assert.equal(window.document.querySelector(".save"), null);
  } finally {
    console.warn = warn;
    window.happyDOM.abort();
    await cleanup();
  }
});

/** An application whose pages inject actions in the toolbar of their layout. */
const app: Record<string, string> = {
  "app/layouts/default.meeko": `<template><header><nav id="toolbar"><a class="home">home</a></nav></header><main><MeekoOutlet /></main></template>`,
  "app/layouts/alt.meeko": `<template><div class="alt"><nav id="toolbar"></nav><MeekoOutlet /></div></template>`,
  "app/pages/index.meeko": `<script lang="ts">
import { signal } from "@meekojs/meeko";
const count = signal(0);
</script>
<template><h1 class="home-title">Inicio</h1><MeekoTeleport to="#toolbar"><button type="button" class="save" on:click="() => count.value++">Guardar {count.value}</button></MeekoTeleport><MeekoTeleport to="body"><div class="toast">Hola</div></MeekoTeleport></template>
<style scoped>.save { font-weight: bold; }</style>`,
  "app/pages/other.meeko": `<template><h1 class="other-title">Otra</h1></template>`,
  "app/pages/alt.meeko": `<template><MeekoTeleport to="#toolbar"><button type="button" class="alt-save">Alt</button></MeekoTeleport></template>`,
  "app/pages/missing.meeko": `<template><p class="missing">x</p><MeekoTeleport to="#nope"><b class="lost">x</b></MeekoTeleport></template>`,
};

async function loadApp() {
  const { modules, cleanup } = await load(app);
  const routes = createRouteManifest([
    { id: "/", file: "app/pages/index", layouts: ["app/layouts/default"] },
    { id: "/other", file: "app/pages/other", layouts: ["app/layouts/default"] },
    { id: "/alt", file: "app/pages/alt", layouts: ["app/layouts/alt"] },
    { id: "/stream", file: "app/pages/index", layouts: ["app/layouts/default"], sidecar: "stream", render: "stream" },
    { id: "/static", file: "app/pages/index", layouts: ["app/layouts/default"], sidecar: "static", render: "prerender" },
    { id: "/missing", file: "app/pages/missing", layouts: ["app/layouts/default"] },
  ]);
  const sidecars: Record<string, { render: "stream" | "prerender" }> = { stream: { render: "stream" }, static: { render: "prerender" } };
  const handler = (production: boolean) => createPageHandler({
    routes,
    loadPage: async (file) => modules[file] as unknown as PageModule,
    loadRoute: async (file) => sidecars[file]!,
    production,
  });
  return { modules, routes, sidecars, handler, cleanup };
}

const documentRequest = (path: string): Request => new Request(`https://example.test${path}`, { headers: { accept: "text/html" } });

test("the first HTML has each teleport in its target, hydrates without mismatch and navigation removes it", async () => {
  const { modules, routes, handler, cleanup } = await loadApp();
  const server = handler(false);
  const browser = new Window({ url: "https://example.test/" });
  const errors: unknown[] = [];
  const error = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    const response = await server(documentRequest("/"));
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /<nav id="toolbar"><a class="home">home<\/a><!--meeko:portal:t0--><button type="button" class="save" data-meeko="0" data-meeko-s-[0-9a-f]{8}="">Guardar <!--meeko:text:0-->0<!--\/meeko:text:0--><\/button><!--\/meeko:portal:t0--><\/nav>/);
    // Content for body goes after the application and before Meeko's scripts.
    assert.match(html, /<\/main><\/div><!--meeko:portal:t1--><div class="toast"[^>]*>Hola<\/div><!--\/meeko:portal:t1--><script id="meeko-payload"/);
    browser.document.write(html);
    const document = browser.document;
    const toolbar = document.getElementById("toolbar")!;
    const button = toolbar.querySelector(".save");
    const toast = document.querySelector(".toast");
    const navigation = await mountClientApp({
      routes,
      root: document.getElementById("app") as unknown as Element,
      payload: document.getElementById("meeko-payload")!.textContent!,
      loadPage: async (file) => modules[file] as unknown as ClientComponent,
      serverData: true,
      fetch: ((input: RequestInfo | URL, init?: RequestInit) => server(new Request(input, init))) as typeof fetch,
      browser: browser as unknown as globalThis.Window,
    });
    assert.equal(toolbar.querySelector(".save"), button, "hydration keeps the server's nodes in the target");
    assert.equal(document.querySelector(".toast"), toast);
    (button as unknown as HTMLButtonElement).click();
    assert.equal(button!.textContent, "Guardar 1");
    assert.equal(await navigation.navigate("/other"), true);
    assert.ok(document.querySelector(".other-title"));
    assert.equal(document.querySelector(".save"), null, "the page left: its toolbar action left with it");
    assert.equal(document.querySelector(".toast"), null);
    assert.doesNotMatch(document.body.innerHTML, /meeko:portal/);
    assert.equal(toolbar.innerHTML, `<a class="home">home</a>`);
    // Back to the page: the browser renders it and moves the content to its targets.
    assert.equal(await navigation.navigate("/"), true);
    assert.equal(document.getElementById("toolbar")!.querySelectorAll(".save").length, 1);
    assert.equal(document.querySelector(".toast")!.parentNode, document.body);
    // Another layout with its own #toolbar: the new page's content goes to the toolbar that stays.
    assert.equal(await navigation.navigate("/alt"), true);
    assert.equal(document.querySelectorAll("#toolbar").length, 1);
    assert.equal(document.querySelector(".alt #toolbar .alt-save")?.textContent, "Alt");
    assert.equal(document.querySelector(".save"), null);
    assert.equal(document.querySelector(".toast"), null);
    navigation.dispose();
    assert.equal(document.querySelector(".alt-save"), null);
    assert.deepEqual(errors, []);
  } finally {
    console.error = error;
    browser.happyDOM.abort();
    await cleanup();
  }
});

test("render: stream and prerender place teleports in the first HTML too", async () => {
  const { routes, sidecars, handler, cleanup } = await loadApp();
  const output = await mkdtemp(join(tmpdir(), "meeko-teleport-prerender-"));
  try {
    const streamed = await (await handler(false)(documentRequest("/stream"))).text();
    assert.match(streamed, /<nav id="toolbar"><a class="home">home<\/a><!--meeko:portal:t0--><button type="button" class="save"/);
    assert.match(streamed, /<!--meeko:portal:t1--><div class="toast"[^>]*>Hola<\/div><!--\/meeko:portal:t1--><script id="meeko-payload"/);
    await prerenderRoutes({ routes, outputRoot: output, loadRoute: async (file) => sidecars[file]!, handler: handler(true) });
    const html = await (await import("node:fs/promises")).readFile(join(output, "static", "index.html"), "utf8");
    assert.match(html, /<nav id="toolbar"><a class="home">home<\/a><!--meeko:portal:t0--><button type="button" class="save"/);
  } finally {
    await rm(output, { recursive: true, force: true });
    await cleanup();
  }
});

test("a target that the page does not render fails in development and renders in place in production", async () => {
  const { handler, cleanup } = await loadApp();
  const error = console.error;
  const warn = console.warn;
  const logged: string[] = [];
  console.error = () => {};
  console.warn = (message: string) => { logged.push(message); };
  try {
    const development = await handler(false)(documentRequest("/missing"));
    assert.equal(development.status, 500);
    const production = await handler(true)(documentRequest("/missing"));
    assert.equal(production.status, 200);
    assert.match(await production.text(), /<p class="missing">x<\/p><!--meeko:teleport:0--><!--meeko:portal:t0--><b class="lost">x<\/b><!--\/meeko:portal:t0--><!--\/meeko:teleport:0-->/);
    await handler(true)(documentRequest("/missing"));
    assert.equal(logged.filter((message) => message.includes('to="#nope"')).length, 1, "warned once");
  } finally {
    console.error = error;
    console.warn = warn;
    await cleanup();
  }
});

test("the editor completes the attributes of <MeekoTeleport> and the targets of to, and explains the tag on hover", async () => {
  const text = `<script lang="ts"></script>\n<template><nav id="bar"></nav><MeekoTeleport t></MeekoTeleport><MeekoTeleport to=""></MeekoTeleport></template>`;
  const document = TextDocument.create("file:///project/app/pages/index.meeko", "meeko", 1, text);
  const attributes = teleportCompletion(document, document.positionAt(text.indexOf("MeekoTeleport t") + 15))!;
  assert.deepEqual(attributes.map((item) => item.label), ["to", "bind:to", "disabled", "bind:disabled", "if:when", "each:of"]);
  const root = await mkdtemp(join(tmpdir(), "meeko-teleport-editor-"));
  try {
    await mkdir(join(root, "app", "layouts"), { recursive: true });
    await writeFile(join(root, "app", "layouts", "default.meeko"), `<template><header><nav id="toolbar"></nav></header><MeekoOutlet /></template>`);
    const targets = teleportCompletion(document, document.positionAt(text.indexOf('to=""') + 4), new Set(), root)!;
    assert.deepEqual(targets.map((item) => [item.label, item.detail]), [["body", "Al final de <body>"], ["#bar", "Este componente"], ["#toolbar", "app/layouts/default.meeko"]]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
  // A project component named MeekoTeleport is a component tag, with its own props.
  assert.equal(teleportCompletion(document, document.positionAt(text.indexOf("MeekoTeleport t") + 15), new Set(["MeekoTeleport"])), undefined);
  const hover = teleportHover(document, document.positionAt(text.indexOf("MeekoTeleport t") + 3))!;
  assert.match((hover.contents as { value: string }).value, /pinta su contenido en otro lugar del documento/);
  assert.match((hover.contents as { value: string }).value, /`<dialog>` y `popover`/);
  assert.ok(teleportHover(document, document.positionAt(text.indexOf("</MeekoTeleport>") + 4)));
  assert.equal(teleportHover(document, document.positionAt(text.indexOf("nav id") + 1)), undefined);
  assert.equal(teleportHover(document, document.positionAt(text.indexOf("MeekoTeleport t") + 3), new Set(["MeekoTeleport"])), undefined);
});

test("meeko check types to as \"body\" | `#${string}` and disabled as a boolean", { timeout: 300_000 }, async (context) => {
  const root = await tempProject(context, "teleport-types");
  await linkRepositoryPackages(root);
  const put = async (files: Record<string, string>): Promise<void> => {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, name)), { recursive: true });
      await writeFile(join(root, name), content);
    }
  };
  await put({
    "package.json": '{"private":true,"type":"module"}\n',
    "app/layouts/default.meeko": `<template><nav id="toolbar"></nav><MeekoOutlet /></template>\n`,
    "app/pages/index.meeko": `<script lang="ts">
import type { MeekoTeleportProps, MeekoTeleportTarget } from "@meekojs/meeko/framework";
const where = signal<MeekoTeleportTarget>("body");
const mobile = signal(false);
const props: MeekoTeleportProps = { to: "#toolbar" };
</script>
<template><MeekoTeleport to="#toolbar" bind:disabled="mobile.value"><p>{props.to}</p></MeekoTeleport><MeekoTeleport bind:to="where.value" disabled><p>x</p></MeekoTeleport></template>
`,
  });
  assert.deepEqual((await checkApp(root)).map((item) => `${item.filename}: ${item.code}: ${item.message}`), []);
  const wrong = `<script lang="ts">
const name: string = "toolbar";
</script>
<template><MeekoTeleport bind:to="name"><p>x</p></MeekoTeleport><MeekoTeleport to="body" bind:disabled="'yes'"><p>y</p></MeekoTeleport></template>
`;
  await put({ "app/pages/index.meeko": wrong });
  const diagnostics = await checkApp(root);
  const at = (needle: string): boolean => diagnostics.some((item) => /^TS\d+$/.test(item.code) && item.location.offset === wrong.indexOf(needle));
  assert.ok(at(`name"><p>x`), JSON.stringify(diagnostics));
  assert.ok(at(`'yes'`), JSON.stringify(diagnostics));
});
