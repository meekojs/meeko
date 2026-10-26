import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { Window } from "happy-dom";
import * as prettier from "prettier";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/sfc.ts";
import { assertRouteBlockPlacement } from "../src/framework/route-block.ts";
import plugin from "../src/prettier.ts";
import { generateTypes } from "../src/types.ts";

const execFileAsync = promisify(execFile);

const dataTable = `<script lang="ts" generic="T extends { id: string }">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ rows: T[]; selected?: T }>();
const emit = defineEmits<{ select: [row: T] }>();
const snippets = defineSnippets<{ row: [row: T] }>();
const current = defineModel<T | null>("current");
const clicks = signal(0);
function choose(row: T): void {
  clicks.value++;
  current.value = row;
  emit("select", row);
}
defineExpose({ first: (): T | undefined => props.rows[0], clicks: (): number => clicks.value });
</script>
<template><ul><li each:of="props.rows" each:key="row.id" each:as="row" on:click="() => choose(row)"><render snippet="snippets.row" args="row" /></li></ul><p class="current">{current.value?.id ?? "none"}</p></template>`;

/** A second generic component: two parameters, one of them a key of the other, and no snippets. */
const picker = `<script lang="ts" generic="T extends object, K extends keyof T">
const props = defineProps<{ items: T[]; field: K }>();
const emit = defineEmits<{ pick: [value: T[K]] }>();
</script>
<template><ol><li each:of="props.items" each:as="item" on:click="() => emit('pick', item[props.field])">{String(item[props.field])}</li></ol></template>`;

