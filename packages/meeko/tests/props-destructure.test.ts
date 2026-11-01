import { Window } from "happy-dom";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import type * as hmr_tsTypes from "../src/app/runtime/hmr.ts";
import type * as props_tsTypes from "../src/app/runtime/props.ts";
import type * as reactivity_tsTypes from "../src/core/reactivity.ts";

import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/parser/sfc.ts";
import { checkApp } from "../src/framework/check-app.ts";
import { createEditorModel } from "../src/language-server/model.ts";

/** The runtime as the compiled components import it, by file URL: one instance of every module. */
const runtimeUrl = (path: string): string => pathToFileURL(resolve(path)).href;
/** Any file of the package: the editor model resolves the project from it. */
const editorFilename = resolve("examples/regions/Regions.meeko");
const { enableHotModule, replaceHotModule } = await import(runtimeUrl("src/app/runtime/hmr.js")) as typeof hmr_tsTypes;
const { isReactiveProps, reactiveProps, restProps } = await import(runtimeUrl("src/app/runtime/props.js")) as typeof props_tsTypes;
const { signal } = await import(runtimeUrl("src/core/reactivity.js")) as typeof reactivity_tsTypes;

interface Module {
  renderToString(props: object): string;
  hydrate(root: Element, props: object): () => void;
  readonly __hotId?: string;
}

/** A button that is a link with `href`: destructured props, defaults, a renamed prop, a rest view, emits and shadowing. */
const button = `<script lang="ts">
import { computed, signal } from "@meekojs/meeko";
const SIZES = ["sm", "md", "lg"] as const;
const DEFAULT_SIZE = SIZES[1];
interface Props { label: string; href?: string; size?: "sm" | "md" | "lg"; class?: string; tags?: string[]; title?: string; "data-kind"?: string }
const { label, href, size = DEFAULT_SIZE, class: className, tags = [], ...rest } = defineProps<Props>();
const emit = defineEmits<{ press: [label: string] }>();
const upper = computed(() => label.toUpperCase());
const clicks = signal(0);
function press(): void {
  clicks.value++;
  emit("press", label);
}
function echo(label: string): string {
  return label;
}
</script>
<template><component is="href !== undefined ? 'a' : 'button'" bind:href="href" bind:class="className" bind="rest" on:click="press"><span class="label">{label}</span><span class="size">{size}</span><span class="upper">{upper.value}</span><span class="echo">{echo("x")}</span><i each:of="tags" each:as="label">{label}</i><b class="clicks">{clicks.value}</b><s class="keys">{Object.keys(rest).join(",")}</s></component></template>`;

const parent = `<script lang="ts">
import type { Signal } from "@meekojs/meeko";
import * as Button from "./Button.meeko";
const props = defineProps<{ store: { label: Signal<string>; href: Signal<string | undefined>; size: Signal<"sm" | "md" | "lg" | undefined>; kind: Signal<string>; pressed: string[] } }>();
const store = props.store;
</script>
<template><div><Button bind:label="store.label.value" bind:href="store.href.value" bind:size="store.size.value" class="btn" title="Hola" bind:data-kind="store.kind.value" on:press="(label) => store.pressed.push(label)" /></div></template>`;

/** Each instance creates its own default array. */
const tagged = `<script lang="ts">
const { tags = [] } = defineProps<{ tags?: string[] }>();
tags.push("own");
</script>
<template><u>{tags.length}</u></template>`;

const tags = `<script lang="ts">
import * as Tagged from "./Tagged.meeko";
</script>
<template><p><Tagged /><Tagged /></p></template>`;

const runtime = (path: string): string => JSON.stringify(runtimeUrl(path));

