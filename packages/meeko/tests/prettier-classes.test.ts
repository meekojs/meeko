import assert from "node:assert/strict";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import * as prettier from "prettier";
import { compile } from "../src/compiler.ts";
import plugin from "../src/prettier.ts";
import type { MeekoPrettierOptions } from "../src/prettier.ts";
import { classOrderWarnings } from "../src/prettier/classes.ts";
import { formatWithPrettier } from "../src/prettier/editor.ts";
import { createTempProject, linkRepositoryPackages, type TempProject } from "./helpers/temp-project.ts";

type FormatOptions = prettier.Options & MeekoPrettierOptions;

/** Formatea, comprueba que una segunda pasada no cambia nada y que el resultado compila. */
async function formatStable(source: string, options: FormatOptions = {}): Promise<string> {
  const settings: FormatOptions = { filepath: "Component.meeko", plugins: [plugin], ...options };
  const formatted = await prettier.format(source, settings);
  assert.equal(await prettier.format(formatted, settings), formatted, "formatting is idempotent");
  compile(formatted, settings.filepath!);
  return formatted;
}

/** Plantilla formateada, sin las etiquetas de sección. */
function templateOf(formatted: string): string {
  return formatted.slice(formatted.indexOf("<template>\n") + 11, formatted.indexOf("\n</template>"));
}

const warnings: string[] = [];
const write = classOrderWarnings.write;
before(() => { classOrderWarnings.write = (message) => { warnings.push(message); }; });
after(() => { classOrderWarnings.write = write; });

describe("static class attributes", () => {
  test("collapse whitespace, trim and drop repeated classes", async () => {
    const template = templateOf(await formatStable("<template>\n<div class=\"  card   stack\">a</div>\n<p class=\"one\ttwo\n   three one  two\">b</p>\n<span class=\"\">c</span>\n<i class=\" \t\n \"></i>\n<b class>d</b>\n</template>\n"));
    assert.equal(template, [
      '<div class="card stack">a</div>',
      '<p class="one two three">b</p>',
      '<span class="">c</span>',
      '<i class=""></i>',
      "<b class>d</b>",
    ].join("\n"));
  });

  test("keep a non-ASCII space inside a class, as HTML does", async () => {
    const template = templateOf(await formatStable("<template>\n<p class=\"a b  c\">x</p>\n</template>\n"));
    assert.equal(template, "<p class=\"a b c\">x</p>");
  });

  test("leave bind:class, other attributes, component props and character references alone", async () => {
    const source = [
      '<script lang="ts">',
      'import Card from "./Card.meeko";',
      "const tone = \"a  b\";",
      "</script>",
      "<template>",
      '<div><span bind:class="tone" title="a  b  a" data-class="x  x">y</span><Card class="x  x" /><component is="Card" class="y  y"></component><p class="a &amp;  b">z</p></div>',
      "</template>",
      "",
    ].join("\n");
    const template = templateOf(await formatStable(source, { printWidth: 200 }));
    assert.ok(template.includes('<span bind:class="tone" title="a  b  a" data-class="x  x">y</span>'), template);
    assert.ok(template.includes('<Card class="x  x" />'), template);
    assert.ok(template.includes('<component is="Card" class="y  y"></component>'), template);
    assert.ok(template.includes('<p class="a &amp;  b">z</p>'), template);
  });

  test("meekoSortClasses alphabetical sorts by code unit and off keeps the order", async () => {
    const source = "<template>\n<p class=\"b  B a-2 a  b\">x</p>\n</template>\n";
    assert.equal(templateOf(await formatStable(source, { meekoSortClasses: "alphabetical" })), '<p class="B a a-2 b">x</p>');
    assert.equal(templateOf(await formatStable(source)), '<p class="b B a-2 a">x</p>');
  });

  test("the option is a stable choice, off by default", () => {
    const option = plugin.options?.meekoSortClasses as { type?: string; default?: unknown; choices?: Array<{ value: unknown }> } | undefined;
    assert.deepEqual({ type: option?.type, default: option?.default, choices: option?.choices?.map((choice) => choice.value) }, {
      type: "choice", default: "off", choices: ["off", "stylesheet", "alphabetical"],
    });
  });
});

