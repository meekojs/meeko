import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import type { CompileOptions } from "../src/compiler.ts";
import { MeekoCompileError } from "../src/compiler/sfc.ts";
import { createTempProject, repositoryRoot } from "./helpers/temp-project.ts";

interface Props {
  initial: number;
  tags: string[];
  log: string[];
}

interface StatementsModule {
  renderToString(props: Props, state?: Record<string, unknown>): string;
  renderWithState(props: Props): { html: string; state: Record<string, unknown> };
  hydrate(root: Element, props: Props, state?: Record<string, unknown>): () => void;
}

/** Top-level expression and control-flow statements of the synchronous setup. */
const statements = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ initial: number; tags: string[]; log: string[] }>();
const count = signal(0);
const items = signal<string[]>([]);
let label: string | undefined;
count.value = props.initial;
label ??= "items";
items.value.push("first");
void props.log;
if (props.initial > 5) items.value = [...items.value, "big"];
else items.value = [...items.value, "small"];
for (const tag of props.tags) items.value = [...items.value, tag];
outer: for (const a of [1, 2]) {
  for (const b of [1, 2]) {
    if (b === 2) continue outer;
    props.log.push(\`pair:\${a}\${b}\`);
  }
}
switch (props.tags.length) {
  case 0:
    props.log.push("none");
    break;
  default:
    const first = props.tags[0];
    props.log.push(\`first:\${first}\`);
}
try { JSON.parse("{"); } catch { props.log.push("caught"); }
{ const double = count.value * 2; props.log.push(\`double:\${double}\`); }
;
function increment(): void {
  count.value++;
}
</script>
<template><p>{label}: {items.value.join(",")}</p><button on:click="increment">{count.value}</button></template>`;

const expectedLog = ["pair:11", "pair:21", "first:a", "caught", "double:14"];

/** Compiles the component against the source runtime, so the test does not depend on dist/. */
async function load(source: string, options: CompileOptions = {}): Promise<{ module: StatementsModule; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "meeko-statements-"));
  const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  const code = compile(source, join(directory, "Statements.meeko"), options).code
    .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
    .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`);
  await writeFile(join(directory, "Statements.ts"), code);
  const module = await import(pathToFileURL(join(directory, "Statements.ts")).href) as StatementsModule;
  return { module, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

function assertCompileError(source: string, code: string, offset: number, message?: RegExp): void {
  assert.throws(() => compile(source, "Statements.meeko"), (error: unknown) => {
    assert.ok(error instanceof MeekoCompileError, String(error));
    assert.equal(error.diagnostic.code, code, error.message);
    assert.equal(error.diagnostic.location.offset, offset, error.message);
    if (message) assert.match(error.message, message);
    return true;
  });
}

for (const hot of [false, true]) {
  test(`top-level assignments and control flow run in SSR and on hydration${hot ? " (hot)" : ""}`, async () => {
    const { module, cleanup } = await load(statements, { hot });
    const window = new Window();
    try {
      const serverLog: string[] = [];
      const rendered = module.renderWithState({ initial: 7, tags: ["a", "b"], log: serverLog });
      assert.deepEqual(serverLog, expectedLog);
      assert.equal(rendered.state["count"], 7);
      assert.deepEqual(rendered.state["items"], ["first", "big", "a", "b"]);
      assert.equal(module.renderToString({ initial: 7, tags: ["a", "b"], log: [] }), rendered.html);
      const root = window.document.createElement("main");
      root.innerHTML = rendered.html;
      assert.equal(root.querySelector("p")?.textContent, "items: first,big,a,b");
      assert.equal(root.querySelector("button")?.textContent, "7");
      // Hydration runs the same statements, then restores the transferred state over them.
      const clientLog: string[] = [];
      const release = module.hydrate(root as unknown as Element, { initial: 7, tags: ["a", "b"], log: clientLog }, rendered.state);
      assert.deepEqual(clientLog, expectedLog);
      assert.equal(root.querySelector("p")?.textContent, "items: first,big,a,b");
      assert.equal(root.querySelector("button")?.textContent, "7");
      (root.querySelector("button") as unknown as HTMLButtonElement).click();
      assert.equal(root.querySelector("button")?.textContent, "8");
      release();
      // A transferred state wins over the top-level write, as in a hot update.
      const restored = window.document.createElement("main");
      restored.innerHTML = module.renderToString({ initial: 7, tags: [], log: [] }, { count: 3 });
      assert.equal(restored.querySelector("button")?.textContent, "3");
      const releaseRestored = module.hydrate(restored as unknown as Element, { initial: 7, tags: [], log: [] }, { count: 3 });
      assert.equal(restored.querySelector("button")?.textContent, "3");
      assert.equal(restored.querySelector("p")?.textContent, "items: first,big");
      releaseRestored();
    } finally {
      window.happyDOM.abort();
      await cleanup();
    }
  });
}

test("the setup rejects exports, classes and jumps with precise diagnostics", () => {
  const script = (body: string): string => `<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nconst status = signal("");\n${body}\n</script><template><p ref:field>{status.value}</p></template>`;
  const rejected: Array<{ body: string; at: string; message: RegExp }> = [
    { body: "export const value = 1;", at: "export const", message: /sólo exporta tipos/ },
    { body: "export function save() {}", at: "export function", message: /sólo exporta tipos/ },
    { body: "export { status };", at: "export {", message: /sólo exporta tipos/ },
    { body: "export default status;", at: "export default", message: /sólo exporta tipos/ },
    { body: "class Store {}", at: "class", message: /ClassDeclaration; declara la clase en un módulo/ },
    { body: "enum Mode { A }", at: "enum", message: /EnumDeclaration/ },
    { body: "namespace Tools {}", at: "namespace", message: /ModuleDeclaration/ },
    { body: "return;", at: "return", message: /ReturnStatement/ },
    { body: "throw new Error(\"x\");", at: "throw", message: /ThrowStatement; un throw incondicional/ },
    { body: "break;", at: "break", message: /BreakStatement/ },
    { body: "label: function later() {}", at: "label:", message: /LabeledStatement/ },
  ];
  for (const item of rejected) {
    const source = script(item.body);
    assertCompileError(source, "MEEK018", source.indexOf(item.at), item.message);
  }
  // After the first browser await the continuation keeps the same rules.
  const late = script(`const field = await useElementRef("field");\nexport const value = 1;`);
  assertCompileError(late, "MEEK018", late.indexOf("export const"), /sólo exporta tipos/);
  const lateClass = script(`const field = await useElementRef("field");\nclass Later {}`);
  assertCompileError(lateClass, "MEEK018", lateClass.indexOf("class"), /tras el primer await de navegador: ClassDeclaration/);
  // Exported types stay allowed.
  assert.doesNotThrow(() => compile(script("export interface Props { title: string }\nexport type Mode = \"a\" | \"b\";"), "Types.meeko"));
});

test("the setup keeps composables unconditional and defineProps in its declaration", () => {
  const script = (body: string): string => `<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nconst status = signal("");\n${body}\n</script><template><p ref:field>{status.value}</p></template>`;
  const conditional = script(`if (status.value) { const field = useElementRef("field"); }`);
  assertCompileError(conditional, "MEEK054", conditional.indexOf("useElementRef"));
  const loop = script(`for (const n of [1]) useApi("/api/x");`);
  assertCompileError(loop, "MEEK054", loop.indexOf("useApi"));
  const block = script(`{ const query = useRpcQuery("notes.list"); }`);
  assertCompileError(block, "MEEK054", block.indexOf("useRpcQuery"));
  const awaited = script(`if (status.value) await useApi("/api/x");`);
  assertCompileError(awaited, "MEEK055", awaited.indexOf("await"));
  const assigned = script(`let notes;\nnotes = await useApi("/api/x");`);
  assertCompileError(assigned, "MEEK055", assigned.indexOf("await"));
  const bareProps = script(`defineProps<{ title: string }>();`);
  assertCompileError(bareProps, "MEEK016", bareProps.indexOf("defineProps"));
  const nestedProps = script(`if (status.value) { const props = defineProps<{ title: string }>(); }`);
  assertCompileError(nestedProps, "MEEK016", nestedProps.indexOf("defineProps"));
  const nestedExpose = script(`if (status.value) defineExpose({ status });`);
  assertCompileError(nestedExpose, "MEEK050", nestedExpose.indexOf("defineExpose"));
  // An assignment of a composable result is unconditional, like a declaration.
  assert.doesNotThrow(() => compile(script(`let field;\nfield = useElementRef("field");`), "Assigned.meeko"));
});

test("meeko check and the editor accept the new statements and report the rejected ones", { timeout: 90_000 }, async () => {
  const { root, remove } = await createTempProject("statements-check");
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({
    compilerOptions: {
      types: ["node"],
      paths: { "@meekojs/meeko/internal": [join(repositoryRoot, "src/internal.ts")], "@meekojs/meeko": [join(repositoryRoot, "src/index.ts")] },
    },
  })}\n`);
  try {
    const accepted = await checkSource(statements, join(root, "Statements.meeko"));
    assert.deepEqual(accepted, [], JSON.stringify(accepted));
    const writeType = statements.replace("count.value = props.initial;", "count.value = props.tags;");
    const typed = await checkSource(writeType, join(root, "WrongType.meeko"));
    assert.ok(typed.some((diagnostic) => diagnostic.code === "TS2322" && diagnostic.location.offset === writeType.indexOf("count.value = props.tags")), JSON.stringify(typed));
    const klass = statements.replace("function increment", "class Store {}\nfunction increment");
    const rejected = await checkSource(klass, join(root, "Rejected.meeko"));
    assert.deepEqual(rejected.map((diagnostic) => [diagnostic.code, diagnostic.location.offset]), [["MEEK018", klass.indexOf("class Store")]]);
  } finally {
    await remove();
  }
});