async function writeModule(directory: string, name: string, output: string, source: string, hot: boolean): Promise<void> {
  const code = compile(source, join(directory, `${name}.meeko`), { hot }).code
    .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
    .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`)
    .replaceAll(/from "\.\/(\w+)\.meeko"/g, `from "./$1.ts"`);
  await writeFile(join(directory, `${output}.ts`), code);
}

/** Compiles components inside the package, so they share the runtime modules of this file. */
async function load(sources: Record<string, string>, hot = false): Promise<{ modules: Record<string, Module>; directory: string; cleanup: () => Promise<void> }> {
  await mkdir(resolve(".meeko"), { recursive: true });
  const directory = await mkdtemp(resolve(".meeko", "props-destructure-test-"));
  for (const [name, source] of Object.entries(sources)) await writeModule(directory, name, name, source, hot);
  const modules: Record<string, Module> = {};
  for (const name of Object.keys(sources)) modules[name] = await import(pathToFileURL(join(directory, `${name}.ts`)).href) as Module;
  return { modules, directory, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function compileError(source: string): MeekoCompileError {
  try {
    compile(source, "Broken.meeko");
  } catch (error) {
    assert.ok(error instanceof MeekoCompileError, String(error));
    return error;
  }
  assert.fail("the component compiled");
}

const text = (root: { querySelector(selector: string): { textContent: string | null } | null }, selector: string): string | null | undefined => root.querySelector(selector)?.textContent;

test("a destructured defineProps reads each prop where it is used, keeps shadowed names and builds a rest view", () => {
  const { code } = compile(button, "Button.meeko");
  const setup = code.slice(code.indexOf("function __setup"), code.indexOf("export type ComponentExposed"));
  assert.match(setup, /const __meeko_props = __meeko\.withoutEventProps\(__props, \["onPress"\]\) as Readonly<__MeekoResolvedProps> & __meeko\.PropKeysCheck<\[__meeko\.PropKey<Props, "label">, /);
  assert.match(code, /export type ComponentDefaults = \{ readonly "size": "DEFAULT_SIZE"; readonly "tags": "\[\]" \};/);
  assert.match(setup, /const rest = __meeko\.restProps\(__meeko_props, \["label","href","size","class","tags"\]\)/);
  assert.match(setup, /computed\(\(\) => __meeko_props\.label\.toUpperCase\(\)\)/);
  assert.match(setup, /emit\("press", __meeko_props\.label\)/);
  // A parameter with the same name is another variable.
  assert.match(setup, /function echo\(label: string\): string \{\n  return label;\n\}/);
  // The template reads the props view; the list item keeps its own name.
  assert.match(code, /bindText\(__scope, \d+, \(\) => \(__meeko_props\.label\)/);
  assert.match(code, /\(label, index\) => "<i"/);
  assert.match(code, /__meeko\.tagAttribute\([^)]*"class"[^)]*\)|__meeko_props\.class/);
  // The defaults are evaluated for each instance, with the constants they read.
  assert.match(code, /function __meeko_defaultProps\(\) \{\nconst SIZES = \["sm", "md", "lg"\] as const;\nconst DEFAULT_SIZE = SIZES\[1\];\n  return \(\(\(\{ "size": DEFAULT_SIZE, "tags": \[\] \}/);
  // Neither default is a literal: each is checked against the members that require its prop (MEEK131).
  assert.match(code, / satisfies __MeekoDefaultFit<"size">\) satisfies __MeekoDefaultFit<"tags">\);/);
  assert.doesNotMatch(code, /const \{ label/);
});

test("the source map points the prop of each rewritten read at the destructured name", () => {
  const { code, mappings } = compile(button, "Button.meeko");
  const generated = code.indexOf("__meeko_props.label.toUpperCase") + "__meeko_props.".length;
  const original = button.indexOf("label.toUpperCase");
  const span = mappings.filter((mapping) => generated >= mapping.generatedStart && generated < mapping.generatedEnd)
    .sort((a, b) => (a.generatedEnd - a.generatedStart) - (b.generatedEnd - b.generatedStart))[0];
  assert.ok(span);
  assert.equal(span.originalStart, original);
  assert.equal(span.originalLength, "label".length);
  // Text after the rewritten read keeps its exact position.
  const after = code.indexOf(".toUpperCase()", generated);
  const afterSpan = mappings.filter((mapping) => after >= mapping.generatedStart && after < mapping.generatedEnd)
    .sort((a, b) => (a.generatedEnd - a.generatedStart) - (b.generatedEnd - b.generatedStart))[0];
  assert.equal(afterSpan!.originalStart + after - afterSpan!.generatedStart, original + "label".length);
});

test("SSR, hydration, prop updates and the rest view of a destructured component", async () => {
  const { modules, cleanup } = await load({ Button: button, Parent: parent });
  const window = new Window();
  const document = window.document;
  try {
    const store = { label: signal("Guardar"), href: signal<string | undefined>(undefined), size: signal<"sm" | "md" | "lg" | undefined>(undefined), kind: signal("primary"), pressed: [] as string[] };
    const root = document.createElement("main");
    document.body.appendChild(root);
    const html = modules.Parent!.renderToString({ store });
    root.innerHTML = html;
    const host = (): Element => root.querySelector("div > *") as unknown as Element;
    assert.equal(host().tagName, "BUTTON");
    assert.equal(host().getAttribute("class"), "btn");
    assert.equal(host().getAttribute("title"), "Hola");
    assert.equal(host().getAttribute("data-kind"), "primary");
    assert.equal(host().hasAttribute("onpress"), false);
    assert.equal(text(root, ".label"), "Guardar");
    assert.equal(text(root, ".size"), "md");
    assert.equal(text(root, ".upper"), "GUARDAR");
    assert.equal(text(root, ".echo"), "x");
    // The rest view has neither the destructured props nor the callback of the declared event.
    assert.equal(text(root, ".keys"), "title,data-kind");
    const release = modules.Parent!.hydrate(root as unknown as Element, { store });
    assert.equal(root.innerHTML, html);
    const label = root.querySelector(".label");
    store.label.value = "Enviar";
    assert.equal(root.querySelector(".label"), label);
    assert.equal(text(root, ".label"), "Enviar");
    assert.equal(text(root, ".upper"), "ENVIAR");
    store.size.value = "lg";
    assert.equal(text(root, ".size"), "lg");
    store.size.value = undefined;
    assert.equal(text(root, ".size"), "md");
    store.kind.value = "danger";
    assert.equal(host().getAttribute("data-kind"), "danger");
    (host() as unknown as HTMLButtonElement).click();
    assert.equal(text(root, ".clicks"), "1");
    assert.deepEqual(store.pressed, ["Enviar"]);
    store.href.value = "/docs";
    assert.equal(host().tagName, "A");
    assert.equal(host().getAttribute("href"), "/docs");
    assert.equal(host().getAttribute("data-kind"), "danger");
    assert.equal(text(root, ".label"), "Enviar");
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("a default object or array of the destructuring is created for each instance", async () => {
  const { modules, cleanup } = await load({ Tagged: tagged, Tags: tags });
  try {
    assert.equal(modules.Tags!.renderToString({}).replaceAll(/<!--.*?-->/g, "").replaceAll(/ data-meeko="\d+"/g, ""), "<p><u>1</u><u>1</u></p>");
  } finally {
    await cleanup();
  }
});

test("the rest view follows the props, hides the destructured names and stays read-only", () => {
  const source = reactiveProps<Record<string, unknown>>({ a: 1, b: 2, c: 3 });
  const rest = restProps(source.props, ["a"]) as Record<string, unknown>;
  assert.equal(isReactiveProps(rest), true);
  assert.deepEqual({ ...rest }, { b: 2, c: 3 });
  assert.equal(rest.a, undefined);
  assert.equal("a" in rest, false);
  source.update({ a: 1, b: 5, d: 4 });
  assert.deepEqual({ ...rest }, { b: 5, d: 4 });
  assert.throws(() => { rest.b = 1; }, TypeError);
  assert.deepEqual({ ...restProps({ a: 1, b: 2 }, ["b"]) }, { a: 1 });
});

test("HMR keeps the state of a destructured component and its reads stay reactive", async () => {
  const { modules, directory, cleanup } = await load({ Button: button, Parent: parent }, true);
  const window = new Window();
  const names = ["window", "Node"] as const;
  const previous = names.map((name) => ({ name, value: Reflect.get(globalThis, name), present: Reflect.has(globalThis, name) }));
  Reflect.set(globalThis, "window", window);
  Reflect.set(globalThis, "Node", window.Node);
  try {
    const id = modules.Button!.__hotId!;
    enableHotModule(id);
    const store = { label: signal("Uno"), href: signal<string | undefined>(undefined), size: signal<"sm" | "md" | "lg" | undefined>(undefined), kind: signal("k"), pressed: [] as string[] };
    const root = window.document.createElement("main");
    window.document.body.appendChild(root);
    root.innerHTML = modules.Parent!.renderToString({ store });
    const release = modules.Parent!.hydrate(root as unknown as Element, { store });
    (root.querySelector("button") as unknown as HTMLButtonElement).click();
    assert.equal(text(root, ".clicks"), "1");
    await writeModule(directory, "Button", "ButtonEdited", button.replace(`class="label"`, `class="label edited"`), true);
    const edited = await import(pathToFileURL(join(directory, "ButtonEdited.ts")).href) as Module;
    replaceHotModule(id, edited);
    assert.equal(text(root, ".label.edited"), "Uno");
    assert.equal(text(root, ".clicks"), "1");
    store.label.value = "Dos";
    assert.equal(text(root, ".label.edited"), "Dos");
    assert.equal(text(root, ".upper"), "DOS");
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

test("unsupported destructurings, writes and setup-dependent defaults are clear errors", () => {
  const script = (code: string, template = "<p></p>"): string => `<script lang="ts">\n${code}\n</script>\n<template>${template}</template>`;
  const cases: Array<{ source: string; code: string; at: string; message: RegExp }> = [
    { source: script("const { a: { b } } = defineProps<{ a: { b: string } }>();"), code: "MEEK015", at: "{ b }", message: /anidada.*const \{ a \} = defineProps/ },
    { source: script("const [a] = defineProps<{ a: string }>();"), code: "MEEK015", at: "[a]", message: /no un array/ },
    { source: script("let { a } = defineProps<{ a: string }>();"), code: "MEEK015", at: "let", message: /const/ },
    { source: script("const key = \"a\";\nconst { [key]: a } = defineProps<{ a: string }>();"), code: "MEEK015", at: "[key]", message: /claves calculadas/ },
    { source: script("const { a, b: a2, a: again } = defineProps<{ a: string; b: string }>();"), code: "MEEK042", at: "a: again", message: /duplicado/ },
    { source: script("const { size = \"md\" } = defineProps<{ size?: string }>({ size: \"sm\" });"), code: "MEEK124", at: "{ size: \"sm\" }", message: /no en los dos/ },
    { source: script("const { label } = defineProps<{ label: string }>();\nfunction rename(): void { label = \"x\"; }"), code: "MEEK125", at: "label = \"x\"", message: /label es la prop label.*sólo lectura/ },
    { source: script("const { count: total } = defineProps<{ count: number }>();", "<button on:click=\"() => total++\">x</button>"), code: "MEEK125", at: "total++", message: /total es la prop count/ },
    { source: script("const { count } = defineProps<{ count: number }>();\nfunction reset(): void { [count] = [0]; }"), code: "MEEK125", at: "count] = [0]", message: /count es la prop count/ },
    { source: script("import { signal } from \"@meekojs/meeko\";\nconst start = signal(1);\nconst { count = start } = defineProps<{ count?: unknown }>();"), code: "MEEK123", at: "start }", message: /prop count usa start.*llama a una función/ },
    { source: script("let fallback = 1;\nconst { count = fallback } = defineProps<{ count?: number }>();"), code: "MEEK123", at: "fallback }", message: /let o var/ },
    { source: script("const { a, b = a } = defineProps<{ a: string; b?: string }>();"), code: "MEEK123", at: "a }", message: /prop b usa a, que depende del setup: es una prop/ },
    { source: script("function base(): number { return 1; }\nconst props = defineProps<{ count?: number }>({ count: base() });"), code: "MEEK123", at: "base() }", message: /función del setup/ },
    { source: script("const now = Date.now();\nconst LIMIT = now + 1;\nconst props = defineProps<{ count?: number }>({ count: LIMIT });"), code: "MEEK123", at: "LIMIT }", message: /su valor usa now.*llama a una función/ },
    // A parameter that shadows a forbidden name inside the default does not hide its use outside.
    { source: script("let local = 5;\nconst { x = ((local: number) => local * 2)(local) } = defineProps<{ x?: number }>();"), code: "MEEK123", at: "local) }", message: /prop x usa local.*let o var/ },
    // Implicit bindings of the setup function: inside the defaults they would be another function's.
    { source: script("const A = arguments[0].x;\nconst { x = A } = defineProps<{ x?: number }>();"), code: "MEEK123", at: "A }", message: /prop x usa A.*su valor usa arguments, y arguments es implícito/ },
    { source: script("const { x = arguments.length } = defineProps<{ x?: number }>();"), code: "MEEK123", at: "arguments.length", message: /prop x usa arguments, que depende del setup: arguments es implícito/ },
    { source: script("const props = defineProps<{ x?: number }>({ x: (() => arguments.length)() });"), code: "MEEK123", at: "arguments.length", message: /prop x usa arguments/ },
    { source: script("const A = new.target;\nconst props = defineProps<{ x?: unknown }>({ x: A });"), code: "MEEK123", at: "A }", message: /su valor usa new\.target/ },
  ];
  for (const item of cases) {
    const error = compileError(item.source);
    assert.equal(error.diagnostic.code, item.code, `${item.at}: ${error.message}`);
    assert.match(error.diagnostic.message, item.message);
    assert.equal(error.diagnostic.location.offset, item.source.indexOf(item.at), `${item.code} ${item.at}: ${error.diagnostic.location.offset}`);
  }
});

test("constants of literals and imports are valid defaults in both forms", () => {
  const source = `<script lang="ts">
import { sizes } from "./sizes";
const LIMITS = { min: 1, max: 10 } as const;
const START = -LIMITS.min * 2 + sizes.length;
const LABEL = \`Hasta \${LIMITS.max}\`;
const props = defineProps<{ count?: number; label?: string; range?: { min: number; max: number } }>({ count: START, label: LABEL, range: { ...LIMITS } });
</script>
<template><p>{props.count}</p></template>`;
  const { code } = compile(source, "Valid.meeko");
  assert.match(code, /function __meeko_defaultProps\(\) \{\nconst LIMITS = \{ min: 1, max: 10 \} as const;\nconst START = -LIMITS\.min \* 2 \+ sizes\.length;\nconst LABEL = `Hasta \$\{LIMITS\.max\}`;\n/);
});

