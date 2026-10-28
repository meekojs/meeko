import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/sfc.ts";

interface RuntimeModule {
  renderToString(props: Record<string, unknown>): string;
  renderWithState(props: Record<string, unknown>): { html: string; state: Record<string, unknown> };
  hydrate(root: Element, props: Record<string, unknown>, state?: Record<string, unknown>): () => void;
}

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);

/** Compiles components inside the repository; the runtime is imported by file URL, as one instance. */
async function load(components: Record<string, string>, entry: string): Promise<{ component: RuntimeModule; cleanup: () => Promise<void> }> {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "dynamic-tag-test-"));
  for (const [name, source] of Object.entries(components)) {
    let code = compile(source, join(directory, `${name}.meeko`)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
      .replaceAll(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`);
    for (const other of Object.keys(components)) code = code.replace(`from "./${other}.meeko"`, `from "./${other}.ts"`);
    await writeFile(join(directory, `${name}.ts`), code);
  }
  const component = await import(pathToFileURL(join(directory, `${entry}.ts`)).href) as RuntimeModule;
  return { component, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

async function typeProject(files: Record<string, string>): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const parentDirectory = resolve(".meeko");
  await mkdir(parentDirectory, { recursive: true });
  const root = await mkdtemp(join(parentDirectory, "dynamic-tag-check-"));
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
  assert.throws(() => compile(source, "Dynamic.meeko"), (error: unknown) => {
    assert.ok(error instanceof MeekoCompileError, String(error));
    assert.equal(error.diagnostic.code, code, error.message);
    assert.equal(error.diagnostic.location.offset, offset, error.message);
    return true;
  });
}

/** The user's button: one template for `<a>` and `<button>`. */
const button = `<script lang="ts">
import { computed } from "@meekojs/meeko";
const props = defineProps<{ href?: string; target?: string; type?: "button" | "submit" | "reset"; disabled?: boolean; loading?: boolean }>();
const emit = defineEmits<{ click: [event: MouseEvent] }>();
const snippets = defineSnippets<{ default?: []; leading?: []; trailing?: [] }>();
const inactive = computed(() => Boolean(props.disabled || props.loading));
const rel = computed(() => props.target === "_blank" ? "noopener noreferrer" : undefined);
const state = computed(() => ({ "data-loading": props.loading ? "" : undefined, "aria-disabled": inactive.value ? "true" : undefined }));
function onClick(event: MouseEvent): void {
  if (inactive.value) {
    event.preventDefault();
    return;
  }
  emit("click", event);
}
</script>
<template><component is="props.href ? 'a' : 'button'" class="button" bind="state.value" on:click="onClick"
  bind:href="inactive.value ? undefined : props.href" bind:target="props.target" bind:rel="rel.value"
  bind:type="props.type" bind:disabled="props.disabled">
  <span if:when="props.loading" class="button__spinner" aria-hidden="true"></span>
  <span class="button__label"><render snippet="snippets.leading" /><render snippet="snippets.default" /><render snippet="snippets.trailing" /></span>
</component></template>`;

const buttonPage = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Button from "./Button.meeko";
const href = signal("");
const loading = signal(false);
const clicks = signal(0);
const label = signal("Guardar");
</script>
<template><main><Button bind:href="href.value || undefined" type="button" target="_blank" bind:loading="loading.value" on:click="() => clicks.value++"><snippet name="leading"><b>*</b></snippet>{label.value}</Button><p class="clicks">{clicks.value}</p><i class="link" on:click="() => href.value = href.value ? '' : '/docs'"></i><i class="load" on:click="() => loading.value = !loading.value"></i><i class="relabel" on:click="() => label.value = 'Hecho'"></i></main></template>`;

test("the button compiles one template for <a> and <button>", () => {
  const { code } = compile(button, "Button.meeko");
  // Only the tags that accept an attribute write it.
  assert.match(code, /__meeko\.tagAttribute\(__meeko_tag_0, "href", \["a"\]\)/);
  assert.match(code, /__meeko\.tagAttribute\(__meeko_tag_0, "type", \["button"\]\)/);
  assert.match(code, /__meeko\.tagAttribute\(__meeko_tag_0, "disabled", \["button"\]\)/);
  // Global attributes and events are written on every tag.
  assert.doesNotMatch(code, /tagAttribute\([^)]*"class"/);
  assert.match(code, /__meeko\.bindElementTag\(__scope, 0, /);
  assert.match(code, /__meeko\.renderElementTag\(props\.href \? 'a' : 'button', /);
});

test("the button renders <button> without href and <a> with it, each with its own attributes", async () => {
  const { component, cleanup } = await load({ Button: button }, "Button");
  try {
    const label = `
  <!--meeko:if:0--><!--/meeko:if:0-->
  <span class="button__label"><!--meeko:snippet:1--><!--/meeko:snippet:1--><!--meeko:snippet:2--><!--/meeko:snippet:2--><!--meeko:snippet:3--><!--/meeko:snippet:3--></span>
`;
    // Without href: <button> with type and disabled; target and rel do not apply to it.
    assert.equal(component.renderToString({ type: "submit", disabled: true, target: "_blank" }),
      `<button class="button" aria-disabled="true" type="submit" disabled="" data-meeko="0">${label}</button>`);
    assert.equal(component.renderToString({ type: "button" }), `<button class="button" type="button" data-meeko="0">${label}</button>`);
    // With href: <a> with href, target and rel; type and disabled do not apply to it.
    assert.equal(component.renderToString({ href: "/docs", type: "submit", target: "_blank" }),
      `<a class="button" href="/docs" target="_blank" rel="noopener noreferrer" data-meeko="0">${label}</a>`);
    // A disabled link keeps aria-disabled, a global attribute, and drops its href.
    assert.equal(component.renderToString({ href: "/docs", disabled: true }), `<a class="button" aria-disabled="true" data-meeko="0">${label}</a>`);
  } finally {
    await cleanup();
  }
});

test("the button hydrates and becomes an <a> when it receives href, keeping its content, its state and the focus", async () => {
  const { component, cleanup } = await load({ Button: button, Page: buttonPage }, "Page");
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    window.document.body.appendChild(root);
    const rendered = component.renderWithState({});
    root.innerHTML = rendered.html;
    const element = (): HTMLElement => root.querySelector(".button") as unknown as HTMLElement;
    const click = (selector: string): void => (root.querySelector(selector) as unknown as HTMLElement).click();
    const initial = element();
    assert.equal(initial.localName, "button");
    assert.equal(initial.getAttribute("type"), "button");
    assert.equal(initial.hasAttribute("target"), false);
    const release = component.hydrate(root as unknown as Element, {}, rendered.state);
    // Hydration keeps the server's element.
    assert.equal(element(), initial);
    initial.click();
    assert.equal(root.querySelector(".clicks")?.textContent, "1");
    const labelNode = root.querySelector(".button__label");
    initial.focus();
    assert.equal(window.document.activeElement, initial);
    // href arrives: the <button> becomes an <a> with the same content nodes and the focus.
    click("i.link");
    const link = element();
    assert.equal(link.localName, "a");
    assert.notEqual(link, initial);
    assert.equal(link.getAttribute("href"), "/docs");
    assert.equal(link.getAttribute("target"), "_blank");
    assert.equal(link.getAttribute("rel"), "noopener noreferrer");
    assert.equal(link.hasAttribute("type"), false);
    assert.equal(link.getAttribute("data-meeko"), "0");
    assert.equal(root.querySelector(".button__label"), labelNode);
    assert.equal(window.document.activeElement, link);
    assert.equal(link.textContent?.trim(), "*Guardar");
    // The content stays reactive, and so do the element's own bindings and events on the new tag.
    click("i.relabel");
    assert.equal(link.textContent?.trim(), "*Hecho");
    click("i.load");
    assert.equal(link.getAttribute("aria-disabled"), "true");
    assert.equal(link.hasAttribute("href"), false);
    assert.ok(link.querySelector(".button__spinner"));
    click("i.load");
    assert.equal(link.hasAttribute("aria-disabled"), false);
    assert.equal(link.getAttribute("href"), "/docs");
    link.click();
    assert.equal(root.querySelector(".clicks")?.textContent, "2");
    // Back to <button>: the old <a> no longer listens.
    click("i.link");
    const back = element();
    assert.equal(back.localName, "button");
    assert.equal(back.getAttribute("type"), "button");
    assert.equal(back.hasAttribute("href"), false);
    assert.equal(window.document.activeElement, back);
    link.click();
    assert.equal(root.querySelector(".clicks")?.textContent, "2");
    back.click();
    assert.equal(root.querySelector(".clicks")?.textContent, "3");
    release();
    back.click();
    assert.equal(root.querySelector(".clicks")?.textContent, "3");
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

/** `meeko check` of each component of a project, by name. */
async function checkAll(files: Record<string, string>, names: readonly string[]): Promise<Record<string, string[]>> {
  const { root, cleanup } = await typeProject(files);
  try {
    const result: Record<string, string[]> = {};
    for (const name of names) {
      const diagnostics = await checkSource(files[`${name}.meeko`]!, join(root, `${name}.meeko`));
      result[name] = diagnostics.map((item) => `${item.code}@${item.location.offset} ${item.message}`);
    }
    return result;
  } finally {
    await cleanup();
  }
}

test("the button type-checks, with currentTarget typed as the union of its elements", async () => {
  const handlers = `<script lang="ts">
const props = defineProps<{ href?: string }>();
function onClick(event: MouseEvent & { currentTarget: HTMLAnchorElement | HTMLButtonElement }): void { void event; }
const target = useElementRef("target");
function focus(): void { target.value?.focus(); }
</script>
<template><component is="props.href ? 'a' : 'button'" on:click="onClick" on:focus="(event) => event.currentTarget.focus()" ref:target>x</component><i on:click="focus"></i></template>`;
  const result = await checkAll({ "Button.meeko": button, "Page.meeko": buttonPage, "Handlers.meeko": handlers }, ["Button", "Page", "Handlers"]);
  assert.deepEqual(result, { Button: [], Page: [], Handlers: [] });
});

test("meeko check reports attributes that no possible tag accepts and values of is that are not tags", async () => {
  const script = `<script lang="ts">
const props = defineProps<{ href?: string; tag: string; frame: "div" | "iframe"; media: "img" | "span" }>();
</script>`;
  const cases: Record<string, { template: string; expected: (source: string) => string[] }> = {
    Unknown: {
      template: `<component is="props.href ? 'a' : 'button'" bind:colspan="2" rowspan="1" bind:disabled="true">x</component>`,
      expected: (source) => [
        `MEEK112@${source.indexOf("bind:colspan")} colspan no se aplica a ninguna etiqueta posible de is: Meeko no lo escribiría nunca; quítalo o añade a is una etiqueta que lo admita`,
        `MEEK112@${source.indexOf("rowspan")} rowspan no se aplica a ninguna etiqueta posible de is: Meeko no lo escribiría nunca; quítalo o añade a is una etiqueta que lo admita`,
      ],
    },
    Wide: {
      template: `<component is="props.tag">x</component>`,
      expected: (source) => [`MEEK112@${source.indexOf("props.tag")} is es un string cualquiera; usa una unión de etiquetas, como 'a' | 'button'`],
    },
    Forbidden: {
      template: `<component is="props.frame">x</component>`,
      expected: (source) => [`MEEK112@${source.indexOf("props.frame")} <iframe> no es una etiqueta que <component is> pueda renderizar`],
    },
    Void: {
      template: `<component is="props.media">x</component>`,
      expected: (source) => [`MEEK031@${source.indexOf("props.media")} <img> no admite contenido`],
    },
    Target: {
      template: `<component is="props.href ? 'a' : 'button'" on:click="(event) => event.currentTarget.href">x</component>`,
      expected: (source) => [`TS2339@${source.indexOf("href\">x")} Property 'href' does not exist on type '(EventTarget & HTMLAnchorElement) | (EventTarget & HTMLButtonElement)'.\n  Property 'href' does not exist on type 'EventTarget & HTMLButtonElement'.`],
    },
  };
  const files = Object.fromEntries(Object.entries(cases).map(([name, item]) => [`${name}.meeko`, `${script}\n<template>${item.template}</template>`]));
  const result = await checkAll(files, Object.keys(cases));
  for (const [name, item] of Object.entries(cases)) assert.deepEqual(result[name], item.expected(files[`${name}.meeko`]!), name);
});

test("tags that <component is> cannot render are compile errors when they are literals and type errors otherwise", () => {
  const source = (template: string): string => `<script lang="ts">const props = defineProps<{ on: boolean }>();</script>\n<template>${template}</template>`;
  const script = source(`<component is="props.on ? 'div' : 'script'">x</component>`);
  assertCompileError(script, "MEEK112", script.indexOf("'script'"));
  const unknown = source(`<component is="'blink'"></component>`);
  assertCompileError(unknown, "MEEK112", unknown.indexOf("'blink'"));
  const empty = source(`<component is="props.on ? 'hr' : 'p'">x</component>`);
  assertCompileError(empty, "MEEK031", empty.indexOf("'hr'"));
  const model = source(`<component is="'div'" model="x"></component>`);
  assertCompileError(model, "MEEK112", model.indexOf("model="));
  const svg = source(`<svg><component is="'circle'"></component></svg>`);
  assertCompileError(svg, "MEEK112", svg.indexOf("'circle'"));
  // A void tag without content is fine.
  assert.doesNotThrow(() => compile(source(`<component is="props.on ? 'hr' : 'br'" />`), "Dynamic.meeko"));
});

test("SSR and the browser reject a tag that <component is> cannot render, before writing any HTML", async () => {
  const dynamic = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ as: string }>();
const tag = signal(props.as);
</script>
<template><div><component is="tag.value as 'p'" class="box">x</component><i on:click="() => tag.value = '<svg onload=alert(1)>'"></i><b on:click="() => tag.value = 'script'"></b><u on:click="() => tag.value = 'section'"></u></div></template>`;
  const { component, cleanup } = await load({ Dynamic: dynamic }, "Dynamic");
  const window = new Window();
  try {
    for (const as of ["script", "style", "iframe", "textarea", "template", "x-y", "P", "<b>", ""]) {
      assert.throws(() => component.renderToString({ as }), (error: unknown) => error instanceof TypeError && /^MEEK112: /.test(error.message), as);
    }
    // `tag.value` may be any string: the element sits in a component region, with its content as a snippet.
    assert.equal(component.renderToString({ as: "p" }), `<div><!--meeko:component:1--><p class="box" data-meeko="0"><!--meeko:snippet:0-->x<!--/meeko:snippet:0--></p><!--/meeko:component:1--><i data-meeko="1"></i><b data-meeko="2"></b><u data-meeko="3"></u></div>`);
    const root = window.document.createElement("main");
    const rendered = component.renderWithState({ as: "p" });
    root.innerHTML = rendered.html;
    const release = component.hydrate(root as unknown as Element, { as: "p" }, rendered.state);
    // A click handler reports its failure to the error handler, here the console.
    const errors: unknown[] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.at(-1)); };
    try {
      (root.querySelector("i") as unknown as HTMLElement).click();
      (root.querySelector("b") as unknown as HTMLElement).click();
    } finally { console.error = consoleError; }
    assert.equal(errors.length, 2);
    for (const error of errors) assert.ok(error instanceof TypeError && /^MEEK112: /.test(error.message), String(error));
    assert.equal(root.querySelector("svg"), null);
    assert.equal(root.querySelector("script"), null);
    assert.equal(root.querySelector(".box")?.localName, "p");
    (root.querySelector("u") as unknown as HTMLElement).click();
    assert.equal(root.querySelector(".box")?.localName, "section");
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

const spreading = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const attrs = signal<Record<string, string | boolean | undefined>>({ id: "first", title: "From object", "data-kind": "a", hidden: false, class: "extra", style: "color: red" });
const title = signal("Explicit");
</script>
<template><div><p class="base" bind="attrs.value" bind:title="title.value" style="margin: 0">x</p><i class="swap" on:click="() => attrs.value = { 'data-kind': 'b', hidden: true, 'aria-label': 'Second' }"></i><b on:click="() => attrs.value = { onclick: 'alert(1)' }"></b></div></template>`;

test("bind=\"obj\" writes an object's attributes, below the explicit ones, and follows the object", async () => {
  const { component, cleanup } = await load({ Spreading: spreading }, "Spreading");
  const window = new Window();
  try {
    const rendered = component.renderWithState({});
    // class and style combine; the explicit title wins; undefined and false keys are left out.
    assert.equal(rendered.html.slice(0, rendered.html.indexOf(">x")), `<div><p class="base extra" style="color: red; margin: 0" id="first" data-kind="a" title="Explicit" data-meeko="0"`);
    const root = window.document.createElement("main");
    root.innerHTML = rendered.html;
    const release = component.hydrate(root as unknown as Element, {}, rendered.state);
    const paragraph = root.querySelector("p")!;
    (root.querySelector("i.swap") as unknown as HTMLElement).click();
    assert.equal(paragraph.getAttribute("class"), "base");
    assert.equal(paragraph.getAttribute("style"), "margin: 0");
    assert.equal(paragraph.hasAttribute("id"), false);
    assert.equal(paragraph.getAttribute("data-kind"), "b");
    assert.equal(paragraph.getAttribute("hidden"), "");
    assert.equal(paragraph.getAttribute("aria-label"), "Second");
    assert.equal(paragraph.getAttribute("title"), "Explicit");
    // A handler never comes from data: the key is rejected and nothing is written.
    const errors: unknown[] = [];
    const consoleError = console.error;
    console.error = (...args: unknown[]) => { errors.push(args.at(-1)); };
    try { (root.querySelector("b") as unknown as HTMLElement).click(); }
    finally { console.error = consoleError; }
    assert.ok(errors.some((error) => error instanceof TypeError && /^MEEK113: /.test(error.message)), String(errors));
    assert.equal(paragraph.hasAttribute("onclick"), false);
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("bind=\"obj\" rejects handler keys in SSR and in the type check", async () => {
  const handler = `<script lang="ts">const attrs = { onClick: "alert(1)", title: "x" };</script><template><p bind="attrs">x</p></template>`;
  const { component, cleanup } = await load({ Handler: handler }, "Handler");
  try {
    assert.throws(() => component.renderToString({}), (error: unknown) => error instanceof TypeError && /^MEEK113: /.test(error.message));
  } finally {
    await cleanup();
  }
  const source = (script: string, template: string): string => `<script lang="ts">\n${script}\n</script>\n<template>${template}</template>`;
  const files = {
    "Handler.meeko": source(`const attrs = { onclick: "alert(1)" };`, `<p bind="attrs">x</p>`),
    "Unknown.meeko": source("", `<p bind="{ href: '/x', title: 'x' }">x</p>`),
    "Value.meeko": source("", `<p bind="{ title: { text: 'x' } }">x</p>`),
    "Valid.meeko": source(`import type { ElementAttributes } from "@meekojs/meeko";\nconst attrs: ElementAttributes<"a"> = { href: "/x", "data-id": 1, hidden: false };\nconst props = defineProps<{ to?: string }>();`, `<a bind="attrs">x</a><a bind="props.to ? { href: props.to } : undefined">y</a><x-card bind="{ anything: 'goes' }"></x-card>`),
    "Union.meeko": source(`const props = defineProps<{ href?: string }>();`, `<component is="props.href ? 'a' : 'button'" bind="{ href: props.href, type: 'button', colspan: 2 }">x</component>`),
  };
  const result = await checkAll(files, ["Handler", "Unknown", "Value", "Valid", "Union"]);
  assert.deepEqual(result["Handler"]!.map((item) => item.replace(/@\d+/, "")), ["MEEK113 bind no admite claves on*; usa on:evento"]);
  assert.deepEqual(result["Unknown"], [`MEEK113@${files["Unknown.meeko"].indexOf("href:")} href no es un atributo de la etiqueta`]);
  assert.equal(result["Value"]!.length, 1, String(result["Value"]));
  assert.match(result["Value"]![0]!, /^TS2322@/);
  assert.deepEqual(result["Valid"], []);
  assert.deepEqual(result["Union"], [`MEEK113@${files["Union.meeko"].indexOf("colspan")} colspan no es un atributo de la etiqueta`]);
});

const card = `<script lang="ts">
const props = defineProps<{ title: string; tone?: "info" | "warn"; count?: number }>();
const snippets = defineSnippets<{ default?: [] }>();
</script>
<template><article class="card" bind:data-tone="props.tone">{props.title}:{props.count ?? 0}<render snippet="snippets.default" /></article></template>`;

test("bind=\"obj\" on a component passes props, below the explicit ones, and follows the object", async () => {
  const parent = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Card from "./Card.meeko";
const card = signal<{ title: string; tone?: "info" | "warn"; count?: number }>({ title: "Hola", tone: "info", count: 1 });
</script>
<template><main><Card bind="card.value" bind:count="5" /><component is="Card" bind="card.value">dentro</component><i on:click="() => card.value = { title: 'Adiós', count: 2 }"></i></main></template>`;
  const { component, cleanup } = await load({ Card: card, Parent: parent }, "Parent");
  const window = new Window();
  try {
    const rendered = component.renderWithState({});
    const root = window.document.createElement("main");
    root.innerHTML = rendered.html;
    const cards = (): string[] => [...root.querySelectorAll("article")].map((item) => `${item.getAttribute("data-tone")}|${item.textContent}`);
    assert.deepEqual(cards(), ["info|Hola:5", "info|Hola:1dentro"]);
    const release = component.hydrate(root as unknown as Element, {}, rendered.state);
    const first = root.querySelector("article");
    (root.querySelector("i") as unknown as HTMLElement).click();
    assert.deepEqual(cards(), ["null|Adiós:5", "null|Adiós:2dentro"]);
    // New props reach the mounted child in place.
    assert.equal(root.querySelector("article"), first);
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
  const files = {
    "Card.meeko": card,
    "Unknown.meeko": `<script lang="ts">import * as Card from "./Card.meeko";</script><template><Card bind="{ title: 'x', size: 2 }" /></template>`,
    "Handler.meeko": `<script lang="ts">import * as Card from "./Card.meeko";\nconst extra = { title: "x", onSave: () => {} };</script><template><Card bind="extra" /></template>`,
    "Missing.meeko": `<script lang="ts">import * as Card from "./Card.meeko";\nconst extra = { title: "x" };\nconst partial: { count: number } = { count: 1 };</script><template><Card bind="extra" /><Card bind="partial" /></template>`,
  };
  const result = await checkAll(files, ["Unknown", "Handler", "Missing"]);
  assert.deepEqual(result["Unknown"], [`MEEK113@${files["Unknown.meeko"].indexOf("size")} size no es una prop del componente`]);
  assert.deepEqual(result["Handler"]!.map((item) => item.replace(/@\d+/, "")), ["MEEK113 bind no admite claves on*; usa on:evento"]);
  // The spread gives the required title; without it, the tag reports the missing prop.
  assert.equal(result["Missing"]!.length, 1, String(result["Missing"]));
  assert.match(result["Missing"]![0]!, /title/);
});

test("bind=\"obj\" needs an object and stays an attribute on a custom element", () => {
  const source = (template: string): string => `<script lang="ts">const x = {};</script>\n<template>${template}</template>`;
  const bare = source(`<p bind>x</p>`);
  assertCompileError(bare, "MEEK113", bare.indexOf("bind>"));
  const empty = source(`<p bind="">x</p>`);
  assertCompileError(empty, "MEEK113", empty.indexOf("bind="));
  const template = source(`<template bind="x"><p>x</p></template>`);
  assertCompileError(template, "MEEK113", template.indexOf("bind="));
  // On a custom element `bind` stays a plain attribute, as `html` and `model` do.
  assert.match(compile(source(`<x-card bind="x"></x-card>`), "Custom.meeko").code, /" bind=\\"x\\""/);
});

const panel = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ title: string }>();
const snippets = defineSnippets<{ default: [] }>();
const opened = signal(0);
</script>
<template><aside class="panel" on:click="() => opened.value++"><h2>{props.title}</h2><render snippet="snippets.default" /><em>{opened.value}</em></aside></template>`;

test("<component is> with a tag or a component renders each, and swaps one for the other", async () => {
  const host = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import type { Component } from "@meekojs/meeko";
import * as Panel from "./Panel.meeko";
const kind = signal<"section" | "panel" | "article">("section");
const text = signal("Uno");
const view = (): "section" | "article" | Component<{ title: string }> => kind.value === "panel" ? Panel : kind.value;
</script>
<template><main><component is="view()" class="box" bind:title="text.value" on:click="() => text.value += '!'"><b class="text">{text.value}</b></component><i class="section" on:click="() => kind.value = 'section'"></i><i class="article" on:click="() => kind.value = 'article'"></i><i class="panel" on:click="() => kind.value = 'panel'"></i></main></template>`;
  const { component, cleanup } = await load({ Panel: panel, Host: host }, "Host");
  const window = new Window();
  try {
    const rendered = component.renderWithState({});
    assert.match(rendered.html, /^<main><!--meeko:component:1--><section class="box" title="Uno" data-meeko="0"><!--meeko:snippet:0--><b class="text"><!--meeko:text:0-->Uno<!--\/meeko:text:0--><\/b><!--\/meeko:snippet:0--><\/section><!--\/meeko:component:1-->/);
    const root = window.document.createElement("main");
    window.document.body.appendChild(root);
    root.innerHTML = rendered.html;
    const release = component.hydrate(root as unknown as Element, {}, rendered.state);
    const click = (selector: string): void => (root.querySelector(selector) as unknown as HTMLElement).click();
    const bold = root.querySelector("b.text");
    click(".box");
    assert.equal(root.querySelector(".box")?.getAttribute("title"), "Uno!");
    assert.equal(bold?.textContent, "Uno!");
    // Tag to tag: the content moves with its nodes.
    click("i.article");
    assert.equal(root.querySelector(".box")?.localName, "article");
    assert.equal(root.querySelector("b.text"), bold);
    // Tag to component: the props and the default snippet go to the component.
    click("i.panel");
    assert.equal(root.querySelector(".box"), null);
    assert.equal(root.querySelector("aside h2")?.textContent, "Uno!");
    assert.equal(root.querySelector("aside b.text")?.textContent, "Uno!");
    click("aside");
    assert.equal(root.querySelector("aside em")?.textContent, "1");
    // Component to tag: the element comes back with its content, live.
    click("i.section");
    assert.equal(root.querySelector("aside"), null);
    assert.equal(root.querySelector(".box")?.localName, "section");
    click(".box");
    assert.equal(root.querySelector("b.text")?.textContent, "Uno!!");
    release();
    // SSR of the component.
    const panelHost = host.replace(`signal<"section" | "panel" | "article">("section")`, `signal<"section" | "panel" | "article">("panel")`);
    const second = await load({ Panel: panel, Host: panelHost }, "Host");
    try {
      const html = second.component.renderToString({});
      assert.match(html, /<!--meeko:component:1--><aside class="panel" data-meeko="0"><h2>/);
      assert.match(html, /<b class="text">/);
    } finally {
      await second.cleanup();
    }
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("<component is> that may be a tag or a component checks what only one of them accepts", async () => {
  const files = {
    "Panel.meeko": panel,
    "FooterPanel.meeko": `<script lang="ts">
const props = defineProps<{ title: string; colspan?: number }>();
const snippets = defineSnippets<{ default: []; footer?: [] }>();
</script>
<template><aside>{props.title}{props.colspan}<render snippet="snippets.default" /><render snippet="snippets.footer" /></aside></template>`,
    "Mixed.meeko": `<script lang="ts">
import * as FooterPanel from "./FooterPanel.meeko";
const props = defineProps<{ link: boolean }>();
const view = (): "section" | typeof FooterPanel => props.link ? "section" : FooterPanel;
</script>
<template><component is="view()" bind:title="'x'" bind:colspan="2" aria-label="x"><snippet name="footer">f</snippet>x</component></template>`,
    "Tags.meeko": `<script lang="ts">
const props = defineProps<{ as: "section" | "article" }>();
</script>
<template><component is="props.as" aria-label="x" bind:data-id="1">x</component></template>`,
    "Components.meeko": `<script lang="ts">
import * as Panel from "./Panel.meeko";
const props = defineProps<{ title: string }>();
const view = Panel;
</script>
<template><component is="view" bind:title="props.title">x</component></template>`,
  };
  const result = await checkAll(files, ["Mixed", "Tags", "Components"]);
  const mixed = files["Mixed.meeko"];
  assert.deepEqual(result["Mixed"]!.map((item) => item.replace(/^(\S+)@(\d+)/, (_, code: string, at: string) => `${code}@${mixed.slice(Number(at), Number(at) + 10)}`)).sort(), [
    "MEEK112@aria-label aria-label sólo vale si is es una etiqueta HTML",
    "MEEK112@footer\">f< <snippet> sólo vale si is es un componente",
    "MEEK112@bind:colsp colspan no se aplica a ninguna etiqueta posible de is: Meeko no lo escribiría nunca; quítalo o añade a is una etiqueta que lo admita",
  ].sort());
  assert.deepEqual(result["Tags"], []);
  assert.deepEqual(result["Components"], []);
});

test("<component is> with a component accepts children as its snippets", async () => {
  const parent = `<script lang="ts">
import * as Panel from "./Panel.meeko";
</script>
<template><component is="Panel" bind:title="'Hola'"><p class="inside">dentro</p></component></template>`;
  const { component, cleanup } = await load({ Panel: panel, Parent: parent }, "Parent");
  try {
    assert.match(component.renderToString({}), /^<!--meeko:component:0--><aside class="panel" data-meeko="0"><h2><!--meeko:text:0-->Hola<!--\/meeko:text:0--><\/h2><!--meeko:snippet:0--><p class="inside">dentro<\/p><!--\/meeko:snippet:0-->/);
  } finally {
    await cleanup();
  }
});

test("bind=\"obj\" compares attribute names without case: data-meeko* stays reserved and the explicit binding wins", async () => {
  const { spreadEntries } = await import(pathToFileURL(resolve("src/dynamic-tag.ts")).href) as typeof import("../src/dynamic-tag.ts");
  const spread = (value: Record<string, unknown>, excluded: readonly string[], explicit?: { class?: unknown; style?: unknown }) => spreadEntries("div", value as never, excluded, explicit);
  assert.throws(() => spread({ "Data-Meeko": "0" }, []), (error: unknown) => error instanceof TypeError && /^MEEK113: .*data-meeko\* está reservado/.test(error.message));
  assert.throws(() => spread({ "DATA-MEEKO-ID": "0" }, []), /MEEK113/);
  // `bind:id` next to an `ID` key: one attribute, the explicit one.
  assert.deepEqual(spread({ ID: "from-object", Title: "t" }, ["id"]), [["Title", "t"]]);
  // `Class` and `Style` join the explicit ones instead of writing a second attribute.
  assert.deepEqual(spread({ Class: "b", STYLE: "color: red" }, [], { class: "a", style: "margin: 0" }), [["class", "a b"], ["style", "color: red; margin: 0"]]);
});
