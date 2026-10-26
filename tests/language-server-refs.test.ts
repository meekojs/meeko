import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import ts from "@typescript/typescript6";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { createEditorModel } from "../src/language-server/model.ts";
import { languageProject, locateOnDisk } from "./language-server-workspace.ts";

const filename = resolve("tests/fixtures/RefsModel.meeko");
const source = `<script lang="ts">
const field = useElementRef("field");
const rows = useElementRef("row");
const input = await useElementRef("field");
const dot = await useElementRef("dot");
</script>
<template><input ref:field><svg><circle ref:dot /></svg><li each:of="[1, 2]" each:as="item" ref:row>{item}</li></template>`;

function quickInfo(model: ReturnType<typeof createEditorModel>, text: string): string {
  const at = model.toGenerated(source.indexOf(text))!;
  return ts.displayPartsToString(model.service.getQuickInfoAtPosition(model.virtualFilename, at)?.displayParts);
}

test("the editor types useElementRef from ref: and narrows it after await", () => {
  const model = createEditorModel(source, filename);
  try {
    const errors = [...model.service.getSyntacticDiagnostics(model.virtualFilename), ...model.service.getSemanticDiagnostics(model.virtualFilename)]
      .filter((item) => item.category === ts.DiagnosticCategory.Error)
      .map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n"));
    assert.deepEqual(errors, []);
    assert.match(quickInfo(model, "field ="), /HTMLInputElement \| null/);
    assert.match(quickInfo(model, "rows ="), /readonly HTMLLIElement\[\]/);
    assert.match(quickInfo(model, "input ="), /const input: HTMLInputElement$/);
    assert.match(quickInfo(model, "dot ="), /const dot: SVGCircleElement$/);
  } finally {
    model.dispose();
  }
});

test("the editor completes ref names inside useElementRef", () => {
  const model = createEditorModel(source, filename);
  try {
    const at = model.toGenerated(source.indexOf("\"field\")") + 1)!;
    const names = model.service.getCompletionsAtPosition(model.virtualFilename, at, {})?.entries.map((entry) => entry.name) ?? [];
    assert.deepEqual([...names].sort(), ["dot", "field", "row"]);
  } finally {
    model.dispose();
  }
});

test("the language server reports await useElementRef on a component without defineExpose as MEEK080", { timeout: 120_000 }, async () => {
  const page = `<script lang="ts">
import * as Plain from "./Plain.meeko";
const kid = await useElementRef("kid");
</script>
<template><Plain ref:kid bind:label="'k'" /></template>`;
  const workspace = await languageProject("refs-meek080-", {
    "Plain.meeko": `<script lang="ts">\nconst props = defineProps<{ label: string }>();\n</script>\n<template><b>{props.label}</b></template>`,
    "Page.meeko": page,
  });
  try {
    const opened = await workspace.open("Page.meeko");
    const diagnostics = await componentDiagnostics(workspace.project, opened.document, workspace.file("Page.meeko"), locateOnDisk);
    // Only the component's own errors: the isolated project has no Node types for the runtime sources.
    const own = diagnostics.filter((item) => !item.relatedInformation);
    assert.deepEqual(own.map((item) => item.code), ["MEEK080"], JSON.stringify(diagnostics));
    const [diagnostic] = own;
    assert.deepEqual(diagnostic!.range, { start: opened.at("useElementRef"), end: opened.at("useElementRef(\"kid\")", "useElementRef(\"kid\")".length) });
    assert.match(diagnostic!.message as string, /^await useElementRef\("kid"\) espera el valor del defineExpose de un componente, pero el componente de ref:kid no lo tiene/);
  } finally {
    await workspace.dispose();
  }
});