test("reads of a destructured prop that run once are MEEK101 warnings; reactive reads are not", () => {
  const source = `<script lang="ts">
import { computed, effect, onMounted, signal, untrack } from "@meekojs/meeko";
const { label, onPick, ...rest } = defineProps<{ label: string; onPick?: () => void; title?: string }>();
const copy = label;
const fine = computed(() => label);
effect(() => { void label; });
const initial = signal(label);
const later = untrack(() => label);
onPick?.();
const spread = { ...rest };
function handler(): string { return label; }
onMounted(() => { void label; });
</script>
<template><p bind:title="rest.title">{label}</p></template>`;
  const warnings = compile(source, "Reads.meeko").warnings ?? [];
  const at = warnings.map((warning) => [warning.code, source.slice(warning.location.offset, warning.location.offset + 12)]);
  assert.deepEqual(at, [
    ["MEEK101", "label;\nconst"],
    ["MEEK101", "rest };\nfunc"],
    ["MEEK101", "label; });\n<"],
  ]);
  assert.match(warnings[0]!.message, /^label es una prop de defineProps y aquí se lee una sola vez/);
  assert.match(warnings[2]!.message, /onMounted se ejecuta una sola vez/);
});

/** Temporary project whose tsconfig points the package at src/, like a built consumer. */
async function typeProject(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(join(resolve(".meeko"), "props-destructure-check-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      types: ["node"],
      paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] },
    },
  })}\n`);
  await writeFile(join(root, "Button.meeko"), button);
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const union = `<script lang="ts">
import { computed } from "@meekojs/meeko";
type Props = { kind: "link"; href: string; count?: never } | { kind: "count"; count: number; href?: never };
const { kind, href, count } = defineProps<Props>();
const doubled = computed(() => kind === "count" ? count * 2 : 0);
function describe(): string {
  if (href !== undefined) return href.toUpperCase();
  return String(doubled.value);
}
</script>
<template><a if:when="kind === 'link'" bind:href="href">{href.toUpperCase()}</a><b if:when="count !== undefined">{count.toFixed(0)}</b><i>{describe()}</i></template>`;

test("meeko check types destructured props: unions narrow in script and template, defaults and keys are checked", { timeout: 120_000 }, async () => {
  const { root, cleanup } = await typeProject();
  const cases: Array<{ name: string; source: string; codes: string[]; at?: string }> = [
    { name: "Button", source: button, codes: [] },
    { name: "Union", source: union, codes: [] },
    { name: "Unnarrowed", source: union.replace(`<b if:when="count !== undefined">`, "<b>"), codes: ["TS18048"], at: "count.toFixed" },
    { name: "UnknownKey", source: `<script lang="ts">\nconst { label, nope } = defineProps<{ label: string }>();\n</script><template><p>{label}</p></template>`, codes: ["TS2344"], at: "nope" },
    { name: "WrongDefault", source: `<script lang="ts">\nconst { size = 3 } = defineProps<{ size?: "sm" | "md" }>();\n</script><template><p>{size}</p></template>`, codes: ["TS2322"], at: "size = 3" },
    { name: "Defaulted", source: `<script lang="ts">\nconst { size = "md" } = defineProps<{ size?: "sm" | "md" }>();\nconst length: number = size.length;\n</script><template><p>{length}</p></template>`, codes: ["MEEK101"] },
    { name: "RestType", source: `<script lang="ts">\nconst { label, ...rest } = defineProps<{ label: string; title?: string }>();\n</script><template><p bind:title="rest.title">{label}{rest.label}</p></template>`, codes: ["TS2339"], at: "label}</p>" },
    { name: "Parent", source: `<script lang="ts">\nimport * as Button from "./Button.meeko";\n</script><template><Button label="Ir" size="lg" on:press="(label) => label.length" /></template>`, codes: [] },
    { name: "ParentMissing", source: `<script lang="ts">\nimport * as Button from "./Button.meeko";\n</script><template><Button size="lg" /></template>`, codes: ["TS2345"] },
    { name: "ParentWrongSize", source: `<script lang="ts">\nimport * as Button from "./Button.meeko";\n</script><template><Button label="Ir" size="xl" /></template>`, codes: ["TS2322"] },
    { name: "Reassigned", source: `<script lang="ts">\nconst { label } = defineProps<{ label: string }>();\nlabel = "x";\n</script><template><p>{label}</p></template>`, codes: ["MEEK125"], at: "label = " },
  ];
  try {
    for (const item of cases) {
      const diagnostics = await checkSource(item.source, join(root, `${item.name}.meeko`));
      const messages = JSON.stringify(diagnostics);
      assert.deepEqual([...new Set(diagnostics.map((diagnostic) => diagnostic.code))].sort(), [...item.codes].sort(), `${item.name}: ${messages}`);
      if (item.at) assert.ok(diagnostics.some((diagnostic) => diagnostic.location.offset === item.source.indexOf(item.at!)), `${item.name}: ${messages}`);
    }
  } finally {
    await cleanup();
  }
});

test("check-app types a destructured polymorphic component and its pages", { timeout: 120_000 }, async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko/check-app-destructure-"));
  const pages = join(root, "app", "pages");
  const components = join(root, "app", "components");
  await mkdir(pages, { recursive: true });
  await mkdir(components, { recursive: true });
  await writeFile(join(components, "Choice.meeko"), union);
  await writeFile(join(components, "Button.meeko"), button);
  const page = (body: string): string => `<script lang="ts">
