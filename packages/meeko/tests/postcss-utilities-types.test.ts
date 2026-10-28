import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import ts from "@typescript/typescript6";
import { createTempProject, linkRepositoryPackages } from "./helpers/temp-project.ts";

const tsconfig = JSON.stringify({
  compilerOptions: {
    target: "ES2022", module: "NodeNext", moduleResolution: "NodeNext", lib: ["ES2022", "DOM"], types: [],
    strict: true, exactOptionalPropertyTypes: true, noEmit: true, skipLibCheck: true,
  },
  include: ["*.ts"],
});

/** Type-checks `files` with TypeScript 7 against the built declarations, as an application that imports the package. */
async function check(files: Record<string, string>): Promise<{ status: number | null; output: string }> {
  const project = await createTempProject("postcss-utilities-types-");
  try {
    await linkRepositoryPackages(project.root);
    await writeFile(join(project.root, "package.json"), JSON.stringify({ type: "module" }));
    await writeFile(join(project.root, "tsconfig.json"), tsconfig);
    for (const [name, source] of Object.entries(files)) await writeFile(join(project.root, name), source);
    const result = spawnSync(process.execPath, [resolve("node_modules/typescript/bin/tsc"), "-p", join(project.root, "tsconfig.json")], { encoding: "utf8", windowsHide: true });
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  } finally {
    await project.remove();
  }
}

const declarations = `import type { UtilityAtRuleDeclarations, UtilityDeclarations, UtilityHelpers, UtilityValue } from "@meekojs/meeko/postcss";

declare const { rule, atRule }: UtilityHelpers;

// Standard, vendor and custom properties, with csstype's values.
const valid: UtilityDeclarations = {
  backgroundColor: "red",
  borderRadius: "1rem",
  padding: "0.5rem 1rem",
  margin: 0,
  transitionDuration: "200ms",
  WebkitAppearance: "none",
  msFlex: "1",
  "--color-1": "var(--gray-1)",
  "--columns": 3,
  outline: undefined,
};
// Unitless numbers where csstype admits them.
const unitless: UtilityDeclarations = { opacity: 0.5, zIndex: 10, flexGrow: 1, lineHeight: 1.5, fontWeight: 600 };
// Kebab-case keys, which the plugin writes as they are.
const kebab: UtilityDeclarations = { "background-color": "red", "-webkit-appearance": "none", "z-index": 10 };
// Fallback values, mutable or readonly.
const fallback = ["-webkit-box", "flex"] as const;
const fallbacks: UtilityDeclarations = { display: ["-webkit-box", "flex"], width: fallback.length ? ["100%", "-webkit-fill-available"] : "auto" };
const readonlyFallbacks: UtilityDeclarations = { display: fallback };
// !important, also where csstype only admits keywords.
const important: UtilityDeclarations = { color: "red !important", position: "absolute !important", boxSizing: ["border-box!important"] };
const value: UtilityValue = 4;

// @ts-expect-error a misspelled property
const typo: UtilityDeclarations = { backgroundColr: "red" };
// @ts-expect-error a length needs its unit: the plugin writes "padding: 4"
const unitlessLength: UtilityDeclarations = { padding: 4 };
// @ts-expect-error a time needs its unit too
const unitlessTime: UtilityDeclarations = { transitionDuration: 200 };
// @ts-expect-error a keyword csstype does not know
const keyword: UtilityDeclarations = { position: "absolut" };
// @ts-expect-error undefined omits a declaration, not a fallback value
const undefinedFallback: UtilityDeclarations = { display: ["flex", undefined] };

// rule(): the second argument is the declarations or the first child.
const card = rule(".card", { padding: "1rem" }, rule("&:hover", { opacity: 0.9 }));
const nested = rule(".card", rule("&:hover", { opacity: 0.9 }), [atRule("media", "(min-width: 48rem)", { padding: "2rem" })]);
// @ts-expect-error a misspelled property in rule()
const wrongRule = rule(".card", { backgroundColr: "red" });
// @ts-expect-error a unitless length in rule()
const wrongLength = rule(".card", { padding: 4 });

// atRule(): properties and the descriptors of @font-face, @property, @page…
const font = atRule("font-face", "", { fontFamily: "Inter", src: "url('/inter.woff2') format('woff2')", fontDisplay: "swap", "unicode-range": "U+0-FF", fontWeight: "100 900" });
const property = atRule("property", "--angle", { syntax: "'<angle>'", inherits: "false", initialValue: "0deg" });
const page = atRule("page", "", { size: "A4", margin: "1cm" });
const media = atRule("media", "(min-width: 48rem)", valid, rule(".stack", { flexDirection: "row" }));
// @ts-expect-error a misspelled descriptor
const wrongDescriptor = atRule("font-face", "", { fontDisplya: "swap" });
// The declarations of an at-rule are still UtilityDeclarations.
const body: UtilityDeclarations = font.declarations;
const descriptors: UtilityAtRuleDeclarations = { src: "url(a.woff2)" };

void [valid, unitless, kebab, fallbacks, readonlyFallbacks, important, value, typo, unitlessLength, unitlessTime, keyword,
  undefinedFallback, card, nested, wrongRule, wrongLength, font, property, page, media, wrongDescriptor, body, descriptors];
`;

