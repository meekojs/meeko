import { Window } from "happy-dom";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createEmit } from "../src/app/runtime/emits.ts";
import { isReactiveProps, reactiveProps, withoutEventProps } from "../src/app/runtime/props.ts";
import { compileWithAutoImports } from "../src/autoimports/transform.ts";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/parser/sfc.ts";
import { generateTypes } from "../src/types.ts";

const child = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ id: number }>();
const emit = defineEmits<{ save: [id: number]; close: [] }>();
const clicks = signal(0);
function save(): void {
  clicks.value++;
  emit("save", props.id);
}
</script>
<template><button class="save" on:click="save">Save {props.id} ({clicks.value})</button><button class="close" on:click="() => emit('close')">Close</button></template>`;

const parent = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Child from "./Child.meeko";
const id = signal(1);
const saved = signal<number[]>([]);
const closed = signal(0);
function close(): void {
  closed.value++;
}
</script>
<template><section><Child bind:id="id.value" on:save="(value) => saved.value = [...saved.value, value]" on:close="close" /><p class="log">{saved.value.join(",")}|{closed.value}</p><button class="next" on:click="() => id.value++">Next</button><component is="Child" bind:id="100"></component></section></template>`;

interface RuntimeModule {
  renderToString(props: Record<string, never>): string;
  hydrate(root: Element, props: Record<string, never>): () => void;
}

