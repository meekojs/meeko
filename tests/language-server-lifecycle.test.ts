import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import ts from "@typescript/typescript6";
import { createEditorModel } from "../src/language-server/model.ts";

const filename = resolve("tests/fixtures/LifecycleModel.meeko");
const source = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const count = signal(0);
function bump(): number {
  count.value++;
  return count.value;
}
defineExpose({ bump, count });
onMounted(() => () => { count.value = 0; });
const rows = [{ id: 1 }];
</script>
<template><p each:of="rows" each:as="row">{row.id}</p></template>`;

function diagnostics(model: ReturnType<typeof createEditorModel>): string[] {
  return [...model.service.getSyntacticDiagnostics(model.virtualFilename), ...model.service.getSemanticDiagnostics(model.virtualFilename)]
    .map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n"));
}

test("the editor model accepts defineExpose, autoimports onMounted and lists without each:key", () => {
  const model = createEditorModel(source, filename);
  try {
    assert.deepEqual(diagnostics(model), []);
    assert.match(model.code, /import \{ onMounted as onMounted \} from "@meekojs\/meeko"/);
    // The module shape carries the exposed type, which a parent ref receives.
    const at = model.code.indexOf("export type ComponentExposed") + "export type ".length;
    const info = model.service.getQuickInfoAtPosition(model.virtualFilename, at);
    const text = ts.displayPartsToString(info?.displayParts);
    assert.match(text, /bump: \(\) => number/);
    assert.match(text, /count: Signal<number>/);
    assert.match(model.code, /hydrateScope\(scope: object, props: ComponentProps, state\?: Record<string, unknown>\): \{ \(\): void; readonly exposed\?: ComponentExposed \}/);

    // The script keeps its positions: hover on the defineExpose argument maps back.
    const use = source.indexOf("bump, count })");
    const hover = model.service.getQuickInfoAtPosition(model.virtualFilename, model.toGenerated(use)!);
    assert.match(ts.displayPartsToString(hover?.displayParts), /bump: \(\) => number/);
  } finally {
    model.dispose();
  }
});

test("without defineExpose the editor exposes null and reports a wrong onMounted callback", () => {
  const plain = `<script lang="ts">\nonMounted(async () => () => undefined);\n</script><template><p>x</p></template>`;
  const model = createEditorModel(plain, filename);
  try {
    assert.match(model.code, /export type ComponentExposed = null;/);
    assert.ok(diagnostics(model).some((message) => /MountedResult/.test(message)), diagnostics(model).join("\n"));
  } finally {
    model.dispose();
  }
});