import * as Choice from "../components/Choice.meeko";
import * as Button from "../components/Button.meeko";
</script>
<template>${body}</template>`;
  await writeFile(join(pages, "index.meeko"), page(`<Choice kind="link" href="/a" /><Choice kind="count" bind:count="2" /><Button label="Ir" />`));
  await writeFile(join(pages, "wrong.meeko"), page(`<Choice kind="link" bind:count="2" />`));
  // A generic component and a page destructure their props too.
  await writeFile(join(components, "Rows.meeko"), `<script lang="ts" generic="Row extends { id: string }">
const { rows, empty = "Nada" } = defineProps<{ rows: readonly Row[]; empty?: string }>();
</script>
<template><ul><li each:of="rows" each:as="row" each:key="row.id">{row.id}</li></ul><p if:when="rows.length === 0">{empty.toUpperCase()}</p></template>`);
  await mkdir(join(pages, "users"), { recursive: true });
  await writeFile(join(pages, "users", "[id].meeko"), `<script lang="ts">
import * as Rows from "../../components/Rows.meeko";
const { params } = defineProps<{ params: { id: string } }>();
</script>
<template><h1>{params.id.toUpperCase()}</h1><Rows bind:rows="[{ id: params.id }]" /></template>`);
  await writeFile(join(pages, "rows.meeko"), `<script lang="ts">
