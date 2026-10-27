import assert from "node:assert/strict";
import { mkdir, utimes, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";
import postcss, { type AcceptedPlugin, type CssSyntaxError, type Message } from "postcss";
import { defineUtilities, meekoUtilities } from "../src/postcss.ts";
import { createTempProject, linkRepositoryPackages, type TempProject } from "./helpers/temp-project.ts";

/** Writes `files` (paths relative to the project) and returns the project. */
async function project(files: Record<string, string>): Promise<TempProject> {
  const created = await createTempProject("postcss-utilities-");
  await linkRepositoryPackages(created.root);
  await write(created.root, files);
  return created;
}

async function write(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, contents] of Object.entries(files)) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, contents);
  }
}

/** Rewrites a file with a later modification time, so a same-millisecond write is still a change. */
async function edit(file: string, contents: string): Promise<void> {
  await writeFile(file, contents);
  const later = new Date(Date.now() + 2_000);
  await utimes(file, later, later);
}

async function run(css: string, from: string | undefined, plugins: AcceptedPlugin[] = [meekoUtilities()]) {
  return postcss(plugins).process(css, { from });
}

function compact(css: string): string {
  return css.replace(/\s+/g, " ").replace(/\s*([{};:,])\s*/g, "$1").replaceAll(";}", "}").trim();
}

function dependencies(messages: readonly Message[]): string[] {
  return messages.filter((message) => message.type === "dependency").map((message) => String(message["file"]).replaceAll("\\", "/")).sort();
}

async function rejection(promise: PromiseLike<unknown>): Promise<CssSyntaxError> {
  try {
    await promise;
  } catch (error) {
    return error as CssSyntaxError;
  }
  assert.fail("the stylesheet was expected to fail");
}

test("@utilities expands a TypeScript module inside its layer and reports its local imports", async () => {
  const fixture = await project({
    "app/styles/utilities/palette.ts": `export const names: readonly string[] = ["gray", "blue"];\nexport const steps = 3;\n`,
    "app/styles/utilities/color.ts": `import { defineUtilities } from "@meekojs/meeko/postcss";
import { names, steps } from "./palette";
export default defineUtilities(({ rule }) =>
  names.map((name) => rule(\`.color[data-color='\${name}']\`, Object.fromEntries(
    Array.from({ length: steps }, (_, i) => [\`--color-\${i + 1}\`, \`var(--\${name}-\${i + 1})\`])))));
`,
  });
  try {
    const from = join(fixture.root, "app/styles/main.css");
    const result = await run(`@layer tokens, utilities;\n@utilities './utilities/color.ts' layer(utilities);\n.after { color: red; }\n`, from);
    assert.equal(compact(result.css), compact(`@layer tokens, utilities;
@layer utilities {
  .color[data-color='gray'] { --color-1: var(--gray-1); --color-2: var(--gray-2); --color-3: var(--gray-3) }
  .color[data-color='blue'] { --color-1: var(--blue-1); --color-2: var(--blue-2); --color-3: var(--blue-3) }
}
.after { color: red; }`));
    const root = fixture.root.replaceAll("\\", "/");
    assert.deepEqual(dependencies(result.messages), [`${root}/app/styles/utilities/color.ts`, `${root}/app/styles/utilities/palette.ts`]);
    const message = result.messages.find((item) => item.type === "dependency");
    assert.equal(message?.plugin, "meeko-utilities");
    assert.equal(message?.["parent"], from);
  } finally {
    await fixture.remove();
  }
});