/** Compiles the components against the source runtime, so the test does not depend on dist/. */
async function loadParent(): Promise<{ component: RuntimeModule; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "meeko-emits-"));
  const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  for (const [name, source] of [["Child", child], ["Parent", parent]] as const) {
    const code = compile(source, join(directory, `${name}.meeko`)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`)
      .replace(`from "./Child.meeko"`, `from "./Child.ts"`);
    await writeFile(join(directory, `${name}.ts`), code);
  }
  const component = await import(pathToFileURL(join(directory, "Parent.ts")).href) as RuntimeModule;
  return { component, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

/** Temporary project whose tsconfig points the package at src/, like a built consumer. */
async function typeProject(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const parentDirectory = resolve(".meeko");
  await mkdir(parentDirectory, { recursive: true });
  const root = await mkdtemp(join(parentDirectory, "emits-check-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      types: ["node"],
      paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] },
    },
  })}\n`);
  await writeFile(join(root, "Child.meeko"), child);
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function assertCompileError(source: string, code: string, offset: number): void {
  assert.throws(() => compile(source, "Emits.meeko"), (error: unknown) => {
    assert.ok(error instanceof MeekoCompileError, String(error));
    assert.equal(error.diagnostic.code, code, error.message);
    assert.equal(error.diagnostic.location.offset, offset, error.message);
    return true;
  });
}

test("defineEmits compiles to optional callback props and a typed emit", () => {
  const { code } = compile(child, "Child.meeko");
  assert.match(code, /type __MeekoEmits = __meeko\.Emits<\{ save: \[id: number\]; close: \[\] \}>;/);
  assert.match(code, /type __MeekoComponentProps = __MeekoDeclaredProps & __MeekoEmitProps;/);
  assert.match(code, /export type \{ __MeekoComponentProps as ComponentProps \};/);
  assert.match(code, /const emit: __meeko\.Emit<__MeekoEmits> = __meeko\.createEmit<__MeekoEmits, __meeko\.NoEmitConflict<__MeekoDeclaredProps, __MeekoEmits>>\(__props\);/);
  assert.doesNotMatch(code, /defineEmits/);

  const alone = compile(`<script lang="ts">const emit = defineEmits<{ ready: [] }>();</script><template><button on:click="() => emit('ready')">x</button></template>`, "Alone.meeko").code;
  assert.match(alone, /type __MeekoComponentProps = __MeekoEmitProps;/);
  assert.match(alone, /function __setup\(__props: __MeekoComponentProps\)/);
  assert.match(alone, /__meeko\.createEmit<__MeekoEmits>\(__props\)/);

  const defaults = compile(`<script lang="ts">const props = defineProps<{ id?: number }>({ id: 1 });\nconst emit = defineEmits<{ save: [id: number] }>();</script><template><button on:click="() => emit('save', props.id)">x</button></template>`, "Defaults.meeko").code;
  assert.match(defaults, /type __MeekoComponentProps = __MeekoInputPropsOf<__MeekoDeclaredProps> & __MeekoEmitProps;/);
  assert.match(defaults, /function __setup\(__props: __MeekoResolvedProps & __MeekoEmitProps\)/);
});

test("on:event on a component passes the callback prop like bind:onEvent", () => {
  const { code } = compile(parent, "Parent.meeko");
  // One tag call checks the props and handlers; the event names go apart, to reject unknown ones.
  assert.match(code, /__meeko\.renderComponent<any>\(0, Child, __meeko\.componentTag\(\(\) => Child\)\(\{ "id": id\.value, "onSave": \(value\) => saved\.value = \[\.\.\.saved\.value, value\], "onClose": close \}, \{ "onSave": true, "onClose": true \}, __meeko\.noChannels, __meeko\.noChannels\), __meeko_transfer\)/);
  assert.match(code, /__meeko\.bindComponent<any>\(__scope, 0, \(\) => \(Child\), \(\) => \(__meeko\.componentTag\(\(\) => \(Child\)\)\(\{ "id": id\.value, "onSave": .*"onClose": close \}, \{ "onSave": true, "onClose": true \}/);
  assert.doesNotMatch(code, /checkComponentEvents/);
  // `<component is>` without on: passes no event names.
  assert.match(code, /__meeko\.componentTag\(\(\) => Child\)\(\{ "id": 100 \}, __meeko\.noChannels, __meeko\.noChannels, __meeko\.noChannels\)/);
});

test("defineEmits and component events report MEEK045 to MEEK048", () => {
  const script = (body: string): string => `<script lang="ts">\n${body}\n</script><template><p>x</p></template>`;
  const twice = script(`const a = defineEmits<{ x: [] }>();\nconst b = defineEmits<{ y: [] }>();`);
  assertCompileError(twice, "MEEK045", twice.lastIndexOf("defineEmits"));
  const mutable = script(`let emit = defineEmits<{ x: [] }>();`);
  assertCompileError(mutable, "MEEK045", mutable.indexOf("defineEmits"));
  const destructured = script(`const { x } = defineEmits<{ x: [] }>();`);
  assertCompileError(destructured, "MEEK045", destructured.indexOf("defineEmits"));
  const nested = script(`function setup() { return defineEmits<{ x: [] }>(); }`);
  assertCompileError(nested, "MEEK045", nested.indexOf("defineEmits"));
  const expression = script(`const emit = [defineEmits<{ x: [] }>()];`);
  assertCompileError(expression, "MEEK045", expression.indexOf("defineEmits"));
  const untyped = script(`const emit = defineEmits();`);
  assertCompileError(untyped, "MEEK046", untyped.indexOf("defineEmits"));
  const runtime = script(`const emit = defineEmits<{ x: [] }>(["x"]);`);
  assertCompileError(runtime, "MEEK047", runtime.indexOf(`["x"]`));

  const component = (attributes: string): string => `<script lang="ts">const Child = 1;\nconst f = () => {};</script>\n<template><component is="Child" ${attributes}></component></template>`;
  const both = component(`on:save="f" bind:onSave="f"`);
  assertCompileError(both, "MEEK048", both.indexOf("bind:onSave"));
  const reversed = component(`bind:onSave="f" on:save="f"`);
  assertCompileError(reversed, "MEEK048", reversed.indexOf("on:save"));
  const invalid = component(`on:save-item="f"`);
  assertCompileError(invalid, "MEEK011", invalid.indexOf("on:save-item"));
});

test("props leave the callbacks of the declared events out of their keys, since 1.8", () => {
  // The script spells the events: a type literal, a local interface or a local type alias.
  const wrapped = /const props = __meeko\.withoutEventProps\(__props, \["onSave","onClose"\]\) as Readonly</;
  assert.match(compile(child, "Child.meeko").code, wrapped);
  const local = (declaration: string, emits: string): string => `<script lang="ts">
${declaration}
const props = defineProps<{ id: number }>();
const emit = defineEmits<${emits}>();
</script><template><button on:click="() => emit('save', props.id)">x</button></template>`;
  assert.match(compile(local("interface Events { save: [id: number]; \"close\": [] }", "Events"), "Local.meeko").code, wrapped);
  assert.match(compile(local("type Events = { save: [id: number]; close: [] };", "Events"), "Alias.meeko").code, wrapped);
  // A type from elsewhere cannot be listed: every `onX` key leaves the keys, read at run time.
  for (const [declaration, emits] of [["import type { Events } from './events';", "Events"], ["interface Base { close: [] }\ninterface Events extends Base { save: [id: number] }", "Events"], ["", "Record<'save', [id: number]>"]] as const) {
    assert.match(compile(local(declaration, emits), "Other.meeko").code, /const props = __meeko\.withoutEventProps\(__props, null\) as Readonly</, declaration || emits);
  }
  // Without defineEmits nothing changes.
  assert.match(compile(`<script lang="ts">const props = defineProps<{ id: number }>();</script><template>{props.id}</template>`, "Plain.meeko").code, /const props = __props as Readonly</);
});

test("withoutEventProps hides the callbacks from keys, in and rest, keeps reads and reactive views", () => {
  const onSave = (): void => {};
  for (const input of [{ id: 1, "aria-label": "x", onSave }, reactiveProps({ id: 1, "aria-label": "x", onSave }).props]) {
    const props = withoutEventProps(input, ["onSave", "onClose"]) as Record<string, unknown>;
    assert.deepEqual(Object.keys(props), ["id", "aria-label"]);
    assert.equal("onSave" in props, false);
    const { id, ...rest } = props;
    assert.equal(id, 1);
    assert.deepEqual(rest, { "aria-label": "x" });
    assert.deepEqual({ ...props }, { id: 1, "aria-label": "x" });
    // A read still reaches the callback, and the view is read-only like the props.
    assert.equal(props["onSave"], onSave);
    assert.throws(() => { props["id"] = 2; }, /read-only/);
    assert.equal(isReactiveProps(props), isReactiveProps(input));
  }
  const plain = { id: 1 };
  assert.equal(withoutEventProps(plain, []), plain);
});

const forwarding = `<script lang="ts">
import { computed } from "@meekojs/meeko";
import type { ElementAttributes } from "@meekojs/meeko";
const props = defineProps<{ label: string } & ElementAttributes<"button">>();
const emit = defineEmits<{ press: [label: string] }>();
const attributes = computed(() => {
  const { label, ...rest } = props;
  return rest;
});
</script>
<template><button class="forward" bind="attributes.value" on:click="() => emit('press', props.label)">{props.label}</button></template>`;

const forwardingParent = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Forward from "./Forward.meeko";
const busy = signal(false);
const pressed = signal<string[]>([]);
</script>
<template><section><Forward label="Guardar" aria-label="Guardar cambios" data-kind="primary" bind:aria-busy="busy.value" on:press="(label) => { pressed.value = [...pressed.value, label]; busy.value = !busy.value }" /><p class="pressed">{pressed.value.join(",")}</p></section></template>`;

test("aria-* and data-* props and a rest of props reach the element in SSR and hydration, without the event callbacks", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeko-emits-forward-"));
  const window = new Window();
  try {
    const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
    for (const [name, source] of [["Forward", forwarding], ["Parent", forwardingParent]] as const) {
      const code = compile(source, join(directory, `${name}.meeko`)).code
        .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
        .replaceAll(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`)
        .replace(`from "./Forward.meeko"`, `from "./Forward.ts"`);
      await writeFile(join(directory, `${name}.ts`), code);
    }
    const component = await import(pathToFileURL(join(directory, "Parent.ts")).href) as RuntimeModule;
    const root = window.document.createElement("main");
    const html = component.renderToString({});
    // Before 1.8 the rest carried onPress and bind threw MEEK113.
    assert.match(html, /<button class="forward" aria-label="Guardar cambios" data-kind="primary" data-meeko="\d+"><!--meeko:text:\d+-->Guardar</);
    root.innerHTML = html;
    const button = root.querySelector("button.forward")!;
    const release = component.hydrate(root as unknown as Element, {});
    assert.equal(root.querySelector("button.forward"), button, "hydration keeps the SSR button");
    (button as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelector(".pressed")?.textContent, "Guardar");
    assert.equal(button.getAttribute("aria-busy"), "true");
    assert.equal(button.getAttribute("onpress"), null);
    (button as unknown as HTMLButtonElement).click();
    assert.equal(button.getAttribute("aria-busy"), null);
    release();
  } finally {
    window.happyDOM.abort();
    await rm(directory, { recursive: true, force: true });
  }
});

