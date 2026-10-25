import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { checkSource } from "../src/check.ts";
import { createEditorModel } from "../src/language-server/model.ts";

const filename = resolve("examples/regions/Regions.meeko");
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

test("editor resolves the typed component error observer autoimport", () => {
  const filename = resolve("examples/counter/ErrorObserverEditor.meeko");
  const valid = '<script lang="ts">provideErrorHandler((error) => { const value: unknown = error; void value; });</script><template><button>Run</button></template>';
  const model = createEditorModel(valid, filename);
  try {
    assert.match(model.code, /import \{ provideErrorHandler as provideErrorHandler \} from "@meekojs\/meeko"/);
    assert.deepEqual(model.service.getSemanticDiagnostics(model.virtualFilename).map((item) => item.code), []);
    const location = model.toGenerated(valid.indexOf("provideErrorHandler") + 2);
    assert.notEqual(location, undefined);
    const definitions = model.service.getDefinitionAtPosition(model.virtualFilename, location!);
    assert.ok(definitions?.some((item) => item.fileName.includes("component-errors.d.ts")), JSON.stringify(definitions));
  } finally {
    model.dispose();
  }
  const invalid = valid.replace("(error) =>", "(error: string) =>");
  const broken = createEditorModel(invalid, filename);
  try {
    assert.ok(broken.service.getSemanticDiagnostics(broken.virtualFilename).some((item) => item.code === 2345));
  } finally {
    broken.dispose();
  }
});

test("editor and CLI reject an asynchronous component cleanup", async () => {
  const component = '<script lang="ts">onCleanup(async () => undefined);</script><template><div>cleanup</div></template>';
  const start = component.indexOf("async");
  const cli = await checkSource(component, filename);
  assert.ok(cli.some((item) => item.code === "TS2345" && item.location.offset === start), JSON.stringify(cli));
  const model = createEditorModel(component, filename);
  try {
    assert.match(model.code, /import \{ onCleanup as onCleanup \} from "@meekojs\/meeko"/);
    const diagnostics = model.service.getSemanticDiagnostics(model.virtualFilename);
    assert.ok(diagnostics.some((item) => item.code === 2345 && item.start !== undefined
      && model.toSource(item.start) === start
      && /Promise<undefined>/.test(String(item.messageText))
      && /never/.test(String(item.messageText))),
    JSON.stringify(diagnostics.map((item) => ({
      code: item.code,
      message: String(item.messageText),
      source: model.toSource(item.start ?? 0),
    }))));
  } finally {
    model.dispose();
  }
});

test("editor checks event handler types at their template expression", () => {
  const component = '<script lang="ts">const handler = (event: KeyboardEvent): void => { void event.key; };</script><template><button on:click="handler">Click</button></template>';
  const invalid = createEditorModel(component, filename);
  try {
    const diagnostics = invalid.service.getSemanticDiagnostics(invalid.virtualFilename);
    assert.ok(diagnostics.some((item) => item.code === 2345 && item.start !== undefined &&
      invalid.toSource(item.start) === component.indexOf('on:click="handler"') + 'on:click="'.length),
    JSON.stringify(diagnostics.map((item) => ({ code: item.code, source: invalid.toSource(item.start ?? 0) }))));
  } finally { invalid.dispose(); }
  const valid = createEditorModel(component.replace("KeyboardEvent", "MouseEvent").replace("event.key", "event.clientX"), filename);
  try {
    assert.deepEqual(valid.service.getSemanticDiagnostics(valid.virtualFilename).map((item) => item.code), []);
  } finally { valid.dispose(); }
});

test("editor requires string or number keyed-list identifiers", () => {
  const component = '<script lang="ts">const items = [{ id: 1 }];</script><template><li each:of="items" each:as="item" each:key="({ id: item.id })">{item.id}</li></template>';
  const invalid = createEditorModel(component, filename);
  try {
    const start = component.indexOf("({ id: item.id })");
    const diagnostics = invalid.service.getSemanticDiagnostics(invalid.virtualFilename);
    assert.ok(diagnostics.some((item) => item.code === 2345 && item.start !== undefined &&
      (invalid.toSource(item.start) ?? -1) >= start && (invalid.toSource(item.start) ?? -1) < start + "({ id: item.id })".length),
    JSON.stringify(diagnostics.map((item) => ({ code: item.code, source: invalid.toSource(item.start ?? 0) }))));
  } finally { invalid.dispose(); }
  const valid = createEditorModel(component.replace("({ id: item.id })", "item.id"), filename);
  try {
    assert.deepEqual(valid.service.getSemanticDiagnostics(valid.virtualFilename).map((item) => item.code), []);
  } finally { valid.dispose(); }
});

