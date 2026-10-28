import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { compile } from "../src/compiler.ts";
import type { DevtoolsHook } from "../src/devtools.ts";

/** The runtime as the compiled components import it, by file URL: one instance of every module. */
const runtimeUrl = (path: string): string => pathToFileURL(resolve(path)).href;
const { enableHotModule, replaceHotModule } = await import(runtimeUrl("src/hmr.js")) as typeof import("../src/hmr.ts");
const { isReactiveProps, reactiveProps, resolveProps } = await import(runtimeUrl("src/props.js")) as typeof import("../src/props.ts");
const { effect, signal } = await import(runtimeUrl("src/reactivity.js")) as typeof import("../src/reactivity.ts");

interface Module {
  renderToString(props: object): string;
  hydrate(root: Element, props: object): () => void;
  readonly __hotId?: string;
  readonly __meekoReactiveProps?: boolean;
}

const textField = `<script lang="ts">
import { computed } from "@meekojs/meeko";
const props = defineProps<{ label: string; error?: string; hint?: string }>({ hint: "Escribe tu nombre" });
const value = defineModel<string>("value");
const { label: initialLabel } = props;
const upper = computed(() => props.label.toUpperCase());
</script>
<template><label class="field"><span class="label">{props.label}</span><span class="initial">{initialLabel}</span><span class="upper">{upper.value}</span><input class="input" model="value" bind:aria-invalid="props.error ? 'true' : 'false'" /></label><p class="error" if:when="props.error">{props.error}</p><small class="hint">{props.hint}</small></template>`;

const card = `<script lang="ts">
const props = defineProps<{ title: string }>();
const snippets = defineSnippets<{ default: [] }>();
</script>
<template><section class="card"><h2 class="title">{props.title}</h2><render snippet="snippets.default" /></section></template>`;

const leaf = `<script lang="ts">
const props = defineProps<{ text: string }>();
</script>
<template><em class="leaf">{props.text}</em></template>`;

const row = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Leaf from "./Leaf.meeko";
const props = defineProps<{ label: string }>();
const count = signal(0);
</script>
<template><button class="row" on:click="() => count.value++">{props.label}:{count.value}</button><Leaf bind:text="props.label" /></template>`;

const form = `<script lang="ts">
import type { Signal } from "@meekojs/meeko";
import * as TextField from "./TextField.meeko";
import * as Card from "./Card.meeko";
import * as Row from "./Row.meeko";
const props = defineProps<{ store: {
  name: Signal<string>;
  label: Signal<string>;
  error: Signal<string | undefined>;
  hint: Signal<string | undefined>;
  title: Signal<string>;
  rows: Signal<Array<{ id: string; label: string }>>;
} }>();
const store = props.store;
</script>
<template><form><TextField model:value="store.name" bind:label="store.label.value" bind:error="store.error.value" bind:hint="store.hint.value" /><Card bind:title="store.title.value"><input class="inner" /></Card><ul><li each:of="store.rows.value" each:as="item" each:key="item.id"><Row bind:label="item.label" /></li></ul></form></template>`;

const first = `<script lang="ts">
const props = defineProps<{ label: string }>();
</script>
<template><b class="first">{props.label}</b></template>`;

const second = `<script lang="ts">
const props = defineProps<{ label: string }>();
</script>
<template><i class="second">{props.label}</i></template>`;

const switcher = `<script lang="ts">
import type { Signal } from "@meekojs/meeko";
import * as First from "./First.meeko";
import * as Second from "./Second.meeko";
const props = defineProps<{ which: Signal<"first" | "second">; label: Signal<string> }>();
const which = props.which;
const label = props.label;
</script>
<template><div><component is="which.value === 'first' ? First : Second" bind:label="label.value" /></div></template>`;

const runtime = (path: string): string => JSON.stringify(runtimeUrl(path));

/** Compiles `source` as `<name>.meeko` of `directory` against the source runtime, into `<output>.ts`. */
async function writeModule(directory: string, name: string, output: string, source: string, hot: boolean): Promise<void> {
  const code = compile(source, join(directory, `${name}.meeko`), { hot }).code
    .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
    .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`)
    .replaceAll(/from "\.\/(\w+)\.meeko"/g, `from "./$1.ts"`);
  await writeFile(join(directory, `${output}.ts`), code);
}

async function loadModule(directory: string, name: string, output: string, source: string, hot: boolean): Promise<Module> {
  await writeModule(directory, name, output, source, hot);
  return await import(pathToFileURL(join(directory, `${output}.ts`)).href) as Module;
}

/**
 * Compiles components inside the package, as `late-mount.test.ts` does: outside it, the test
 * loader gives them other instances of the runtime modules than the signals of this file.
 */