import * as Rows from "../components/Rows.meeko";
</script>
<template><Rows bind:rows="[{ name: 'x' }]" /></template>`);
  try {
    const diagnostics = await checkApp(root);
    const of = (file: string): string[] => diagnostics.filter((item) => item.filename === file).map((item) => item.code);
    assert.deepEqual(of(join(pages, "index.meeko")), [], JSON.stringify(diagnostics));
    assert.deepEqual(of(join(components, "Choice.meeko")), [], JSON.stringify(diagnostics));
    assert.deepEqual(of(join(components, "Button.meeko")), [], JSON.stringify(diagnostics));
    assert.ok(of(join(pages, "wrong.meeko")).length > 0, JSON.stringify(diagnostics));
    assert.deepEqual(of(join(components, "Rows.meeko")), [], JSON.stringify(diagnostics));
    assert.deepEqual(of(join(pages, "users", "[id].meeko")), [], JSON.stringify(diagnostics));
    assert.ok(of(join(pages, "rows.meeko")).length > 0, JSON.stringify(diagnostics));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the editor types a destructured defineProps: unions with defaults narrow, hover, completion and errors", () => {
  const unionDefaults = `<script lang="ts">
type Props = { to: string; params: { id: string }; type?: never; label?: string } | { to?: never; params?: never; type?: "button" | "submit"; label?: string };
const { to, params, type = "button", label = "", ...rest } = defineProps<Props>();
function id(): string { return to !== undefined ? params.id : type; }
</script>
<template><a if:when="to !== undefined">{params.id}{label.length}</a><b if:when="to === undefined">{type.toUpperCase()}</b><i>{id()}</i></template>`;
  for (const source of [button, union, unionDefaults]) {
    const model = createEditorModel(source, editorFilename);
    try {
      const diagnostics = model.service.getSemanticDiagnostics(model.virtualFilename);
      assert.deepEqual(diagnostics.map((item) => item.code), [], diagnostics.map((item) => String(item.messageText)).join("\n"));
    } finally { model.dispose(); }
  }
  const model = createEditorModel(button, editorFilename);
  try {
    const use = button.indexOf("{label}") + 1;
    const generated = model.toGenerated(use + 2);
    assert.notEqual(generated, undefined);
    const info = model.service.getQuickInfoAtPosition(model.virtualFilename, generated!);
    assert.equal(info?.displayParts?.map((part) => part.text).join(""), "const label: string");
    const span = info!.textSpan;
    assert.equal(model.toSource(span.start), use);
    const completions = model.service.getCompletionsAtPosition(model.virtualFilename, generated!, {});
    for (const name of ["label", "size", "className", "rest", "upper"]) assert.ok(completions?.entries.some((entry) => entry.name === name), name);
  } finally { model.dispose(); }
  const wrong = `<script lang="ts">
