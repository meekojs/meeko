import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { createEditorModel } from "../src/language-server/model.ts";

test("editor positions follow the compiler template AST", () => {
  const source = `<script lang="ts">const options = [{ name: "A" }]; const selected = options[0];</script>
<template><ul><li each:of="options" each:as="option">{option.name}</li></ul><component is="selected"></component></template>`;
  const model = createEditorModel(source, "Editor.meeko");
  try {
    for (const value of ["options", "option.name", "selected"]) {
      const sourceOffset = source.indexOf(value, source.indexOf("<template>"));
      const generatedOffset = model.toGenerated(sourceOffset);
      assert.notEqual(generatedOffset, undefined, value);
      assert.equal(model.code.slice(generatedOffset, generatedOffset! + value.length), value);
      assert.equal(model.toSource(generatedOffset!), sourceOffset);
    }
  } finally {
    model.dispose();
  }
});

test("editor resolves scoped autoimports through the same registry and preserves spans", async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko/editor-imports-test-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}');
  await mkdir(join(root, "app", "composables"), { recursive: true });
  await mkdir(join(root, "app", "pages"), { recursive: true });
  await mkdir(join(root, "server", "utils"), { recursive: true });
  await writeFile(join(root, "app", "composables", "count.ts"), "export function useCount(): number { return 1; }");
  await writeFile(join(root, "server", "utils", "secret.ts"), "export function getSecret(): number { return 2; }");
  const filename = join(root, "app", "pages", "index.meeko");
  const source = `<script lang="ts">const count = useCount();</script><template><p>{count}</p></template>`;
  try {
    const model = createEditorModel(source, filename);
    try {
      assert.match(model.code, /import \{ useCount as useCount \} from "\.\.\/composables\/count\.js"/);
      const original = source.indexOf("useCount");
      const generated = model.toGenerated(original);
      assert.notEqual(generated, undefined);
      assert.equal(model.code.slice(generated, generated! + "useCount".length), "useCount");
      assert.equal(model.toSource(generated!), original);
      assert.equal(model.service.getSemanticDiagnostics(model.virtualFilename).some((item) => item.code === 2304), false);
    } finally { model.dispose(); }
    assert.throws(() => createEditorModel(source.replace("useCount()", "getSecret()"), filename), /unavailable in client scope/);
    const explicit = createEditorModel(source.replace("const count", 'import { useCount } from "../composables/count.js"; const count'), filename);
    try { assert.equal((explicit.code.match(/import \{ useCount/g) ?? []).length, 1); }
    finally { explicit.dispose(); }
    await mkdir(join(root, "shared", "utils"), { recursive: true });
    await writeFile(join(root, "shared", "utils", "duplicate.ts"), "export function useCount(): number { return 3; }");
    assert.throws(() => createEditorModel(source, filename), /Ambiguous autoimport useCount/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