test("helpers nest rules, at-rules and raw CSS and normalize declarations", async () => {
  const fixture = await project({
    "utilities.ts": `import { defineUtilities } from "@meekojs/meeko/postcss";
export default defineUtilities(({ rule, atRule, css }) => [
  rule(".button", { borderRadius: "1rem", WebkitAppearance: "none", msFlex: 1, "--button-gap": " 0.5rem ", outline: undefined, display: ["-webkit-box", "flex"] },
    rule("&:hover", { opacity: 0.9 }),
    atRule("media", "(pointer: coarse)", { minHeight: "2.75rem" }),
    [null, false, undefined, [rule("> .icon", { color: "currentColor !important" })]],
  ),
  atRule("supports", "(display: grid)", rule(".grid", { display: "grid" })),
  atRule("layer", "a, b"),
  atRule("property", "--angle", { syntax: "'<angle>'", inherits: "false", initialValue: "0deg" }),
  css\`@keyframes spin { to { transform: rotate(1turn) } }\`,
  css(".quote::before { content: \\"\\\\201C\\" }"),
  css\`.quote::after { content: "\\201D" }\`,
]);
`,
  });
  try {
    const result = await run(`@utilities "./utilities.ts";`, join(fixture.root, "main.css"));
    assert.equal(compact(result.css), compact(`.button {
  border-radius: 1rem; -webkit-appearance: none; -ms-flex: 1; --button-gap: 0.5rem; display: -webkit-box; display: flex;
  &:hover { opacity: 0.9 }
  @media (pointer: coarse) { min-height: 2.75rem }
  > .icon { color: currentColor !important }
}
@supports (display: grid) { .grid { display: grid } }
@layer a, b;
@property --angle { syntax: '<angle>'; inherits: false; initial-value: 0deg }
@keyframes spin { to { transform: rotate(1turn) } }
.quote::before { content: "\\201C" }
.quote::after { content: "\\201D" }`));
  } finally {
    await fixture.remove();
  }
});

test("@utilities accepts async and plain default functions in .mjs and .mts modules", async () => {
  const fixture = await project({
    // The bundle runs from a data: URL; import.meta still names the original file.
    "plain.mjs": `import { readFileSync } from "node:fs";
const { zIndex } = JSON.parse(readFileSync(new URL("./data/z.json", import.meta.url), "utf8"));
const named = import.meta.filename.endsWith("plain.mjs") && import.meta.dirname.length > 0;
export default async ({ rule }) => { await new Promise((resolve) => setTimeout(resolve, 5)); return named && rule(".plain", { zIndex }); };
`,
    "data/z.json": `{ "zIndex": 10 }\n`,
    "typed.mts": `import type { UtilityFunction } from "@meekojs/meeko/postcss";
const sizes = { sm: "0.25rem 0.5rem", md: "0.5rem 1rem", lg: "0.75rem 1.5rem" } satisfies Record<string, string>;
const utilities: UtilityFunction = async ({ rule }) => Object.entries(sizes).map(([size, padding]) => rule(\`.button[data-size='\${size}']\`, { padding }));
export default utilities;
`,
  });
  try {
    const result = await run(`@utilities "./plain.mjs" layer;\n@media print { @utilities "./typed.mts"; }`, join(fixture.root, "main.css"));
    assert.equal(compact(result.css), compact(`@layer { .plain { z-index: 10 } }
@media print {
.button[data-size='sm'] { padding: 0.25rem 0.5rem }
.button[data-size='md'] { padding: 0.5rem 1rem }
.button[data-size='lg'] { padding: 0.75rem 1.5rem }
}`));
  } finally {
    await fixture.remove();
  }
});