/** The examples of docs/framework.md, which build declarations from strings and \`Object.fromEntries\`. */
const documented = `import { defineUtilities } from "@meekojs/meeko/postcss";

const colors = ["gray", "blue", "red"] as const;
const steps = Array.from({ length: 12 }, (_, i) => i + 1);
const names: readonly string[] = ["gray", "blue"];
const sizes = { sm: "0.25rem 0.5rem", md: "0.5rem 1rem", lg: "0.75rem 1.5rem" };
const tokens: Record<string, string> = { "--radius": "0.5rem" };

export const color = defineUtilities(({ rule, atRule }) => [
  colors.map((name) =>
    rule(\`.color[data-color='\${name}']\`, Object.fromEntries(steps.map((step) => [\`--color-\${step}\`, \`var(--\${name}-\${step})\`])))),
  names.map((name) => rule(\`.color[data-color='\${name}']\`, Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [\`--color-\${i + 1}\`, \`var(--\${name}-\${i + 1})\`])))),
  rule(".color", { color: "var(--color-11)" },
    rule("&:hover", { backgroundColor: "var(--color-3)" }),
    atRule("media", "(prefers-contrast: more)", { color: "var(--color-12)" })),
  rule(":root", tokens),
]);

export const buttonSizes = defineUtilities(({ rule }) =>
  Object.entries(sizes).map(([size, padding]) => rule(\`.button[data-size='\${size}']\`, { padding })));
`;

test("UtilityDeclarations types properties and values with csstype", async () => {
  const result = await check({ "declarations.ts": declarations });
  assert.equal(result.status, 0, result.output);
});

test("the documented utilities, built with Object.fromEntries, still compile", async () => {
  const result = await check({ "documented.ts": documented });
  assert.equal(result.status, 0, result.output);
});

test("rule() and atRule() complete CSS properties and keywords in the declarations object", () => {
  // In memory only, next to the sources so `./postcss.js` resolves; TypeScript uses `/` separators.
  const file = resolve("src/__postcss-completions.ts").replaceAll("\\", "/");
  const source = `import type { UtilityHelpers } from "./postcss.js";
declare const { rule, atRule }: UtilityHelpers;
rule(".card", { });
rule(".card", { position: "" });
atRule("font-face", "", { });
`;
  const options: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true, exactOptionalPropertyTypes: true, types: ["node"], skipLibCheck: true,
  };
  const service = ts.createLanguageService({
    getScriptFileNames: () => [file],
    getScriptVersion: () => "1",
    getScriptSnapshot: (name) => {
      const text = name === file ? source : ts.sys.readFile(name);
      return text === undefined ? undefined : ts.ScriptSnapshot.fromString(text);
    },
    getCurrentDirectory: () => process.cwd(),
    getCompilationSettings: () => options,
    getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
    fileExists: (name) => name === file || ts.sys.fileExists(name),
    readFile: (name) => name === file ? source : ts.sys.readFile(name),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
  });
  const names = (marker: string, offset: number): string[] =>
    service.getCompletionsAtPosition(file, source.indexOf(marker) + offset, {})?.entries.map((entry) => entry.name) ?? [];
  try {
    const properties = names(`rule(".card", { })`, `rule(".card", { `.length);
    for (const name of ["backgroundColor", "padding", "WebkitAppearance", "\"background-color\""]) assert.ok(properties.includes(name), name);
    // The members of the nodes, the other overload, are not offered.
    for (const name of ["kind", "selector", "children"]) assert.ok(!properties.includes(name), name);
    const keywords = names(`position: ""`, `position: "`.length);
    assert.ok(keywords.includes("absolute") && keywords.includes("sticky"), keywords.join(","));
    const descriptors = names(`atRule("font-face", "", { })`, `atRule("font-face", "", { `.length);
    for (const name of ["src", "fontDisplay", "unicodeRange", "fontFamily"]) assert.ok(descriptors.includes(name), name);
  } finally {
    service.dispose();
  }
});
