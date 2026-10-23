import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { createEditorModel } from "../src/model.js";

const filename = resolve("../../examples/regions/Regions.meeko");
const source = readFileSync(filename, "utf8");

test("mapea referencias de script y plantilla para renombrado", () => {
  const model = createEditorModel(source, filename);
  try {
    const declaration = source.indexOf("const visible");
    const use = source.indexOf("visible.value", source.indexOf("<template>"));
    const offset = model.toGenerated(use + 2);
    assert.notEqual(offset, undefined);
    const definitions = model.service.getDefinitionAtPosition(model.virtualFilename, offset!);
    assert.ok(definitions?.some((item) => model.toSource(item.textSpan.start) === declaration + "const ".length));
    const rename = model.service.findRenameLocations(model.virtualFilename, offset!, false, false, true) ?? [];
    const mapped = rename.map((item) => model.toSource(item.textSpan.start));
    assert.ok(mapped.includes(declaration + "const ".length));
    assert.ok(mapped.includes(use));
  } finally {
    model.dispose();
  }
});

test("conserva el ámbito de los elementos de lista", () => {
  const model = createEditorModel(source, filename);
  try {
    const use = source.indexOf("item.label", source.indexOf("<template>"));
    const offset = model.toGenerated(use + 2);
    assert.notEqual(offset, undefined);
    const info = model.service.getQuickInfoAtPosition(model.virtualFilename, offset!);
    assert.ok(info);
    const completions = model.service.getCompletionsAtPosition(model.virtualFilename, offset!, {});
    assert.ok(completions?.entries.some((item) => item.name === "item"));
  } finally {
    model.dispose();
  }
});

test("formatea el script mediante TypeScript", () => {
  const altered = source.replace("const visible = signal(true);", "const visible=signal(true);");
  const model = createEditorModel(altered, filename);
  try {
    const edits = model.service.getFormattingEditsForRange(model.virtualFilename, 0, altered.indexOf("</script>"), {
      tabSize: 2,
      indentSize: 2,
      convertTabsToSpaces: true,
      newLineCharacter: "\n",
      insertSpaceBeforeAndAfterBinaryOperators: true,
      insertSpaceAfterCommaDelimiter: true,
      insertSpaceAfterSemicolonInForStatements: true,
    });
    assert.ok(edits.length, "TypeScript debe producir ediciones");
    assert.ok(edits.some((edit) => {
      const start = model.toSource(edit.span.start);
      return start !== undefined && start < altered.indexOf("</script>") && start > altered.indexOf("const visible");
    }), JSON.stringify(edits.map((edit) => ({ start: edit.span.start, length: edit.span.length, mapped: model.toSource(edit.span.start), text: edit.newText }))));
  } finally {
    model.dispose();
  }
});

test("formatea un componente mínimo con error de tipos", () => {
  const compact = `<script lang="ts">\nimport { signal } from "meeko";\nconst count=signal(0);\nconst bad: number = "invalid";\n</script>\n<template>\n  <button on:click="() => count.value++">{count.value}</button>\n</template>\n`;
  const model = createEditorModel(compact, filename);
  try {
    const end = compact.indexOf("</script>") - compact.indexOf("<script lang=\"ts\">") - "<script lang=\"ts\">".length;
    const edits = model.service.getFormattingEditsForRange(model.virtualFilename, 0, end, {
      tabSize: 2,
      indentSize: 2,
      convertTabsToSpaces: true,
      newLineCharacter: "\n",
      insertSpaceBeforeAndAfterBinaryOperators: true,
      insertSpaceAfterCommaDelimiter: true,
      insertSpaceAfterSemicolonInForStatements: true,
    });
    assert.ok(edits.some((edit) => model.toSource(edit.span.start) === compact.indexOf("=signal")), JSON.stringify(edits.map((edit) => ({ start: edit.span.start, mapped: model.toSource(edit.span.start), text: edit.newText }))));
  } finally {
    model.dispose();
  }
});