test("@utilities reloads a module when it or a local import changes, and only then", async () => {
  const fixture = await project({
    "lib/steps.ts": `export const steps = 2;\n`,
    "utilities.ts": `import { steps } from "./lib/steps";
const counter = globalThis as { __meekoUtilitiesEvaluations?: number };
counter.__meekoUtilitiesEvaluations = (counter.__meekoUtilitiesEvaluations ?? 0) + 1;
export default ({ rule }: import("@meekojs/meeko/postcss").UtilityHelpers) => rule(".steps", { "--steps": steps });
`,
  });
  const counter = globalThis as { __meekoUtilitiesEvaluations?: number };
  delete counter.__meekoUtilitiesEvaluations;
  try {
    const from = join(fixture.root, "main.css");
    const css = `@utilities "./utilities.ts";`;
    assert.match((await run(css, from)).css, /--steps: 2/);
    assert.match((await run(css, from)).css, /--steps: 2/);
    assert.equal(counter.__meekoUtilitiesEvaluations, 1, "an unchanged module is not evaluated again");
    await edit(join(fixture.root, "lib/steps.ts"), `export const steps = 5;\n`);
    assert.match((await run(css, from)).css, /--steps: 5/, "a nested import change reaches the output");
    assert.equal(counter.__meekoUtilitiesEvaluations, 2);
    await edit(join(fixture.root, "utilities.ts"), `export default ({ rule }: any) => rule(".edited", { "--edited": 1 });\n`);
    const edited = await run(css, from);
    assert.match(edited.css, /\.edited/);
    assert.deepEqual(dependencies(edited.messages), [join(fixture.root, "utilities.ts").replaceAll("\\", "/")], "the dependencies follow the new imports");
  } finally {
    delete counter.__meekoUtilitiesEvaluations;
    await fixture.remove();
  }
});