const users = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as DataTable from "./DataTable.meeko";
import * as Picker from "./Picker.meeko";
interface User { id: string; email: string }
const users = signal<User[]>([{ id: "a", email: "a@x.dev" }, { id: "b", email: "b@x.dev" }]);
const picked = signal<User | null>(null);
const log = signal<string[]>([]);
const table = useElementRef("table");
function firstEmail(): string {
  return table.value?.first()?.email ?? "-";
}
</script>
<template><main><DataTable ref:table bind:rows="users.value" on:select="(u) => log.value = [...log.value, u.email]" model:current="picked"><snippet name="row" params="user"><span class="email">{user.email}</span></snippet></DataTable><component is="Picker" bind:items="users.value" bind:field="'email'" on:pick="(value) => log.value = [...log.value, value.toUpperCase()]"></component><p class="log">{log.value.join(",")}</p><p class="picked">{picked.value?.email ?? ""}</p><button type="button" class="add" on:click="() => users.value = [...users.value, { id: 'c', email: 'c@x.dev' }]">+</button><button type="button" class="first" on:click="() => log.value = [...log.value, firstEmail()]">f</button></main></template>`;

const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);

interface RuntimeModule {
  renderWithState(props: Record<string, never>): { html: string; state: Record<string, unknown> };
  hydrate(root: Element, props: Record<string, never>, state?: Record<string, unknown>): () => void;
}

/** Compiles the components inside the repository against the source runtime. */
async function load(components: Record<string, string>, entry: string): Promise<{ component: RuntimeModule; cleanup: () => Promise<void> }> {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "generics-test-"));
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

/** Temporary project whose tsconfig points the package at src/, like a built consumer. */
async function typeProject(files: Record<string, string>): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const parentDirectory = resolve(".meeko");
  await mkdir(parentDirectory, { recursive: true });
  const root = await mkdtemp(join(parentDirectory, "generics-check-"));
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
  assert.throws(() => compile(source, "Generic.meeko"), (error: unknown) => {
    assert.ok(error instanceof MeekoCompileError, String(error));
    assert.equal(error.diagnostic.code, code, error.message);
    assert.equal(error.diagnostic.location.offset, offset, error.message);
    return true;
  });
}

test("generic gives the compiled module generic types and functions", () => {
  const { code } = compile(dataTable, "DataTable.meeko");
  const parameters = "T extends { id: string }";
  assert.ok(code.includes(`export type ComponentProps<${parameters}> = __MeekoDeclaredProps<T> & __MeekoEmitProps<T>;`), code);
  assert.ok(code.includes(`type __MeekoEmits<${parameters}> = __meeko.Emits<{ select: [row: T] }>;`));
  assert.ok(code.includes(`export type ComponentModels<${parameters}> = { "current": __meeko.Signal<__MeekoModels<T>["current"]> };`));
  assert.ok(code.includes(`export type ComponentSnippets<${parameters}> = __meeko.SnippetMap<__MeekoSnippets<T>>;`));
  assert.ok(code.includes(`export type ComponentExposed<${parameters}> = ReturnType<typeof __setup<T>>[typeof __meeko.exposedKey];`));
  assert.ok(code.includes(`function __setup<${parameters}>(__props: ComponentProps<T>)`));
  assert.ok(code.includes(`export function renderWithState<${parameters}>(__inputProps: ComponentProps<T>)`));
  assert.ok(code.includes(`export function renderToString<${parameters}>(__inputProps: ComponentProps<T>, __state?: __meeko.HotState): string`));
  assert.ok(code.includes(`export function hydrate<${parameters}>(root: Element, __inputProps: ComponentProps<T>, __state?: __meeko.HotState): () => void`));
  assert.ok(code.includes(`export function hydrateScope<${parameters}>(__scope: __meeko.DomScope, __inputProps: ComponentProps<T>, __state?: __meeko.HotState): __meeko.ComponentRelease<ComponentExposed<T>>`));
  assert.ok(code.includes("return hydrateScope<T>(__scope, __inputProps, __state);"));
  assert.ok(code.includes("() => __setup<T>(__inputProps)"));
  // The tag check that a parent calls: T comes from the props, the rest only uses it.
  assert.ok(code.includes(`export declare const __meekoTag: <${parameters}>(props: ComponentProps<T> & __meeko.ExtraProps, events: NoInfer<__meeko.EventNames<ComponentProps<T>>>, models: NoInfer<ComponentModels<T>>, snippets: NoInfer<ComponentSnippets<T>>) => __meeko.TagInput<ComponentExposed<T>>;`));
  assert.ok(code.includes(`declare function __meeko_channels<${parameters}>(): { readonly models: ComponentModels<T>; readonly snippets: ComponentSnippets<T> };`));
  // Inside the setup, the macros use the parameters of __setup.
  assert.match(code, /const current: __meeko\.Signal<__MeekoModels<T>\["current"\]> = __meeko\.useModel<__MeekoModels<T>\["current"\]>/);
  assert.match(code, /const emit: __meeko\.Emit<__MeekoEmits<T>> = __meeko\.createEmit<__MeekoEmits<T>, __meeko\.NoEmitConflict<__MeekoDeclaredProps<T>, __MeekoEmits<T>>>\(__props\);/);

  // Defaults keep their helpers' own parameters apart from the component's.
  const defaults = compile(`<script lang="ts" generic="T, K extends string = 'id'">\nconst props = defineProps<{ value: T; key?: K; label?: string }>({ label: "x" });\n</script><template><p>{props.label}{String(props.value)}</p></template>`, "Defaults.meeko").code;
  assert.ok(defaults.includes("type __MeekoResolvedPropsOf<__P, T, K extends string = 'id'> = __P extends unknown ? Omit<__P, __MeekoDefaultKeys<T, K>> & __MeekoDefaultValues<T, K> : never;"), defaults);
  assert.ok(defaults.includes("export type ComponentProps<T, K extends string = 'id'> = __MeekoInputPropsOf<__MeekoDeclaredProps<T, K>, T, K>;"));
  assert.ok(defaults.includes("const defaults = __meeko_defaultProps<T, K>();"));

  // Without generic the module is the non-generic one, plus its tag check.
  const plain = compile(`<script lang="ts">const props = defineProps<{ id: number }>();</script><template><p>{props.id}</p></template>`, "Plain.meeko").code;
  assert.match(plain, /export type ComponentProps = \{ id: number \};/);
  assert.match(plain, /export function renderToString\(__inputProps: ComponentProps, __state\?: __meeko\.HotState\): string/);
  assert.match(plain, /export declare const __meekoTag: \(props: ComponentProps & __meeko\.ExtraProps, events: NoInfer<__meeko\.EventNames<ComponentProps>>, models: __meeko\.NoModels, snippets: __meeko\.NoSnippets\) => __meeko\.TagInput<ComponentExposed>;/);
  assert.match(plain, /export declare const __meekoChannels: \{ readonly models: ComponentModels; readonly snippets: ComponentSnippets \};/);
});

test("a component tag is one generic call; a component ref reuses it for its exposed type", () => {
  const { code } = compile(users, "Users.meeko");
  assert.match(code, /__meeko\.renderComponent<any>\(0, DataTable, __meeko\.componentTag\(\(\) => DataTable\)\(\{ "rows": users\.value, "onSelect": \(u\) => log\.value = \[\.\.\.log\.value, u\.email\] \}, \{ "onSelect": true \}, \{ "current": picked \}, \{ "row": __meeko\.snippet\(\(user\) => /);
  assert.match(code, /__meeko\.bindComponent<any>\(__scope, 0, \(\) => \(DataTable\), \(\) => \(__meeko\.componentTag\(\(\) => \(DataTable\)\)\(/);
  assert.match(code, /type __MeekoRefs = \{ "table": __meeko\.TagExposed<ReturnType<typeof __meeko_exposed_0>> \};/);
  assert.match(code, /const __meeko_exposed_0 = \(\) => __meeko\.componentTag\(\(\) => DataTable\)\(\{ "rows": users\.value, "onSelect": \(u\) => log\.value = \[\.\.\.log\.value, u\.email\] \}, null!, null!, null!\);/);
  assert.doesNotMatch(code, /checkComponent(?:Events|Models|Snippets)|SnippetArgs/);
});

test("generic reports MEEK100 for an invalid list, a page and types that use its parameters", () => {
  const component = (attribute: string, script = "const x = 1;"): string => `<script lang="ts" ${attribute}>\n${script}\n</script><template><p>{x}</p></template>`;
  const empty = component(`generic=""`);
  assertCompileError(empty, "MEEK100", empty.indexOf(`""`) + 1);
  const syntax = component(`generic="T extends"`);
  assertCompileError(syntax, "MEEK100", syntax.indexOf(`T extends"`) + "T extends".length);
  const early = component(`generic="T> = string; type X<U"`);
  assertCompileError(early, "MEEK100", early.indexOf("T>"));
  const modifier = component(`generic="const T"`);
  assertCompileError(modifier, "MEEK100", modifier.indexOf("const T"));
  const reserved = component(`generic="__T"`);
  assertCompileError(reserved, "MEEK100", reserved.indexOf("__T"));
  const repeated = component(`generic="T, U, T"`);
  assertCompileError(repeated, "MEEK100", repeated.lastIndexOf("T\""));
  const single = component(`generic='T extends "a" | "b"'`);
  assert.doesNotThrow(() => compile(single, "Generic.meeko"));
  // The script's type declarations move to module level, where T does not exist.
  const hoisted = component(`generic="T"`, "interface Row { value: T }\nconst x = 1;");
  assertCompileError(hoisted, "MEEK100", hoisted.indexOf("T }"));
  const exported = component(`generic="T"`, "export type Rows = Array<T>;\nconst x = 1;");
  assertCompileError(exported, "MEEK100", exported.indexOf("T>;"));
  // A declaration with its own parameter of the same name, or a mapped key, is fine.
  const own = component(`generic="T"`, "type Rows<T> = T[];\ntype Keys<O> = { [T in keyof O]: T };\nconst props = defineProps<{ rows: Rows<T> }>();\nconst x = props.rows.length;");
  assert.doesNotThrow(() => compile(own, "Generic.meeko"));
  // Only the component's own <script>, and never a page, which Meeko gives its props.
  const server = `<script server lang="ts" generic="T">\nexport const data = 1;\n</script><script lang="ts">\nconst x = data;\n</script><template><p>{x}</p></template>`;
  assertCompileError(server, "MEEK100", server.indexOf("generic"));
  const page = `<script server lang="ts">\nexport const data = 1;\n</script><script lang="ts" generic="T">\nconst x = data;\n</script><template><p>{x}</p></template>`;
  assertCompileError(page, "MEEK100", page.indexOf("generic"));
  // Pages, layouts, app.meeko and error pages of the framework neither.
  const root = resolve("project");
  for (const file of ["app/pages/index.meeko", "app/pages/+layout.meeko", "app/layouts/main.meeko", "app/app.meeko", "app/error.meeko"]) {
    assert.throws(() => assertRouteBlockPlacement(component(`generic="T"`), join(root, file), [root]), (error: unknown) =>
      error instanceof MeekoCompileError && error.diagnostic.code === "MEEK100" && error.diagnostic.location.offset === component(`generic="T"`).indexOf("generic"), file);
  }
  assert.doesNotThrow(() => assertRouteBlockPlacement(component(`generic="T"`), join(root, "app/components/table.meeko"), [root]));
});

