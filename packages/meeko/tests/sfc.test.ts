import assert from "node:assert/strict";
import test from "node:test";

import { compile } from "../src/compiler.ts";
import { locate, MeekoCompileError, parseSfc } from "../src/compiler/parser/sfc.ts";
import { parseTemplate } from "../src/compiler/parser/template.ts";

const validSource = `<script lang="ts">\nconst label = "<template>literal</template>";\n</script>\n<template><button>{label}</button></template>\n<style scoped>button { color: red; }</style>`;

test("component snippets preserve table fragments and original attribute positions", () => {
  const source = '<template><Panel><snippet name="head"><tr><th scope="col">Title</th></tr></snippet><colgroup><col /><col></colgroup><tr each:of="rows" each:as="row" each:key="row.id"><td>{row.name}</td></tr></Panel></template>';
  const ast = parseTemplate(source, parseSfc(source, "Table.meeko").template, "Table.meeko");
  const all: typeof ast[] = [];
  const walk = (node: typeof ast): void => { all.push(node); for (const child of node.childNodes ?? []) walk(child); };
  walk(ast);
  assert.equal(all.filter((node) => node.tagName === "tr").length, 2);
  assert.equal(all.filter((node) => node.tagName === "col").length, 2);
  const rows = all.find((node) => node.attrs?.some((attribute) => attribute.name === "each:of"))!;
  const attribute = rows.attrs!.find((attribute) => attribute.name === "each:of")!;
  assert.equal(attribute.start, source.indexOf('each:of="rows"'));
  assert.equal(source.slice(rows.start, rows.start + 3), "<tr");
  assert.equal(all.find((node) => node.tagName === "th")?.attrs?.[0]?.value, "col");
});

test("ordinary HTML tables keep implicit tbody and native cell parsing", () => {
  const source = '<template><table><tr><td><Button /></td><td>Second</td></tr></table></template>';
  const ast = parseTemplate(source, parseSfc(source, "Native.meeko").template, "Native.meeko");
  const table = ast.childNodes!.find((node) => node.tagName === "table")!;
  const body = table.childNodes!.find((node) => node.tagName === "tbody")!;
  assert.ok(body, "native HTML insertion modes remain active when table slots are not needed");
  assert.equal(body.childNodes![0]!.childNodes?.filter((node) => node.tagName === "td").length, 2);
});

test("table fragments inside a component in a native cell keep their own structure", () => {
  const source = '<template><table><tr><td><NestedTable><tr><td>Nested</td></tr></NestedTable></td><td>Sibling</td></tr></table></template>';
  const ast = parseTemplate(source, parseSfc(source, "Nested.meeko").template, "Nested.meeko");
  const table = ast.childNodes!.find((node) => node.tagName === "table")!;
  const row = table.childNodes!.find((node) => node.tagName === "tbody")!.childNodes![0]!;
  const cells = row.childNodes!.filter((node) => node.tagName === "td");
  assert.equal(cells.length, 2);
  const nested = cells[0]!.childNodes!.find((node) => node.componentName === "NestedTable")!;
  assert.equal(nested.childNodes![0]!.tagName, "tr");
  assert.equal(nested.childNodes![0]!.childNodes![0]!.tagName, "td");
});

test("conserva contenido y posiciones de secciones .meeko", () => {
  const document = parseSfc(validSource, "Counter.meeko");
  assert.match(document.script.content, /<template>literal<\/template>/);
  assert.equal(document.script.start, validSource.indexOf("<script"));
  assert.equal(document.script.end, validSource.indexOf("</script>") + "</script>".length);
  assert.equal(document.script.contentStart, validSource.indexOf(">\n") + 1);
  assert.equal(document.template.content, "<button>{label}</button>");
  assert.ok(document.style?.attributes.some((attribute) => attribute.name === "scoped"));
  assert.deepEqual(locate("a\r\nb\nc", 4), { offset: 4, line: 2, column: 2 });
});

test("el AST propio de plantilla conserva límites de nodos y atributos", () => {
  const source = `<script lang="ts">const name = "Meeko";</script>\n<template><p title="greeting">{name}</p></template>`;
  const section = parseSfc(source, "Ast.meeko").template;
  const root = parseTemplate(source, section, "Ast.meeko");
  const paragraph = root.childNodes?.[0];
  assert.ok(paragraph);
  assert.equal(root.start, section.contentStart);
  assert.equal(root.end, section.contentEnd);
  assert.equal(paragraph.start, source.indexOf("<p"));
  assert.equal(paragraph.end, source.indexOf("</p>") + 4);
  assert.equal(paragraph.attrs?.[0]?.start, source.indexOf('title="greeting"'));
  assert.equal(paragraph.attrs?.[0]?.end, source.indexOf('title="greeting"') + 'title="greeting"'.length);
  assert.equal(paragraph.childNodes?.[0]?.start, source.indexOf("{name}"));
});

test("señala secciones duplicadas en la línea original", () => {
  const source = `<script lang="ts"></script>\n<template></template>\n<template></template>`;
  assert.throws(() => parseSfc(source, "Duplicate.meeko"), (error: unknown) => {
    assert.ok(error instanceof MeekoCompileError);
    assert.equal(error.diagnostic.code, "MEEK004");
    assert.equal(error.diagnostic.filename, "Duplicate.meeko");
    assert.deepEqual(error.diagnostic.location, { offset: source.lastIndexOf("<template>"), line: 3, column: 1 });
    return true;
  });
});

