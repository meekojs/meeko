import assert from "node:assert/strict";
import test from "node:test";
import { MeekoCompileError, locate, parseSfc } from "../src/compiler/sfc.ts";
import { compile } from "../src/compiler.ts";

const validSource = `<script lang="ts">\nconst label = "<template>literal</template>";\n</script>\n<template><button>{label}</button></template>\n<style scoped>button { color: red; }</style>`;

test("conserva contenido y posiciones de secciones .meeko", () => {
  const document = parseSfc(validSource, "Counter.meeko");
  assert.match(document.script.content, /<template>literal<\/template>/);
  assert.equal(document.script.contentStart, validSource.indexOf(">\n") + 1);
  assert.equal(document.template.content, "<button>{label}</button>");
  assert.ok(document.style?.attributes.some((attribute) => attribute.name === "scoped"));
  assert.deepEqual(locate("a\r\nb\nc", 4), { offset: 4, line: 2, column: 2 });
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
  assert.throws(() => parseSfc("<template></template>", "Missing.meeko"), /MEEK005/);
  assert.throws(() => parseSfc("<script lang=\"ts\"></script><template></template><div></div>", "Extra.meeko"), /MEEK002/);
});

test("sitúa errores de script, plantilla y CSS en el archivo original", () => {
  const cases = [
    { source: `<script lang="ts">\nconst value = ;\n</script>\n<template>{value}</template>`, code: "MEEK013", line: 2 },
    { source: `<script lang="ts">const value = 1;</script>\n<template>\n{value(}\n</template>`, code: "MEEK020", line: 3 },
    { source: `<script lang="ts">const value = 1;</script>\n<template>\n{value\n</template>`, code: "MEEK010", line: 3 },
    { source: `<script lang="ts">const value = 1;</script>\n<template></template>\n<style scoped>\nbutton { color: ;\n</style>`, code: "MEEK019", line: 4 },
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
