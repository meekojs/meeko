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
import { createEditorModel } from "../src/language-server/model.ts";

// A composable whose signals the component destructures, beside a signal of its own.
const source = `<script lang="ts">
import { signal } from "@meekojs/meeko";
function useToasts() {
  const toasts = signal<string[]>(["saved"]);
  return { toasts, dismiss: (index: number): void => { toasts.value = toasts.value.filter((_, position) => position !== index); } };
}
function pair(): [number, string, boolean, boolean] {
  return [1, "one", true, false];
}
const own = signal(3);
const { toasts, dismiss: remove } = useToasts();
const { missing = "fallback", ...others } = { size: 2, color: "red" } as { missing?: string; size: number; color: string };
let [count, , ...flags] = pair();
</script>
<template>
  <p each:of="toasts.value" each:as="toast" each:index="index"><span>{toast}</span><button on:click="() => remove(index)">x</button></p>
  <b>{missing}:{others.size}:{others.color}:{count}:{flags.length}:{own.value}</b>
</template>`;

/** A project folder whose components resolve the package from `src`, like the other check tests. */
async function checkProject(): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "destructuring-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { types: ["node"], paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] } } })}\n`);
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

function compileError(input: string): MeekoCompileError {
  try {
    compile(input, "Destructuring.meeko");
  } catch (error) {
    assert.ok(error instanceof MeekoCompileError, String(error));
    return error;
  }
  assert.fail("compile did not fail");
}

test("top-level destructuring declares setup bindings for the template and the type checker", async () => {
  const { root, cleanup } = await checkProject();
  try {
    assert.deepEqual(await checkSource(source, join(root, "Destructuring.meeko")), []);
    // The names are typed: a wrong use is reported where the template uses it.
    const wrong = source.replace("{others.color}", "{others.colour}");
    const diagnostics = await checkSource(wrong, join(root, "Wrong.meeko"));
    assert.ok(diagnostics.some((item) => item.code === "TS2551" && item.location.offset === wrong.indexOf("colour")), JSON.stringify(diagnostics));
  } finally {
    await cleanup();
  }
  const model = createEditorModel(source, resolve("examples/regions/Destructuring.meeko"));
  try {
    assert.deepEqual(model.service.getSemanticDiagnostics(model.virtualFilename).map((item) => item.messageText), []);
  } finally { model.dispose(); }
});

test("destructured bindings render, hydrate and stay out of state snapshots", async () => {
  const directory = await mkdtemp(join(tmpdir(), "meeko-destructuring-"));
  const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  const window = new Window();
  try {
    const code = compile(source, join(directory, "Destructuring.meeko")).code
      .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
      .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`);
    await writeFile(join(directory, "Destructuring.ts"), code);
    const component = await import(pathToFileURL(join(directory, "Destructuring.ts")).href) as {
      renderWithState(props: Record<string, never>): { html: string; state: Record<string, unknown> };
      hydrate(root: Element, props: Record<string, never>, state?: Record<string, unknown>): () => void;
    };
    const rendered = component.renderWithState({});
    // `own` is the component's state; `toasts` belongs to the composable that returned it.
    assert.deepEqual(rendered.state, { own: 3 });
    const root = window.document.createElement("main");
    root.innerHTML = rendered.html;
    assert.equal(root.querySelector("b")?.textContent, "fallback:2:red:1:2:3");
    assert.deepEqual([...root.querySelectorAll("span")].map((span) => span.textContent), ["saved"]);
    const release = component.hydrate(root as unknown as Element, {}, rendered.state);
    (root.querySelector("button") as unknown as HTMLButtonElement).click();
    assert.equal(root.querySelectorAll("span").length, 0);
    release();
  } finally {
    await window.happyDOM.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("destructuring a macro or an element ref is a clear compile error", () => {
  const cases: Array<{ script: string; code: string; at: string; message: RegExp }> = [
    { script: "const { title } = defineProps<{ title: string }>();", code: "MEEK015", at: "{ title }", message: /defineProps no admite desestructuración/ },
    { script: "const [first] = defineEmits<{ save: [] }>();", code: "MEEK045", at: "defineEmits", message: /nombre simple/ },
    { script: "const { value } = defineModel<string>();", code: "MEEK063", at: "defineModel", message: /nombre simple/ },
    { script: "const { title } = defineSnippets<{ title: [] }>();", code: "MEEK059", at: "defineSnippets", message: /nombre simple/ },
    { script: "const { value } = useElementRef(\"box\");", code: "MEEK015", at: "{ value }", message: /useElementRef no admite desestructuración/ },
  ];
  for (const item of cases) {
    const input = `<script lang="ts">${item.script}</script><template><div ref:box></div></template>`;
    const error = compileError(input);
    assert.equal(error.diagnostic.code, item.code, error.message);
    assert.equal(error.diagnostic.location.offset, input.indexOf(item.at), error.message);
    assert.match(error.diagnostic.message, item.message);
  }
});

test("the result of a data await may be destructured; the render still waits for it", () => {
  const input = `<script lang="ts">
const { data, refresh } = await useApi("/api/users");
</script>
<template><button on:click="refresh">{data.value.length}</button></template>`;
  const { code } = compile(input, "Users.meeko");
  assert.match(code, /const \{ data, refresh \} = __meeko\.awaitData\(useApi\("\/api\/users"\)\);/);
  assert.match(code, /export const hasDataAwait: boolean = true;/);
  // The resource owns its signals: the component marks them as borrowed.
  assert.match(code, /for \(const __meeko_value of \[data, refresh\]\) __meeko_borrowed\.add\(__meeko_value\);/);
  assert.match(code, /\[__meeko\.borrowedKey\]: __meeko_borrowed/);
});

test("destructuring after the first browser await declares browser-only names", () => {
  const input = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const shown = signal(0);
const box = await useElementRef("box");
const { width, height } = box.getBoundingClientRect();
shown.value = width + height;
</script>
<template><div ref:box>{shown.value}</div></template>`;
  assert.match(compile(input, "Late.meeko").code, /const \{ width, height \} = box\.getBoundingClientRect\(\);/);
  // The template only sees the bindings declared before that await (MEEK057).
  const error = compileError(input.replace("{shown.value}", "{width}"));
  assert.equal(error.diagnostic.code, "MEEK057");
});
