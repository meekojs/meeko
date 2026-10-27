import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/sfc.ts";
import { bindComponent, renderComponent } from "../src/dom.ts";
import type { ComponentModule, ComponentRelease } from "../src/dom.ts";
import { onMounted } from "../src/lifecycle.ts";
import { createRoot } from "../src/reactivity.ts";
import { generateTypes } from "../src/types.ts";

const child = `<script lang="ts">
import { onMounted, signal } from "@meekojs/meeko";
const props = defineProps<{ name: string; log: string[] }>();
const count = signal(0);
function bump(): number {
  count.value++;
  return count.value;
}
defineExpose({ bump, count, name: props.name });
onMounted(() => {
  props.log.push(\`mounted:\${props.name}\`);
  return () => { props.log.push(\`cleanup:\${props.name}\`); };
});
</script>
<template><span class="child">{props.name}:{count.value}</span></template>`;

const parent = `<script lang="ts">
import { onMounted, signal } from "@meekojs/meeko";
import * as Child from "./Child.meeko";
const props = defineProps<{ log: string[] }>();
const show = signal(true);
const rows = signal(["a", "b"]);
onMounted(() => { props.log.push("mounted:parent"); });
</script>
<template><section><Child bind:name="'first'" bind:log="props.log" /><div if:when="show.value"><Child bind:name="'shown'" bind:log="props.log" /></div><ul><li each:of="rows.value" each:as="row" each:key="row"><Child bind:name="row" bind:log="props.log" /></li></ul><button class="toggle" on:click="() => show.value = !show.value">toggle</button><button class="add" on:click="() => rows.value = [...rows.value, 'c']">add</button><button class="drop" on:click="() => rows.value = rows.value.slice(1)">drop</button></section></template>`;

const faulty = `<script lang="ts">
import { onMounted, provideErrorHandler } from "@meekojs/meeko";
const props = defineProps<{ seen: string[] }>();
provideErrorHandler((error, source) => { props.seen.push(\`\${source}:\${(error as Error).message}\`); });
onMounted(() => { throw new Error("sync"); });
onMounted(async () => { throw new Error("async"); });
onMounted(() => { props.seen.push("after"); });
</script>
<template><p>faulty</p></template>`;

