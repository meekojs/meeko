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
import type { ComponentModule, ComponentRelease } from "../src/dom.ts";

interface RuntimeModule extends ComponentModule<Record<string, unknown>> {
  renderToString(props: Record<string, unknown>): string;
  hydrate(root: Element, props: Record<string, unknown>): () => void;
  hydrateScope: (scope: { root: Element }, props: Record<string, unknown>) => ComponentRelease;
}

/** Compiles the components against the source runtime, so the test does not depend on dist/. */
async function load(sources: Record<string, string>): Promise<{ modules: Record<string, RuntimeModule>; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "meeko-refs-"));
  const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  for (const [name, source] of Object.entries(sources)) {
    const code = compile(source, join(directory, `${name}.meeko`)).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko/framework"`, `from ${runtime("src/framework.ts")}`)
      .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`)
      .replaceAll(/from "\.\/(\w+)\.meeko"/g, `from "./$1.ts"`);
    await writeFile(join(directory, `${name}.ts`), code);
  }
  const modules: Record<string, RuntimeModule> = {};
  for (const name of Object.keys(sources)) modules[name] = await import(pathToFileURL(join(directory, `${name}.ts`)).href) as RuntimeModule;
  return { modules, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function assertCompileError(source: string, code: string, offset: number): void {
  assert.throws(() => compile(source, "Refs.meeko"), (error: unknown) => {
    assert.ok(error instanceof MeekoCompileError, String(error));
    assert.equal(error.diagnostic.code, code, error.message);
    assert.equal(error.diagnostic.location.offset, offset, error.message);
    return true;
  });
}

const flush = async (): Promise<void> => {
  for (let index = 0; index < 5; index++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function click(root: { querySelector(selector: string): unknown }, selector: string): void {
  (root.querySelector(selector) as HTMLButtonElement).click();
}

const child = `<script lang="ts">
const props = defineProps<{ label: string }>();
defineExpose({ label: props.label, shout: () => props.label.toUpperCase() });
</script>
<template><b>{props.label}</b></template>`;

const refs = `<script lang="ts">
import { onMounted, signal } from "@meekojs/meeko";
import * as Child from "./Child.meeko";
const props = defineProps<{ log: string[] }>();
const show = signal(false);
const rows = signal(["a", "b"]);
const field = useElementRef("field");
const box = useElementRef("box");
const items = useElementRef("item");
const child = useElementRef("child");
onMounted(() => {
  props.log.push(\`mounted:\${field.value?.tagName}:\${String(box.value)}:\${items.value.length}:\${child.value?.shout()}\`);
});
</script>
<template><section><input ref:field value="x"><div if:when="show.value"><p ref:box>box</p></div><ul><li each:of="rows.value" each:as="row" ref:item>{row}</li></ul><Child ref:child bind:label="'kid'" /><button class="toggle" on:click="() => show.value = !show.value">t</button><button class="add" on:click="() => rows.value = [...rows.value, 'c']">a</button></section></template>`;

test("useElementRef reads refs: null in SSR, elements, lists and exposed values once hydrated", async () => {
  const { modules, cleanup } = await load({ Child: child, Refs: refs });
  const window = new Window();
  try {
    const log: string[] = [];
    const root = window.document.createElement("main");
    root.innerHTML = modules["Refs"]!.renderToString({ log });
    assert.match(root.innerHTML, /<input data-meeko-r-0="" value="x">/);
    const release = modules["Refs"]!.hydrate(root as unknown as Element, { log });
    assert.deepEqual(log.splice(0), ["mounted:INPUT:null:2:KID"]);
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

const continuation = `<script lang="ts">
import { effect, onCleanup, signal } from "@meekojs/meeko";
const props = defineProps<{ log: string[] }>();
const show = signal(false);
const count = signal(0);
props.log.push("setup");
const box = await useElementRef("box");
props.log.push(\`box:\${box.textContent}\`);
effect(() => { props.log.push(\`count:\${count.value}\`); });
onCleanup(() => props.log.push("cleanup"));
</script>
<template><div if:when="show.value"><p ref:box>{count.value}</p></div><button class="toggle" on:click="() => show.value = !show.value">t</button><button class="bump" on:click="() => count.value++">b</button></template>`;

test("await useElementRef continues in the browser once an if: shows the element, and the continuation is released with the component", async () => {
  const { modules, cleanup } = await load({ Continuation: continuation });
  const window = new Window();
  try {
    const log: string[] = [];
    const html = modules["Continuation"]!.renderToString({ log });
    assert.deepEqual(log.splice(0), ["setup"], "SSR stops before the browser await");
    const root = window.document.createElement("main");
    root.innerHTML = html;
    const release = modules["Continuation"]!.hydrate(root as unknown as Element, { log });
    await flush();
    assert.deepEqual(log.splice(0), ["setup"], "the element is hidden, so the continuation waits");
    click(root, "button.toggle");
    await flush();
    assert.deepEqual(log.splice(0), ["box:0", "count:0"]);
    click(root, "button.bump");
    assert.deepEqual(log.splice(0), ["count:1"], "an effect of the continuation belongs to the component");
    release();
    assert.deepEqual(log.splice(0), ["cleanup"]);
    click(root, "button.bump");
    assert.deepEqual(log, [], "the released effect no longer runs");
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("a component released while its continuation waits never resumes it", async () => {
  const { modules, cleanup } = await load({ Continuation: continuation });
  const window = new Window();
  try {
    const log: string[] = [];
    const root = window.document.createElement("main");
    root.innerHTML = modules["Continuation"]!.renderToString({ log });
    const release = modules["Continuation"]!.hydrate(root as unknown as Element, { log });
    release();
    log.splice(0);
    click(root, "button.toggle");
    await flush();
    assert.deepEqual(log, []);
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

const socketPage = (composable: "useSocketClient" | "useSocket") => `<script lang="ts">
import { ${composable} } from "@meekojs/meeko/framework";
const props = defineProps<{ log: string[]; contract: { clientToServer: {}; serverToClient: {} }; factory: (url: string) => WebSocket }>();
const plain = ${composable}("ws://example.test/a", props.contract, { webSocketFactory: props.factory });
props.log.push(\`plain:\${plain.state.value}\`);
const socket = await ${composable}("ws://example.test/b", props.contract, { webSocketFactory: props.factory });
props.log.push(\`open:\${socket.state.value}\`);
</script>
<template><p>socket</p></template>`;

// `useSocket` is the deprecated framework alias of `useSocketClient` and must keep working in 1.x.
for (const composable of ["useSocketClient", "useSocket"] as const) test(`await ${composable} continues once the socket is open; ${composable} without await is unchanged`, async () => {
  const { modules, cleanup } = await load({ Socket: socketPage(composable) });
  const window = new Window();
  const sockets: EventTarget[] = [];
  const factory = (): WebSocket => {
    const socket = new EventTarget() as EventTarget & { close(): void; readyState: number };
    socket.readyState = 0;
    socket.close = () => {};
    sockets.push(socket);
    return socket as unknown as WebSocket;
  };
  const globals = globalThis as { window?: unknown };
  globals.window = window;
  try {
    const log: string[] = [];
    const root = window.document.createElement("main");
    root.innerHTML = "<p>socket</p>";
    const release = modules["Socket"]!.hydrate(root as unknown as Element, { log, contract: { clientToServer: {}, serverToClient: {} }, factory });
    await flush();
    assert.deepEqual(log.splice(0), ["plain:connecting"]);
    assert.equal(sockets.length, 2);
    sockets[1]!.dispatchEvent(new Event("open"));
    await flush();
    assert.deepEqual(log.splice(0), ["open:open"]);
    release();
  } finally {
    delete globals.window;
    window.happyDOM.abort();
    await cleanup();
  }
});

test("composable rules: MEEK054 to MEEK058", () => {
  const script = (body: string, template = "<p ref:field>x</p><li each:of=\"[1]\" each:as=\"row\" ref:row>{row}</li>"): string =>
    `<script lang="ts">\n${body}\n</script><template>${template}</template>`;
  const nested = script(`function later() { return useElementRef("field"); }`);
  assertCompileError(nested, "MEEK054", nested.indexOf("useElementRef"));
  const nestedApi = script(`const load = () => useApi("/api/x");`);
  assertCompileError(nestedApi, "MEEK054", nestedApi.indexOf("useApi"));
  const awaitFetch = script(`const value = await fetch("/x");`);
  assertCompileError(awaitFetch, "MEEK055", awaitFetch.indexOf("await"));
  const awaitMutation = script(`const save = await useRpcMutation("notes.save");`);
  assertCompileError(awaitMutation, "MEEK055", awaitMutation.indexOf("await"));
  const partial = script(`const value = (await useApi("/api/x")).data;`);
  assertCompileError(partial, "MEEK055", partial.indexOf("await"));
  const dynamic = script(`const name = "field";\nconst value = useElementRef(name);`);
  assertCompileError(dynamic, "MEEK056", dynamic.lastIndexOf("name)"));
  const unknown = script(`const value = useElementRef("missing");`);
  assertCompileError(unknown, "MEEK056", unknown.indexOf("\"missing\""));
  const list = script(`const rows = await useElementRef("row");`);
  assertCompileError(list, "MEEK056", list.indexOf("\"row\""));
  const late = script(`const field = await useElementRef("field");\nconst label = "late";`, "<p ref:field>{label}</p>");
  assertCompileError(late, "MEEK057", late.lastIndexOf("label"));
  const lateFunction = script(`const field = await useElementRef("field");\nfunction send() {}`, "<p ref:field><button on:click=\"send\">x</button></p>");
  assertCompileError(lateFunction, "MEEK057", lateFunction.lastIndexOf("send"));
  const lateMacro = script(`const field = await useElementRef("field");\ndefineExpose({ field });`);
  assertCompileError(lateMacro, "MEEK058", lateMacro.indexOf("defineExpose"));
  // Nested async code keeps its own awaits; existing composables keep working in nested code.
  assert.doesNotThrow(() => compile(script(`async function save() { await fetch("/x"); }\nconst stop = () => useState("x", () => 1);`), "Ok.meeko"));
});

const statements = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ log: string[] }>();
const status = signal("idle");
const box = await useElementRef("box");
status.value = "ready";
props.log.push(box.tagName);
if (box.textContent === "x") props.log.push("if");
else props.log.push("else");
for (const n of [1, 2]) props.log.push(\`n\${n}\`);
let tries = 0;
while (tries < 2) tries++;
try { JSON.parse("{"); } catch { props.log.push(\`caught:\${tries}\`); }
switch (status.value) { case "ready": props.log.push("switch"); break; }
{ const inner = 1; props.log.push(\`block:\${inner}\`); }
</script>
<template><p ref:box>x</p><span>{status.value}</span></template>`;

test("after the first browser await the continuation runs assignments, calls and control flow", async () => {
  const { modules, cleanup } = await load({ Statements: statements });
  const window = new Window();
  try {
    const log: string[] = [];
    const root = window.document.createElement("main");
    root.innerHTML = modules["Statements"]!.renderToString({ log });
    assert.equal(root.querySelector("span")?.textContent, "idle");
    const release = modules["Statements"]!.hydrate(root as unknown as Element, { log });
    await flush();
    assert.deepEqual(log, ["P", "if", "n1", "n2", "caught:2", "switch", "block:1"]);
    assert.equal(root.querySelector("span")?.textContent, "ready");
    release();
  } finally {
    window.happyDOM.abort();
    await cleanup();
  }
});

test("the continuation keeps composables unconditional and rejects other statements", () => {
  const script = (body: string): string => `<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nconst status = signal("");\n${body}\n</script><template><p ref:field>x</p><i ref:other>y</i></template>`;
  const head = `const field = await useElementRef("field");\n`;
  const conditional = script(`${head}if (status.value) { const other = useElementRef("other"); }`);
  assertCompileError(conditional, "MEEK054", conditional.indexOf("useElementRef(\"other\")"));
  const loop = script(`${head}for (const n of [1]) useApi("/api/x");`);
  assertCompileError(loop, "MEEK054", loop.indexOf("useApi"));
  const awaited = script(`${head}if (status.value) { await useElementRef("other"); }`);
  assertCompileError(awaited, "MEEK055", awaited.indexOf("await useElementRef(\"other\")"));
  const macro = script(`${head}const value = defineModel<string>({ default: "" });`);
  assertCompileError(macro, "MEEK058", macro.indexOf("const value"));
  const klass = script(`${head}class Later {}`);
  assertCompileError(klass, "MEEK018", klass.indexOf("class"));
  // Before the browser await the setup keeps its rules: a bare assignment is not a declaration.
  const early = script(`status.value = "x";\n${head}`);
  assertCompileError(early, "MEEK018", early.indexOf("status.value = "));
  assert.doesNotThrow(() => compile(script(`${head}status.value = "y";\nconst other = useElementRef("other");`), "Ok.meeko"));
});

test("meeko check types useElementRef from ref: and narrows it after await", { timeout: 90_000 }, async () => {
  const parentDirectory = resolve(".meeko");
  await mkdir(parentDirectory, { recursive: true });
  const root = await mkdtemp(join(parentDirectory, "refs-check-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      types: ["node"],
      paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] },
    },
  })}\n`);
  await writeFile(join(root, "Child.meeko"), child);
  const template = `<template><input ref:field><svg><circle ref:dot /></svg><li each:of="[1]" each:as="row" ref:row>{row}</li><Child ref:kid bind:label="'k'" />`;
  const head = `<script lang="ts">\nimport * as Child from "./Child.meeko";\n`;
  const cases = [
    { name: "Typed", source: `${head}const field = useElementRef("field");\nconst value: string | undefined = field.value?.value;\nconst dot = useElementRef("dot");\nconst radius: SVGAnimatedLength | undefined = dot.value?.r;\nconst rows = useElementRef("row");\nconst count: number = rows.value.length;\nconst kid = useElementRef("kid");\nconst shout: string | undefined = kid.value?.shout();\nconst input = await useElementRef("field");\nconst text: string = input.value;\nconst kidNow = await useElementRef("kid");\nconst label: string = kidNow.label;\n</script>${template}<p>{value}{String(radius)}{count}{shout}</p></template>`, codes: [] as string[] },
    { name: "Nullable", source: `${head}const field = useElementRef("field");\nconst value: string = field.value.value;\n</script>${template}</template>`, codes: ["TS18047"], at: "field.value.value" },
    { name: "Continuation", source: statements, codes: [] },
    { name: "WrongElement", source: `${head}const input = await useElementRef("field");\nconst nope: number = input.value;\n</script>${template}</template>`, codes: ["TS2322"], at: "nope" },
  ];
  try {
    for (const item of cases) {
      const diagnostics = await checkSource(item.source, join(root, `${item.name}.meeko`));
      const messages = JSON.stringify(diagnostics);
      const codes = new Set(diagnostics.map((diagnostic) => diagnostic.code));
      if (item.codes.length === 0) assert.deepEqual([...codes], [], `${item.name}: ${messages}`);
      for (const code of item.codes) assert.ok(codes.has(code), `${item.name}: ${messages}`);
      if (item.at) assert.ok(diagnostics.some((diagnostic) => diagnostic.location.offset === item.source.indexOf(item.at!)), `${item.name}: ${messages}`);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