async function load(sources: Record<string, string>, hot = false): Promise<{ modules: Record<string, Module>; directory: string; cleanup: () => Promise<void> }> {
  await mkdir(resolve(".meeko"), { recursive: true });
  const directory = await mkdtemp(resolve(".meeko", "reactive-props-test-"));
  for (const [name, source] of Object.entries(sources)) await writeModule(directory, name, name, source, hot);
  const modules: Record<string, Module> = {};
  for (const name of Object.keys(sources)) modules[name] = await import(pathToFileURL(join(directory, `${name}.ts`)).href) as Module;
  return { modules, directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function createStore() {
  return {
    name: signal(""),
    label: signal("Nombre"),
    error: signal<string | undefined>("Obligatorio"),
    hint: signal<string | undefined>(undefined),
    title: signal("Alta"),
    rows: signal([{ id: "a", label: "A" }, { id: "b", label: "B" }]),
  };
}

/** Node identity, without printing DOM trees on failure. */
function same(actual: unknown, expected: unknown, message: string): void {
  assert.ok(actual === expected, `${message} is not the same node`);
}

function sameList(actual: readonly unknown[], expected: readonly unknown[], message: string): void {
  assert.ok(actual.length === expected.length && actual.every((node, index) => node === expected[index]), `${message} are not the same nodes`);
}

function text(root: { querySelector(selector: string): { textContent: string | null } | null }, selector: string): string | null | undefined {
  return root.querySelector(selector)?.textContent;
}

test("a prop change updates a mounted child in place: focus, caret, snippets and nested children survive", async () => {
  const { modules, cleanup } = await load({ TextField: textField, Card: card, Leaf: leaf, Row: row, Form: form });
  const window = new Window();
  const document = window.document;
  try {
    const store = createStore();
    const root = document.createElement("main");
    document.body.appendChild(root);
    const html = modules.Form!.renderToString({ store });
    root.innerHTML = html;
    // The default applies in SSR to an undefined prop.
    assert.equal(text(root, ".hint"), "Escribe tu nombre");
    assert.equal(text(root, ".error"), "Obligatorio");
    const release = modules.Form!.hydrate(root as unknown as Element, { store });
    // Hydration does not touch the server's markup.
    assert.equal(root.innerHTML, html);

    const input = root.querySelector(".input") as unknown as HTMLInputElement;
    const labelNode = root.querySelector(".label")!;
    input.focus();
    input.value = "Ada";
    input.setSelectionRange(1, 1);
    input.dispatchEvent(new window.Event("input", { bubbles: true }) as unknown as Event);
    assert.equal(store.name.value, "Ada");
    same(document.activeElement, input, "the focused element");

    // A sibling prop changes while the user types: same input, focus and caret.
    store.error.value = undefined;
    same(root.querySelector(".input"), input, "the .input element");
    same(document.activeElement, input, "the focused element");
    assert.equal(input.selectionStart, 1);
    assert.equal(input.value, "Ada");
    assert.equal(input.getAttribute("aria-invalid"), "false");
    assert.ok(root.querySelector(".error") === null);
    store.error.value = "Demasiado corto";
    assert.equal(text(root, ".error"), "Demasiado corto");
    assert.equal(input.getAttribute("aria-invalid"), "true");
    same(document.activeElement, input, "the focused element");

    // Defaults: a passed value wins, undefined shows the default again.
    store.hint.value = "Como en tu DNI";
    assert.equal(text(root, ".hint"), "Como en tu DNI");
    store.hint.value = undefined;
    assert.equal(text(root, ".hint"), "Escribe tu nombre");

    // Template reads and computed follow the prop; a value destructured in setup does not.
    store.label.value = "Nombre completo";
    same(root.querySelector(".label"), labelNode, "the .label element");
    assert.equal(labelNode.textContent, "Nombre completo");
    assert.equal(text(root, ".upper"), "NOMBRE COMPLETO");
    assert.equal(text(root, ".initial"), "Nombre");
    same(document.activeElement, input, "the focused element");

    // The snippet content of the parent stays: same input, still focused.
    const inner = root.querySelector(".inner") as unknown as HTMLInputElement;
    const title = root.querySelector(".title")!;
    inner.focus();
    inner.value = "nota";
    store.title.value = "Edición";
    same(root.querySelector(".title"), title, "the .title element");
    assert.equal(title.textContent, "Edición");
    same(root.querySelector(".inner"), inner, "the .inner element");
    same(document.activeElement, inner, "the focused element");
    assert.equal(inner.value, "nota");

    // Keyed rows keep their child instances, their state and their nested children.
    const [rowA, rowB] = [...root.querySelectorAll(".row")] as unknown as HTMLButtonElement[];
    const [leafA, leafB] = [...root.querySelectorAll(".leaf")];
    rowB!.click();
    store.rows.value = [{ id: "b", label: "B2" }, { id: "a", label: "A" }];
    sameList([...root.querySelectorAll(".row")], [rowB, rowA], "rows");
    sameList([...root.querySelectorAll(".leaf")], [leafB, leafA], "leaves");
    assert.equal(rowB!.textContent, "B2:1");
    assert.equal(leafB!.textContent, "B2");
    assert.equal(rowA!.textContent, "A:0");

    release();
    store.error.value = "Tras liberar";
    assert.equal(text(root, ".error"), "Demasiado corto", "a released child no longer follows its props");
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("another component in <component is> still mounts again", async () => {
  const { modules, cleanup } = await load({ First: first, Second: second, Switcher: switcher });
  const window = new Window();
  try {
    const which = signal<"first" | "second">("first");
    const label = signal("uno");
    const root = window.document.createElement("main");
    root.innerHTML = modules.Switcher!.renderToString({ which, label });
    const release = modules.Switcher!.hydrate(root as unknown as Element, { which, label });
    const bold = root.querySelector(".first")!;
    label.value = "dos";
    same(root.querySelector(".first"), bold, "the .first element");
    assert.equal(bold.textContent, "dos");
    which.value = "second";
    assert.ok(root.querySelector(".first") === null);
    assert.equal(text(root, ".second"), "dos");
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("compiled modules mark reactive props, except those with a top-level data await", () => {
  assert.match(compile(leaf, "Leaf.meeko").code, /export const __meekoReactiveProps: boolean = true;/);
  const awaiting = `<script lang="ts">
const props = defineProps<{ q: string }>();
const notes = await useApi("/api/notes", { query: { q: props.q } });
</script><template>{String(notes.data.value)}</template>`;
  assert.match(compile(awaiting, "Notes.meeko").code, /export const __meekoReactiveProps: boolean = false;/);
});

test("the props view is read-only, tracks names and values, and applies defaults on every read", () => {
  const channels = Symbol("channels");
  const source = reactiveProps<Record<string | symbol, unknown>>({ label: "a", [channels]: "models" });
  const props = source.props;
  assert.equal(isReactiveProps(props), true);
  assert.equal(isReactiveProps({ label: "a" }), false);
  assert.throws(() => { (props as { label: string }).label = "b"; }, /read-only/);
  assert.throws(() => { delete (props as { label?: string }).label; }, /read-only/);
  assert.equal(props[channels], "models");
  assert.deepEqual({ ...props }, { label: "a", [channels]: "models" });

  const seen: string[] = [];
  const names: string[][] = [];
  const stopValue = effect(() => { seen.push(String(props.label)); });
  const stopNames = effect(() => { names.push(Object.keys(props)); });
  source.update({ label: "a", [channels]: "models" });
  assert.deepEqual(seen, ["a"], "an equal value notifies nobody");
  source.update({ label: "b", extra: 1 });
  assert.deepEqual(seen, ["a", "b"]);
  assert.deepEqual(names, [["label"], ["label", "extra"]]);
  assert.equal("extra" in props, true);
  stopValue();
  stopNames();

  const defaults = { hint: "default", count: 0 };
  const view = resolveProps(props, defaults) as Record<string, unknown>;
  assert.equal(isReactiveProps(view), true);
  assert.equal(view.hint, "default");
  source.update({ label: "b", hint: "custom" });
  assert.equal(view.hint, "custom");
  source.update({ label: "b", hint: undefined });
  assert.equal(view.hint, "default");
  assert.deepEqual(Object.keys(view), ["hint", "count", "label"]);
  assert.throws(() => { view.hint = "x"; }, /read-only/);

  // Plain props are copied as before: SSR and a root hydrate keep their behaviour.
  const plain = resolveProps({ label: "x", hint: undefined }, defaults);
  assert.equal(isReactiveProps(plain), false);
  assert.deepEqual(plain, { hint: "default", count: 0, label: "x" });
});

test("the snippets of a props view follow a snippet that appears or disappears, and keep their identity", async () => {
  const { withChannels } = await import(runtimeUrl("src/channels.js")) as typeof import("../src/channels.ts");
  const { snippet, useSnippets } = await import(runtimeUrl("src/snippets.js")) as typeof import("../src/snippets.ts");
  const tag = (footer: boolean): Record<string, unknown> => withChannels({ label: "a" }, undefined, { default: snippet(() => "d"), footer: footer ? snippet(() => "f") : undefined });
  const source = reactiveProps(tag(false));
  // Through the defaults view too, as a compiled child with defineProps defaults reads them.
  const snippets = useSnippets<{ default: []; footer?: [] }>(resolveProps(source.props, { hint: "x" }));
  const first = snippets.default;
  assert.ok(first);
  assert.equal(snippets.footer, undefined);
  assert.equal("footer" in snippets, false);
  assert.deepEqual(Object.keys(snippets), ["default"]);
  assert.throws(() => { (snippets as Record<string, unknown>).footer = first; }, /read-only/);

  const reads: boolean[] = [];
  const keys: string[][] = [];
  const stopRead = effect(() => { reads.push(snippets.footer !== undefined); });
  const stopKeys = effect(() => { keys.push(Object.keys(snippets)); });
  source.update(tag(false));
  assert.deepEqual(reads, [false], "a snippet still absent notifies nobody");
  source.update(tag(true));
  assert.deepEqual(reads, [false, true]);
  assert.deepEqual(keys, [["default"], ["default", "footer"]]);
  const footer = snippets.footer;
  source.update(tag(true));
  assert.equal(snippets.footer, footer, "a snippet still passed keeps the value the child has");
  assert.equal(snippets.default, first);
  assert.deepEqual(reads, [false, true]);
  source.update(tag(false));
  assert.deepEqual(reads, [false, true, false]);
  assert.equal("footer" in snippets, false);
  stopRead();
  stopKeys();

  // Plain props (SSR, a root hydrate) keep a frozen object.
  const plain = useSnippets<{ default: []; footer?: [] }>(tag(true));
  assert.ok(Object.isFrozen(plain));
  assert.deepEqual(Object.keys(plain), ["default", "footer"]);
  assert.deepEqual(Object.keys(useSnippets<{ default: []; footer?: [] }>(tag(false))), ["default"]);
});

test("DevTools shows new props and HMR keeps a child reactive to its parent", async () => {
  const parent = `<script lang="ts">
import type { Signal } from "@meekojs/meeko";
import * as Row from "./Row.meeko";
const props = defineProps<{ label: Signal<string> }>();
const label = props.label;
</script>
<template><div><Row bind:label="label.value" /></div></template>`;
  const { modules, directory, cleanup } = await load({ Leaf: leaf, Row: row, Parent: parent }, true);
  const window = new Window();
  const names = ["window", "Node"] as const;
  const previous = names.map((name) => ({ name, value: Reflect.get(globalThis, name), present: Reflect.has(globalThis, name) }));
  Reflect.set(globalThis, "window", window);
  Reflect.set(globalThis, "Node", window.Node);
  try {
    const leafId = modules.Leaf!.__hotId!;
    enableHotModule(leafId);
    const label = signal("uno");
    const root = window.document.createElement("main");
    window.document.body.appendChild(root);
    root.innerHTML = modules.Parent!.renderToString({ label });
    const release = modules.Parent!.hydrate(root as unknown as Element, { label });
    const hook = Reflect.get(window, "__MEEKO_DEVTOOLS__") as DevtoolsHook;
    const rowProps = (): unknown => hook.snapshot().instances.find((instance) => instance.name === "Row")?.props;
    assert.equal(JSON.stringify(rowProps()), JSON.stringify({ label: "uno" }));
    let notices = 0;
    const unsubscribe = hook.subscribe(() => { notices++; });
    const button = root.querySelector(".row") as unknown as HTMLButtonElement;
    button.click();
    const before = notices;
    label.value = "dos";
    assert.ok(notices > before, "a prop change notifies the panel");
    assert.equal(JSON.stringify(rowProps()), JSON.stringify({ label: "dos" }));
    same(root.querySelector(".row"), button, "the .row element");
    assert.equal(button.textContent, "dos:1");
    unsubscribe();

    // A hot replacement of the grandchild keeps reading the props its parent updates.
    const edited = await loadModule(directory, "Leaf", "LeafEdited", leaf.replace(`class="leaf"`, `class="leaf edited"`), true);
    assert.equal(edited.__hotId, leafId);
    replaceHotModule(leafId, edited);
    assert.equal(text(root, ".leaf.edited"), "dos");
    label.value = "tres";
    assert.equal(text(root, ".leaf.edited"), "tres");
    assert.equal(button.textContent, "tres:1");
    release();
  } finally {
    for (const item of previous) {
      if (item.present) Reflect.set(globalThis, item.name, item.value);
      else Reflect.deleteProperty(globalThis, item.name);
    }
    window.happyDOM.abort();
    await cleanup();
  }
});