describe("meekoSortClasses stylesheet", () => {
  const projects: TempProject[] = [];
  after(async () => { await Promise.all(projects.map((project) => project.remove())); });

  async function project(prefix: string, files: Record<string, string>): Promise<string> {
    const created = await createTempProject(prefix);
    projects.push(created);
    await linkRepositoryPackages(created.root);
    const all: Record<string, string> = { "package.json": '{"private":true,"type":"module","devDependencies":{"@meekojs/meeko":"*"}}\n', ...files };
    for (const [path, contents] of Object.entries(all)) {
      await mkdir(dirname(join(created.root, path)), { recursive: true });
      await writeFile(join(created.root, path), contents);
    }
    return created.root;
  }

  const stylesheetProject: Record<string, string> = {
    // The configuration a project writes; the counter shows how often the stylesheet is processed.
    "postcss.config.ts": `import { meekoUtilities } from "@meekojs/meeko/postcss";
const counter = { postcssPlugin: "count", Once() { (globalThis as Record<string, number>).__meekoStylesheetRuns = ((globalThis as Record<string, number>).__meekoStylesheetRuns ?? 0) + 1; } };
export default { plugins: [meekoUtilities(), counter] };
`,
    "app/styles/main.css": `@import "./base.css";\n.zeta { color: red; }\n@utilities "./utilities/tone.ts";\n.alpha { color: blue; }\n`,
    "app/styles/base.css": `.stack { display: grid; }\n.card .title { margin: 0; }\n`,
    "app/styles/utilities/names.ts": `export const names = ["tone-b", "tone-a"];\n`,
    "app/styles/utilities/tone.ts": `import { defineUtilities } from "@meekojs/meeko/postcss";
import { names } from "./names.ts";
export default defineUtilities(({ rule }) => names.map((name) => rule(\`.\${name}\`, { color: "green" })));
`,
  };

  const component = [
    "<template>",
    '<div class="extra alpha tone-a  local stack zeta other card tone-b alpha">x</div>',
    "</template>",
    "<style scoped>",
    ".local { color: red; }",
    ".stack { color: blue; }",
    "</style>",
    "",
  ].join("\n");

  const runs = (): number => (globalThis as { __meekoStylesheetRuns?: number }).__meekoStylesheetRuns ?? 0;

  test("orders known classes as the processed stylesheet, unknown first and the component's after", async () => {
    const root = await project("prettier-classes-", stylesheetProject);
    const filepath = join(root, "app", "components", "Box.meeko");
    const options: FormatOptions = { filepath, meekoSortClasses: "stylesheet" };
    const sorted = '<div class="extra other stack card zeta tone-b tone-a alpha local">x</div>';
    const before = runs();
    assert.equal(templateOf(await formatStable(component, options)), sorted);
    // Every later format reuses the processed stylesheet while none of its files changes.
    assert.equal(templateOf(await formatStable(component, options)), sorted);
    assert.equal(runs() - before, 1, "the stylesheet is processed once");
    assert.equal(templateOf(await formatStable(component, { filepath })), '<div class="extra alpha tone-a local stack zeta other card tone-b">x</div>', "off keeps the order");

    // A module that an @utilities module imports changes: the order follows it.
    const names = join(root, "app/styles/utilities/names.ts");
    await writeFile(names, `export const names = ["tone-a", "tone-b"];\n`);
    const later = new Date(Date.now() + 2_000);
    await utimes(names, later, later);
    assert.equal(templateOf(await formatStable(component, options)), '<div class="extra other stack card zeta tone-a tone-b alpha local">x</div>');
    assert.equal(runs() - before, 2);
    assert.deepEqual(warnings.filter((warning) => warning.includes(root)), []);

    // The language server sorts in a trusted workspace with the project's configuration, never in an untrusted one.
    await writeFile(join(root, ".prettierrc"), '{ "meekoSortClasses": "stylesheet" }\n');
    const trusted = await formatWithPrettier({ text: component, filename: filepath, tabSize: 2, insertSpaces: true, trusted: true });
    assert.equal(templateOf(trusted!.text), '<div class="extra other stack card zeta tone-a tone-b alpha local">x</div>');
    const untrusted = await formatWithPrettier({ text: component, filename: filepath, tabSize: 2, insertSpaces: true, trusted: false });
    assert.equal(templateOf(untrusted!.text), '<div class="extra alpha tone-a local stack zeta other card tone-b">x</div>');
  });

  test("without app/styles/main.css only normalizes, and warns once", async () => {
    const root = await project("prettier-classes-missing-", { "meeko.config.ts": "export default {};\n" });
    const options: FormatOptions = { filepath: join(root, "app", "pages", "index.meeko"), meekoSortClasses: "stylesheet" };
    assert.equal(templateOf(await formatStable(component, options)), '<div class="extra alpha tone-a local stack zeta other card tone-b">x</div>');
    assert.equal(templateOf(await formatStable(component, options)), '<div class="extra alpha tone-a local stack zeta other card tone-b">x</div>');
    const own = warnings.filter((warning) => warning.includes(root));
    assert.equal(own.length, 1, own.join(""));
    assert.match(own[0]!, /no existe app\/styles\/main\.css/);
  });

  test("a stylesheet that does not process only normalizes, and warns once", async () => {
    const root = await project("prettier-classes-broken-", {
      "postcss.config.ts": stylesheetProject["postcss.config.ts"]!,
      "app/styles/main.css": `.stack { display: grid; }\n@utilities "./utilities/missing.ts";\n`,
    });
    const options: FormatOptions = { filepath: join(root, "app", "Box.meeko"), meekoSortClasses: "stylesheet" };
    assert.equal(templateOf(await formatStable(component, options)), '<div class="extra alpha tone-a local stack zeta other card tone-b">x</div>');
    const own = warnings.filter((warning) => warning.includes(root));
    assert.equal(own.length, 1, own.join(""));
    assert.match(own[0]!, /no se pudo procesar app\/styles\/main\.css en .*@utilities no encuentra "\.\/utilities\/missing\.ts"/);
    // Once the stylesheet is fixed, the next format sorts.
    const stylesheet = join(root, "app/styles/main.css");
    await writeFile(stylesheet, ".zeta { color: red; }\n.stack { display: grid; }\n");
    const later = new Date(Date.now() + 2_000);
    await utimes(stylesheet, later, later);
    assert.equal(templateOf(await formatStable(component, options)), '<div class="extra alpha tone-a other card tone-b zeta stack local">x</div>');
  });
});