test("rechaza secciones faltantes y contenido inesperado", () => {
  assert.throws(() => parseSfc("<style></style>", "Missing.meeko"), /MEEK007/);
  assert.throws(() => parseSfc("<script lang=\"ts\"></script>", "Missing.meeko"), /MEEK007/);
  assert.throws(() => parseSfc("<script lang=\"ts\"></script><template></template><div></div>", "Extra.meeko"), /MEEK002/);
});

test("<script lang=\"ts\"> es opcional: sin él hay un script implícito vacío ante la plantilla", () => {
  const only = parseSfc("<template><p>x</p></template>", "Only.meeko");
  assert.equal(only.script.implicit, true);
  assert.equal(only.script.content, "");
  assert.equal(only.script.start, only.template.start);
  const source = `<script server lang="ts">
export const title = "x";
</script>
<template><h1>{title}</h1></template>
<style scoped>h1 { color: red; }</style>`;
  const server = parseSfc(source, "Server.meeko");
  assert.equal(server.script.implicit, true);
  assert.equal(server.script.contentStart, source.indexOf("<template>"));
  assert.ok(server.server && server.style);
  assert.equal(parseSfc(`<script lang="ts">const a = 1;</script><template></template>`, "Explicit.meeko").script.implicit, undefined);
  // An empty script and no script compile to the same component.
  const withScript = compile(`<script lang="ts"></script><template><p>x</p></template>`, "Same.meeko").code;
  assert.equal(compile("<template><p>x</p></template>", "Same.meeko").code, withScript);
});

test("sitúa errores de script, plantilla y CSS en el archivo original", () => {
  const cases = [
    { source: `<script lang="ts">\nconst value = ;\n</script>\n<template>{value}</template>`, code: "MEEK013", line: 2 },
    { source: `<script lang="ts">const value = 1;</script>\n<template>\n{value(}\n</template>`, code: "MEEK020", line: 3 },
    { source: `<script lang="ts">const value = 1;</script>\n<template>\n{value\n</template>`, code: "MEEK010", line: 3 },
    { source: `<script lang="ts">const value = 1;</script>\n<template></template>\n<style scoped>\nbutton { color: ;\n</style>`, code: "MEEK019", line: 4 },
    { source: `<script lang="ts">const value = 1;</script>\n<template></template>\n<style scoped>\n:global button { color: red; }\n</style>`, code: "MEEK019", line: 4 },
  ];
  for (const { source, code, line } of cases) {
    assert.throws(() => compile(source, "Broken.meeko"), (error: unknown) => {
      assert.ok(error instanceof MeekoCompileError);
      assert.equal(error.diagnostic.code, code);
      assert.equal(error.diagnostic.location.line, line);
      return true;
    });
  }
});

test("las expresiones de texto admiten llaves anidadas, cadenas, plantillas y comentarios", () => {
  const expressions = ["{ value: count }.value", "`${count}px {` + label + \"}\"", "\"}\" + label", "count /* } */"];
  const source = `<script lang="ts">const count = 2; const label = "x";</script>\n<template>${expressions.map((expression) => `<p>{ ${expression} }</p>`).join("")}</template>`;
  const result = compile(source, "Nested.meeko");
  for (const expression of expressions) {
    const offset = source.indexOf(expression);
    const spans = result.mappings.filter((mapping) => mapping.originalStart === offset && mapping.originalLength === expression.length);
    const generated = spans.map((span) => result.code.slice(span.generatedStart, span.generatedEnd));
    assert.ok(generated.filter((text) => text === expression).length >= 3, expression);
    for (const text of generated) assert.ok(text === expression || text === `(${expression})`, text);
  }
  assert.doesNotMatch(result.code, /escapeHtml\("\{ "\)/);
});

test("una interpolación sin cerrar se señala en su llave de apertura", () => {
  const cases = [
    `<script lang="ts">const value = 1;</script>\n<template>\n<p>{ { value }</p>\n</template>`,
    `<script lang="ts">const value = 1;</script>\n<template>\n<p>{ "}" </p>\n</template>`,
    `<script lang="ts">const value = 1;</script>\n<template>\n<p>{ \`\${value}</p>\n</template>`,
  ];
  for (const source of cases) {
    assert.throws(() => compile(source, "Unclosed.meeko"), (error: unknown) => {
      assert.ok(error instanceof MeekoCompileError, String(error));
      assert.equal(error.diagnostic.code, "MEEK010");
      assert.deepEqual(error.diagnostic.location, { offset: source.indexOf("<p>{") + 3, line: 3, column: 4 });
      return true;
    });
  }
  assert.throws(() => compile(`<script lang="ts">const value = 1;</script><template><p>{}</p></template>`, "Empty.meeko"), /MEEK009/);
});

test("una lista sin each:key compila con el índice como clave", () => {
  const source = `<script lang="ts">const items = [1, 2];</script>\n<template><li each:of="items" each:as="item">{item}</li></template>`;
  const { code } = compile(source, "List.meeko");
  assert.match(code, /__meeko\.renderFor\(0, items, __meeko\.indexKey, \(item, index\) =>/);
  assert.match(code, /__meeko\.bindFor\(__scope, 0, \(\) => \(items\), __meeko\.indexKey, /);
});