test("editor treats a list index as number rather than literal zero", () => {
  const source = `<script lang="ts">
const numbers = [1, 2];
const takesZero = (value: 0): string => String(value);
</script><template><ul><li each:of="numbers" each:as="item" each:index="position" each:key="item">{takesZero(position)}</li></ul></template>`;
  const invalid = createEditorModel(source, filename);
  try {
    const start = source.indexOf("takesZero(position)");
    const diagnostics = invalid.service.getSemanticDiagnostics(invalid.virtualFilename);
    assert.ok(diagnostics.some((item) => item.code === 2345 && item.start !== undefined &&
      (invalid.toSource(item.start) ?? -1) >= start && (invalid.toSource(item.start) ?? -1) < start + "takesZero(position)".length),
    JSON.stringify(diagnostics.map((item) => ({ code: item.code, source: invalid.toSource(item.start ?? 0) }))));
  } finally { invalid.dispose(); }
  const valid = createEditorModel(source.replace("value: 0", "value: number"), filename);
  try {
    assert.deepEqual(valid.service.getSemanticDiagnostics(valid.virtualFilename).map((item) => item.code), []);
  } finally { valid.dispose(); }
});

test("editor applies the same strict indexed-access rule as the CLI", async () => {
  const component = '<script lang="ts">const values = [1]; const value: number = values[0];</script><template>{value}</template>';
  const cli = await checkSource(component, filename);
  assert.ok(cli.some((item) => item.code === "TS2322" && item.location.offset === component.indexOf("value: number")), JSON.stringify(cli));
  const model = createEditorModel(component, filename);
  try {
    const diagnostics = model.service.getSemanticDiagnostics(model.virtualFilename);
    assert.ok(diagnostics.some((item) => item.code === 2322 && item.start !== undefined &&
      model.toSource(item.start) === component.indexOf("value: number")),
    JSON.stringify(diagnostics.map((item) => ({ code: item.code, source: model.toSource(item.start ?? 0) }))));
  } finally { model.dispose(); }
});

