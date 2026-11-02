import { Window } from "happy-dom";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { PassThrough } from "node:stream";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { parseFragment } from "parse5";
import * as prettier from "prettier";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  createConnection, createProtocolConnection, DidOpenTextDocumentNotification, DocumentFormattingRequest, InitializedNotification,
  InitializeRequest, ShutdownRequest, StreamMessageReader, StreamMessageWriter,
} from "vscode-languageserver/node";

import type { LanguageServerInitializationOptions } from "../src/language-server/server.ts";
import type { MeekoPrettierOptions } from "../src/prettier.ts";

import { compile } from "../src/compiler.ts";
import { formatWithPrettier } from "../src/formatters/prettier/editor.ts";
import { startLanguageServer } from "../src/language-server/server.ts";
import plugin from "../src/prettier.ts";

const fixtures = resolve("tests/fixtures/prettier");

async function format(source: string, options: prettier.Options & MeekoPrettierOptions = {}): Promise<string> {
  return prettier.format(source, { filepath: "Component.meeko", plugins: [plugin], ...options });
}

/** Formatea, comprueba que una segunda pasada no cambia nada y que el resultado compila. */
async function formatStable(source: string, options: prettier.Options & MeekoPrettierOptions = {}): Promise<string> {
  const formatted = await format(source, options);
  assert.equal(await format(formatted, options), formatted, "formatting is idempotent");
  compile(formatted, "Component.meeko");
  return formatted;
}

const component = (template: string, script = "const count = signal(0);\n"): string =>
  `<script lang="ts">\n${script}</script>\n\n<template>\n${template}\n</template>\n`;

/** Plantilla formateada, sin las etiquetas de sección. */
function templateOf(formatted: string): string {
  return formatted.slice(formatted.indexOf("<template>\n") + 11, formatted.lastIndexOf("\n</template>"));
}