const list = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const items = signal(["a", "b", "c"]);
</script>
<template><ul><li each:of="items.value" each:as="item" class="row">{index}:{item}</li></ul><button class="replace" on:click="() => items.value = ['x', 'b']">replace</button><button class="grow" on:click="() => items.value = [...items.value, 'd']">grow</button></template>`;

interface RuntimeModule extends ComponentModule<Record<string, unknown>> {
  renderToString(props: Record<string, unknown>): string;
  hydrate(root: Element, props: Record<string, unknown>): () => void;
  hydrateScope: (scope: { root: Element }, props: Record<string, unknown>) => ComponentRelease;
}

/** Compiles the components against the source runtime, so the test does not depend on dist/. */
async function load(sources: Record<string, string>): Promise<{ modules: Record<string, RuntimeModule>; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "meeko-lifecycle-"));
  const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  for (const [name, source] of Object.entries(sources)) {
    const code = compile(source, join(directory, `${name}.meeko`)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`)
      .replaceAll(/from "\.\/(\w+)\.meeko"/g, `from "./$1.ts"`);
    await writeFile(join(directory, `${name}.ts`), code);
  }
  const modules: Record<string, RuntimeModule> = {};
  for (const name of Object.keys(sources)) modules[name] = await import(pathToFileURL(join(directory, `${name}.ts`)).href) as RuntimeModule;
  return { modules, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function assertCompileError(source: string, code: string, offset: number): void {
  assert.throws(() => compile(source, "Lifecycle.meeko"), (error: unknown) => {
    assert.ok(error instanceof MeekoCompileError, String(error));
    assert.equal(error.diagnostic.code, code, error.message);
    assert.equal(error.diagnostic.location.offset, offset, error.message);
    return true;
  });
}

function click(root: { querySelector(selector: string): unknown }, selector: string): void {
  (root.querySelector(selector) as HTMLButtonElement).click();
}

test("onMounted runs after hydration, children before their parent, never during SSR", async () => {
  const { modules, cleanup } = await load({ Child: child, Parent: parent });
  const window = new Window();
  try {
    const log: string[] = [];
    const root = window.document.createElement("main");
    root.innerHTML = modules["Parent"]!.renderToString({ log });
    assert.deepEqual(log, [], "SSR never runs onMounted");
    const release = modules["Parent"]!.hydrate(root as unknown as Element, { log });
    // A child finishes hydrating inside its parent's template, so it mounts first.
    assert.deepEqual(log.splice(0), ["mounted:first", "mounted:shown", "mounted:a", "mounted:b", "mounted:parent"]);

    click(root, "button.toggle");
    assert.deepEqual(log.splice(0), ["cleanup:shown"], "if: hiding releases the child");
    click(root, "button.toggle");
    assert.deepEqual(log.splice(0), ["mounted:shown"], "if: showing mounts a new instance");
    click(root, "button.add");
    assert.deepEqual(log.splice(0), ["mounted:c"], "each: mounts the added row only");
    click(root, "button.drop");
    assert.deepEqual(log.splice(0), ["cleanup:a"], "each: releases the removed row only");

    release();
    assert.deepEqual(log.sort(), ["cleanup:b", "cleanup:c", "cleanup:first", "cleanup:shown"]);
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("onMounted reports failures to the component observer with the mounted source", async () => {
  const { modules, cleanup } = await load({ Faulty: faulty });
  const window = new Window();
  try {
    const seen: string[] = [];
    const root = window.document.createElement("main");
    root.innerHTML = modules["Faulty"]!.renderToString({ seen });
    const release = modules["Faulty"]!.hydrate(root as unknown as Element, { seen });
    // A failure neither undoes the hydration nor skips the next callback.
    assert.deepEqual(seen, ["mounted:sync", "after"]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(seen, ["mounted:sync", "after", "mounted:async"]);
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("onMounted outside a component script throws and an HTML render ignores it", () => {
  assert.throws(() => onMounted(() => undefined), /while a component script runs/);
  assert.throws(() => createRoot(() => onMounted(() => undefined)), /while a component script runs/);
  const { code } = compile(child, "Child.meeko");
  assert.match(code, /const __bindings = __meeko\.collectMounted\(null, \(\) => __setup\(__inputProps\)\);\nconst \{ props, count, bump \}/);
  assert.match(code, /const __mounted: Array<\(\) => __meeko\.MountedResult> = \[\];\nconst __bindings = __meeko\.collectMounted\(__mounted, /);
  assert.match(code, /__meeko\.runMounted\(__mounted\);\nreturn __meeko\.withStateSnapshot\(/);
});

test("defineExpose returns its value from hydrateScope and through bindComponent", async () => {
  const { modules, cleanup } = await load({ Child: child, Plain: list });
  const window = new Window();
  try {
    const log: string[] = [];
    const Child = modules["Child"]!;
    const root = window.document.createElement("main");
    root.innerHTML = Child.renderToString({ name: "solo", log });
    const release = Child.hydrateScope({ root: root as unknown as Element }, { name: "solo", log });
    const exposed = release.exposed as { bump(): number; count: { value: number }; name: string };
    assert.equal(exposed.name, "solo");
    assert.equal(exposed.bump(), 1);
    assert.equal(root.querySelector(".child")?.textContent, "solo:1");
    release();

    const plain = modules["Plain"]!;
    const plainRoot = window.document.createElement("main");
    plainRoot.innerHTML = plain.renderToString({});
    const plainRelease = plain.hydrateScope({ root: plainRoot as unknown as Element }, {});
    assert.equal(plainRelease.exposed, null, "without defineExpose a component exposes null");
    plainRelease();

    const host = window.document.createElement("main");
    host.innerHTML = renderComponent(0, Child, { name: "nested", log });
    const seen: unknown[] = [];
    const stop = createRoot(() => bindComponent({ root: host as unknown as Element }, 0, Child, () => ({ name: "nested", log }), "test", (value) => seen.push(value)));
    assert.equal((seen[0] as { name: string }).name, "nested");
    stop();
    assert.equal(seen.at(-1), null, "the exposed value is cleared when the child is released");
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("defineExpose compiles to a symbol binding and reports MEEK050 and MEEK051", () => {
  const { code } = compile(child, "Child.meeko");
  assert.match(code, /const __meeko_exposed = __meeko\.defineExpose\(\{ bump, count, name: props\.name \}\);/);
  assert.match(code, /return \{ props, count, bump, \[__meeko\.exposedKey\]: __meeko_exposed \};/);
  assert.match(code, /export type ComponentExposed = ReturnType<typeof __setup>\[typeof __meeko\.exposedKey\];/);
  assert.match(code, /: __meeko\.ComponentRelease<ComponentExposed> \{/);
  assert.doesNotMatch(code, /(?<!__meeko\.)defineExpose/);
  assert.match(compile(list, "List.meeko").code, /export type ComponentExposed = null;/);

  const script = (body: string): string => `<script lang="ts">\n${body}\n</script><template><p>x</p></template>`;
  const twice = script("defineExpose({ a: 1 });\ndefineExpose({ b: 2 });");
  assertCompileError(twice, "MEEK050", twice.lastIndexOf("defineExpose"));
  const nested = script("function setup(): void { defineExpose({ a: 1 }); }");
  assertCompileError(nested, "MEEK050", nested.indexOf("defineExpose"));
  const assigned = script("const exposed = defineExpose({ a: 1 });");
  assertCompileError(assigned, "MEEK050", assigned.indexOf("defineExpose"));
  const empty = script("defineExpose();");
  assertCompileError(empty, "MEEK051", empty.indexOf("defineExpose"));
  const extra = script("defineExpose({ a: 1 }, 2);");
  assertCompileError(extra, "MEEK051", extra.indexOf("2)"));
});

test("SSR renders defineExpose components without running onMounted", async () => {
  const { modules, cleanup } = await load({ Child: child });
  try {
    const log: string[] = [];
    const Child = modules["Child"]! as RuntimeModule & { renderWithState(props: Record<string, unknown>): { html: string } };
    const text = (html: string): string => html.replaceAll(/<!--.*?-->/g, "");
    assert.match(text(Child.renderWithState({ name: "server", log }).html), /server:0/);
    assert.match(text(Child.renderToString({ name: "server", log })), /server:0/);
    assert.deepEqual(log, []);
  } finally {
    await cleanup();
  }
});

test("each:of without each:key updates rows in place by index", async () => {
  const { modules, cleanup } = await load({ List: list });
  const window = new Window();
  try {
    const component = modules["List"]!;
    const root = window.document.createElement("main");
    root.innerHTML = component.renderToString({});
    const rows = (): Element[] => [...root.querySelectorAll("li.row")] as unknown as Element[];
    const texts = (): string[] => rows().map((row) => row.textContent ?? "");
    assert.deepEqual(texts(), ["0:a", "1:b", "2:c"]);
    const release = component.hydrate(root as unknown as Element, {});
    const [first, second] = rows();

    click(root, "button.replace");
    assert.deepEqual(texts(), ["0:x", "1:b"], "row 0 receives the new item 0 and the last row is removed");
    assert.equal(rows()[0], first, "row 0 keeps its node");
    assert.equal(rows()[1], second, "row 1 keeps its node");

    click(root, "button.grow");
    assert.deepEqual(texts(), ["0:x", "1:b", "2:d"]);
    assert.equal(rows()[0], first);
    assert.equal(rows()[1], second);
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("ref:name names a template target and is validated", () => {
  const template = (body: string): string => `<script lang="ts">
const Child = 1;
const items = [1];
</script><template>${body}</template>`;
  const element = compile(template(`<input ref:field class="x">`), "Ref.meeko").code;
  // One `data-meeko` number per element, after its own attributes.
  assert.match(element, /"<input" \+ " class=\\"x\\"" \+ " data-meeko=\\"0\\""/);
  assert.doesNotMatch(element, /ref:/);

  const duplicate = template(`<p ref:same></p><span ref:same></span>`);
  assertCompileError(duplicate, "MEEK053", duplicate.lastIndexOf("same"));
  const twiceInRow = template(`<li each:of="items" each:as="item"><b ref:cell></b><i ref:cell></i></li>`);
  assertCompileError(twiceInRow, "MEEK053", twiceInRow.lastIndexOf("cell"));
  // One ref inside each:of names every row's element.
  assert.doesNotThrow(() => compile(template(`<li each:of="items" each:as="item" ref:rows>{item}</li>`), "Rows.meeko"));
  assert.doesNotThrow(() => compile(template(`<Child ref:child />`), "ChildRef.meeko"));

  const valued = template(`<p ref:name="x"></p>`);
  assertCompileError(valued, "MEEK052", valued.indexOf("ref:"));
  const twice = template(`<p ref:one ref:two></p>`);
  assertCompileError(twice, "MEEK052", twice.indexOf("ref:two"));
  const invalid = template(`<p ref:not-valid></p>`);
  assertCompileError(invalid, "MEEK052", invalid.indexOf("ref:"));
  const onTemplate = template(`<template ref:group><p>x</p></template>`);
  assertCompileError(onTemplate, "MEEK052", onTemplate.indexOf("ref:"));
});

test("ref=\"x\" and bind:ref keep their 1.0 meaning: an HTML attribute and a component prop", () => {
  const plain = compile(`<script lang="ts">
const name = "dyn";
</script><template><p ref="field"></p><p bind:ref="name"></p></template>`, "Plain.meeko").code;
  assert.match(plain, /ref=\\"field\\"/);
  assert.match(plain, /__meeko\.renderAttribute\("ref"/);
  assert.doesNotMatch(plain, /bindElementRef/);
  const component = compile(`<script lang="ts">
import * as Child from "./Child.meeko";
const value = "x";
</script><template><Child bind:ref="value" /></template>`, "Parent.meeko").code;
  assert.match(component, /"ref": /);
  const unbound = `<script lang="ts">
import * as Child from "./Child.meeko";
</script><template><Child ref="x" /></template>`;
  assertCompileError(unbound, "MEEK032", unbound.indexOf("ref="));
});

/** Temporary project whose tsconfig points the package at src/, like a built consumer. */
async function typeProject(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const parentDirectory = resolve(".meeko");
  await mkdir(parentDirectory, { recursive: true });
  const root = await mkdtemp(join(parentDirectory, "lifecycle-check-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      types: ["node"],
      paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] },
    },
  })}\n`);
  await writeFile(join(root, "Child.meeko"), child);
  await writeFile(join(root, "Plain.meeko"), list);
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

test("meeko check types onMounted, defineExpose and lists without each:key", { timeout: 90_000 }, async () => {
  const { root, cleanup } = await typeProject();
  const exposedOf = `import type { ExposedOf } from "@meekojs/meeko/internal";\nimport * as Child from "./Child.meeko";\nimport * as Plain from "./Plain.meeko";\n`;
  const cases = [
    { name: "ValidChild", source: child, codes: [] as string[] },
    { name: "ValidParent", source: parent, codes: [] },
    { name: "ValidList", source: list, codes: [] },
    { name: "Exposed", source: `<script lang="ts">\n${exposedOf}const exposed = null as unknown as ExposedOf<typeof Child>;\nconst next: number = exposed.bump();\nconst name: string = exposed.name;\nconst none: null = null as unknown as ExposedOf<typeof Plain>;\n</script><template><p>{next}{name}{String(none)}</p></template>`, codes: [] },
    { name: "ExposedMissing", source: `<script lang="ts">\n${exposedOf}const exposed = null as unknown as ExposedOf<typeof Child>;\nconst value = exposed.missing;\n</script><template><p>{String(value)}</p></template>`, codes: ["TS2339"], at: "missing" },
    { name: "ExposeTyped", source: `<script lang="ts">\ndefineExpose<{ id: number }>({ id: "x" });\n</script><template><p>x</p></template>`, codes: ["TS2322"], at: "id: \"x\"" },
    { name: "AsyncMounted", source: `<script lang="ts">\nimport { onMounted } from "@meekojs/meeko";\nonMounted(async () => { await Promise.resolve(); });\nonMounted(() => () => undefined);\n</script><template><p>x</p></template>`, codes: [] },
    { name: "AsyncCleanup", source: `<script lang="ts">\nimport { onMounted } from "@meekojs/meeko";\nonMounted(async () => () => undefined);\n</script><template><p>x</p></template>`, codes: ["TS2322"] },
    { name: "UnkeyedRows", source: `<script lang="ts">\nconst rows = [{ id: 1 }];\n</script><template><p each:of="rows" each:as="row">{row.id}{row.missing}</p></template>`, codes: ["TS2339"], at: "missing" },
  ];
  try {
    for (const item of cases) {
      // Type errors only: MEEK101 warnings about props read once are covered by props-read-once.test.ts.
      const diagnostics = (await checkSource(item.source, join(root, `${item.name}.meeko`))).filter((diagnostic) => diagnostic.severity !== "warning");
      const messages = JSON.stringify(diagnostics);
      const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
      if (item.codes.length === 0) assert.deepEqual([...codes], [], `${item.name}: ${messages}`);
      for (const code of item.codes) assert.ok(codes.has(code), `${item.name}: ${messages}`);
      if (item.at) assert.ok(diagnostics.some((diagnostic) => diagnostic.location.offset === item.source.indexOf(item.at!)), `${item.name}: ${messages}`);
    }
    // The declaration of a component with defineExpose is generated instead of failing.
    const outputs = await generateTypes(child, join(root, "Child.meeko"));
    assert.equal(outputs.length, 1);
  } finally {
    await cleanup();
  }
});