const { label, ...rest } = defineProps<{ label: string; title?: string }>();
</script>
<template><p>{rest.label}{label.nope}</p></template>`;
  const broken = createEditorModel(wrong, editorFilename);
  try {
    const diagnostics = broken.service.getSemanticDiagnostics(broken.virtualFilename);
    assert.deepEqual(diagnostics.map((item) => [item.code, broken.toSource(item.start ?? -1)]), [
      [2339, wrong.indexOf("label}{label")],
      [2339, wrong.indexOf("nope")],
    ]);
  } finally { broken.dispose(); }
});

/** A discriminated union whose discriminant has a default, in both forms of defineProps. */
const discriminated = (declaration: string, read = ""): string => `<script lang="ts">
type Props = { kind: "a"; a: string; b?: never } | { kind: "b"; b: string; a?: never };
const DEFAULT_KIND = "a";
${declaration}
function f(): string {
  if (${read}kind === "a") return ${read}a.toUpperCase();
  return ${read}b.toUpperCase();
}
</script>
<template><p>{f()}</p><i>{${read}kind === "a" ? ${read}a.length : ${read}b.length}</i></template>`;
const discriminatedForms = {
  Pattern: discriminated(`const { kind = "a", a, b } = defineProps<Props>();`),
  Argument: discriminated(`const props = defineProps<Props>({ kind: "a" });`, "props."),
  Constant: discriminated(`const { kind = DEFAULT_KIND, a, b } = defineProps<Props>();`),
};

test("a default of a union's discriminant is optional only in the members that admit it", { timeout: 180_000 }, async () => {
  const { root, cleanup } = await typeProject();
  const parent = (name: string, attributes: string): string => `<script lang="ts">\nimport * as Child from "./${name}.meeko";\n</script><template><Child ${attributes} /></template>`;
  try {
    for (const [name, source] of Object.entries(discriminatedForms)) {
      await writeFile(join(root, `${name}.meeko`), source);
      const own = await checkSource(source, join(root, `${name}.meeko`));
      assert.deepEqual(own.map((item) => item.code), [], `${name}: ${JSON.stringify(own)}`);
      for (const [attributes, valid] of [[`a="x"`, true], [`kind="a" a="x"`, true], [`kind="b" b="x"`, true], [`b="hello"`, false], [`kind="b" a="x"`, false]] as const) {
        const page = parent(name, attributes);
        const diagnostics = await checkSource(page, join(root, `${name}Parent.meeko`));
        if (valid) assert.deepEqual(diagnostics.map((item) => item.code), [], `${name} ${attributes}: ${JSON.stringify(diagnostics)}`);
        else assert.ok(diagnostics.some((item) => item.code.startsWith("TS") && item.location.offset >= page.indexOf("<Child") && item.location.offset < page.indexOf("/>")), `${name} ${attributes}: ${JSON.stringify(diagnostics)}`);
      }
    }
  } finally {
    await cleanup();
  }
});

test("SSR of a union with a default discriminant fills the default only where a member admits it", async () => {
  const { modules, cleanup } = await load({ Pattern: discriminatedForms.Pattern, Argument: discriminatedForms.Argument });
  try {
    for (const name of ["Pattern", "Argument"]) {
      const html = (props: object): string => modules[name]!.renderToString(props).replaceAll(/<!--.*?-->/g, "").replaceAll(/ data-meeko="\d+"/g, "");
      assert.equal(html({ a: "x" }), "<p>X</p><i>1</i>", name);
      assert.equal(html({ kind: "b", b: "yz" }), "<p>YZ</p><i>2</i>", name);
    }
  } finally {
    await cleanup();
  }
});

test("a default that is not a literal must suit every member that requires its prop (MEEK131)", { timeout: 120_000 }, async () => {
  const { root, cleanup } = await typeProject();
  const union = "type Props = { kind: \"a\"; a: string } | { kind: \"b\"; b: string };\nconst KINDS = [\"a\", \"b\"] as const;";
  const script = (code: string): string => `<script lang="ts">\n${union}\n${code}\n</script>\n<template><p>{String(kind)}</p></template>`;
  const cases: Array<{ name: string; source: string; at: string | undefined }> = [
    { name: "PatternOpaque", source: script("const { kind = KINDS[0] } = defineProps<Props>();"), at: "kind = KINDS" },
    { name: "ArgumentOpaque", source: script("const props = defineProps<Props>({ kind: KINDS[0] });\nconst kind = props.kind;"), at: "kind: KINDS" },
    // Optional in every member, or required with the same type: nothing to narrow.
    { name: "Optional", source: `<script lang="ts">\nconst KINDS = ["a", "b"] as const;\nconst { kind = KINDS[0] } = defineProps<{ kind?: "a" | "b"; a: string } | { kind?: "a"; b: string }>();\n</script>\n<template><p>{kind}</p></template>`, at: undefined },
  ];
  try {
    for (const item of cases) {
      const diagnostics = await checkSource(item.source, join(root, `${item.name}.meeko`));
      if (item.at === undefined) {
        assert.deepEqual(diagnostics.map((diagnostic) => diagnostic.code), [], `${item.name}: ${JSON.stringify(diagnostics)}`);
        continue;
      }
      const fit = diagnostics.find((diagnostic) => diagnostic.code === "MEEK131");
      assert.ok(fit, `${item.name}: ${JSON.stringify(diagnostics)}`);
      assert.equal(fit.location.offset, item.source.indexOf(item.at), `${item.name}: ${JSON.stringify(diagnostics)}`);
      assert.match(fit.message, /^el valor por defecto de kind no es un literal/);
    }
  } finally {
    await cleanup();
  }
});

/** Defaults whose own scopes declare names of the setup: locals, blocks, `catch`, accessors and their own `arguments`. */
const scopedDefaults = `<script lang="ts">
let local = 5;
let error = 1;
let value = 1;
const { a = (() => { const local = 2; return local; })(), b = (() => { { const local = 3; return local; } })(), c = (() => { try { throw new Error("x"); } catch (error) { return String(error).length; } })(), d = { get value() { const value = 4; return value; } }, e = (function () { return arguments.length; })(), f = ((local: number) => local * 2)(3) } = defineProps<{ a?: number; b?: number; c?: number; d?: { readonly value: number }; e?: number; f?: number }>();
</script>
<template><p>{a},{b},{c},{d.value},{e},{f},{local + error + value}</p></template>`;

test("defaults may declare their own names, catch variables, accessors and arguments (no MEEK123)", async () => {
  const argument = `<script lang="ts">