describe("Prettier plugin for .meeko", () => {
  for (const name of ["button", "dashboard", "error", "login"]) {
    test(`formats the real component ${name}.meeko`, async () => {
      const source = await readFile(join(fixtures, `${name}.meeko`), "utf8");
      const expected = await readFile(join(fixtures, `${name}.formatted.meeko`), "utf8");
      assert.equal(await formatStable(source), expected.replaceAll("\r\n", "\n"));
    });
  }

  test("keeps the order and attributes of the sections and the comments between them", async () => {
    const source = '<!-- page -->\n<script server lang="ts">\nexport const route={}\n</script>\n<script lang="ts">\nconst a=1\n</script>\n\n\n<!-- view -->\n<template>\n<p>{a}</p>\n</template>\n<style scoped lang="css">.a{color:red}</style>\n';
    assert.equal(await formatStable(source), '<!-- page -->\n<script server lang="ts">\nexport const route = {};\n</script>\n<script lang="ts">\nconst a = 1;\n</script>\n\n<!-- view -->\n<template>\n<p>{a}</p>\n</template>\n<style scoped lang="css">\n.a {\n  color: red;\n}\n</style>\n');
  });

  test("formats directive values as TypeScript expressions", async () => {
    const formatted = templateOf(await formatStable(component([
      '<ul><li each:of="items.value.filter((item)=>item.done)" each:as="item" each:index="i" each:key="item.id+i">{i}</li></ul>',
      '<p if:when="count.value>1&&!busy">many</p>',
      '<button on:click="()=>count.value++" bind:title="`n=${count.value}`">add</button>',
      '<input model="name" ref:field>',
      '<Field model="name" model:open="flags[count.value===1?0:1]" />',
      '<component is="pick(count.value)" bind:options="{a:1,b:[1,2]}"></component>',
      '<render snippet="rows[0]" args="[count.value,2]"></render>',
    ].join("\n"), "const count = signal(0);\nconst items = signal([]);\nconst busy = false;\nconst name = signal(\"\");\nconst pick = (n: number) => n;\nconst rows = [];\nconst flags = [];\nconst Field = pick;\n")));
    assert.match(formatted, /each:of="items\.value\.filter\(\(item\) => item\.done\)"/);
    assert.match(formatted, /each:as="item"\s+each:index="i"/);
    assert.match(formatted, /each:key="item\.id \+ i"/);
    assert.match(formatted, /if:when="count\.value > 1 && !busy"/);
    assert.match(formatted, /on:click="\(\) => count\.value\+\+"/);
    assert.match(formatted, /bind:title="`n=\$\{count\.value\}`"/);
    assert.match(formatted, /<input model="name" ref:field \/>/);
    assert.match(formatted, /<Field model="name" model:open="flags\[count\.value === 1 \? 0 : 1\]" \/>/);
    assert.match(formatted, /<component\s+is="pick\(count\.value\)"\s+bind:options="\{ a: 1, b: \[1, 2\] \}"\s*><\/component>/);
    assert.match(formatted, /<render snippet="rows\[0\]" args="\[count\.value, 2\]"><\/render>/);
  });

  test("formats bind=\"obj\" and the tag of <component is> as TypeScript expressions", async () => {
    const formatted = templateOf(await formatStable(component([
      '<p class="x" bind="{id:count.value,\'data-n\':count.value+1}">a</p>',
      '<component is="count.value>1?\'a\':\'button\'" bind="attrs" bind:href="count.value>1?\'/x\':undefined">b</component>',
      '<x-card bind="raw   text"></x-card>',
    ].join("\n"), "const count = signal(0);\nconst attrs = { title: \"t\" };\n")));
    assert.match(formatted, /<p class="x" bind="\{ id: count\.value, 'data-n': count\.value \+ 1 \}">a<\/p>/);
    assert.match(formatted, /is="count\.value > 1 \? 'a' : 'button'"/);
    assert.match(formatted, /bind:href="count\.value > 1 \? '\/x' : undefined"/);
    // On a custom element `bind` is an HTML attribute: its text stays as written.
    assert.match(formatted, /<x-card bind="raw   text"><\/x-card>/);
  });

  test("uses single quotes in attribute expressions and keeps strings with double quotes valid", async () => {
    const formatted = templateOf(await formatStable(component('<p bind:title="count.value ? \'a\' : &quot;b&quot;">x</p>')));
    assert.equal(formatted, "<p bind:title=\"count.value ? 'a' : 'b'\">x</p>");
  });

  test("leaves values that are not one expression as they are", async () => {
    const formatted = templateOf(await formatStable(component([
      '<render snippet="row" args="item,  index"></render>',
      '<Row><snippet name="row" params="item,   index"><b>{item}</b></snippet></Row>',
    ].join("\n"), "const count = signal(0);\nconst Row = 1;\nconst row = 1;\nconst item = 1;\nconst index = 1;\n")));
    assert.ok(formatted.includes('args="item,  index"'), formatted);
    assert.ok(formatted.includes('params="item,   index"'), formatted);
  });

  test("formats <snippet>, <render /> and model like the rest of the template", async () => {
    const formatted = await formatStable(component(
      '<section><h1 if:when="snippets.actions"><render snippet="snippets.actions"   args="close"/></h1><render snippet="snippets.default"/>\n<input model="name"><AppDialog   model:open="visible" model="name"><p>{name.value}</p><snippet name="actions"   params="close"><button on:click="()=>close()">x</button></snippet></AppDialog></section>',
      'import { signal } from "@meekojs/meeko";\nimport * as AppDialog from "./AppDialog.meeko";\nconst snippets = defineSnippets<{ default: []; actions?: [close: () => void] }>();\nconst visible = signal(true);\nconst name = signal("");\nfunction close(){visible.value=false}\n',
    ));
    assert.ok(formatted.includes("const snippets = defineSnippets<{\n  default: [];\n  actions?: [close: () => void];\n}>();"), formatted);
    const template = templateOf(formatted);
    assert.match(template, /<render snippet="snippets\.actions" args="close" \/>/);
    assert.match(template, /<render snippet="snippets\.default" \/>/);
    assert.match(template, /<input model="name" \/>/);
    assert.match(template, /model:open="visible"\s+model="name"/);
    // The compiler drops a line break at the edge of a snippet, so the format is free to write one.
    assert.match(template, /<snippet name="actions" params="close"\s*>\s*<button on:click="\(\) => close\(\)">x<\/button>\s*<\/snippet\s*>/);
  });

  test("formats the if:when of a <snippet> as an expression", async () => {
    const formatted = templateOf(await formatStable(component(
      '<AppCard><snippet name="footer"   if:when="snippets.actions&&!busy"><render snippet="snippets.actions" args="close"/></snippet></AppCard>',
      'import * as AppCard from "./AppCard.meeko";\nconst snippets = defineSnippets<{ actions?: [close: () => void] }>();\nconst busy = false;\nfunction close(){}\n',
    )));
    assert.match(formatted, /<snippet name="footer" if:when="snippets\.actions && !busy"\s*>/);
  });

  test("keeps <component is /> self-closing and its following siblings in place", async () => {
    const formatted = templateOf(await formatStable(component(
      '<div><component is="pick(count.value)"   bind:label="count.value" /><p>after</p></div>',
      "const count = signal(0);\nconst pick = (n: number) => n;\n",
    )));
    assert.match(formatted, /<component is="pick\(count\.value\)" bind:label="count\.value" \/>/);
    assert.match(formatted, /\/><p\s*>after<\/p\s*><\/div\s*>/);
  });

  test("keeps self-closing HTML elements, and their end tags, as written (since 1.8)", async () => {
    const formatted = templateOf(await formatStable(component(
      '<section><div class="a"   bind:title="String(count.value)" /><span/><textarea name="t" /><p>after</p></section><table><tr><td /><td>x</td></tr></table><div></div>',
    ), { singleAttributePerLine: true, useTabs: true }));
    assert.match(formatted, /<div\n\t+class="a"\n\t+bind:title="String\(count\.value\)"\n\t+\/>/);
    assert.match(formatted, /<span \/><textarea name="t" \/>/);
    assert.match(formatted, /<td \/>\s*<td>x<\/td>/);
    assert.match(formatted, /<div><\/div>/);
    assert.match(formatted, /<p>after<\/p><\/section\s*>/);
  });

  test("formats {expr} interpolations, nested braces and strings", async () => {
    const formatted = templateOf(await formatStable(component(
      '<p>Total:{count.value+1}items, { {a:"}"}.a } and {`x ${ {b:1}.b }`}</p>\n<p>\n{count.value>1?"Una cadena bastante larga para partir la línea":"Otra cadena también bastante larga"}\n</p>',
    )));
    assert.equal(formatted, [
      '<p>Total:{count.value + 1}items, {{ a: "}" }.a} and {`x ${{ b: 1 }.b}`}</p>',
      "<p>",
      "  {",
      "    count.value > 1",
      '      ? "Una cadena bastante larga para partir la línea"',
      '      : "Otra cadena también bastante larga"',
      "  }",
      "</p>",
    ].join("\n"));
  });

  test("formats a < inside {expr} as part of the expression, never as a tag", async () => {
    const formatted = templateOf(await formatStable(component(
      '<p>{count.value<2}</p>\n<p>{ count.value <= 2?"<b>yes</b>":`<i>${count.value}</i>` }</p>\n<p>{ identity<number>(count.value) } &lt; {count.value}</p>',
      "const count = signal(0);\nconst identity = <T,>(value: T): T => value;\n",
    )));
    assert.equal(formatted, [
      "<p>{count.value < 2}</p>",
      '<p>{count.value <= 2 ? "<b>yes</b>" : `<i>${count.value}</i>`}</p>',
      "<p>{identity<number>(count.value)} &lt; {count.value}</p>",
    ].join("\n"));
  });

  test("keeps a < combined with & and the character references of {expr} as they are", async () => {
    const formatted = templateOf(await formatStable(component(
      '<p>{a<b&&c}</p>\n<p>{a < b && c}</p>\n<p>{true && "<b>"}</p>\n<p>{true && `}<b>`}</p>\n<p>{a &amp;&amp; b}</p>\n<p>{\'&lt;\'}</p>',
      "const a = 1;\nconst b = 2;\nconst c = true;\n",
    )));
    // The formatted text compiles to the same expressions (`formatStable`); the references stay written.
    assert.equal(formatted, [
      "<p>{a < b && c}</p>",
      "<p>{a < b && c}</p>",
      '<p>{true && "<b>"}</p>',
      "<p>{true && `}<b>`}</p>",
      "<p>{a &amp;&amp; b}</p>",
      '<p>{"&lt;"}</p>',
    ].join("\n"));
  });

  test("puts long attribute lists one per line", async () => {
    const formatted = templateOf(await formatStable(component('<input id="login-username" name="username" type="text" autocomplete="username" required bind:value="count.value">')));
    assert.equal(formatted, '<input\n  id="login-username"\n  name="username"\n  type="text"\n  autocomplete="username"\n  required\n  bind:value="count.value"\n/>');
  });

  test("treats reserved SVG/MathML names as standard elements, like the compiler, and custom elements verbatim", async () => {
    const script = "const intro = signal('');\nconst suffix = '';\n";
    const template = templateOf(await formatStable(component(
      '<x-markdown html="intro.value+suffix"></x-markdown>\n<svg><font-face html="intro.value+suffix"></font-face></svg>\n<math><annotation-xml html="intro.value+suffix"></annotation-xml></math>',
      script,
    )));
    // `html` on a custom element is a plain HTML attribute: its value is not an expression.
    assert.match(template, /<x-markdown html="intro\.value\+suffix">/);
    assert.match(template, /<font-face html="intro\.value \+ suffix">/);
    assert.match(template, /<annotation-xml html="intro\.value \+ suffix">/);
  });

  test("keeps PascalCase tags, including names of HTML elements, and their self-closing form", async () => {
    const formatted = templateOf(await formatStable(component(
      '<div>\n<AppButton bind:label="count.value"   on:press="()=>count.value++" />\n<Table bind:rows="[]"></Table>\n<Link/>\n</div>',
      'import AppButton from "./AppButton.meeko";\nimport Table from "./Table.meeko";\nimport Link from "./Link.meeko";\nconst count = signal(0);\n',
    )));
    assert.equal(formatted, '<div>\n  <AppButton bind:label="count.value" on:press="() => count.value++" />\n  <Table bind:rows="[]"></Table>\n  <Link />\n</div>');
  });

  test("keeps static props of component tags verbatim, including bare and mixed-case names", async () => {
    const formatted = templateOf(await formatStable(component(
      '<AppButton   variant="primary" disabled closeOnEscape="no" />\n<component is="AppButton" variant=\'a "b"\'></component>',
      'import * as AppButton from "./AppButton.meeko";\nconst count = signal(0);\n',
    )));
    assert.equal(formatted, '<AppButton variant="primary" disabled closeOnEscape="no" />\n<component is="AppButton" variant=\'a "b"\'></component>');
  });

  test("does not add a <script lang=\"ts\"> to a component without one", async () => {
    const plain = await formatStable("<template>\n<p   class=\"x\">Hola</p>\n</template>\n\n<style scoped>\np{color:red}\n</style>\n");
    assert.equal(plain, "<template>\n<p class=\"x\">Hola</p>\n</template>\n\n<style scoped>\np {\n  color: red;\n}\n</style>\n");
    const page = "<script server lang=\"ts\">\nexport const title=\"Hola\"\n</script>\n<template>\n<h1>{title}</h1>\n</template>\n";
    const formatted = await format(page);
    assert.equal(await format(formatted), formatted);
    assert.doesNotMatch(formatted, /<script lang="ts">/);
    assert.match(formatted, /^<script server lang="ts">\nexport const title = "Hola";\n<\/script>\n<template>\n<h1>\{title\}<\/h1>\n<\/template>\n$/);
  });

  test("never changes the content of pre and textarea", async () => {
    const formatted = templateOf(await formatStable(component("<section>\n<pre>a\n   b   {count.value}\n</pre>\n<textarea>  keep\n   this  </textarea>\n</section>")));
    // A line feed right after <pre> or <textarea> is ignored by HTML, so Prettier may add it.
    assert.equal(formatted, "<section>\n  <pre>\na\n   b   {count.value}\n</pre>\n  <textarea>\n  keep\n   this  </textarea>\n</section>");
  });

  test("honors <!-- prettier-ignore --> in the template and between sections", async () => {
    const source = '<!-- prettier-ignore -->\n<script lang="ts">\nconst   count=signal(0)\n</script>\n<template>\n<div>\n<!-- prettier-ignore -->\n<p   class="x"  >  {count.value+1}  </p>\n<p   class="y">{count.value+1}</p>\n</div>\n</template>\n';
    const formatted = await formatStable(source);
    assert.ok(formatted.includes("<script lang=\"ts\">\nconst   count=signal(0)\n</script>"), formatted);
    assert.ok(formatted.includes('<p   class="x"  >  {count.value+1}  </p>'), formatted);
    assert.ok(formatted.includes('<p class="y">{count.value + 1}</p>'), formatted);
  });

  test("meekoIndentSections indents every section one level", async () => {
    const source = '<script server lang="ts">\nexport const route={}\n</script>\n<script lang="ts">\nconst count=signal(0)\n</script>\n<template>\n<section>\n<p>{count.value}</p>\n<pre>a\n  b</pre>\n</section>\n</template>\n<style>.a{color:red}</style>\n';
    const flat = await formatStable(source, { meekoIndentSections: false });
    const indented = await formatStable(source, { meekoIndentSections: true });
    assert.equal(indented, [
      '<script server lang="ts">', "  export const route = {};", "</script>",
      '<script lang="ts">', "  const count = signal(0);", "</script>",
      "<template>", "  <section>", "    <p>{count.value}</p>", "    <pre>", "a", "  b</pre>", "  </section>", "</template>",
      "<style>", "  .a {", "    color: red;", "  }", "</style>", "",
    ].join("\n"));
    assert.equal(await format(indented, { meekoIndentSections: false }), flat);
    assert.equal(await format(flat, { useTabs: true, meekoIndentSections: true }), indented.replace(/^( +)/gm, (spaces) => "\t".repeat(spaces.length / 2)).replace("\n\tb</pre>", "\n  b</pre>"));
  });

  test("keeps CRLF with endOfLine auto and converts it with the default endOfLine", async () => {
    const source = component("<p>{count.value}</p>\n<pre>a\n b</pre>").replaceAll("\n", "\r\n");
    const auto = await formatStable(source, { endOfLine: "auto" });
    assert.ok(!auto.replaceAll("\r\n", "").includes("\n"), JSON.stringify(auto));
    assert.ok(auto.includes("<pre>\r\na\r\n b</pre>"), JSON.stringify(auto));
    assert.equal(await formatStable(source), auto.replaceAll("\r\n", "\n"));
  });

  test("a component that does not compile is not formatted and reports its location", async () => {
    await assert.rejects(format(component('<p if:when="count.value" each:of="[]">x</p>')), (error: Error & { loc?: { start: { line: number; column: number } } }) => {
      assert.equal(error.name, "SyntaxError");
      assert.match(error.message, /MEEK021/);
      assert.deepEqual(error.loc?.start, { line: 6, column: 1 });
      return true;
    });
    await assert.rejects(format('<script server lang="ts">\nexport const = 1;\n</script>\n' + component("<p></p>")), /MEEK013/);
    await assert.rejects(format('<template><p>{count.value</p></template>\n<script lang="ts">\n</script>\n'), /MEEK010/);
  });

  test("is resolved by Prettier from the .meeko extension", async () => {
    const info = await prettier.getFileInfo("Component.meeko", { plugins: [plugin] });
    assert.equal(info.inferredParser, "meeko");
  });
});