test("emit calls the current parent callback, propagates errors and ignores a missing one", () => {
  const props: Record<string, unknown> = {};
  const emit = createEmit<{ save: [id: number]; fail: [] }>(props);
  assert.doesNotThrow(() => emit("save", 1));
  const calls: number[] = [];
  props["onSave"] = (id: number) => calls.push(id);
  emit("save", 2);
  props["onSave"] = (id: number) => calls.push(id * 10);
  emit("save", 3);
  assert.deepEqual(calls, [2, 30]);
  props["onFail"] = () => { throw new Error("parent failed"); };
  assert.throws(() => emit("fail"), /parent failed/);
  props["onFail"] = "not a function";
  assert.throws(() => emit("fail"), /onFail prop to be a function/);
  const result = Promise.resolve("async");
  props["onSave"] = () => result;
  assert.equal((emit as unknown as (name: string, id: number) => unknown)("save", 1), result);
});

test("SSR and hydration run the parent handler through emit and follow prop updates", async () => {
  const { component, cleanup } = await loadParent();
  const window = new Window();
  try {
    const root = window.document.createElement("main");
    root.innerHTML = component.renderToString({});
    const log = (): string | undefined => root.querySelector(".log")?.textContent ?? undefined;
    assert.equal(log(), "|0");
    assert.equal(root.querySelectorAll("button.save").length, 2);
    const hydrated = root.querySelector("button.save");
    const release = component.hydrate(root as unknown as Element, {});
    const buttons = (): HTMLButtonElement[] => [...root.querySelectorAll("button.save")] as unknown as HTMLButtonElement[];
    // An inline on:save handler is a new function on each read; hydration keeps the SSR child.
    assert.equal(root.querySelector("button.save"), hydrated);
    buttons()[0]!.click();
    (root.querySelector("button.close") as unknown as HTMLButtonElement).click();
    assert.equal(log(), "1|1");
    (root.querySelector("button.next") as unknown as HTMLButtonElement).click();
    assert.match(buttons()[0]!.textContent ?? "", /Save 2/);
    buttons()[0]!.click();
    assert.equal(log(), "1,2|1");
    // A child without on:save emits into nothing.
    buttons()[1]!.click();
    assert.equal(log(), "1,2|1");
    assert.match(buttons()[1]!.textContent ?? "", /Save 100 \(1\)/);
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("meeko check types emit calls, on:event handlers and callback conflicts", { timeout: 60_000 }, async () => {
  const { root, cleanup } = await typeProject();
  const cases = [
    { name: "ValidChild", source: child, codes: [] as string[] },
    { name: "ValidParent", source: parent, codes: [] },
    { name: "WrongArgument", source: `<script lang="ts">\nconst emit = defineEmits<{ save: [id: number] }>();\nfunction go(): void { emit("save", "x"); }\n</script><template><button on:click="go">x</button></template>`, codes: ["TS2345"], at: `"x"` },
    { name: "UnknownEvent", source: `<script lang="ts">\nconst emit = defineEmits<{ save: [id: number]; close: [] }>();\nfunction go(): void { emit("nope"); }\n</script><template><button on:click="go">x</button></template>`, codes: ["TS2345"], at: `"nope"` },
    { name: "NotTuple", source: `<script lang="ts">\nconst emit = defineEmits<{ save: number }>();\n</script><template><p>{typeof emit}</p></template>`, codes: ["TS2344"], at: "{ save: number }" },
    { name: "Conflict", source: `<script lang="ts">\nconst props = defineProps<{ onSave: () => void }>();\nconst emit = defineEmits<{ save: [] }>();\n</script><template><button on:click="() => emit('save')">{typeof props}</button></template>`, codes: ["TS2344"], at: "{ save: [] }" },
    { name: "WrongHandler", source: `<script lang="ts">\nimport * as Child from "./Child.meeko";\nfunction save(id: string): void { void id; }\n</script><template><component is="Child" bind:id="7" on:save="save"></component></template>`, codes: ["TS2322"], at: "on:save" },
    { name: "UnknownHandler", source: `<script lang="ts">\nimport * as Child from "./Child.meeko";\n</script><template><Child bind:id="7" on:nope="() => {}" /></template>`, codes: ["TS2353"], at: "on:nope" },
  ];
  try {
    for (const item of cases) {
      const diagnostics = await checkSource(item.source, join(root, `${item.name}.meeko`));
      const messages = JSON.stringify(diagnostics);
      const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
      if (item.codes.length === 0) assert.deepEqual([...codes], [], `${item.name}: ${messages}`);
      for (const code of item.codes) assert.ok(codes.has(code), `${item.name}: ${messages}`);
      if (item.at) {
        assert.ok(diagnostics.every((diagnostic) => !diagnostic.message.startsWith("TypeScript generado")), messages);
        assert.ok(diagnostics.some((diagnostic) => diagnostic.location.offset === item.source.indexOf(item.at!)), `${item.name}: ${messages}`);
      }
    }
    const [declaration] = await generateTypes(parent, join(root, "Parent.meeko"));
    const childDeclaration = (await readFile(join(root, ".meeko", "types", "Child.d.meeko.ts"), "utf8"));
    assert.ok(declaration);
    assert.match(childDeclaration, /type __MeekoComponentProps = __MeekoDeclaredProps & __MeekoEmitProps;/);
    assert.match(childDeclaration, /export type \{ __MeekoComponentProps as ComponentProps \};/);
    assert.match(childDeclaration, /type __MeekoEmitProps = __meeko\.EmitProps<__MeekoEmits>;/);
  } finally {
    await cleanup();
  }
});

test("autoimported components work as PascalCase tags with props and events", { timeout: 60_000 }, async () => {
  const { root, cleanup } = await typeProject();
  try {
    await mkdir(join(root, "app", "components", "forms"), { recursive: true });
    await mkdir(join(root, "app", "pages"), { recursive: true });
    await writeFile(join(root, "app", "components", "forms", "save-button.meeko"), child);
    const page = `<script lang="ts">\nconst saved: number[] = [];\n</script><template><FormsSaveButton bind:id="1" on:save="(id) => saved.push(id)" /><p>{saved.length}</p></template>`;
    const filename = join(root, "app", "pages", "index.meeko");
    const compiled = await compileWithAutoImports(page, filename);
    assert.match(compiled.code, /import \* as FormsSaveButton from "\.\.\/components\/forms\/save-button\.meeko";/);
    assert.deepEqual(await checkSource(page, filename), []);
    const wrong = page.replace("(id) => saved.push(id)", "(id: string) => saved.push(Number(id))");
    assert.ok((await checkSource(wrong, filename)).some((diagnostic) => diagnostic.code === "TS2322"));
  } finally {
    await cleanup();
  }
});
