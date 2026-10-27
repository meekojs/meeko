import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import { Window } from "happy-dom";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { createEditorModel } from "../src/language-server/model.ts";

/** A project folder whose components resolve the package from `src`, like the other check tests. */
async function checkProject(files: Record<string, string>): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "optional-props-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { types: ["node"], paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] } } })}\n`);
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

// `error` is optional without a default, `label` optional with one, `name` required.
const field = `<script lang="ts">
const props = defineProps<{ name: string; error?: string; label?: string }>({ label: "Label" });
</script>
<template><p>{props.label}:{props.name}:{props.error ?? "none"}</p></template>`;

test("an optional prop accepts undefined from a binding; required and unknown props stay strict", { timeout: 120_000 }, async () => {
  const { root, cleanup } = await checkProject({ "Field.meeko": field });
  const head = `<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nimport * as Field from "./Field.meeko";\nconst failed = signal(false);\n</script>\n<template>`;
  const cases: Array<{ name: string; template: string; code?: string; at?: string }> = [
    { name: "Valid", template: `<Field name="a" bind:error="failed.value ? 'Required' : undefined" bind:label="undefined" /><component is="Field" name="b" bind:error="undefined"></component>` },
    { name: "Required", template: `<Field bind:name="failed.value ? 'a' : undefined" />`, code: "TS2322", at: "name=" },
    { name: "Unknown", template: `<Field name="a" bind:hint="undefined" />`, code: "TS2353", at: "hint=" },
    { name: "WrongType", template: `<Field name="a" bind:error="failed.value ? 1 : undefined" />`, code: "TS2322", at: "error=" },
  ];
  try {
    for (const item of cases) {
      const source = `${head}${item.template}</template>`;
      const diagnostics = await checkSource(source, join(root, `${item.name}.meeko`));
      const messages = JSON.stringify(diagnostics);
      if (!item.code) {
        assert.deepEqual(diagnostics, [], `${item.name}: ${messages}`);
        continue;
      }
      const offset = source.indexOf(item.at!, source.indexOf("<template>"));
      assert.ok(diagnostics.some((diagnostic) => diagnostic.code === item.code && diagnostic.location.offset === offset), `${item.name}: ${messages}`);
    }
  } finally {
    await cleanup();
  }
});

test("the editor accepts undefined for an optional prop of a component tag", () => {
  const parent = `<script lang="ts">
const Child = {} as import("@meekojs/meeko").Component<{ label: string; error?: string }>;
const failed = { value: false };
</script>
<template><Child bind:label="'x'" bind:error="failed.value ? 'Required' : undefined" /><Child bind:label="undefined" /><Child bind:label="'y'" bind:hint="undefined" /></template>`;
  const model = createEditorModel(parent, resolve("examples/regions/OptionalProps.meeko"));
  try {
    const diagnostics = model.service.getSemanticDiagnostics(model.virtualFilename);
    assert.deepEqual(diagnostics.map((item) => [item.code, model.toSource(item.start ?? -1)]).sort(), [
      [2322, parent.indexOf("label=\"undefined\"")],
      [2353, parent.indexOf("hint=")],
    ], JSON.stringify(diagnostics.map((item) => item.messageText)));
  } finally { model.dispose(); }
});

test("a child receives its default when the parent binds undefined, also after an update", async () => {
  const form = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as Field from "./Field.meeko";
const label = signal<string | undefined>(undefined);
</script>
<template><Field name="n" bind:label="label.value" /><button on:click="() => label.value = label.value === undefined ? 'Custom' : undefined">toggle</button></template>`;
  const directory = await mkdtemp(join(tmpdir(), "meeko-optional-"));
  const runtime = (path: string): string => JSON.stringify(pathToFileURL(resolve(path)).href);
  const window = new Window();
  try {
    for (const [name, source] of [["Field", field], ["Form", form]] as const) {
      const code = compile(source, join(directory, `${name}.meeko`)).code
        .replace(`from "@meekojs/meeko/internal"`, `from ${runtime("src/internal.ts")}`)
        .replace(`from "@meekojs/meeko"`, `from ${runtime("src/index.ts")}`)
        .replace(`from "./Field.meeko"`, `from "./Field.ts"`);
      await writeFile(join(directory, `${name}.ts`), code);
    }
    const component = await import(pathToFileURL(join(directory, "Form.ts")).href) as {
      renderToString(props: Record<string, never>): string;
      hydrate(root: Element, props: Record<string, never>): () => void;
    };
    const root = window.document.createElement("main");
    root.innerHTML = component.renderToString({});
    assert.equal(root.querySelector("p")?.textContent, "Label:n:none");
    const release = component.hydrate(root as unknown as Element, {});
    const toggle = (): void => (root.querySelector("button") as unknown as HTMLButtonElement).click();
    toggle();
    assert.equal(root.querySelector("p")?.textContent, "Custom:n:none");
    toggle();
    assert.equal(root.querySelector("p")?.textContent, "Label:n:none");
    release();
  } finally {
    await window.happyDOM.close();
    await rm(directory, { recursive: true, force: true });
  }
});