test("editor and CLI reject undefined for an exact optional component prop", async () => {
  const component = '<script lang="ts">type Props = { label?: string }; const props = defineProps<Props>(); const input: Props = { label: undefined };</script><template>{props.label}</template>';
  const cli = await checkSource(component, filename);
  assert.ok(cli.some((item) => item.code === "TS2375"), JSON.stringify(cli));
  const model = createEditorModel(component, filename);
  try {
    assert.ok(model.service.getSemanticDiagnostics(model.virtualFilename).some((item) => item.code === 2375));
  } finally { model.dispose(); }
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
  const compact = `<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nconst count=signal(0);\nconst bad: number = "invalid";\n</script>\n<template>\n  <button on:click="() => count.value++">{count.value}</button>\n</template>\n`;
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

test("defineProps defaults mantiene el tipo resuelto en script y plantilla", () => {
  const defaultsFile = resolve("tests/fixtures/PropsDefaults.meeko");
  const defaultsSource = readFileSync(defaultsFile, "utf8");
  const model = createEditorModel(defaultsSource, defaultsFile);
  try {
    const diagnostics = model.service.getSemanticDiagnostics(model.virtualFilename);
    assert.deepEqual(diagnostics.map((item) => item.code), [], diagnostics.map((item) => String(item.messageText)).join("\n"));
    const use = defaultsSource.indexOf("props.label", defaultsSource.indexOf("<template>"));
    const generated = model.toGenerated(use + "props.".length + 2);
    assert.notEqual(generated, undefined);
    const info = model.service.getQuickInfoAtPosition(model.virtualFilename, generated!);
    assert.ok(info);
    assert.doesNotMatch(info.displayParts?.map((part) => part.text).join("") ?? "", /undefined/);
  } finally { model.dispose(); }
});

test("el editor comprueba las props de un componente hijo", () => {
  const parent = `<script lang="ts">
const Child = {} as { renderToString(props: { label: string; count?: number }): string };
</script>
<template><component is="Child" bind:label="42"></component></template>`;
  const model = createEditorModel(parent, filename);
  try {
    const diagnostics = model.service.getSemanticDiagnostics(model.virtualFilename);
    const mismatch = diagnostics.find((item) => item.code === 2322);
    assert.ok(mismatch, diagnostics.map((item) => String(item.messageText)).join("\n"));
    assert.equal(model.toSource(mismatch.start ?? -1), parent.indexOf("bind:label") + 5);
    const property = model.toGenerated(parent.indexOf("bind:label") + 6);
    assert.notEqual(property, undefined);
    const completions = model.service.getCompletionsAtPosition(model.virtualFilename, property!, {});
    assert.ok(completions?.entries.some((item) => item.name === "label"));
  } finally { model.dispose(); }
});

test("el editor detecta props obligatorias omitidas en un componente hijo", () => {
  const parent = `<script lang="ts">
const Child = {} as { renderToString(props: { label: string }): string };
</script>
<template><component is="Child"></component></template>`;
  const model = createEditorModel(parent, filename);
  try {
    const diagnostics = model.service.getSemanticDiagnostics(model.virtualFilename);
    const missing = diagnostics.find((item) => item.code === 2345);
    assert.ok(missing, diagnostics.map((item) => String(item.messageText)).join("\n"));
    assert.equal(model.toSource(missing.start ?? -1), parent.indexOf('is="Child"') + 4);
  } finally { model.dispose(); }
});

test("editor rejects a nested component without SSR state transfer", () => {
  const source = `<script lang="ts">
import type { ComponentModule } from "@meekojs/meeko";
const props = defineProps<{ child: ComponentModule<{ label: string }> }>();
</script><template><component is="props.child" bind:label="'ok'"></component></template>`;
  const model = createEditorModel(source, filename);
  try {
    const diagnostics = model.service.getSemanticDiagnostics(model.virtualFilename);
    assert.ok(diagnostics.some((item) => JSON.stringify(item.messageText).includes("renderWithState")),
      JSON.stringify(diagnostics.map((item) => item.messageText)));
  } finally { model.dispose(); }
  const valid = createEditorModel(source.replaceAll("ComponentModule", "Component"), filename);
  try {
    const diagnostics = valid.service.getSemanticDiagnostics(valid.virtualFilename);
    assert.deepEqual(diagnostics.map((item) => item.code), [], JSON.stringify(diagnostics.map((item) => item.messageText)));
  } finally { valid.dispose(); }
});

test("los defaults conservan el discriminante y las props de cada variante", () => {
  const union = `<script lang="ts">
type Props = ({ kind: "a"; a: number } | { kind: "b"; b: string }) & { count: number };
const props = defineProps<Props>({ count: 0 });
function value(): string {
  if (props.kind === "a") return String(props.a + props.count);
  return props.b;
}
</script><template>{value()}</template>`;
  const model = createEditorModel(union, filename);
  try {
    const diagnostics = model.service.getSemanticDiagnostics(model.virtualFilename);
    assert.deepEqual(diagnostics.map((item) => item.code), [], diagnostics.map((item) => String(item.messageText)).join("\n"));
  } finally { model.dispose(); }
});

test("el editor actualiza tipos de un modulo importado sin editar el componente", () => {
  const parent = resolve(".meeko");
  mkdirSync(parent, { recursive: true });
  const root = mkdtempSync(join(parent, "editor-dependency-"));
  try {
    writeFileSync(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    const dependency = join(root, "answer.ts");
    writeFileSync(dependency, 'export const answer = "ok";\n');
    const component = join(root, "Page.meeko");
    const source = '<script lang="ts">import { answer } from "./answer.js"; const text: string = answer;</script><template>{text}</template>';
    writeFileSync(component, source);
    const model = createEditorModel(source, component);
    try {
      assert.deepEqual(model.service.getSemanticDiagnostics(model.virtualFilename).map((item) => item.code), []);
      writeFileSync(dependency, 'export const answer = 42;\n');
      assert.ok(model.service.getSemanticDiagnostics(model.virtualFilename).some((item) => item.code === 2322));
    } finally { model.dispose(); }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("editor and CLI map nested text interpolations to the same source positions", async () => {
  const component = '<script lang="ts">const count = 1; const label = "x";</script><template><p>{ { value: count }.missing }</p><p>{ `${count}px {` + label + "}" }</p><p>{ count /* } */ + unknownName }</p></template>';
  const missing = component.indexOf("missing");
  const unknown = component.indexOf("unknownName");
  const model = createEditorModel(component, filename);
  try {
    assert.deepEqual(model.service.getSyntacticDiagnostics(model.virtualFilename).map((item) => String(item.messageText)), []);
    const diagnostics = model.service.getSemanticDiagnostics(model.virtualFilename);
    assert.deepEqual(diagnostics.map((item) => [item.code, model.toSource(item.start ?? -1)]), [[2339, missing], [2304, unknown]]);
    for (const value of ["{ value: count }.missing", "`${count}px {` + label + \"}\""]) {
      const generated = model.toGenerated(component.indexOf(value));
      assert.notEqual(generated, undefined, value);
      assert.equal(model.code.slice(generated!, generated! + value.length), value);
    }
  } finally { model.dispose(); }
  const cli = await checkSource(component, filename);
  assert.deepEqual([...new Set(cli.map((item) => `${item.code}:${item.location.offset}`))], [`TS2339:${missing}`, `TS2304:${unknown}`]);
});

test("editor and CLI agree on text interpolations after entities and CRLF", async () => {
  const component = '<script lang="ts">const a = 1; const b = 2;</script><template><p>&copy; {missingAfterEntity}</p>\r\n<p>{ a &lt; b ? "yes" : "no" }</p>\r\n<p>x\r\n{missingAfterCrlf}</p></template>';
  const first = component.indexOf("missingAfterEntity");
  const second = component.indexOf("missingAfterCrlf");
  const model = createEditorModel(component, filename);
  try {
    assert.deepEqual(model.service.getSyntacticDiagnostics(model.virtualFilename).map((item) => String(item.messageText)), []);
    const diagnostics = model.service.getSemanticDiagnostics(model.virtualFilename);
    assert.deepEqual(diagnostics.map((item) => [item.code, model.toSource(item.start ?? -1)]), [[2304, first], [2304, second]]);
  } finally { model.dispose(); }
  const cli = await checkSource(component, filename);
  assert.deepEqual([...new Set(cli.map((item) => `${item.code}:${item.location.offset}`))], [`TS2304:${first}`, `TS2304:${second}`]);
});

test("editor maps unquoted directive values like the compiler", async () => {
  const component = '<script lang="ts">const items = [1, 2]; const run = (event: KeyboardEvent): void => { void event.key; };</script><template><ul><li each:of=items each:as="item" each:key=item bind:title=missingTitle>{item}</li></ul><button on:click=run>Run</button></template>';
  const model = createEditorModel(component, filename);
  try {
    const items = component.indexOf("items", component.indexOf("<template>"));
    const generated = model.toGenerated(items);
    assert.notEqual(generated, undefined);
    assert.equal(model.code.slice(generated!, generated! + "items".length), "items");
    const diagnostics = model.service.getSemanticDiagnostics(model.virtualFilename);
    assert.deepEqual(diagnostics.map((item) => [item.code, model.toSource(item.start ?? -1)]), [
      [2304, component.indexOf("missingTitle")],
      [2345, component.indexOf("on:click=run") + "on:click=".length],
    ]);
  } finally { model.dispose(); }
  const cli = await checkSource(component, filename);
  assert.deepEqual([...new Set(cli.map((item) => `${item.code}:${item.location.offset}`))].sort(), [
    `TS2304:${component.indexOf("missingTitle")}`,
    `TS2345:${component.indexOf("on:click=run") + "on:click=".length}`,
  ]);
});