test("meeko check infers T from the props for on:, models, snippets and refs", { timeout: 120_000 }, async () => {
  const { root, cleanup } = await typeProject({ "DataTable.meeko": dataTable, "Picker.meeko": picker });
  const variant = (from: string, to: string): string => {
    assert.ok(users.includes(from), from);
    return users.replace(from, to);
  };
  const cases = [
    { name: "ValidChild", source: dataTable, codes: [] as string[] },
    { name: "ValidPicker", source: picker, codes: [] },
    { name: "ValidParent", source: users, codes: [] },
    { name: "Handler", source: variant("u.email]", "u.nope]"), codes: ["TS2339"], at: "nope]", message: /'nope' does not exist on type 'User'/ },
    { name: "Snippet", source: variant("{user.email}", "{user.nope}"), codes: ["TS2339"], at: "nope}", message: /'nope' does not exist on type 'User'/ },
    { name: "Model", source: variant("signal<User | null>(null)", "signal<number | null>(null)"), codes: ["TS2322"], at: "model:current", message: /Signal<number \| null>' is not assignable to type 'Signal<User \| null>'/ },
    { name: "Constraint", source: variant(`signal<User[]>([{ id: "a", email: "a@x.dev" }, { id: "b", email: "b@x.dev" }])`, "signal<{ name: string }[]>([])"), codes: ["TS2322"], at: `rows="users.value"`, message: /not assignable to type '\{ id: string; \}\[\]'/ },
    { name: "UnknownEvent", source: variant("on:select=", "on:nope="), codes: ["TS2353"], at: "on:nope" },
    { name: "WrongHandler", source: variant("(u) => log.value", "(u: { id: number }) => log.value"), codes: ["TS2322"], at: "on:select", message: /\(row: User\) => void/ },
    { name: "MissingSnippet", source: variant(`<snippet name="row" params="user"><span class="email">{user.email}</span></snippet>`, ""), codes: ["TS2741"], at: "<DataTable", message: /SnippetMap<\{ row: \[row: User\]; \}>/ },
    { name: "Ref", source: variant("first()?.email", "first()?.nope"), codes: ["TS2339"], at: "nope ??", message: /'nope' does not exist on type 'User'/ },
    { name: "PickerKey", source: variant(`bind:field="'email'"`, `bind:field="'name'"`), codes: ["TS2322"], at: `field="'name'"`, message: /'"name"' is not assignable to type 'keyof User'/ },
    { name: "PickerValue", source: variant("value.toUpperCase()", "value.toExponential()"), codes: ["TS2339"], at: "toExponential", message: /on type 'string'/ },
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
        const at = item.source.indexOf(item.at);
        const found = diagnostics.find((diagnostic) => diagnostic.location.offset === at && item.codes.includes(diagnostic.code));
        assert.ok(found, `${item.name}: ${messages}`);
        if (item.message) assert.match(found.message, item.message, item.name);
      }
    }
  } finally {
    await cleanup();
  }
});