describe("meekoPreserveArrayBreaks", () => {
  type CodeOptions = prettier.Options & MeekoPrettierOptions;

  /** Formatea JavaScript o TypeScript con el plugin y comprueba que una segunda pasada no cambia nada. */
  async function formatCode(source: string, options: CodeOptions = {}): Promise<string> {
    const settings: CodeOptions = { filepath: "file.ts", plugins: [plugin], ...options };
    const formatted = await prettier.format(source, settings);
    assert.equal(await prettier.format(formatted, settings), formatted, "formatting is idempotent");
    return formatted;
  }

  /** Cada caso: código fuente, salida con la opción y si usa sintaxis de tipos. */
  const cases: ReadonlyArray<readonly [source: string, expanded: string, typed?: boolean]> = [
    ["const routes = [\n  '/', '/about'];", 'const routes = [\n  "/",\n  "/about",\n];'],
    ["const tags = ['a',\n  'b'];", 'const tags = ["a", "b"];'],
    ["const numbers = [\n  1, 2, 3];", "const numbers = [\n  1, 2, 3,\n];"],
    ["const modes = [\n  'light', 'dark'] as const;", 'const modes = [\n  "light",\n  "dark",\n] as const;', true],
    ["type Pair = [\n  string, number];", "type Pair = [\n  string,\n  number,\n];", true],
    ["type Named = readonly [\n  key: string, value?: number];", "type Named = readonly [\n  key: string,\n  value?: number,\n];", true],
    ["type Flat = [string, number];", "type Flat = [string, number];", true],
    ["const [\n  first, second] = pair;", "const [\n  first,\n  second,\n] = pair;"],
    ["function sum([\n  a, b]: [number, number] = [1, 2]) { return a + b; }", "function sum(\n  [\n    a,\n    b,\n  ]: [number, number] = [1, 2],\n) {\n  return a + b;\n}", true],
    ["function swap([\n  a, b] = [1, 2]) { return [b, a]; }", "function swap(\n  [\n    a,\n    b,\n  ] = [1, 2],\n) {\n  return [b, a];\n}"],
    ["register([\n  'a', 'b']);", 'register([\n  "a",\n  "b",\n]);'],
    ["await Promise.all([\n  load(), save()]);", "await Promise.all([\n  load(),\n  save(),\n]);"],
    ["const grid = [[\n  1, 2], [3, 4]];", "const grid = [\n  [\n    1, 2,\n  ],\n  [3, 4],\n];"],
    ["const commented = [ // first\n  a, b];", "const commented = [\n  // first\n  a,\n  b,\n];"],
    ["const leading = [\n  // lead\n  a, b];", "const leading = [\n  // lead\n  a,\n  b,\n];"],
    ["const inline = [/* x */ a, b];", "const inline = [/* x */ a, b];"],
    ["const empty = [\n];", "const empty = [];"],
    ["const holes = [\n  , a];", "const holes = [\n  ,\n  a,\n];"],
    ["class Service { constructor(@Inject() [\n  a, b]: Pair) {} }", "class Service {\n  constructor(\n    @Inject()\n    [\n      a,\n      b,\n    ]: Pair,\n  ) {}\n}", true],
  ];
  const source = cases.map(([code]) => code).join("\n");
  const expanded = `${cases.map(([, output]) => output).join("\n")}\n`;
  const untypedSource = cases.filter(([, , typed]) => !typed).map(([code]) => code).join("\n");

  test("keeps expanded an array, pattern or tuple with a line break after [ and leaves the rest to Prettier", async () => {
    assert.equal(await formatCode(source, { printWidth: 800 }), expanded);
    assert.equal(await formatCode(source), expanded);
  });

  test("is on by default and replaces the estree printer of Prettier", () => {
    const option = plugin.options?.meekoPreserveArrayBreaks as { type?: string; default?: unknown } | undefined;
    assert.deepEqual({ type: option?.type, default: option?.default }, { type: "boolean", default: true });
    assert.ok(plugin.printers?.estree, "the plugin defines the estree printer");
  });

  test("collapses the array once [ and the first element are joined, and Prettier still breaks long arrays", async () => {
    const multiline = await formatCode("const tags = [\n  'a', 'b'];\n", { printWidth: 800 });
    assert.equal(multiline, 'const tags = [\n  "a",\n  "b",\n];\n');
    assert.equal(await formatCode(multiline.replace("[\n  ", "["), { printWidth: 800 }), 'const tags = ["a", "b"];\n');
    const long = `const words = [${Array.from({ length: 12 }, (_, index) => `"word${index}"`).join(", ")}];`;
    assert.match(await formatCode(long), /^const words = \[\n {2}"word0",\n/);
    assert.equal(await formatCode(long, { printWidth: 800 }), `${long}\n`);
  });

  test("with false reproduces Prettier without the plugin for every JavaScript and TypeScript parser", async () => {
    for (const [parser, filepath] of [["typescript", "file.ts"], ["babel-ts", "file.ts"], ["babel", "file.js"]] as const) {
      const code = parser === "babel" ? untypedSource : source;
      for (const printWidth of [80, 800]) {
        const expected = await prettier.format(code, { parser, filepath, printWidth });
        assert.equal(await formatCode(code, { parser, filepath, printWidth, meekoPreserveArrayBreaks: false }), expected, `${parser} ${printWidth}`);
      }
    }
  });

  test("delegates to the estree printer of the Prettier that runs it, not to the one Meeko depends on", async () => {
    const { printers } = await import("prettier/plugins/estree") as unknown as { printers: { estree: prettier.Printer } };
    const real = printers.estree;
    // Another Prettier 3.x: its printer writes `x` as `hostX`, which the printer Meeko depends on never does.
    const calls = { preprocess: 0, print: 0 };
    const hostPrinter: prettier.Printer = {
      ...real,
      preprocess: (ast) => { calls.preprocess += 1; return ast; },
      print(path, options, print, args) {
        calls.print += 1;
        const node = path.node as { type?: string; name?: string };
        return node.type === "Identifier" && node.name === "x" ? "hostX" : (real.print as (...parameters: unknown[]) => prettier.Doc)(path, options, print, args);
      },
    };
    const code = "const x = [\n  1, 2]; // trailing\n";
    for (const host of [{ printers: { estree: hostPrinter } }, { printers: { estree: async () => hostPrinter } }] as unknown as prettier.Plugin[]) {
      const alone = await prettier.format(code, { filepath: "file.ts", plugins: [host] });
      assert.equal(alone, "const hostX = [1, 2]; // trailing\n");
      calls.print = 0;
      assert.equal(await prettier.format(code, { filepath: "file.ts", plugins: [host, plugin], meekoPreserveArrayBreaks: false } as CodeOptions), alone);
      assert.ok(calls.print > 0 && calls.preprocess > 0, "the host printer printed the file");
      assert.equal(await prettier.format(code, { filepath: "file.ts", plugins: [host, plugin] }), "const hostX = [\n  1, 2,\n]; // trailing\n");
    }
  });

  test("applies to .js files with babel and .tsx files", async () => {
    assert.equal(await formatCode("export const list = [\n  1, 2];\n", { filepath: "file.js", printWidth: 800 }), "export const list = [\n  1, 2,\n];\n");
    assert.equal(
      await formatCode("export const view = <ul>{[\n  'a', 'b'].map((item) => <li>{item}</li>)}</ul>;\n", { filepath: "view.tsx", printWidth: 800 }),
      'export const view = (\n  <ul>\n    {[\n      "a",\n      "b",\n    ].map((item) => (\n      <li>{item}</li>\n    ))}\n  </ul>\n);\n',
    );
  });

  test("applies to the script and the template expressions of a .meeko file", async () => {
    const meeko = component(
      '<ul>\n<li each:of="[\n  1, 2]" each:as="n">{n}</li>\n</ul>\n<p bind:title="[a,\n  b].join()">\n{[\n  a, b].length}\n</p>',
      'const a = "a";\nconst b = "b";\nconst items = signal([\n  "a", "b"]);\nconst flat = ["a",\n  "b"];\n',
    );
    const formatted = await formatStable(meeko, { printWidth: 800 });
    assert.ok(formatted.includes('const items = signal([\n  "a",\n  "b",\n]);\nconst flat = ["a", "b"];\n'), formatted);
    const template = templateOf(formatted);
    assert.ok(template.includes('each:of="[\n      1, 2,\n    ]"'), template);
    assert.ok(template.includes('<p bind:title="[a, b].join()">'), template);
    assert.ok(template.includes("{\n    [\n      a,\n      b,\n    ].length\n  }"), template);
    const flat = await formatStable(meeko, { printWidth: 800, meekoPreserveArrayBreaks: false });
    assert.ok(flat.includes('const items = signal(["a", "b"]);\n'), flat);
    assert.ok(templateOf(flat).includes('<li each:of="[1, 2]" each:as="n">{n}</li>'), flat);
  });
});

describe("Prettier in the language server", () => {
  const roots: string[] = [];
  // Inside the package, so that `prettier` resolves from the file; not under `.meeko/`, which the repository's `.prettierignore` excludes.
  const workspaces = resolve("tests/.prettier-workspaces");
  after(async () => {
    await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })));
    await rm(workspaces, { recursive: true, force: true });
  });

  const source = component('<p   class="x" bind:title="count.value?\'a\':\'b\'">{count.value}</p>', 'const count = signal("x");\n');

  async function workspace(parent: string, files: Record<string, string>): Promise<string> {
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(join(parent, "prettier-"));
    roots.push(root);
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(resolve("."), join(root, "node_modules", "@meekojs", "meeko"), "junction");
    for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
    return root;
  }

  async function lspFormat(
    root: string, text: string, options: LanguageServerInitializationOptions = {}, file = join(root, "Component.meeko"),
  ): Promise<string> {
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const server = createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient));
    startLanguageServer(server);
    server.listen();
    const client = createProtocolConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer));
    client.onNotification("window/logMessage", () => undefined);
    client.onNotification("textDocument/publishDiagnostics", () => undefined);
    client.listen();
    try {
      await client.sendRequest(InitializeRequest.type, {
        processId: null, rootUri: pathToFileURL(root).href, capabilities: {},
        workspaceFolders: [{ uri: pathToFileURL(root).href, name: "fixture" }],
        initializationOptions: { projectContracts: false, diagnosticsDelay: 0, ...options },
      });
      await client.sendNotification(InitializedNotification.type, {});
      const uri = pathToFileURL(file).href;
      await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "meeko", version: 1, text } });
      const edits = await client.sendRequest(DocumentFormattingRequest.type, { textDocument: { uri }, options: { tabSize: 4, insertSpaces: true } }) ?? [];
      return TextDocument.applyEdits(TextDocument.create(uri, "meeko", 1, text), edits);
    } finally {
      await client.sendRequest(ShutdownRequest.type);
      client.dispose();
      server.dispose();
    }
  }

  test("uses the project's Prettier and its .prettierrc, which prevails over the editor options", async () => {
    // Inside the repository `prettier` resolves from the file, as in a project that installs it.
    const root = await workspace(workspaces, { ".prettierrc": '{ "singleQuote": true, "tabWidth": 3 }\n' });
    const filename = join(root, "Component.meeko");
    const direct = await formatWithPrettier({ text: source, filename, tabSize: 4, insertSpaces: true, trusted: true });
    assert.equal(direct?.prettier, "project");
    const formatted = await lspFormat(root, source);
    assert.equal(formatted, direct?.text);
    assert.ok(formatted.includes("const count = signal('x');"), formatted);
    assert.ok(formatted.includes('<p class="x" bind:title="count.value ? \'a\' : \'b\'">{count.value}</p>'), formatted);
  });

  test("falls back to the bundled Prettier with the editor options and meeko.format.indentSections", async () => {
    const root = await workspace(join(tmpdir(), "meeko-prettier"), {});
    const filename = join(root, "Component.meeko");
    const direct = await formatWithPrettier({ text: source, filename, tabSize: 4, insertSpaces: true, indentSections: true, trusted: true });
    assert.equal(direct?.prettier, "bundled");
    const formatted = await lspFormat(root, source, { format: { indentSections: true } });
    assert.equal(formatted, direct?.text);
    assert.ok(formatted.includes('\n    const count = signal("x");\n'), formatted);
    assert.ok(formatted.includes("\n    <p class=\"x\" bind:title=\"count.value ? 'a' : 'b'\">{count.value}</p>\n"), formatted);
  });

  test("an untrusted workspace ignores the project's Prettier and configuration", async () => {
    const root = await workspace(workspaces, { ".prettierrc": '{ "singleQuote": true }\n' });
    const filename = join(root, "Component.meeko");
    const direct = await formatWithPrettier({ text: source, filename, tabSize: 2, insertSpaces: true, trusted: false });
    assert.equal(direct?.prettier, "bundled");
    assert.ok(direct.text.includes('const count = signal("x");'), direct.text);
    const formatted = await lspFormat(root, source, { trusted: false });
    assert.ok(formatted.includes('const count = signal("x");'), formatted);
  });

  describe("respects .prettierignore", () => {
    const messy = component('<p   class="x">\n    {count.value}\n</p>', 'const count = signal("x");\n');

    /** A workspace that stops the search for ignore files at its own root, like a repository. */
    async function isolated(files: Record<string, string>): Promise<string> {
      const root = await workspace(tmpdir(), files);
      await mkdir(join(root, ".git"));
      return root;
    }

    test("an ignored file gets no edits and a file that is not ignored does", async () => {
      const root = await isolated({ ".prettierignore": "Ignored.meeko\n" });
      const ignored = join(root, "Ignored.meeko");
      const direct = await formatWithPrettier({ text: messy, filename: ignored, tabSize: 2, insertSpaces: true, trusted: true });
      assert.equal(direct?.ignored, true);
      assert.equal(direct?.text, messy);
      assert.equal(await lspFormat(root, messy, {}, ignored), messy, "the whole document stays as written");
      const other = join(root, "Other.meeko");
      assert.equal((await formatWithPrettier({ text: messy, filename: other, tabSize: 2, insertSpaces: true, trusted: true }))?.ignored, undefined);
      assert.notEqual(await lspFormat(root, messy, {}, other), messy);
    });

    test("also in an untrusted workspace, which reads only the ignore patterns", async () => {
      const root = await isolated({ ".prettierignore": "*.meeko\n" });
      const filename = join(root, "Component.meeko");
      assert.equal((await formatWithPrettier({ text: messy, filename, tabSize: 2, insertSpaces: true, trusted: false }))?.ignored, true);
      assert.equal(await lspFormat(root, messy, { trusted: false }), messy);
    });

    test("uses the .prettierignore of the root and of a subproject, each relative to its folder", async () => {
      const root = await isolated({ ".prettierignore": "legacy/\n" });
      await mkdir(join(root, "legacy"));
      await mkdir(join(root, "packages", "app", "src"), { recursive: true });
      await writeFile(join(root, "packages", "app", ".prettierignore"), "src/Frozen.meeko\n");
      const ignored = async (file: string) => (await formatWithPrettier({ text: messy, filename: file, tabSize: 2, insertSpaces: true, trusted: true }))?.ignored === true;
      assert.equal(await ignored(join(root, "legacy", "A.meeko")), true, "pattern of the root");
      assert.equal(await ignored(join(root, "packages", "app", "src", "Frozen.meeko")), true, "pattern of the subproject");
      assert.equal(await ignored(join(root, "packages", "app", "src", "Free.meeko")), false);
      assert.equal(await ignored(join(root, "Frozen.meeko")), false, "a subproject pattern does not reach the root");
      assert.equal(await lspFormat(root, messy, {}, join(root, "packages", "app", "src", "Frozen.meeko")), messy);
    });

  });

  for (const htmlWhitespaceSensitivity of ["ignore", "css", "strict"] as const) test(`saving a component with the sensitivity "${htmlWhitespaceSensitivity}" keeps what it renders: no text node appears or disappears`, async () => {
    const script =`<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nconst items = signal(["a", "b"]);\nconst on = signal(true);\nconst label = "x";\n</script>\n`;
    const template = `<template><ul class="u" id="l"><li each:of="items.value" each:as="item" each:key="item" class="i">{item}</li></ul><div class="d" id="e"><button type="button" class="b" on:click="() => on.value = !on.value">{label}</button><button type="button">y</button><span if:when="on.value" class="s" id="t">Hi<b> you</b>!</span></div></template>`;
    const options: prettier.Options & MeekoPrettierOptions = { filepath: "Whitespace.meeko", htmlWhitespaceSensitivity, singleAttributePerLine: true, printWidth: 800, useTabs: true, meekoIndentSections: true };
    const source = `${script}${template}\n`;
    const formatted = await format(source, options);
    assert.notEqual(formatted, source, "the attributes go on their own lines");
    await mkdir(resolve(".meeko"), { recursive: true });
    const directory = await mkdtemp(join(resolve(".meeko"), "whitespace-"));
    const window = new Window();
    try {
      const load = async (text: string, name: string) => {
        const code = compile(text, join(directory, `${name}.meeko`)).code
          .replace(`from "@meekojs/meeko/internal"`, `from ${JSON.stringify(pathToFileURL(resolve("src/internal.ts")).href)}`)
          .replaceAll(`from "@meekojs/meeko"`, `from ${JSON.stringify(pathToFileURL(resolve("src/index.ts")).href)}`);
        await writeFile(join(directory, `${name}.ts`), code);
        return await import(pathToFileURL(join(directory, `${name}.ts`)).href) as { renderWithState(props: object): { html: string; state: Record<string, unknown> }; hydrate(root: unknown, props: object, state: Record<string, unknown>): () => void };
      };
      const texts = (node: { childNodes: ArrayLike<unknown> }): string[] => Array.from(node.childNodes as ArrayLike<{ nodeType: number; nodeValue: string; childNodes: ArrayLike<unknown> }>).flatMap((child) => child.nodeType === 3 ? [child.nodeValue] : texts(child));
      const [before, after] = await Promise.all([load(source, "Source"), load(formatted, "Formatted")]);
      const rendered = [before.renderWithState({}), after.renderWithState({})] as const;
      assert.equal(rendered[1].html, rendered[0].html, "the HTML of the server");
      const roots = rendered.map((result) => {
        const root = window.document.createElement("main");
        root.innerHTML = result.html;
        return root;
      });
      assert.deepEqual(texts(roots[1]!), texts(roots[0]!), "the text nodes of the server");
      assert.deepEqual(texts(roots[0]!), ["a", "b", "x", "y", "Hi", " you", "!"]);
      const releases = [before.hydrate(roots[0], {}, rendered[0].state), after.hydrate(roots[1], {}, rendered[1].state)];
      assert.equal(roots[1]!.innerHTML, roots[0]!.innerHTML, "the DOM after hydrating");
      assert.deepEqual(texts(roots[1]!), texts(roots[0]!), "the text nodes after hydrating");
      (roots[0]!.querySelector("button") as unknown as { click(): void }).click();
      (roots[1]!.querySelector("button") as unknown as { click(): void }).click();
      assert.equal(roots[1]!.innerHTML, roots[0]!.innerHTML, "the DOM after an update");
      assert.equal(roots[1]!.querySelector("span"), null);
      for (const release of releases) release();
      assert.deepEqual(texts(roots[1]!), texts(roots[0]!), "the text nodes after releasing");
    } finally {
      await window.happyDOM.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("a component that does not compile gets no edits", async () => {
    const root = await workspace(workspaces, {});
    const broken = component('<p if:when="count.value" each:of="[]">x</p>');
    assert.equal(await lspFormat(root, broken), broken);
  });
});

describe("What a component renders after saving it", () => {
  interface ParsedHtml { nodeName: string; value?: string; childNodes?: ParsedHtml[] }
  interface LoadedComponent {
    renderWithState(props: object): { html: string; state: Record<string, unknown> };
    hydrate(root: unknown, props: object, state: Record<string, unknown>): () => void;
  }

  /** Runs `body` with a temporary folder for compiled components. */
  async function withComponents(body: (load: (text: string, name: string) => Promise<LoadedComponent>) => Promise<void>): Promise<void> {
    await mkdir(resolve(".meeko"), { recursive: true });
    const directory = await mkdtemp(join(resolve(".meeko"), "saving-"));
    try {
      await body(async (text, name) => {
        const code = compile(text, join(directory, `${name}.meeko`)).code
          .replace(`from "@meekojs/meeko/internal"`, `from ${JSON.stringify(pathToFileURL(resolve("src/internal.ts")).href)}`)
          .replaceAll(`from "@meekojs/meeko"`, `from ${JSON.stringify(pathToFileURL(resolve("src/index.ts")).href)}`)
          .replace(`from "./Card.meeko"`, `from "./Card.ts"`);
        await writeFile(join(directory, `${name}.ts`), code);
        return await import(pathToFileURL(join(directory, `${name}.ts`)).href) as LoadedComponent;
      });
    } finally { await rm(directory, { recursive: true, force: true }); }
  }

  const find = (node: ParsedHtml, tag: string): ParsedHtml | undefined => node.nodeName === tag ? node : (node.childNodes ?? []).map((child) => find(child, tag)).find(Boolean);
  const textOf = (node: ParsedHtml): string => node.value ?? (node.childNodes ?? []).map(textOf).join("");
  /** The text of an element as an HTML parser reads it, not as this compiler or `happy-dom` do. */
  const parsedText = (html: string, tag: string): string => {
    const element = find(parseFragment(html) as unknown as ParsedHtml, tag);
    assert.ok(element, `<${tag}> in ${html}`);
    return textOf(element);
  };

  test("the text after a line feed that the HTML parser ignores keeps its first characters", () => withComponents(async (load) => {
    let id = 0;
    for (const [template, tag] of [
      ["<textarea>\n&amp;x</textarea>", "textarea"],
      ["<textarea>\r\n&amp;x</textarea>", "textarea"],
      ["<textarea>\n<!-- a -->\n  b</textarea>", "textarea"],
      ["<textarea>\n<b>x</b></textarea>", "textarea"],
      ["<textarea>\n\n&amp;x</textarea>", "textarea"],
      ["<textarea>\n  a</textarea>", "textarea"],
      ["<textarea>\na</textarea>", "textarea"],
      ["<textarea>&#10;x</textarea>", "textarea"],
      ["<textarea>\n&#10;x</textarea>", "textarea"],
      ["<pre>\n&lt;b&gt;</pre>", "pre"],
      ["<pre>\n&amp;x</pre>", "pre"],
      ["<listing>\n&amp;x</listing>", "listing"],
      ["<div>\n&amp;x</div>", "div"],
    ] as const) {
      const { html } = (await load(`<template>${template}</template>`, `Direct${id++}`)).renderWithState({});
      assert.equal(parsedText(html, tag), parsedText(template.replaceAll("\r\n", "\n"), tag), template);
    }
  }));

  test("a value after that line feed hydrates and updates", () => withComponents(async (load) => {
    const source = `<script lang="ts">\nimport { signal } from "@meekojs/meeko";\nconst count = signal(0);\n</script>\n<template><pre>\n&amp;{count.value}</pre><button on:click="() => count.value++">+</button></template>`;
    const component = await load(source, "Hydrated");
    const rendered = component.renderWithState({});
    assert.equal(parsedText(rendered.html, "pre"), "&0");
    const window = new Window();
    try {
      const root = window.document.createElement("main");
      root.innerHTML = rendered.html;
      const release = component.hydrate(root, {}, rendered.state);
      assert.equal(root.querySelector("pre")!.textContent, "&0");
      (root.querySelector("button") as unknown as { click(): void }).click();
      assert.equal(root.querySelector("pre")!.textContent, "&1");
      release();
    } finally { await window.happyDOM.close(); }
  }));

  test("formatting keeps a snippet next to text and interpolations, and preformatted content, for an HTML parser", () => withComponents(async (load) => {
    await load(`<script lang="ts">\nconst snippets = defineSnippets<{ a: []; default?: [] }>();\n</script>\n<template><p>left<render snippet="snippets.a" />right</p></template>`, "Card");
    const script = `<script lang="ts">\nimport * as Card from "./Card.meeko";\nconst x = "X";\n</script>\n`;
    let id = 0;
    for (const [template, tag, expected] of [
      [`<Card>{x}<snippet name="a"> </snippet>{x}</Card>`, "p", "left right"],
      [`<Card>{x}<snippet name="a"> <b>x</b> </snippet>{x}</Card>`, "p", "left x right"],
      [`<Card>t<snippet name="a"> <b>x</b></snippet>t</Card>`, "p", "left xright"],
      ["<textarea>&amp; &#10; &#32;</textarea>", "textarea", "& \n  "],
      ["<textarea><!-- prettier-ignore -->\n  a</textarea>", "textarea", "<!-- prettier-ignore -->\n  a"],
      ["<textarea> </textarea>", "textarea", " "],
      ["<textarea>\n\n</textarea>", "textarea", "\n"],
      ["<textarea>&#10;x</textarea>", "textarea", "x"],
      ["<textarea>a\n}}\nb</textarea>", "textarea", "a\n}}\nb"],
      ["<pre>&lt;b&gt; long enough to break</pre>", "pre", "<b> long enough to break"],
      ["<pre>&amp;\n x</pre>", "pre", "&\n x"],
      ["<pre>   </pre>", "pre", "   "],
      ["<pre>a\n}}\n<b>x</b></pre>", "pre", "a\n}}\nx"],
      ["<pre>\n&#10;x</pre>", "pre", "\nx"],
      ["<p>a }} b</p>", "p", "a }} b"],
      ["<!-- prettier-ignore -->\n<p>\n}}\n</p>", "p", " }} "],
    ] as const) {
      const source = `${script}<template>${template}</template>\n`;
      for (const htmlWhitespaceSensitivity of ["ignore", "css", "strict"] as const) {
        for (const printWidth of [10, 15, 80]) {
          const options = { htmlWhitespaceSensitivity, printWidth };
          const formatted = await format(source, options);
          assert.equal(await format(formatted, options), formatted, `${template}, ${htmlWhitespaceSensitivity}, ${printWidth}: stable`);
          const { html } = (await load(formatted, `Saved${id++}`)).renderWithState({});
          const text = parsedText(html, tag);
          assert.equal(tag === "p" ? text.replace(/[\t\n\f\r ]+/g, " ") : text, expected, `${template}, ${htmlWhitespaceSensitivity}, ${printWidth}:\n${formatted}`);
        }
      }
    }
  }));
});
