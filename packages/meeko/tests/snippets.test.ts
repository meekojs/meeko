import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { originalOffset } from "../src/compiler/mapping.ts";
import { MeekoCompileError, parseSfc } from "../src/compiler/sfc.ts";
import { generateTypes } from "../src/types.ts";

interface RuntimeModule {
  renderToString(props: Record<string, unknown>): string;
  renderWithState(props: Record<string, unknown>): { html: string; state: Record<string, unknown> };
  hydrate(root: Element, props: Record<string, unknown>, state?: Record<string, unknown>): () => void;
}

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);

/** Compiles components inside the repository; the runtime is imported by file URL, as one instance. */
async function load(components: Record<string, string>, entry: string, transform: (name: string, code: string) => string = (_name, code) => code): Promise<{ component: RuntimeModule; cleanup: () => Promise<void> }> {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "snippets-test-"));
  for (const [name, source] of Object.entries(components)) {
    let code = compile(source, join(directory, `${name}.meeko`)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
      .replaceAll(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`);
    for (const other of Object.keys(components)) code = code.replace(`from "./${other}.meeko"`, `from "./${other}.ts"`);
    await writeFile(join(directory, `${name}.ts`), transform(name, code));
  }
  const component = await import(pathToFileURL(join(directory, `${entry}.ts`)).href) as RuntimeModule;
  return { component, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

async function typeProject(files: Record<string, string>): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const parentDirectory = resolve(".meeko");
  await mkdir(parentDirectory, { recursive: true });
  const root = await mkdtemp(join(parentDirectory, "snippets-check-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      types: ["node"],
      paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] },
    },
  })}\n`);
  for (const [name, source] of Object.entries(files)) await writeFile(join(root, name), source);
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function assertCompileError(source: string, code: string, offset: number): void {
  assert.throws(() => compile(source, "Snippets.meeko"), (error: unknown) => {
    assert.ok(error instanceof MeekoCompileError, String(error));
    assert.equal(error.diagnostic.code, code, error.message);
    assert.equal(error.diagnostic.location.offset, offset, error.message);
    return true;
  });
}

const dialog = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const snippets = defineSnippets<{ default: []; title?: []; actions?: [close: () => void, label: string] }>();
const open = signal(true);
const label = signal("Close");
const closes = signal(0);
function close(): void { closes.value++; }
</script>
<template><div class="dialog"><h2 class="title"><render snippet="snippets.title" /></h2><div class="body"><render snippet="snippets.default" /></div><p class="count">{closes.value}</p><footer if:when="open.value"><render snippet="snippets.actions" args="close, label.value" /></footer><button type="button" class="relabel" on:click="() => label.value = 'Done'">l</button><button type="button" class="toggle" on:click="() => open.value = !open.value">t</button></div></template>`;

const page = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as AppDialog from "./AppDialog.meeko";
const message = signal("Hello");
const clicks = signal(0);
const show = signal(true);
</script>
<template><main><template if:when="show.value"><AppDialog>
  <p class="message">{message.value}</p>
  <snippet name="actions" params="close, label"><button type="button" class="action" on:click="() => { clicks.value++; close(); }">{label} {clicks.value}</button></snippet>
</AppDialog></template><button type="button" class="change" on:click="() => message.value = 'Bye'">c</button><button type="button" class="hide" on:click="() => show.value = !show.value">h</button><span class="clicks">{clicks.value}</span></main></template>`;

test("snippets compile into the child channel and <render> regions", () => {
  const child = compile(dialog, "AppDialog.meeko").code;
  assert.match(child, /const snippets: __meeko\.SnippetMap<__MeekoSnippets> = __meeko\.useSnippets<__MeekoSnippets>\(__props\);/);
  assert.match(child, /export type ComponentSnippets = __meeko\.SnippetMap<__MeekoSnippets>;/);
  assert.match(child, /__meeko\.renderSnippet\(0, snippets\.title, \[\]\)/);
  assert.match(child, /__meeko\.renderSnippet\(2, snippets\.actions, \[close, label\.value\]\)/);
  assert.match(child, /__meeko\.bindSnippet\(__scope, 2, \(\) => \(snippets\.actions\), \(\) => \[close, label\.value\]\)/);
  const parent = compile(page, "Page.meeko").code;
  // The tag call types each snippet: the child's defineSnippets gives the parameters.
  assert.match(parent, /__meeko\.componentTag\(\(\) => AppDialog\)\(\{  \}, __meeko\.noChannels, __meeko\.noChannels, \{ "default": __meeko\.snippet\(\(\) => /);
  assert.match(parent, /"actions": __meeko\.snippet\(\(close, label\) => /);
  // In the hydration, parameters read the arguments signal of their snippet.
  assert.match(parent, /\(\(__meeko_args_1\.value\[1\]\)\)/);
  assert.doesNotMatch(parent, /checkComponentSnippets|SnippetArgs/);
  // `<render />` closes itself; the following nodes stay siblings.
  const self = compile(`<script lang="ts">const snippets = defineSnippets<{ a: [] }>();</script><template><div><render snippet="snippets.a" /><p>after</p></div></template>`, "Self.meeko").code;
  assert.match(self, /"<div" \+ ">" \+ __meeko\.renderSnippet\(0, snippets\.a, \[\]\) \+ "<p"/);
  assert.doesNotThrow(() => parseSfc(`<script lang="ts">const x = 1;</script><template><render snippet="x" /></template>`, "Self.meeko"));
});

test("a snippet parameter rewritten in the hydration keeps exact positions for the rest of the expression", () => {
  const source = `<script lang="ts">\nimport * as List from "./List.meeko";\n</script>\n<template><List><snippet name="row" params="row">{row.name}</snippet></List></template>`;
  const { code, mappings } = compile(source, "Parent.meeko");
  const read = "(__meeko_args_0.value[0])";
  const rewritten = code.indexOf(`(${read}.name)`);
  assert.ok(rewritten >= 0, code);
  // `.name` after the rewritten parameter maps to `.name`, not to the end of `row.name`.
  const name = rewritten + 1 + read.length + 1;
  assert.equal(code.slice(name, name + 4), "name");
  assert.equal(originalOffset(mappings, name), source.indexOf("name}"));
  assert.equal(originalOffset(mappings, name + 3), source.indexOf("name}") + 3);
  // The read of the arguments maps to the parameter name it replaces.
  assert.equal(originalOffset(mappings, rewritten + 1), source.indexOf("row.name"));
});

test("snippets render in SSR and hydrate in the parent's reactive scope", async () => {
  const { component, cleanup } = await load({ AppDialog: dialog, Page: page }, "Page");
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    const rendered = component.renderWithState({});
    root.innerHTML = rendered.html;
    const text = (selector: string): string => (root.querySelector(selector)?.textContent ?? "").trim();
    assert.equal(text(".title"), "");
    assert.equal(text(".message"), "Hello");
    assert.equal(text(".action"), "Close 0");
    assert.match(rendered.html, /<!--meeko:snippet:\d+-->/);
    const release = component.hydrate(root as unknown as Element, {}, rendered.state);
    const ssrButton = root.querySelector(".action");
    // Parent state reaches the snippet content inside the child.
    (root.querySelector("button.change") as unknown as HTMLButtonElement).click();
    assert.equal(text(".message"), "Bye");
    // The snippet calls the child's argument and the parent's state.
    (root.querySelector(".action") as unknown as HTMLButtonElement).click();
    assert.equal(text(".count"), "1");
    assert.equal(text(".clicks"), "1");
    assert.equal(text(".action"), "Close 1");
    assert.equal(root.querySelector(".action"), ssrButton);
    // Child arguments update the snippet without rendering it again.
    (root.querySelector("button.relabel") as unknown as HTMLButtonElement).click();
    assert.equal(text(".action"), "Done 1");
    assert.equal(root.querySelector(".action"), ssrButton);
    // The child removes and restores the region; the restored content is live.
    (root.querySelector("button.toggle") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector(".action"), null);
    (root.querySelector("button.toggle") as unknown as HTMLButtonElement).click();
    (root.querySelector(".action") as unknown as HTMLButtonElement).click();
    assert.equal(text(".action"), "Done 2");
    assert.equal(text(".count"), "2");
    // The parent removes the child: the snippet bindings go with it.
    const detached = root.querySelector(".action") as unknown as HTMLButtonElement;
    (root.querySelector("button.hide") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector(".dialog"), null);
    detached.click();
    assert.equal(text(".clicks"), "2");
    (root.querySelector("button.hide") as unknown as HTMLButtonElement).click();
    assert.equal(text(".message"), "Bye");
    (root.querySelector("button.change") as unknown as HTMLButtonElement).click();
    release();
    const last = root.querySelector(".action") as unknown as HTMLButtonElement;
    last.click();
    assert.equal(text(".clicks"), "2");
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

const inner = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const snippets = defineSnippets<{ item: [name: string] }>();
const names = signal(["a", "b"]);
</script>
<template><ul><li each:of="names.value" each:as="name"><render snippet="snippets.item" args="name" /></li></ul><button type="button" class="add" on:click="() => names.value = [...names.value, 'c']">+</button></template>`;

const middle = `<script lang="ts">
import * as Inner from "./Inner.meeko";
const snippets = defineSnippets<{ item: [name: string] }>();
</script>
<template><section class="middle"><Inner><snippet name="item" params="name"><em><render snippet="snippets.item" args="name.toUpperCase()" /></em></snippet></Inner></section></template>`;

const outer = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Middle from "./Middle.meeko";
const prefix = signal(">");
</script>
<template><div><Middle><snippet name="item" params="value"><span class="row">{prefix.value}{value}</span></snippet></Middle><button type="button" class="prefix" on:click="() => prefix.value = '#'">p</button></div></template>`;

test("a component forwards a snippet it received to its own child", async () => {
  const { component, cleanup } = await load({ Inner: inner, Middle: middle, Outer: outer }, "Outer");
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    root.innerHTML = component.renderToString({});
    const rows = (): string[] => [...root.querySelectorAll(".row")].map((row) => row.textContent ?? "");
    assert.deepEqual(rows(), [">A", ">B"]);
    const release = component.hydrate(root as unknown as Element, {});
    (root.querySelector("button.prefix") as unknown as HTMLButtonElement).click();
    assert.deepEqual(rows(), ["#A", "#B"]);
    (root.querySelector("button.add") as unknown as HTMLButtonElement).click();
    assert.deepEqual(rows(), ["#A", "#B", "#C"]);
    assert.equal(root.querySelectorAll("em").length, 3);
    release();
    (root.querySelector("button.prefix") as unknown as HTMLButtonElement).click();
    assert.deepEqual(rows(), ["#A", "#B", "#C"]);
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

const card = `<script lang="ts">
const snippets = defineSnippets<{ default: []; title?: [] }>();
</script>
<template><article class="card"><header if:when="snippets.title"><render snippet="snippets.title" /></header><div class="content"><render snippet="snippets.default" /></div></article></template>`;

const cards = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Card from "./Card.meeko";
const items = signal(["a", "b"]);
const suffix = signal("!");
</script>
<template><div><Card><snippet name="title"><i>T</i></snippet>first</Card><ul><li each:of="items.value" each:as="item" each:index="index"><Card>{index}:{item}{suffix.value}</Card></li></ul><button type="button" class="add" on:click="() => items.value = [...items.value, 'c']">+</button><button type="button" class="drop" on:click="() => items.value = items.value.slice(1)">-</button><button type="button" class="suffix" on:click="() => suffix.value = '?'">s</button></div></template>`;

test("an optional snippet is checked with if:when and list locals reach the snippet content", async () => {
  const { component, cleanup } = await load({ Card: card, Cards: cards }, "Cards");
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    root.innerHTML = component.renderToString({});
    const contents = (): string[] => [...root.querySelectorAll("li .content")].map((node) => node.textContent ?? "");
    // Only the card that fills title renders its header; the others render no guard content.
    assert.equal(root.querySelectorAll("header").length, 1);
    assert.equal(root.querySelector("header")?.textContent, "T");
    assert.equal(root.querySelector(".card .content")?.textContent, "first");
    assert.deepEqual(contents(), ["0:a!", "1:b!"]);
    const release = component.hydrate(root as unknown as Element, {});
    (root.querySelector("button.suffix") as unknown as HTMLButtonElement).click();
    assert.deepEqual(contents(), ["0:a?", "1:b?"]);
    (root.querySelector("button.add") as unknown as HTMLButtonElement).click();
    assert.deepEqual(contents(), ["0:a?", "1:b?", "2:c?"]);
    (root.querySelector("button.drop") as unknown as HTMLButtonElement).click();
    assert.deepEqual(contents(), ["0:b?", "1:c?"]);
    assert.equal(root.querySelectorAll("header").length, 1);
    release();
    (root.querySelector("button.add") as unknown as HTMLButtonElement).click();
    assert.deepEqual(contents(), ["0:b?", "1:c?"]);
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

const footerCard = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const snippets = defineSnippets<{ default: []; footer?: [] }>();
const count = signal(0);
</script>
<template><article class="card"><input class="field" /><button type="button" class="bump" on:click="() => count.value++">{count.value}</button><div class="body"><render snippet="snippets.default" /></div><p class="has">{snippets.footer ? "yes" : "no"}</p><footer class="footer" if:when="snippets.footer"><render snippet="snippets.footer" /></footer><div class="always"><render snippet="snippets.footer" /></div></article></template>`;

const panel = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as FooterCard from "./FooterCard.meeko";
const snippets = defineSnippets<{ default: []; actions?: [close: () => void] }>();
const closes = signal(0);
function close(): void { closes.value++; }
</script>
<template><section class="panel"><span class="closes">{closes.value}</span><FooterCard><render snippet="snippets.default" /><snippet name="footer" if:when="snippets.actions"><render snippet="snippets.actions" args="close" /></snippet></FooterCard></section></template>`;

const panelPage = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Panel from "./Panel.meeko";
const props = defineProps<{ actions: boolean }>();
const show = signal(props.actions);
const label = signal("Close");
</script>
<template><main><Panel><p class="text">body</p><snippet name="actions" params="close" if:when="show.value"><button type="button" class="act" on:click="close">{label.value}</button></snippet></Panel><button type="button" class="toggle" on:click="() => show.value = !show.value">t</button><button type="button" class="relabel" on:click="() => label.value = 'Done'">r</button></main></template>`;

test("<snippet if:when> compiles to a snippet that is passed only while its condition is true", () => {
  const parent = compile(panel, "Panel.meeko").code;
  // SSR and hydration evaluate the same condition; `undefined!` keeps the snippet's type for the tag.
  assert.match(parent, /"footer": \(!!\(snippets\.actions\) \? __meeko\.snippet\(\(\) => /);
  assert.equal(parent.match(/ : undefined!\)/g)?.length, 3, "renderWithState, renderToString and the hydration");
  assert.doesNotMatch(parent, /checkSnippetCondition/, "the MEEK110 check is only for meeko check");
  const checked = compile(panel, "Panel.meeko", { typeCheck: true }).code;
  assert.match(checked, /void \(\(\) => __meeko\.checkSnippetCondition\(\(\) => \(FooterCard\), "footer", true\)\);/);
  // The page's condition reads its own signal, in the parent's scope.
  const page = compile(panelPage, "Page.meeko").code;
  assert.match(page, /"actions": \(!!\(show\.value\) \? __meeko\.snippet\(\(close\) => /);
});

for (const actions of [true, false]) {
  test(`a conditional snippet reaches a mounted child in place (SSR ${actions ? "with" : "without"} it)`, async () => {
    const { component, cleanup } = await load({ FooterCard: footerCard, Panel: panel, Page: panelPage }, "Page");
    const window = new Window();
    try {
      const document = window.document;
      const root = document.createElement("main");
      document.body.appendChild(root);
      const rendered = component.renderWithState({ actions });
      root.innerHTML = rendered.html;
      const text = (selector: string): string => (root.querySelector(selector)?.textContent ?? "").trim();
      const click = (selector: string): void => (root.querySelector(selector) as unknown as HTMLButtonElement).click();
      const present = (): void => {
        assert.equal(text(".has"), "yes");
        assert.equal(root.querySelectorAll(".act").length, 2, "inside the footer and in the plain <render>");
        assert.ok(root.querySelector(".footer .act"));
      };
      const absent = (): void => {
        assert.equal(text(".has"), "no");
        assert.equal(root.querySelector(".footer"), null);
        assert.equal(root.querySelector(".act"), null);
        assert.equal(text(".always"), "");
      };
      if (actions) present();
      else absent();
      assert.equal(text(".body"), "body");
      const release = component.hydrate(root as unknown as Element, { actions }, rendered.state);
      const field = root.querySelector(".field") as unknown as HTMLInputElement;
      const card = root.querySelector(".card");
      const panelElement = root.querySelector(".panel");
      field.value = "typed";
      field.focus();
      click(".bump");
      assert.equal(text(".bump"), "1");
      const toggle = (): void => click(".toggle");
      if (!actions) {
        toggle();
        present();
      }
      // The snippet content belongs to the page and calls the argument that Panel passes.
      click(".footer .act");
      assert.equal(text(".closes"), "1");
      click(".relabel");
      assert.equal(text(".footer .act"), "Done");
      toggle();
      absent();
      toggle();
      present();
      click(".footer .act");
      assert.equal(text(".closes"), "2");
      assert.equal(text(".footer .act"), "Done");
      // Neither Panel nor the card mounted again: the same DOM, state and focus.
      assert.equal(root.querySelector(".panel"), panelElement);
      assert.equal(root.querySelector(".card"), card);
      assert.equal(root.querySelector(".field"), field);
      assert.equal(field.value, "typed");
      assert.equal(document.activeElement, field);
      assert.equal(text(".bump"), "1");
      toggle();
      absent();
      release();
      toggle();
      absent();
    } finally {
      window.happyDOM.abort();
      await cleanup();
    }
  });
}

test("a child without reactive props is rebuilt when a conditional snippet appears or disappears", async () => {
  // A component with a top-level data await does not read its props reactively.
  const rebuilt = (name: string, code: string): string => name === "FooterCard"
    ? code.replace("export const __meekoReactiveProps: boolean = true;", "export const __meekoReactiveProps: boolean = false;")
    : code;
  const { component, cleanup } = await load({ FooterCard: footerCard, Panel: panel, Page: panelPage }, "Page", rebuilt);
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    const rendered = component.renderWithState({ actions: false });
    root.innerHTML = rendered.html;
    const release = component.hydrate(root as unknown as Element, { actions: false }, rendered.state);
    const field = root.querySelector(".field");
    (root.querySelector(".bump") as unknown as HTMLButtonElement).click();
    (root.querySelector(".toggle") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector(".has")?.textContent, "yes");
    assert.notEqual(root.querySelector(".field"), field, "the range was rebuilt");
    // The rebuild keeps the editable signals by name.
    assert.equal(root.querySelector(".bump")?.textContent, "1");
    (root.querySelector(".footer .act") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector(".closes")?.textContent, "1");
    (root.querySelector(".toggle") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector(".has")?.textContent, "no");
    assert.equal(root.querySelector(".act"), null);
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("snippets report MEEK059 to MEEK062 and children no longer give MEEK049", () => {
  const script = (body: string): string => `<script lang="ts">\n${body}\n</script><template><p>x</p></template>`;
  const twice = script(`const a = defineSnippets<{ x: [] }>();\nconst b = defineSnippets<{ y: [] }>();`);
  assertCompileError(twice, "MEEK059", twice.lastIndexOf("defineSnippets"));
  const nested = script(`function f() { return defineSnippets<{ x: [] }>(); }`);
  assertCompileError(nested, "MEEK059", nested.indexOf("defineSnippets"));
  const untyped = script(`const s = defineSnippets();`);
  assertCompileError(untyped, "MEEK060", untyped.indexOf("defineSnippets"));
  const runtimeArgument = script(`const s = defineSnippets<{ x: [] }>("x");`);
  assertCompileError(runtimeArgument, "MEEK060", runtimeArgument.indexOf(`"x"`));
  const late = `<script lang="ts">\nconst input = await useElementRef("input");\nconst s = defineSnippets<{ x: [] }>();\n</script><template><input ref:input /></template>`;
  assertCompileError(late, "MEEK058", late.indexOf("const s"));

  const template = (body: string): string => `<script lang="ts">const Child = 1;\nconst snippets = defineSnippets<{ x: [] }>();\nconst v = 1;</script>\n<template>${body}</template>`;
  const outside = template(`<div><snippet name="x">a</snippet></div>`);
  assertCompileError(outside, "MEEK061", outside.indexOf("<snippet"));
  const noName = template(`<Child><snippet>a</snippet></Child>`);
  assertCompileError(noName, "MEEK061", noName.indexOf("<snippet"));
  const badName = template(`<Child><snippet name="a-b">a</snippet></Child>`);
  assertCompileError(badName, "MEEK061", badName.indexOf(`name="a-b"`));
  const duplicate = template(`<Child><snippet name="x">a</snippet><snippet name="x">b</snippet></Child>`);
  assertCompileError(duplicate, "MEEK061", duplicate.lastIndexOf(`x">b`));
  const badParams = template(`<Child><snippet name="x" params="a, 1b">a</snippet></Child>`);
  assertCompileError(badParams, "MEEK061", badParams.indexOf("1b"));
  const repeatedParams = template(`<Child><snippet name="x" params="a, a">a</snippet></Child>`);
  assertCompileError(repeatedParams, "MEEK061", repeatedParams.lastIndexOf("a\">a"));
  const conflict = template(`<Child>loose<snippet name="default">a</snippet></Child>`);
  assertCompileError(conflict, "MEEK061", conflict.indexOf(`default">`));
  const directive = template(`<Child><snippet name="x" each:of="v">a</snippet></Child>`);
  assertCompileError(directive, "MEEK061", directive.indexOf("each:of"));
  const emptyCondition = template(`<Child><snippet name="x" if:when="">a</snippet></Child>`);
  assertCompileError(emptyCondition, "MEEK061", emptyCondition.indexOf("if:when"));
  const bareCondition = template(`<Child><snippet name="x" if:when>a</snippet></Child>`);
  assertCompileError(bareCondition, "MEEK061", bareCondition.indexOf("if:when"));
  const blankCondition = template(`<Child><snippet name="x" if:when="  ">a</snippet></Child>`);
  assertCompileError(blankCondition, "MEEK061", blankCondition.indexOf("if:when"));
  const badCondition = template(`<Child><snippet name="x" if:when="v +">a</snippet></Child>`);
  assert.throws(() => compile(badCondition, "Snippets.meeko"), (error: unknown) => error instanceof MeekoCompileError && error.diagnostic.code === "MEEK020");
  const ref = template(`<Child><snippet name="x"><p ref:p>a</p></snippet></Child>`);
  assertCompileError(ref, "MEEK052", ref.indexOf("ref:p"));
  const missing = template(`<render />`);
  assertCompileError(missing, "MEEK062", missing.indexOf("<render"));
  const content = template(`<render snippet="snippets.x">text</render>`);
  assertCompileError(content, "MEEK062", content.indexOf("<render"));
  const extra = template(`<render snippet="snippets.x" class="a" />`);
  assertCompileError(extra, "MEEK062", extra.indexOf(`class="a"`));
  // Children of a component tag compile into snippets; the type check decides if the child accepts them.
  assert.doesNotThrow(() => compile(template(`<Child>text</Child><div><Child><span></span></Child></div>`), "Snippets.meeko"));
  // `<component is>` still rejects children.
  const dynamic = template(`<component is="Child">text</component>`);
  assertCompileError(dynamic, "MEEK031", dynamic.indexOf("<component"));
  // A late name inside snippet content is MEEK057, parameters are not.
  const lateName = `<script lang="ts">\nimport * as Child from "./Child.meeko";\nconst input = await useElementRef("input");\nconst later = 1;\n</script><template><input ref:input /><Child><snippet name="x" params="p">{p}{later}</snippet></Child></template>`;
  assertCompileError(lateName, "MEEK057", lateName.indexOf("later}"));
  // The parent's template also reads the condition of a snippet.
  const lateCondition = `<script lang="ts">\nimport * as Child from "./Child.meeko";\nconst input = await useElementRef("input");\nconst later = 1;\n</script><template><input ref:input /><Child><snippet name="x" if:when="later">a</snippet></Child></template>`;
  assertCompileError(lateCondition, "MEEK057", lateCondition.indexOf("later\">"));
});

test("meeko check types snippets: names, parameters, arguments and required ones", { timeout: 90_000 }, async () => {
  const { root, cleanup } = await typeProject({ "AppDialog.meeko": dialog, "Card.meeko": card, "Plain.meeko": `<script lang="ts">const x = 1;</script><template><p>{x}</p></template>` });
  const parentWith = (template: string): string => `<script lang="ts">\nimport * as AppDialog from "./AppDialog.meeko";\nimport * as Plain from "./Plain.meeko";\nfunction go(): void {}\n</script><template>${template}</template>`;
  const cases = [
    { name: "ValidChild", source: dialog, codes: [] as string[] },
    { name: "ValidPage", source: page, codes: [] },
    { name: "ValidCard", source: card, codes: [] },
    { name: "ValidCards", source: cards, codes: [] },
    { name: "Typed", source: parentWith(`<AppDialog>x<snippet name="actions" params="close, label"><button on:click="close">{label.toUpperCase()}</button></snippet></AppDialog>`), codes: [] },
    { name: "Missing", source: parentWith(`<AppDialog><snippet name="title">t</snippet></AppDialog>`), codes: ["TS2741"], at: "<AppDialog" },
    { name: "Unknown", source: parentWith(`<AppDialog>x<snippet name="nope">t</snippet></AppDialog>`), codes: ["TS2353"], at: `nope"` },
    { name: "ParamType", source: parentWith(`<AppDialog>x<snippet name="actions" params="close, label">{label.nope}</snippet></AppDialog>`), codes: ["TS2339"], at: "nope}" },
    { name: "TooManyParams", source: parentWith(`<AppDialog>x<snippet name="actions" params="close, label, extra">{extra}</snippet></AppDialog>`), codes: ["TS2345"], at: "close, label, extra" },
    { name: "NoSnippets", source: parentWith(`<Plain>text</Plain>`), codes: ["TS2322"], at: "text" },
    { name: "NoSnippetsNamed", source: parentWith(`<Plain><snippet name="x">t</snippet></Plain>`), codes: ["TS2322"], at: `x">` },
    { name: "RenderArgs", source: `<script lang="ts">\nconst snippets = defineSnippets<{ a: [n: number] }>();\n</script><template><render snippet="snippets.a" args="'x'" /></template>`, codes: ["TS2322"], at: "'x'" },
    { name: "RenderNoArgs", source: `<script lang="ts">\nconst snippets = defineSnippets<{ a: [n: number] }>();\n</script><template><render snippet="snippets.a" /></template>`, codes: ["TS2345"], at: "<render" },
    { name: "RenderUnknown", source: `<script lang="ts">\nconst snippets = defineSnippets<{ a: [] }>();\n</script><template><render snippet="snippets.b" /></template>`, codes: ["TS2339"], at: "b\" />" },
    { name: "NotTuple", source: `<script lang="ts">\nconst snippets = defineSnippets<{ a: number }>();\n</script><template><p>{typeof snippets}</p></template>`, codes: ["TS2344"], at: "{ a: number }" },
  ];
  try {
    for (const item of cases) {
      const diagnostics = await checkSource(item.source, join(root, `${item.name}.meeko`));
      const messages = JSON.stringify(diagnostics);
      const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
      if (item.codes.length === 0) assert.deepEqual([...codes], [], `${item.name}: ${messages}`);
      for (const code of item.codes) assert.ok(codes.has(code), `${item.name}: ${messages}`);
      if (item.at) {
        assert.ok(diagnostics.every((diagnostic) => !diagnostic.message.startsWith("TypeScript generado")), `${item.name}: ${messages}`);
        assert.ok(diagnostics.some((diagnostic) => diagnostic.location.offset === item.source.indexOf(item.at!)), `${item.name}: ${messages}`);
      }
    }
    await generateTypes(page, join(root, "Page.meeko"));
    const declaration = await readFile(join(root, ".meeko", "types", "AppDialog.d.meeko.ts"), "utf8");
    assert.match(declaration, /export type ComponentSnippets = __meeko\.SnippetMap<__MeekoSnippets>;/);
  } finally {
    await cleanup();
  }
});

const genericList = `<script lang="ts" generic="T extends { id: string }">
const props = defineProps<{ rows: T[] }>();
const snippets = defineSnippets<{ head: []; row?: [row: T] }>();
</script>
<template><ul><li if:when="snippets.head"><render snippet="snippets.head" /></li><li each:of="props.rows" each:as="row" each:key="row.id"><render snippet="snippets.row" args="row" /></li></ul></template>`;

test("meeko check: if:when on a <snippet> needs an optional snippet and narrows its content", { timeout: 120_000 }, async () => {
  const { root, cleanup } = await typeProject({ "AppDialog.meeko": dialog, "FooterCard.meeko": footerCard, "Panel.meeko": panel, "GenericList.meeko": genericList });
  const parentWith = (template: string): string => `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as AppDialog from "./AppDialog.meeko";
import * as GenericList from "./GenericList.meeko";
const flag = signal(true);
const user = signal<{ name: string } | null>(null);
const rows = [{ id: "a" }];
</script><template>${template}</template>`;
  const cases = [
    { name: "Forward", source: panel, codes: [] as string[] },
    { name: "PanelPage", source: panelPage, codes: [] },
    { name: "Optional", source: parentWith(`<AppDialog>x<snippet name="title" if:when="flag.value">t</snippet></AppDialog>`), codes: [] },
    { name: "OptionalParams", source: parentWith(`<AppDialog>x<snippet name="actions" params="close, label" if:when="flag.value"><button on:click="close">{label}</button></snippet></AppDialog>`), codes: [] },
    { name: "Required", source: parentWith(`<AppDialog><snippet name="default" if:when="flag.value">x</snippet></AppDialog>`), codes: ["MEEK110"], at: "if:when" },
    { name: "Narrowed", source: parentWith(`<AppDialog>x<snippet name="title" if:when="user.value">{user.value.name}</snippet></AppDialog>`), codes: [] },
    { name: "NotNarrowed", source: parentWith(`<AppDialog>x<snippet name="title">{user.value.name}</snippet></AppDialog>`), codes: ["TS18047"], at: "user.value.name" },
    // A parameter with the name of a condition's variable hides it: there the condition does not narrow.
    { name: "Shadowed", source: parentWith(`<AppDialog>x<snippet name="actions" params="close, user" if:when="flag.value && user.value">{user.value.name}</snippet></AppDialog>`), codes: ["TS2551"], at: "value.name}" },
    { name: "Unknown", source: parentWith(`<AppDialog>x<snippet name="nope" if:when="flag.value">t</snippet></AppDialog>`), codes: ["TS2353"], at: `nope"` },
    { name: "BadCondition", source: parentWith(`<AppDialog>x<snippet name="title" if:when="missing.value">t</snippet></AppDialog>`), codes: ["TS2304"], at: "missing" },
    { name: "GenericOptional", source: parentWith(`<GenericList bind:rows="rows"><snippet name="head">h</snippet><snippet name="row" params="row" if:when="flag.value">{row.id}</snippet></GenericList>`), codes: [] },
    { name: "GenericRequired", source: parentWith(`<GenericList bind:rows="rows"><snippet name="head" if:when="flag.value">h</snippet></GenericList>`), codes: ["MEEK110"], at: "if:when" },
  ];
  try {
    for (const item of cases) {
      const diagnostics = await checkSource(item.source, join(root, `${item.name}.meeko`));
      const messages = JSON.stringify(diagnostics);
      const codes = diagnostics.map((diagnostic) => diagnostic.code);
      if (item.codes.length === 0) assert.deepEqual(codes, [], `${item.name}: ${messages}`);
      else assert.deepEqual([...new Set(codes)], item.codes, `${item.name}: ${messages}`);
      if (item.at) {
        assert.ok(diagnostics.every((diagnostic) => !diagnostic.message.startsWith("TypeScript generado")), `${item.name}: ${messages}`);
        assert.ok(diagnostics.some((diagnostic) => diagnostic.location.offset === item.source.indexOf(item.at!)), `${item.name}: ${messages}`);
      }
    }
    const required = await checkSource(parentWith(`<AppDialog><snippet name="default" if:when="flag.value">x</snippet></AppDialog>`), join(root, "RequiredMessage.meeko"));
    assert.equal(required.length, 1, JSON.stringify(required));
    assert.match(required[0]!.message, /<snippet name="default">.*declara default como obligatorio.*default\?: \[\.\.\.\]/);
  } finally {
    await cleanup();
  }
});

const reusedCard = `<script lang="ts">
const snippets = defineSnippets<{ header?: []; default: []; footer?: [] }>();
</script>
<template><article><header if:when="snippets.header"><render snippet="snippets.header" /></header><render snippet="snippets.default" /><footer if:when="snippets.footer"><render snippet="snippets.footer" /></footer></article></template>`;

/** Reuses the card's snippets without `footer`, adds `actions` and forwards them with `<snippet if:when>`. */
const reusingModal = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import type { Snippet } from "@meekojs/meeko";
import type { ComponentSnippets as CardSnippets } from "./Card.meeko";
import * as Card from "./Card.meeko";
type Equal<A, B> = (<V>() => V extends A ? 1 : 2) extends (<V>() => V extends B ? 1 : 2) ? true : false;
const snippets = defineSnippets<Omit<CardSnippets, "footer"> & { actions?: [close: () => void] }>();
const sameSnippets: Equal<typeof snippets, { header?: Snippet<[]>; default: Snippet<[]>; actions?: Snippet<[close: () => void]> }> = true;
const open = signal(true);
function close(): void { open.value = false; }
</script>
<template><Card if:when="open.value"><snippet name="header" if:when="snippets.header"><render snippet="snippets.header" /></snippet><render snippet="snippets.default" /><snippet name="footer" if:when="snippets.actions"><render snippet="snippets.actions" args="close" /></snippet></Card><p>{String(sameSnippets)}</p></template>`;

/** A generic list whose wrapper reuses its snippets with its own type parameter. */
const reusingGenericList = `<script lang="ts" generic="T extends { id: string }">
import type { ComponentSnippets as ListSnippets } from "./GenericList.meeko";
import * as GenericList from "./GenericList.meeko";
const props = defineProps<{ rows: T[] }>();
const snippets = defineSnippets<Pick<ListSnippets<T>, "row"> & { empty?: [] }>();
</script>
<template><GenericList bind:rows="props.rows"><snippet name="head"><p if:when="snippets.empty"><render snippet="snippets.empty" /></p></snippet><snippet name="row" params="row" if:when="snippets.row"><render snippet="snippets.row" args="row" /></snippet></GenericList></template>`;

test("defineSnippets accepts a map of Snippet<Args>: Omit, Pick and & keep each snippet's parameters and optionality", { timeout: 180_000 }, async () => {
  const { root, cleanup } = await typeProject({ "Card.meeko": reusedCard, "Modal.meeko": reusingModal, "GenericList.meeko": genericList, "GenericWrap.meeko": reusingGenericList });
  const parentWith = (template: string): string => `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Modal from "./Modal.meeko";
import * as GenericWrap from "./GenericWrap.meeko";
const flag = signal(true);
const rows = [{ id: "a", label: "A" }];
</script><template>${template}</template>`;
  const cases = [
    { name: "Reusing", source: reusingModal, codes: [] as string[] },
    { name: "ReusingGeneric", source: reusingGenericList, codes: [] },
    // Tuples, as before 1.4: the same type, also next to a Snippet entry.
    { name: "Tuples", source: `<script lang="ts">
import type { Snippet } from "@meekojs/meeko";
type Equal<A, B> = (<V>() => V extends A ? 1 : 2) extends (<V>() => V extends B ? 1 : 2) ? true : false;
const snippets = defineSnippets<{ a: [n: number]; b?: []; c: Snippet<[label: string]> }>();
const same: Equal<typeof snippets, { a: Snippet<[n: number]>; b?: Snippet<[]>; c: Snippet<[label: string]> }> = true;
</script><template><render snippet="snippets.a" args="1" /><render snippet="snippets.c" args="'x'" /><p>{String(same)}</p></template>`, codes: [] },
    { name: "Parent", source: parentWith(`<Modal><p>Body</p><snippet name="header">H</snippet><snippet name="actions" params="close"><button on:click="close">x</button></snippet></Modal>`), codes: [] },
    { name: "ParentConditional", source: parentWith(`<Modal>Body<snippet name="actions" params="close" if:when="flag.value"><button on:click="close">x</button></snippet></Modal>`), codes: [] },
    { name: "ParentParamType", source: parentWith(`<Modal>Body<snippet name="actions" params="close">{close.nope}</snippet></Modal>`), codes: ["TS2339"], at: "nope}" },
    { name: "ParentTooManyParams", source: parentWith(`<Modal>Body<snippet name="actions" params="close, extra">{extra}</snippet></Modal>`), codes: ["TS2345"], at: "close, extra" },
    { name: "ParentOmitted", source: parentWith(`<Modal>Body<snippet name="footer">F</snippet></Modal>`), codes: ["TS2353"], at: `footer"` },
    { name: "ParentMissingDefault", source: parentWith(`<Modal><snippet name="header">H</snippet></Modal>`), codes: ["TS2741"], at: "<Modal" },
    { name: "ParentRequired", source: parentWith(`<Modal><snippet name="default" if:when="flag.value">x</snippet></Modal>`), codes: ["MEEK110"], at: "if:when" },
    { name: "GenericParent", source: parentWith(`<GenericWrap bind:rows="rows"><snippet name="row" params="row">{row.label}</snippet></GenericWrap>`), codes: [] },
    { name: "GenericParentType", source: parentWith(`<GenericWrap bind:rows="rows"><snippet name="row" params="row">{row.nope}</snippet></GenericWrap>`), codes: ["TS2339"], at: "nope}" },
    { name: "NotSnippet", source: `<script lang="ts">\nconst snippets = defineSnippets<{ a: { length: number } }>();\n</script><template><p>{typeof snippets}</p></template>`, codes: ["TS2344"], at: "{ a: { length: number } }" },
  ];
  try {
    for (const item of cases) {
      const diagnostics = await checkSource(item.source, join(root, `${item.name}.meeko`));
      const messages = JSON.stringify(diagnostics);
      const codes = diagnostics.map((diagnostic) => diagnostic.code);
      if (item.codes.length === 0) assert.deepEqual(codes, [], `${item.name}: ${messages}`);
      for (const code of item.codes) assert.ok(codes.includes(code), `${item.name}: ${messages}`);
      if (item.at) {
        assert.ok(diagnostics.every((diagnostic) => !diagnostic.message.startsWith("TypeScript generado")), `${item.name}: ${messages}`);
        assert.ok(diagnostics.some((diagnostic) => diagnostic.location.offset === item.source.indexOf(item.at!)), `${item.name}: ${messages}`);
      }
    }
  } finally {
    await cleanup();
  }
});