/** A generic child whose T comes from a static prop, beside a prop with a literal union type. */
const chip = `<script lang="ts" generic="T extends string">
const props = defineProps<{ value: T; tone: "info" | "warn"; options?: readonly T[] }>();
const emit = defineEmits<{ change: [value: T] }>();
defineExpose({ value: (): T => props.value });
</script>
<template><button type="button" on:click="() => emit('change', props.value)">{props.value}:{props.tone}</button></template>`;

test("a generic tag infers T and checks its props exactly: unknown props fail and static literals keep their type", { timeout: 120_000 }, async () => {
  const { root, cleanup } = await typeProject({ "Chip.meeko": chip });
  const parent = (tag: string): string => `<script lang="ts">
import * as Chip from "./Chip.meeko";
const chip = useElementRef("chip");
function read(): "draft" | undefined { return chip.value?.value(); }
</script>
<template><p>{read()}</p>${tag}</template>`;
  // T is the literal of the static prop "draft": the handler and the ref read it, not `string`.
  const valid = `<Chip ref:chip value="draft" tone="warn" on:change="(v) => { const draft: 'draft' = v; void draft; }" />`;
  const cases: Array<{ name: string; tag: string; code?: string; at?: string; message?: RegExp }> = [
    { name: "Valid", tag: valid },
    { name: "UnknownStatic", tag: valid.replace(`tone="warn"`, `tone="warn" label="x"`), code: "TS2353", at: "label=", message: /'"label"' does not exist/ },
    { name: "UnknownBesideKnown", tag: valid.replace(`tone="warn"`, `tone="warn" bind:label="'x'"`), code: "TS2353", at: "label=", message: /'"label"' does not exist/ },
    { name: "UnknownEvent", tag: valid.replace("on:change=", "on:nope="), code: "TS2353", at: "on:nope", message: /'"onNope"' does not exist/ },
    { name: "WrongStaticLiteral", tag: valid.replace(`tone="warn"`, `tone="tertiary"`), code: "TS2322", at: `tone="tertiary"`, message: /'"tertiary"' is not assignable to type '"info" \| "warn"'/ },
    { name: "InferredT", tag: valid.replace("const draft: 'draft'", "const draft: 'other'"), code: "TS2322", at: "draft: 'other'", message: /'"draft"' is not assignable to type '"other"'/ },
  ];
  try {
    for (const item of cases) {
      const source = parent(item.tag);
      const diagnostics = await checkSource(source, join(root, `${item.name}.meeko`));
      const messages = JSON.stringify(diagnostics);
      if (!item.code) {
        assert.deepEqual(diagnostics, [], `${item.name}: ${messages}`);
        continue;
      }
      // One diagnostic on the attribute, although the tag check is in several render paths.
      assert.equal(diagnostics.length, 1, `${item.name}: ${messages}`);
      const [found] = diagnostics;
      assert.equal(found!.code, item.code, `${item.name}: ${messages}`);
      assert.equal(found!.location.offset, source.indexOf(item.at!, source.indexOf("<template>")), `${item.name}: ${messages}`);
      assert.match(found!.message, item.message!, item.name);
    }
  } finally {
    await cleanup();
  }
});