let local = 5;
const props = defineProps<{ x?: number; y?: number }>({ x: (() => { const local = 2; return local; })(), y: (function () { return arguments.length; })() });
</script>
<template><p>{props.x},{props.y},{local}</p></template>`;
  const { modules, cleanup } = await load({ Scoped: scopedDefaults, Argument: argument });
  try {
    const html = (name: string, props: object): string => modules[name]!.renderToString(props).replaceAll(/<!--.*?-->/g, "").replaceAll(/ data-meeko="\d+"/g, "");
    assert.equal(html("Scoped", {}), "<p>2,3,8,4,0,6,7</p>");
    assert.equal(html("Scoped", { a: 10, e: 11 }), "<p>10,3,8,4,11,6,7</p>");
    assert.equal(html("Argument", {}), "<p>2,0,5</p>");
    assert.equal(html("Argument", { x: 1, y: 9 }), "<p>1,9,5</p>");
  } finally {
    await cleanup();
  }
});

/** Type queries of destructured props, with a key that is not an identifier and a parameter that shadows one. */
const typeQueries = `<script lang="ts">
const { x, "aria-label": ariaLabel } = defineProps<{ x: string; "aria-label": string }>();
function f(): string {
  const y: typeof x = x;
  const n: typeof x.length = y.length;
  const label: typeof ariaLabel = ariaLabel;
  const size: typeof ariaLabel.length = label.length;
  return \`\${y}\${n}\${label}\${size}\`;
}
function g(x: number): typeof x {
  return x;
}
</script>
<template><p>{f()}{g(1)}</p></template>`;

test("a type query of a destructured prop reads the props' type, unless a closer name shadows it", { timeout: 120_000 }, async () => {
  const { code } = compile(typeQueries, "Typed.meeko");
  assert.match(code, /const y: typeof __meeko_props\.x = __meeko_props\.x;/);
  assert.match(code, /const n: typeof __meeko_props\.x\.length = y\.length;/);
  assert.match(code, /const label: typeof __meeko_props\["aria-label"\] = __meeko_props\["aria-label"\];/);
  assert.match(code, /const size: \(typeof __meeko_props\)\["aria-label"\]\["length"\] = label\.length;/);
  assert.match(code, /function g\(x: number\): typeof x \{\n  return x;\n\}/);
  const { root, cleanup } = await typeProject();
  try {
    assert.deepEqual(await checkSource(typeQueries, join(root, "Typed.meeko")), []);
    const wrong = typeQueries.replace("const y: typeof x = x;", "const y: typeof x = x;\n  const bad: typeof x = 5;");
    const diagnostics = await checkSource(wrong, join(root, "Wrong.meeko"));
    assert.deepEqual(diagnostics.map((item) => [item.code, item.location.offset]), [["TS2322", wrong.indexOf("bad")]], JSON.stringify(diagnostics));
  } finally {
    await cleanup();
  }
  const model = createEditorModel(typeQueries, editorFilename);
  try {
    const use = typeQueries.indexOf("typeof x =") + "typeof ".length;
    const generated = model.toGenerated(use);
    assert.notEqual(generated, undefined);
    const info = model.service.getQuickInfoAtPosition(model.virtualFilename, generated!);
    assert.equal(info?.displayParts?.map((part) => part.text).join(""), "const x: string");
    assert.equal(model.toSource(info!.textSpan.start), use);
  } finally { model.dispose(); }
});

test("delete of a destructured prop is MEEK125, on the name, before any code is generated", () => {
  const script = (code: string, template = "<p></p>"): string => `<script lang="ts">\n${code}\n</script>\n<template>${template}</template>`;
  const cases = [
    // A plain props object: the parent's own object without defaults or emits.
    { source: script("const { x } = defineProps<{ x?: string }>();\nfunction f(): void { delete x; }"), at: "x; }" },
    // A reactive view: with defaults and emits.
    { source: script("const { x = \"d\" } = defineProps<{ x?: string }>();\nconst emit = defineEmits<{ pick: [] }>();\nfunction f(): void { emit(\"pick\"); delete (x); }"), at: "x); }" },
    { source: script("const { label: text } = defineProps<{ label?: string }>();", "<button on:click=\"() => delete text\">x</button>"), at: "text\">" },
  ];
  for (const item of cases) {
    const error = compileError(item.source);
    assert.equal(error.diagnostic.code, "MEEK125", error.message);
    assert.match(error.diagnostic.message, /es de sólo lectura: no se puede asignar ni borrar con delete/);
    assert.equal(error.diagnostic.location.offset, item.source.indexOf(item.at), `${item.at}: ${error.diagnostic.location.offset}`);
  }
});

test("delete of a local copy leaves the parent's props untouched in SSR, plain or reactive", async () => {
  const body = "function f(): string {\n  const local = { x };\n  delete local.x;\n  return `${x}:${\"x\" in local}`;\n}";
  const plain = `<script lang="ts">\nconst { x } = defineProps<{ x?: string }>();\n${body}\n</script>\n<template><p>{f()}</p></template>`;
  const reactive = `<script lang="ts">\nconst { x = "d" } = defineProps<{ x?: string }>();\nconst emit = defineEmits<{ pick: [] }>();\nvoid emit;\n${body}\n</script>\n<template><p>{f()}</p></template>`;
  const { modules, cleanup } = await load({ Plain: plain, Reactive: reactive });
  try {
    for (const name of ["Plain", "Reactive"]) {
      const input = { x: "parent" };
      assert.equal(modules[name]!.renderToString(input).replaceAll(/<!--.*?-->/g, "").replaceAll(/ data-meeko="\d+"/g, ""), "<p>parent:false</p>", name);
      assert.deepEqual(input, { x: "parent" }, name);
    }
  } finally {
    await cleanup();
  }
});