test("@utilities resolves paths from a .meeko style block and from its options without a file", async () => {
  const fixture = await project({
    "app/components/utilities.ts": `export default ({ rule }: any) => rule(".local", { color: "red" });\n`,
    "shared/utilities.ts": `export default ({ rule }: any) => rule(".shared", { color: "blue" });\n`,
  });
  try {
    const component = `${join(fixture.root, "app/components/Card.meeko")}?meeko-style=${"a".repeat(64)}&lang.css`;
    const scoped = await run(`.card[data-meeko-s-1] { color: red }\n@utilities "./utilities.ts";`, component);
    assert.match(scoped.css, /\.local \{/);
    assert.equal(dependencies(scoped.messages)[0], join(fixture.root, "app/components/utilities.ts").replaceAll("\\", "/"));
    assert.equal(scoped.messages.find((item) => item.type === "dependency")?.["parent"], join(fixture.root, "app/components/Card.meeko"));
    const fileless = await postcss([meekoUtilities({ root: join(fixture.root, "shared") })]).process(`@utilities "./utilities.ts";`, { from: undefined });
    assert.match(fileless.css, /\.shared \{/);
  } finally {
    await fixture.remove();
  }
});

test("@utilities reports module and output errors at the at-rule line", async () => {
  const fixture = await project({
    "not-function.ts": `export default { rule: true };\n`,
    "throws.ts": `export default () => { throw new Error("palette missing"); };\n`,
    "syntax.ts": `export default ({ rule }: any) => rule(".a", {;\n`,
    "selector.ts": `export default ({ rule }: any) => rule(".a[", { color: "red" });\n`,
    "value.ts": `export default ({ rule }: any) => rule(".a", { color: "red; background: blue" });\n`,
    "number.ts": `export default ({ rule }: any) => rule(".a", { opacity: Number.NaN });\n`,
    "property.ts": `export default ({ rule }: any) => rule(".a", { "col or": "red" });\n`,
    "string.ts": `export default () => ".a { color: red }";\n`,
    "forged.ts": `export default () => ({ kind: "rule", selector: ".a", declarations: {}, children: [] });\n`,
    "raw.ts": `export default ({ css }: any) => css\`.a { color: red\`;\n`,
    "params.ts": `export default ({ atRule }: any) => atRule("media", "screen {", []);\n`,
    "data.json": `{}`,
  });
  try {
    const from = join(fixture.root, "main.css");
    const cases: Array<[string, RegExp]> = [
      [`@utilities "./missing.ts";`, /no encuentra "\.\/missing\.ts"/],
      [`@utilities "./data.json";`, /\.ts, \.mts, \.js o \.mjs/],
      [`@utilities ./throws.ts;`, /espera una ruta entre comillas/],
      [`@utilities "./throws.ts" layer(1x);`, /nombre de capa no válido/],
      [`@utilities "./throws.ts" { }`, /no lleva bloque/],
      [`@utilities "./not-function.ts";`, /debe exportar por defecto una función/],
      [`@utilities "./throws.ts";`, /lanzó un error al generar las utilidades: palette missing/],
      [`@utilities "./syntax.ts";`, /no pudo cargar "\.\/syntax\.ts"/],
      [`@utilities "./selector.ts";`, /selector no válido "\.a\["/],
      [`@utilities "./value.ts";`, /valor no válido para color/],
      [`@utilities "./number.ts";`, /opacity tiene el valor NaN/],
      [`@utilities "./property.ts";`, /nombre de propiedad no válido "col or"/],
      [`@utilities "./string.ts";`, /envuelva el CSS literal con css/],
      [`@utilities "./forged.ts";`, /no es un nodo de utilidades/],
      [`@utilities "./raw.ts";`, /no es CSS válido/],
      [`@utilities "./params.ts";`, /parámetros no válidos para @media/],
    ];
    for (const [rule, expected] of cases) {
      const error = await rejection(run(`.before { color: red }\n\n${rule}\n`, from));
      assert.equal(error.name, "CssSyntaxError", rule);
      assert.match(error.message, expected, rule);
      assert.equal(error.file, from, rule);
      assert.equal(error.line, 3, rule);
      assert.equal(error.plugin, "meeko-utilities", rule);
    }
  } finally {
    await fixture.remove();
  }
});

test("a later plugin such as Tailwind sees the generated rules; an earlier one sees the at-rule", async () => {
  const fixture = await project({ "utilities.ts": `export default ({ rule }: any) => rule(".generated", { color: "red" });\n` });
  try {
    const seen: string[][] = [];
    // Tailwind's PostCSS plugin compiles the whole stylesheet in `Once`, like this probe.
    const probe = { postcssPlugin: "probe", Once(root: postcss.Root) { const names: string[] = []; root.walk((node) => { names.push(node.type === "rule" ? node.selector : node.type === "atrule" ? `@${node.name}` : node.type); }); seen.push(names); } };
    const from = join(fixture.root, "main.css");
    const after = await run(`@utilities "./utilities.ts";`, from, [meekoUtilities(), probe]);
    const before = await run(`@utilities "./utilities.ts";`, from, [probe, meekoUtilities()]);
    assert.deepEqual(seen, [[".generated", "decl"], ["@utilities"]]);
    assert.equal(compact(after.css), compact(before.css));
    assert.deepEqual(after.warnings(), []);
    // Tailwind 4's own at-rule is `@utility`; it is left untouched.
    const tailwind = await run(`@utility tab-4 { tab-size: 4; }\n@utilities "./utilities.ts";`, from);
    assert.match(tailwind.css, /@utility tab-4/);
    // Tailwind drops the at-rules it does not know from a stylesheet it compiles: running first is warned.
    const fakeTailwind = { postcssPlugin: "tailwindcss", Once() {} };
    const misordered = await run(`@utilities "./utilities.ts";`, from, [fakeTailwind, meekoUtilities()]);
    assert.match(misordered.warnings().map((warning) => warning.text).join("\n"), /colóquelo antes de @tailwindcss\/postcss/);
  } finally {
    await fixture.remove();
  }
});

test("defineUtilities returns the same function and the plugin is a PostCSS creator", () => {
  const utilities = defineUtilities(({ rule }) => rule(".a", { color: "red" }));
  assert.equal(typeof utilities, "function");
  assert.equal(defineUtilities(utilities), utilities);
  assert.equal(meekoUtilities.postcss, true);
  assert.equal((meekoUtilities() as { postcssPlugin?: string }).postcssPlugin, "meeko-utilities");
});