test("a generic component renders, hydrates, emits and exposes like any other", async () => {
  const { component, cleanup } = await load({ DataTable: dataTable, Picker: picker, Users: users }, "Users");
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    const rendered = component.renderWithState({});
    root.innerHTML = rendered.html;
    const text = (selector: string): string => (root.querySelector(selector)?.textContent ?? "").trim();
    const emails = (): string[] => [...root.querySelectorAll(".email")].map((element) => element.textContent ?? "");
    assert.deepEqual(emails(), ["a@x.dev", "b@x.dev"]);
    assert.equal(text(".current"), "none");
    assert.deepEqual([...root.querySelectorAll("ol li")].map((element) => element.textContent), ["a@x.dev", "b@x.dev"]);
    const release = component.hydrate(root as unknown as Element, {}, rendered.state);
    // on:select, the model and the snippet of the generic child.
    (root.querySelectorAll("ul li")[1] as unknown as HTMLElement).click();
    assert.equal(text(".log"), "b@x.dev");
    assert.equal(text(".picked"), "b@x.dev");
    assert.equal(text(".current"), "b");
    (root.querySelector("button.add") as unknown as HTMLButtonElement).click();
    assert.deepEqual(emails(), ["a@x.dev", "b@x.dev", "c@x.dev"]);
    // The second generic child, through <component is>.
    (root.querySelectorAll("ol li")[2] as unknown as HTMLElement).click();
    assert.equal(text(".log"), "b@x.dev,C@X.DEV");
    // The ref reads the exposed value of the generic child.
    (root.querySelector("button.first") as unknown as HTMLButtonElement).click();
    assert.equal(text(".log"), "b@x.dev,C@X.DEV,a@x.dev");
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test(".d.meeko.ts keeps the type parameters for TypeScript consumers", { timeout: 120_000 }, async () => {
  const { root, cleanup } = await typeProject({ "DataTable.meeko": dataTable, "Picker.meeko": picker, "Users.meeko": users });
  try {
    await generateTypes(users, join(root, "Users.meeko"));
    const declaration = await readFile(join(root, ".meeko", "types", "DataTable.d.meeko.ts"), "utf8");
    assert.match(declaration, /export type ComponentProps<T extends \{\s*id: string;?\s*\}> = /);
    assert.match(declaration, /export declare function renderToString<T extends \{\s*id: string;?\s*\}>\(__inputProps: ComponentProps<T>/);
    assert.match(declaration, /export declare function hydrateScope<T extends \{\s*id: string;?\s*\}>\(__scope: __meeko\.DomScope, __inputProps: ComponentProps<T>.*\): __meeko\.ComponentRelease<ComponentExposed<T>>;/);
    assert.match(declaration, /export declare const __meekoTag: <T extends \{/);
    assert.match(declaration, /declare function __meeko_channels<T extends \{/);
    await writeFile(join(root, "consumer.ts"), `import type { ComponentExposed, ComponentProps } from "./DataTable.meeko";
interface User { id: string; email: string }
const props: ComponentProps<User> = { rows: [{ id: "1", email: "e" }], onSelect: (row) => { const email: string = row.email; void email; } };
declare const exposed: ComponentExposed<User>;
const first: User | undefined = exposed.first();
// @ts-expect-error number does not satisfy { id: string }.
type Wrong = ComponentProps<number>;
void props; void first;
export type { Wrong };
`);
    const config = join(root, "tsconfig.consumer.json");
    await writeFile(config, JSON.stringify({
      compilerOptions: {
        noEmit: true, strict: true, skipLibCheck: true, module: "nodenext", moduleResolution: "nodenext", target: "es2022",
        allowArbitraryExtensions: true, types: ["node"], rootDirs: [root, join(root, ".meeko", "types")],
        paths: { "@meekojs/meeko/internal": [resolve("src/internal.ts")], "@meekojs/meeko": [resolve("src/index.ts")] },
      },
      files: [join(root, "consumer.ts")],
    }));
    await execFileAsync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", config]);
  } finally {
    await cleanup();
  }
});

test("Prettier keeps the generic attribute and formats the script", async () => {
  const source = `<script lang="ts"   generic="T extends Record<string, number>,K = keyof T">\nconst props=defineProps<{rows:T[];key:K}>()\n</script>\n<template><p>{props.rows.length}</p></template>\n`;
  const formatted = await prettier.format(source, { filepath: "Generic.meeko", plugins: [plugin] });
  assert.ok(formatted.startsWith(`<script lang="ts"   generic="T extends Record<string, number>,K = keyof T">\n`), formatted);
  assert.match(formatted, /const props = defineProps<\{ rows: T\[\]; key: K \}>\(\);/);
  assert.equal(await prettier.format(formatted, { filepath: "Generic.meeko", plugins: [plugin] }), formatted);
  assert.doesNotThrow(() => compile(formatted, "Generic.meeko"));
});
