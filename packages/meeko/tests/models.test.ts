import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/sfc.ts";
import { generateTypes } from "../src/types.ts";

interface RuntimeModule {
  renderToString(props: Record<string, never>): string;
  renderWithState(props: Record<string, never>): { html: string; state: Record<string, unknown> };
  hydrate(root: Element, props: Record<string, never>, state?: Record<string, unknown>): () => void;
}

interface Reactivity {
  signal<T>(value: T): { value: T };
}

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);

/**
 * Compiles components inside the repository against the source runtime, imported by file URL so
 * the test and the components share one instance of it.
 */
async function load(components: Record<string, string>, entry: string): Promise<{ component: RuntimeModule; reactivity: Reactivity; cleanup: () => Promise<void> }> {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "models-test-"));
  for (const [name, source] of Object.entries(components)) {
    let code = compile(source, join(directory, `${name}.meeko`)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
      .replaceAll(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`);
    for (const other of Object.keys(components)) code = code.replace(`from "./${other}.meeko"`, `from "./${other}.ts"`);
    await writeFile(join(directory, `${name}.ts`), code);
  }
  const component = await import(pathToFileURL(join(directory, `${entry}.ts`)).href) as RuntimeModule;
  const reactivity = await import(pathToFileURL(resolve("src/index.ts")).href) as Reactivity;
  return { component, reactivity, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

/** Temporary project whose tsconfig points the package at src/, like a built consumer. */
async function typeProject(files: Record<string, string>): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const parentDirectory = resolve(".meeko");
  await mkdir(parentDirectory, { recursive: true });
  const root = await mkdtemp(join(parentDirectory, "models-check-"));
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
  assert.throws(() => compile(source, "Models.meeko"), (error: unknown) => {
    assert.ok(error instanceof MeekoCompileError, String(error));
    assert.equal(error.diagnostic.code, code, error.message);
    assert.equal(error.diagnostic.location.offset, offset, error.message);
    return true;
  });
}

function fire(window: Window, target: Element, type: string): void {
  target.dispatchEvent(new window.Event(type, { bubbles: true }) as unknown as Event);
}

const controls = `<script lang="ts">
import { computed, signal } from "@meekojs/meeko";
const name = signal("Ada");
const notes = signal("line\\nnext");
const agree = signal(true);
const size = signal("m");
const color = signal("green");
const tags = signal<string[]>(["b"]);
const colors = signal(["red", "green", "blue"]);
const summary = computed(() => [name.value, notes.value, agree.value, size.value, color.value, tags.value.join("+")].join("|"));
</script>
<template><form>
<input class="name" model="name" on:focus="() => {}" />
<textarea class="notes" model="notes"></textarea>
<input class="agree" type="checkbox" model="agree" />
<input class="s" type="radio" name="size" value="s" model="size" />
<input class="m" type="radio" name="size" value="m" model="size" />
<select class="color" model="color"><option each:of="colors.value" each:as="item" bind:value="item">{item}</option></select>
<select class="tags" multiple model="tags"><option value="a">A</option><option value="b">B</option><option value="c">C</option></select>
<output>{summary.value}</output>
<button type="button" class="reset" on:click="() => { name.value = 'Grace'; notes.value = ''; agree.value = false; size.value = 's'; color.value = 'blue'; tags.value = ['a', 'c']; }">reset</button>
</form></template>`;

test("model on native controls renders the signal during SSR", () => {
  const { code } = compile(controls, "Controls.meeko");
  assert.match(code, /data-meeko-m-0=\\"\\"" \+ __meeko\.renderAttribute\("value", __meeko\.modelValue\(name\)\)/);
  assert.match(code, /" class=\\"notes\\"" \+ ">" \+ __meeko\.modelText\(notes\) \+ "<\/textarea>"/);
  assert.match(code, /__meeko\.renderAttribute\("checked", __meeko\.modelSelected\(size, "s"\)\)/);
  assert.match(code, /__meeko\.renderAttribute\("selected", __meeko\.modelSelected\(color, \(item\)\)\)/);
  assert.match(code, /__meeko\.bindModel\(__scope, 6, "multiple", \(\) => \(tags\)\)/);
  assert.match(code, /__meeko\.bindModel\(__scope, 4, "radio", \(\) => \(size\), \(\) => "m"\)/);
  assert.match(code, /__meeko\.checkWritableSignal\(name\)/);
});

test("model on native controls hydrates and syncs both directions", async () => {
  const { component, cleanup } = await load({ Controls: controls }, "Controls");
  const window = new Window();
  try {
    const document = window.document;
    const root = document.createElement("main");
    root.innerHTML = component.renderToString({});
    const query = <T>(selector: string): T => root.querySelector(selector) as unknown as T;
    assert.equal(query<HTMLInputElement>("input.name").getAttribute("value"), "Ada");
    assert.equal(query<HTMLTextAreaElement>("textarea.notes").value, "line\nnext");
    assert.equal(query<HTMLInputElement>("input.agree").hasAttribute("checked"), true);
    assert.equal(query<HTMLInputElement>("input.m").hasAttribute("checked"), true);
    assert.equal(query<HTMLInputElement>("input.s").hasAttribute("checked"), false);
    assert.equal(query<HTMLOptionElement>("select.color option:nth-child(2)").hasAttribute("selected"), true);
    assert.deepEqual([...root.querySelectorAll("select.tags option[selected]")].map((option) => option.getAttribute("value")), ["b"]);
    const release = component.hydrate(root as unknown as Element, {});
    const output = (): string => query<HTMLElement>("output").textContent ?? "";
    assert.equal(output(), "Ada|line\nnext|true|m|green|b");

    // Control to signal.
    const nameInput = query<HTMLInputElement>("input.name");
    nameInput.value = "Linus";
    fire(window, nameInput as unknown as Element, "input");
    const notes = query<HTMLTextAreaElement>("textarea.notes");
    notes.value = "changed";
    fire(window, notes as unknown as Element, "input");
    const agree = query<HTMLInputElement>("input.agree");
    agree.checked = false;
    fire(window, agree as unknown as Element, "change");
    const small = query<HTMLInputElement>("input.s");
    small.checked = true;
    fire(window, small as unknown as Element, "change");
    const color = query<HTMLSelectElement>("select.color");
    color.value = "red";
    fire(window, color as unknown as Element, "change");
    const tags = query<HTMLSelectElement>("select.tags");
    for (const option of Array.from(tags.options)) option.selected = option.value !== "b";
    fire(window, tags as unknown as Element, "change");
    assert.equal(output(), "Linus|changed|false|s|red|a+c");

    // Signal to control: programmatic writes update the live properties.
    nameInput.value = "typed";
    query<HTMLButtonElement>("button.reset").click();
    assert.equal(nameInput.value, "Grace");
    assert.equal(notes.value, "");
    assert.equal(agree.checked, false);
    assert.equal(small.checked, true);
    assert.equal(query<HTMLInputElement>("input.m").checked, false);
    assert.equal(color.value, "blue");
    assert.deepEqual(Array.from(tags.options).filter((option) => option.selected).map((option) => option.value), ["a", "c"]);
    assert.equal(output(), "Grace||false|s|blue|a+c");

    // Released bindings stop listening.
    release();
    nameInput.value = "after";
    fire(window, nameInput as unknown as Element, "input");
    assert.equal(output(), "Grace||false|s|blue|a+c");
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("a control edited before hydration keeps the user's value", async () => {
  const { component, cleanup } = await load({ Controls: controls }, "Controls");
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    root.innerHTML = component.renderToString({});
    const input = root.querySelector("input.name") as unknown as HTMLInputElement;
    input.value = "early";
    const release = component.hydrate(root as unknown as Element, {});
    assert.equal(input.value, "early");
    assert.match(root.querySelector("output")?.textContent ?? "", /^early\|/);
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

const restoredCard = `<script lang="ts">
const snippets = defineSnippets<{ default: [] }>();
</script>
<template><article class="card"><div class="content"><render snippet="snippets.default" /></div></article></template>`;

const restored = `<script lang="ts">
import { onMounted, signal } from "@meekojs/meeko";
import * as Card from "./Card.meeko";
const query = signal("");
const items = signal(["a", "b"]);
const seen = signal("-");
onMounted(() => { seen.value = query.value; });
</script>
<template><section><input class="q" model="query" /><p if:when="query.value" class="shown">{query.value}</p><ul><li each:of="items.value" each:as="item">{item}:{query.value}</li></ul><Card>[{query.value}]</Card><b class="seen">{seen.value}</b></section></template>`;

test("a restored control value reaches if:, each:, <render> and onMounted only after hydration", async () => {
  const { component, cleanup } = await load({ Card: restoredCard, Restored: restored }, "Restored");
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    root.innerHTML = component.renderToString({});
    assert.equal(root.querySelector("p.shown"), null);
    // The browser restores the field (or the user types) before the JavaScript runs.
    const input = root.querySelector("input.q") as unknown as HTMLInputElement;
    input.value = "early";
    const release = component.hydrate(root as unknown as Element, {});
    const text = (selector: string): string => root.querySelector(selector)?.textContent ?? "";
    assert.equal(input.value, "early");
    assert.equal(text("p.shown"), "early");
    assert.deepEqual([...root.querySelectorAll("li")].map((node) => node.textContent), ["a:early", "b:early"]);
    assert.equal(text(".card .content"), "[early]");
    assert.equal(text("b.seen"), "early");
    input.value = "";
    fire(window, input as unknown as Element, "input");
    assert.equal(root.querySelector("p.shown"), null);
    assert.deepEqual([...root.querySelectorAll("li")].map((node) => node.textContent), ["a:", "b:"]);
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

const searchBox = `<script lang="ts">
const value = defineModel<string>();
</script>
<template><label><input class="inner" model="value" /></label></template>`;

const searchPage = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as SearchBox from "./SearchBox.meeko";
const query = signal("");
</script>
<template><section><SearchBox model="query" /><p class="echo">{query.value}</p><p if:when="query.value" class="hit">hit</p></section></template>`;

test("a restored value in a child's defineModel control reaches the parent after hydration", async () => {
  const { component, cleanup } = await load({ SearchBox: searchBox, SearchPage: searchPage }, "SearchPage");
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    const rendered = component.renderWithState({});
    root.innerHTML = rendered.html;
    const input = root.querySelector("input.inner") as unknown as HTMLInputElement;
    input.value = "early";
    const release = component.hydrate(root as unknown as Element, {}, rendered.state);
    assert.equal(root.querySelector("p.echo")?.textContent, "early");
    assert.equal(root.querySelector("p.hit")?.textContent, "hit");
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

const password = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const secret = signal("s3cret");
const revealed = signal(false);
const kind = signal("password");
</script>
<template><form>
<input class="secret" bind:type="revealed.value ? 'text' : 'password'" model="secret" autocomplete="current-password" />
<button type="button" class="toggle" on:click="() => revealed.value = !revealed.value">ver</button>
<input class="free" bind:type="kind.value" model="secret" />
<button type="button" class="checkbox" on:click="() => kind.value = 'checkbox'">checkbox</button>
<output>{secret.value}|{revealed.value}</output>
</form></template>`;

test("model with bind:type binds a text value while the type changes", async () => {
  const { code } = compile(password, "Password.meeko");
  assert.match(code, /__meeko\.renderAttribute\("type", revealed\.value \? 'text' : 'password'\)/);
  assert.match(code, /__meeko\.renderAttribute\("value", __meeko\.modelValue\(secret\)\)/);
  assert.match(code, /__meeko\.bindModel\(__scope, 0, "text", \(\) => \(secret\)\)/);
  const { component, cleanup } = await load({ Password: password }, "Password");
  const window = new Window();
  const errors: unknown[][] = [];
  const consoleError = console.error;
  console.error = (...args: unknown[]) => { errors.push(args); };
  try {
    const root = window.document.createElement("main");
    root.innerHTML = component.renderToString({});
    const input = root.querySelector("input.secret") as unknown as HTMLInputElement;
    const output = (): string => root.querySelector("output")?.textContent ?? "";
    // SSR writes the type and the value of the signal.
    assert.equal(input.getAttribute("type"), "password");
    assert.equal(input.getAttribute("value"), "s3cret");
    const release = component.hydrate(root as unknown as Element, {});
    assert.equal(output(), "s3cret|false");

    // Showing the text keeps the value and the binding in both directions.
    (root.querySelector("button.toggle") as unknown as HTMLButtonElement).click();
    assert.equal(input.type, "text");
    assert.equal(input.value, "s3cret");
    input.value = "visible";
    fire(window, input as unknown as Element, "input");
    assert.equal(output(), "visible|true");
    (root.querySelector("button.toggle") as unknown as HTMLButtonElement).click();
    assert.equal(input.type, "password");
    assert.equal(input.value, "visible");
    input.value = "hidden";
    fire(window, input as unknown as Element, "input");
    assert.equal(output(), "hidden|false");
    // `change` is not the event of a text model.
    input.value = "ignored";
    fire(window, input as unknown as Element, "change");
    assert.equal(output(), "hidden|false");
    input.value = "hidden";
    assert.deepEqual(errors, []);

    // A type without a text value is reported; the signal and the control stay as they are.
    const free = root.querySelector("input.free") as unknown as HTMLInputElement;
    (root.querySelector("button.checkbox") as unknown as HTMLButtonElement).click();
    assert.equal(free.type, "checkbox");
    fire(window, free as unknown as Element, "input");
    assert.equal(output(), "hidden|false");
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]?.[1]), /type "checkbox" is not supported/);
    // A write of the signal reaches the text field, and the checkbox reports instead of taking it.
    input.value = "again";
    fire(window, input as unknown as Element, "input");
    assert.equal(output(), "again|false");
    assert.equal(errors.length, 2);
    release();
  } finally {
    console.error = consoleError;
    window.happyDOM.abort();
    await cleanup();
  }
});

test("model with bind:type fails the hydration when the type has no text value", async () => {
  const source = password.replace(`const kind = signal("password");`, `const kind = signal("radio");`);
  const { component, cleanup } = await load({ Password: source }, "Password");
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    root.innerHTML = component.renderToString({});
    assert.throws(() => component.hydrate(root as unknown as Element, {}), /type "radio" is not supported/);
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("model on native controls reports MEEK065", () => {
  const source = (template: string): string => `<script lang="ts">import { signal } from "@meekojs/meeko";\nconst value = signal("");\nconst f = () => {};</script>\n<template>${template}</template>`;
  const div = source(`<div model="value"></div>`);
  assertCompileError(div, "MEEK065", div.indexOf(`model="value"`));
  const file = source(`<input type="file" model="value" />`);
  assertCompileError(file, "MEEK065", file.indexOf(`model="value"`));
  const bind = source(`<input model="value" bind:value="value.value" />`);
  assertCompileError(bind, "MEEK065", bind.indexOf("bind:value"));
  const input = source(`<input on:input="f" model="value" />`);
  assertCompileError(input, "MEEK065", input.indexOf("on:input"));
  const checked = source(`<input type="checkbox" model="value" bind:checked="true" />`);
  assertCompileError(checked, "MEEK065", checked.indexOf("bind:checked"));
  const radio = source(`<input type="radio" model="value" />`);
  assertCompileError(radio, "MEEK065", radio.indexOf(`model="value"`));
  // `bind:type` makes the control text-like; a static `type` beside it is ambiguous.
  const type = source(`<input bind:type="'text'" type="password" model="value" />`);
  assertCompileError(type, "MEEK065", type.indexOf(` type="password"`) + 1);
  const multiple = source(`<select bind:multiple="true" model="value"></select>`);
  assertCompileError(multiple, "MEEK065", multiple.indexOf("bind:multiple"));
  const dynamicValue = source(`<input bind:type="'text'" model="value" bind:value="value.value" />`);
  assertCompileError(dynamicValue, "MEEK065", dynamicValue.indexOf("bind:value"));
  const named = source(`<input model:value="value" />`);
  assertCompileError(named, "MEEK065", named.indexOf("model:value"));
  const textarea = source(`<textarea model="value">text</textarea>`);
  assertCompileError(textarea, "MEEK065", textarea.indexOf("<textarea"));
  // Other events are fine, and on:change on a text input is not its model event.
  assert.doesNotThrow(() => compile(source(`<input model="value" on:change="f" on:blur="f" />`), "Models.meeko"));
});

const child = `<script lang="ts">
const value = defineModel<string>();
const open = defineModel<boolean>("open", { default: false });
const count = defineModel<number>("count", { default: 10 });
</script>
<template><div class="child"><input class="inner" model="value" /><span class="state">{value.value}|{open.value}|{count.value}</span><button type="button" class="toggle" on:click="() => open.value = !open.value">t</button><button type="button" class="inc" on:click="() => count.value++">+</button></div></template>`;

const parent = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Child from "./Child.meeko";
const name = signal("Ada");
const visible = signal(true);
const show = signal(true);
</script>
<template><section><p class="outer">{name.value}|{visible.value}</p><template if:when="show.value"><Child model="name" model:open="visible" /></template><button type="button" class="rename" on:click="() => name.value = 'Grace'">r</button><button type="button" class="hide" on:click="() => show.value = !show.value">h</button></section></template>`;

test("defineModel shares the parent's signal and keeps a local one from its default", async () => {
  const { component, cleanup } = await load({ Child: child, Parent: parent }, "Parent");
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    const rendered = component.renderWithState({});
    root.innerHTML = rendered.html;
    const text = (selector: string): string => root.querySelector(selector)?.textContent ?? "";
    assert.equal(text(".state"), "Ada|true|10");
    // The child's state transfer keeps its own model and skips the parent's signals.
    const marker = /<!--meeko:component:\d+:([^>]*)-->/.exec(rendered.html)?.[1];
    assert.deepEqual(JSON.parse(decodeURIComponent(marker ?? "")), { count: 10 });
    const release = component.hydrate(root as unknown as Element, {}, rendered.state);
    const inner = root.querySelector("input.inner") as unknown as HTMLInputElement;
    inner.value = "Linus";
    fire(window, inner as unknown as Element, "input");
    assert.equal(text(".outer"), "Linus|true");
    (root.querySelector("button.toggle") as unknown as HTMLButtonElement).click();
    assert.equal(text(".outer"), "Linus|false");
    (root.querySelector("button.inc") as unknown as HTMLButtonElement).click();
    assert.equal(text(".state"), "Linus|false|11");
    (root.querySelector("button.rename") as unknown as HTMLButtonElement).click();
    assert.equal(text(".state"), "Grace|false|11");
    assert.equal(inner.value, "Grace");
    // Unmounting the child releases its bindings; the parent's signal stays usable.
    (root.querySelector("button.hide") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector(".child"), null);
    inner.value = "detached";
    fire(window, inner as unknown as Element, "input");
    assert.equal(text(".outer"), "Grace|false");
    (root.querySelector("button.hide") as unknown as HTMLButtonElement).click();
    assert.equal(text(".state"), "Grace|false|10");
    release();
    (root.querySelector("button.rename") as unknown as HTMLButtonElement).click();
    assert.equal(text(".state"), "Grace|false|10");
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("a required model without a parent signal fails at runtime", async () => {
  const { component, cleanup } = await load({ Child: child }, "Child");
  try {
    assert.throws(() => component.renderToString({}), /model "default" is required/);
  } finally {
    await cleanup();
  }
});

test("defineModel and component models report MEEK063, MEEK064 and MEEK066", () => {
  const script = (body: string): string => `<script lang="ts">\n${body}\n</script><template><p>x</p></template>`;
  const nested = script(`function f() { return defineModel<string>(); }`);
  assertCompileError(nested, "MEEK063", nested.indexOf("defineModel"));
  const twice = script(`const a = defineModel<string>();\nconst b = defineModel<string>();`);
  assertCompileError(twice, "MEEK063", twice.lastIndexOf("defineModel"));
  const named = script(`const a = defineModel<string>("x");\nconst b = defineModel<string>("x");`);
  assertCompileError(named, "MEEK063", named.lastIndexOf(`"x"`));
  const invalid = script(`const a = defineModel<string>("a-b");`);
  assertCompileError(invalid, "MEEK063", invalid.indexOf(`"a-b"`));
  const untyped = script(`const a = defineModel();`);
  assertCompileError(untyped, "MEEK064", untyped.indexOf("defineModel"));
  const options = script(`const a = defineModel<string>({ initial: "" });`);
  assertCompileError(options, "MEEK064", options.indexOf("initial"));
  const dynamic = script(`const n = "x";\nconst a = defineModel<string>(n, { default: "" });`);
  assertCompileError(dynamic, "MEEK064", dynamic.indexOf("n, {"));
  const late = `<script lang="ts">\nconst input = await useElementRef("input");\nconst a = defineModel<string>({ default: "" });\n</script><template><input ref:input /></template>`;
  assertCompileError(late, "MEEK058", late.indexOf("const a"));

  const component = (attributes: string): string => `<script lang="ts">const Child = 1;\nconst v = 1;</script>\n<template><Child ${attributes} /></template>`;
  const both = component(`model:open="v" bind:open="v"`);
  assertCompileError(both, "MEEK066", both.indexOf("bind:open"));
  const reversed = component(`bind:default="v" model="v"`);
  assertCompileError(reversed, "MEEK066", reversed.indexOf(`model="v"`));
  const repeated = component(`model="v" model:default="v"`);
  assertCompileError(repeated, "MEEK066", repeated.indexOf("model:default"));
  const bad = component(`model:a-b="v"`);
  assertCompileError(bad, "MEEK066", bad.indexOf("model:a-b"));
});

test("meeko check types models: names, value types, writability and required ones", { timeout: 90_000 }, async () => {
  const { root, cleanup } = await typeProject({ "Child.meeko": child });
  const parentWith = (template: string, extra = ""): string => `<script lang="ts">\nimport { computed, signal } from "@meekojs/meeko";\nimport * as Child from "./Child.meeko";\nconst name = signal("a");\nconst flag = signal(false);\nconst number = signal(1);\nconst derived = computed(() => "x");\n${extra}</script><template>${template}</template>`;
  const cases = [
    { name: "ValidChild", source: child, codes: [] as string[] },
    { name: "ValidParent", source: parent, codes: [] },
    { name: "Optional", source: parentWith(`<Child model="name" />`), codes: [] },
    { name: "Missing", source: parentWith(`<Child model:open="flag" />`), codes: ["TS2741"], at: "<Child" },
    { name: "Unknown", source: parentWith(`<Child model="name" model:nope="flag" />`), codes: ["TS2353"], at: "model:nope" },
    { name: "WrongType", source: parentWith(`<Child model="name" model:open="number" />`), codes: ["TS2322"], at: "model:open" },
    { name: "Computed", source: parentWith(`<Child model="derived" />`), codes: ["TS2345"], at: `derived" />` },
    { name: "Plain", source: parentWith(`<Child model="name.value" />`), codes: ["TS2322"], at: "model=" },
    { name: "NativeText", source: parentWith(`<input model="number" />`), codes: ["TS2322"], at: `number" />` },
    { name: "NativeCheckbox", source: parentWith(`<input type="checkbox" model="name" />`), codes: ["TS2322"], at: `name" />` },
    { name: "NativeMultiple", source: parentWith(`<select multiple model="name"></select>`), codes: ["TS2322"], at: `name"></select>` },
    { name: "NativeComputed", source: parentWith(`<input model="derived" />`), codes: ["TS2345"], at: `derived" />` },
    { name: "NativeDynamicType", source: parentWith(`<input bind:type="flag.value ? 'text' : 'password'" model="name" />`), codes: [] },
    { name: "NativeDynamicTypeBoolean", source: parentWith(`<input bind:type="flag.value ? 'text' : 'password'" model="flag" />`), codes: ["TS2322"], at: `flag" />` },
    { name: "Default", source: `<script lang="ts">\nconst a = defineModel<number>({ default: "x" });\n</script><template><p>{a.value}</p></template>`, codes: ["TS2322"], at: `default: "x"` },
    { name: "NoModels", source: `<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nimport * as Plain from "./Plain.meeko";\nconst v = signal("");\n</script><template><Plain model="v" /></template>`, codes: ["TS2322"], at: "model=" },
  ];
  await writeFile(join(root, "Plain.meeko"), `<script lang="ts">const x = 1;</script><template><p>{x}</p></template>`);
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
    await generateTypes(parent, join(root, "Parent.meeko"));
    const declaration = await readFile(join(root, ".meeko", "types", "Child.d.meeko.ts"), "utf8");
    assert.match(declaration, /export type ComponentModels = \{\s*"default": __meeko\.Signal<__MeekoModels\["default"\]>;\s*"open"\?: __meeko\.Signal<__MeekoModels\["open"\]>;/);
    assert.match(declaration, /export declare const __meekoChannels: \{/);
  } finally {
    await cleanup();
  }
});
