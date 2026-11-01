import ts from "@typescript/typescript6";
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import test from "node:test";

import { moduleSpecifiers } from "../src/compiler/import-graph.ts";
import { checkFrameworkProject } from "../src/framework/check-project.ts";
import { configTypesSource, writeConfigTypesSync } from "../src/framework/config-types.ts";
import { loadConfiguredModules, loadMeekoConfig } from "../src/framework/config.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { classifyModuleEntry, installedModulePackageNames, resolveMeekoModules } from "../src/framework/module-loader.ts";
import { buildProject } from "../src/framework/project.ts";
import { deprecatedModuleEntries } from "../src/language-server/config-diagnostics.ts";
import { linkRepositoryPackages, tempProject } from "./helpers/temp-project.ts";

async function put(root: string, path: string, source: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
}

/** Runs `run` and returns what it wrote to stderr. */
async function stderrOf(run: () => Promise<unknown>): Promise<string> {
  const original = process.stderr.write;
  let written = "";
  process.stderr.write = ((chunk: string | Uint8Array) => { written += String(chunk); return true; }) as typeof process.stderr.write;
  try { await run(); } finally { process.stderr.write = original; }
  return written;
}

const greetModule = `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({
  meta: { name: "@acme/greet", configKey: "greet" },
  defaults: { word: "hola", times: 1 },
  setup(options) { globalThis.__greetOptions = options; },
});
`;

const greetTypes = `import type { MeekoModule } from "@meekojs/meeko/framework";
export interface GreetOptions { readonly word: string; readonly times?: number }
declare module "@meekojs/meeko/framework" {
  interface MeekoConfig {
    /** Opciones del módulo greet. */
    readonly greet?: GreetOptions;
  }
}
declare const greet: MeekoModule<GreetOptions>;
export default greet;
`;

/**
 * A project with three installed packages: \`@acme/greet\`, whose root is its runtime and whose
 * module is the \`./module\` subpath (as \`@meekojs/i18n\`); \`acme-plain\`, whose root exports the
 * module (as \`@meekojs/ui\`); and \`not-module\`, a package that is not a module.
 */
async function moduleProject(context: test.TestContext, name: string): Promise<string> {
  const root = await tempProject(context, name);
  await linkRepositoryPackages(root);
  await put(root, "package.json", JSON.stringify({
    name, private: true, type: "module",
    dependencies: { "@acme/greet": "1.0.0", "acme-plain": "1.0.0", "not-module": "1.0.0" },
  }));
  await put(root, "node_modules/@acme/greet/package.json", JSON.stringify({
    name: "@acme/greet", type: "module", keywords: ["meeko-module"],
    exports: { ".": "./runtime.js", "./module": { types: "./module.d.ts", default: "./module.js" } },
  }));
  await put(root, "node_modules/@acme/greet/runtime.js", "export const runtime = true;\n");
  await put(root, "node_modules/@acme/greet/module.js", greetModule);
  await put(root, "node_modules/@acme/greet/module.d.ts", greetTypes);
  await put(root, "node_modules/acme-plain/package.json", JSON.stringify({ name: "acme-plain", type: "module", keywords: ["meeko-module"], exports: "./index.js" }));
  await put(root, "node_modules/acme-plain/index.js", `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "acme-plain", configKey: "plain" }, setup(options) { globalThis.__plainOptions = options; } });
`);
  await put(root, "node_modules/not-module/package.json", JSON.stringify({ name: "not-module", type: "module", exports: "./index.js" }));
  await put(root, "node_modules/not-module/index.js", "export default { meta: { name: 'not-module' } };\n");
  await put(root, "app/pages/index.meeko", "<template><p>Home</p></template>\n");
  return root;
}

test("a module named by its package resolves its ./module subpath or its root and reads its options from configKey", async (context) => {
  const root = await moduleProject(context, "module-strings");
  assert.deepEqual(installedModulePackageNames(root), ["@acme/greet", "acme-plain"]);
  const greet = classifyModuleEntry(root, "@acme/greet");
  assert.equal(greet.kind === "module" && greet.specifier, "@acme/greet/module");
  const plain = classifyModuleEntry(root, "acme-plain");
  assert.equal(plain.kind === "module" && plain.specifier, "acme-plain");
  await put(root, "meeko.config.mjs", `export default { modules: ["@acme/greet", "acme-plain"], greet: { word: "hi" }, plain: { flag: true } };\n`);
  const warned = await stderrOf(async () => {
    const { modules } = await loadConfiguredModules(root);
    assert.deepEqual(modules.names, ["@acme/greet", "acme-plain"]);
  });
  assert.equal(warned, "", "the documented form warns of nothing");
  const globals = globalThis as Record<string, unknown>;
  assert.deepEqual(globals.__greetOptions, { word: "hi", times: 1 });
  assert.deepEqual(globals.__plainOptions, { flag: true });
});

test("an imported module and [module, options] warn MEEK126 once, naming the string and the configKey", async (context) => {
  const root = await moduleProject(context, "module-deprecated");
  await put(root, "modules/local/index.ts", `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "local" }, setup() {} });
`);
  await put(root, "meeko.config.mjs", `import greet from "@acme/greet/module";
import plain from "acme-plain";
export default { modules: [greet, [plain, { flag: true }], ["./modules/local", { a: 1 }]], greet: { word: "hi" } };
`);
  const first = await stderrOf(() => loadConfiguredModules(root));
  const lines = first.trim().split("\n");
  assert.equal(lines.length, 3, first);
  assert.match(lines[0]!, /^\[meeko\] Aviso MEEK126: modules\[0\] de meeko\.config\.mjs usa el módulo importado @acme\/greet, obsoleto desde 1\.8\. Escríbalo por su nombre: modules: \["@acme\/greet"\] y sus opciones en greet: \{ … \}\..*Meeko 2\.0/);
  assert.match(lines[1]!, /modules\[1\] .* usa \[módulo, opciones\] con el módulo acme-plain.*modules: \["acme-plain"\] y sus opciones en plain: \{ … \}/);
  assert.match(lines[2]!, /modules\[2\] .*modules: \["\.\/modules\/local"\]\. El módulo no declara meta\.configKey, así que sus opciones sólo caben en \[módulo, opciones\] durante 1\.x/);
  assert.deepEqual((globalThis as Record<string, unknown>).__greetOptions, { word: "hi", times: 1 }, "the deprecated forms keep working");
  // A new configuration object of the same project runs the modules again, without repeating the warnings.
  const again = await stderrOf(async () => resolveMeekoModules(root, await loadMeekoConfig(root), { dev: true }));
  assert.equal(again, "");
});

test("an unknown module string, a package that is not a module and a shared configKey fail clearly; a key without its module warns MEEK127", async (context) => {
  const root = await moduleProject(context, "module-string-errors");
  await put(root, "node_modules/acme-twin/package.json", JSON.stringify({ name: "acme-twin", type: "module", exports: "./index.js" }));
  await put(root, "node_modules/acme-twin/index.js", `import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "acme-twin", configKey: "greet" }, setup() {} });
`);
  const cases: Array<[string, RegExp]> = [
    [`modules: ["@acme/gret"]`, /No se encuentra el módulo de Meeko @acme\/gret: no es un paquete instalado ni una ruta del proyecto\. ¿Quisiste decir "@acme\/greet"\?/],
    [`modules: ["left-pad-xyz"]`, /No se encuentra el módulo de Meeko left-pad-xyz: .*Instale el paquete \(pnpm add left-pad-xyz\)/],
    [`modules: ["./modules/none"]`, /No se encuentra el módulo de Meeko \.\/modules\/none: .* no existe/],
    [`modules: ["not-module"]`, /El paquete not-module no es un módulo de Meeko: .*debe exportar por defecto defineMeekoModule\(\.\.\.\), en su subpath \.\/module o en su raíz/],
    [`modules: ["@acme/greet", "acme-twin"]`, /Los módulos de Meeko @acme\/greet y acme-twin usan la misma meta\.configKey "greet"/],
  ];
  for (const [modules, error] of cases) {
    await put(root, "meeko.config.mjs", `export default { ${modules} };\n`);
    await assert.rejects(loadConfiguredModules(root), error, modules);
  }
  await put(root, "meeko.config.mjs", `export default { modules: ["acme-plain"], greet: { word: "hi" } };\n`);
  const warned = await stderrOf(() => loadConfiguredModules(root));
  assert.equal(warned, `[meeko] Aviso MEEK127: meeko.config.mjs tiene la clave "greet", que es la configKey del módulo @acme/greet, pero @acme/greet no está en modules, así que Meeko ignora sus opciones. Añádalo: modules: ["@acme/greet"].\n`);
  // Also without any module.
  await put(root, "meeko.config.mjs", `export default { greet: {} };\n`);
  assert.match(await stderrOf(() => loadConfiguredModules(root)), /^\[meeko\] Aviso MEEK127: .*"greet".*@acme\/greet/);
});

test("generated types load the augmentation of the modules: meeko check types and rejects their options", { timeout: 180_000 }, async (context) => {
  const root = await moduleProject(context, "module-string-types");
  await initFrameworkProject(join(root, "init"));
  const initTsconfig = JSON.parse(await readFile(join(root, "init", "tsconfig.json"), "utf8")) as { references: Array<{ path: string }> };
  assert.ok(initTsconfig.references.some((reference) => reference.path === "./.meeko/tsconfig.config.json"), "meeko init references the project of meeko.config.ts");
  await put(root, "meeko.config.ts", `import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  modules: ["@acme/greet", "./modules/local"],
  greet: { word: 42 },
});
`);
  await put(root, "modules/local/index.ts", `import { defineMeekoModule } from "@meekojs/meeko/framework";
declare module "@meekojs/meeko/framework" { interface MeekoConfig { readonly local?: { readonly on: boolean } } }
export default defineMeekoModule({ meta: { name: "local", configKey: "local" }, setup() {} });
`);
  assert.equal(configTypesSource(root, await loadMeekoConfig(root)), [
    "// Generated by Meeko from modules of meeko.config.*: the modules type their keys. Do not edit.",
    'import type {} from "@meekojs/meeko/framework";',
    'import type {} from "@acme/greet/module";',
    'import type {} from "../../modules/local/index";',
    'declare module "@meekojs/meeko/framework" {',
    "  interface MeekoModuleNames {",
    '    "@acme/greet": true;',
    '    "acme-plain": true;',
    "  }",
    "}",
    "export {};",
    "",
  ].join("\n"));
  await assert.rejects(checkFrameworkProject(root), (error: Error) => {
    assert.match(error.message, /meeko\.config\.ts:5:\d+ TS2322: Type 'number' is not assignable to type 'string'/);
    return true;
  });
  await put(root, "meeko.config.ts", `import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  modules: ["@acme/greet", "./modules/local"],
  greet: { word: "hi" },
  local: { on: "yes" },
});
`);
  await assert.rejects(checkFrameworkProject(root), /meeko\.config\.ts:6:\d+ TS2322/);
  await put(root, "meeko.config.ts", `import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  modules: ["@acme/greet", "./modules/local"],
  greet: { word: "hi" },
  local: { on: true },
});
`);
  await checkFrameworkProject(root);
  const tsconfig = JSON.parse(await readFile(join(root, ".meeko", "tsconfig.config.json"), "utf8")) as { include: string[] };
  assert.deepEqual(tsconfig.include, ["../meeko.config.ts", "../meeko.config.mts", "types/config.d.ts", "types/modules.d.ts"]);
});

test("meeko check types the configuration with the declarations that the modules generate", { timeout: 180_000 }, async (context) => {
  const root = await moduleProject(context, "module-generated-config-types");
  // The module types its option with an interface that its own generated declaration fills (as
  // @meekojs/icon does with the icon names of `icon.include`).
  await put(root, "modules/named/index.ts", `import { defineMeekoModule } from "@meekojs/meeko/framework";
export interface NamedChoices {}
declare module "@meekojs/meeko/framework" { interface MeekoConfig { readonly named?: { readonly pick: keyof NamedChoices } } }
export default defineMeekoModule({
  meta: { name: "named", configKey: "named" },
  setup(_options, meeko) {
    meeko.addTypeTemplate("choices.d.ts", 'export {};\\ndeclare module "../../../../modules/named/index" { interface NamedChoices { first: true } }\\n');
  },
});
`);
  const config = (pick: string): string => `import { defineMeekoConfig } from "@meekojs/meeko/framework";\n\nexport default defineMeekoConfig({\n  modules: ["./modules/named"],\n  named: { pick: ${JSON.stringify(pick)} },\n});\n`;
  await put(root, "meeko.config.ts", config("second"));
  await assert.rejects(checkFrameworkProject(root), /meeko\.config\.ts:5:\d+ TS2322: Type '"second"' is not assignable to type '"first"'/);
  await put(root, "meeko.config.ts", config("first"));
  await checkFrameworkProject(root);
});

test("the editor completes installed module names, types the module keys and marks the deprecated entries", async (context) => {
  const root = await moduleProject(context, "module-string-editor");
  const text = `import { defineMeekoConfig } from "@meekojs/meeko/framework";
import plain from "acme-plain";
import greet from "@acme/greet/module";

export default defineMeekoConfig({
  modules: ["", plain, [greet, { word: "x" }]],
  greet: { word: "hi" },
});
`;
  await put(root, "meeko.config.ts", text);
  // Before any generation, as the editor of a trusted workspace writes them: only strings count.
  writeConfigTypesSync(root, { modules: ["@acme/greet"] });
  const parsed = ts.getParsedCommandLineOfConfigFile(join(root, ".meeko", "tsconfig.config.json"), {}, { ...ts.sys, onUnRecoverableConfigFileDiagnostic: () => {} });
  assert.ok(parsed);
  const file = join(root, "meeko.config.ts").replaceAll("\\", "/");
  const service = ts.createLanguageService({
    getCompilationSettings: () => parsed.options,
    getScriptFileNames: () => parsed.fileNames,
    // The text is the version: the test rewrites meeko.config.ts.
    getScriptVersion: (name) => ts.sys.readFile(name) ?? "",
    getScriptSnapshot: (name) => { const content = ts.sys.readFile(name); return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content); },
    getCurrentDirectory: () => root,
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    ...(ts.sys.realpath ? { realpath: ts.sys.realpath } : {}),
  });
  assert.ok(parsed.fileNames.some((name) => name.toLowerCase() === file.toLowerCase()), "the project of the editor includes meeko.config.ts");
  const completions = service.getCompletionsAtPosition(file, text.indexOf('""') + 1, {});
  const names = completions?.entries.map((entry) => entry.name) ?? [];
  assert.ok(names.includes("@acme/greet") && names.includes("acme-plain"), names.join(", "));
  const hover = service.getQuickInfoAtPosition(file, text.indexOf("greet: {") + 1);
  // const T keeps the literal in the hover; the documentation comes from the augmentation of the module.
  assert.match(ts.displayPartsToString(hover?.displayParts), /\(property\) greet: \{/);
  assert.match(ts.displayPartsToString(hover?.documentation), /Opciones del módulo greet/);
  const keyCompletions = service.getCompletionsAtPosition(file, text.indexOf("greet: {"), {});
  assert.ok(keyCompletions?.entries.some((entry) => entry.name === "greet"));
  const wrong = text.replace('greet: { word: "hi" }', "greet: { word: 1 }");
  await put(root, "meeko.config.ts", wrong);
  const diagnostics = service.getSemanticDiagnostics(file).map((item) => ts.flattenDiagnosticMessageText(item.messageText, "\n"));
  assert.ok(diagnostics.some((message) => /not assignable to type 'string'/.test(message)), diagnostics.join("\n"));
  // MEEK126 in the editor, read from the text: the import names the package without /module.
  const deprecated = deprecatedModuleEntries(text, file);
  assert.deepEqual(deprecated.map((entry) => [entry.index, entry.name, text.slice(entry.start, entry.end)]), [
    [1, "acme-plain", "plain"],
    [2, "@acme/greet", '[greet, { word: "x" }]'],
  ]);
  assert.match(deprecated[1]!.message, /^MEEK126: modules\[2\] usa \[módulo, opciones\], obsoleto desde 1\.8\. Escríbalo por su nombre, modules: \["@acme\/greet"\]/);
});

test("a type-only import of a module package is not a client import of its server-only entry", () => {
  // `modules: ["@meekojs/ui"]` makes the package root a server-only module entry; a page that only
  // imports its types (`import type { UIContainerSize } from "@meekojs/ui"`) loads nothing from it.
  const code = 'import type { UIContainerSize } from "@meekojs/ui";\nexport type { UIOptions } from "@meekojs/ui";\nimport { useModal } from "@meekojs/ui/runtime";\n';
  assert.deepEqual(moduleSpecifiers(code, "page.ts").map(({ value, typeOnly }) => [value, typeOnly === true]), [
    ["@meekojs/ui", true], ["@meekojs/ui", true], ["@meekojs/ui/runtime", false],
  ]);
});

test("a client page may import the types of a module package listed by name, but not its module", { timeout: 180_000 }, async (context) => {
  const root = await moduleProject(context, "module-string-boundary");
  await put(root, "node_modules/acme-plain/package.json", JSON.stringify({
    name: "acme-plain", type: "module", keywords: ["meeko-module"], exports: { ".": { types: "./index.d.ts", default: "./index.js" } },
  }));
  await put(root, "node_modules/acme-plain/index.d.ts", "export interface PlainSize { readonly size: 'sm' | 'md' }\ndeclare const plain: import('@meekojs/meeko/framework').MeekoModule;\nexport default plain;\n");
  await put(root, "meeko.config.mjs", 'export default { modules: ["acme-plain"] };\n');
  const page = (script: string): string => `<script lang="ts">\n${script}\n</script>\n\n<template><p>{label}</p></template>\n`;
  // As apps/ui/app/pages/container.meeko imports UIContainerSize from "@meekojs/ui".
  await put(root, "app/pages/index.meeko", page("import type { PlainSize } from 'acme-plain';\nconst value: PlainSize = { size: 'md' };\nconst label = value.size;"));
  await buildProject(root, { adapter: "node" });
  await put(root, "app/pages/index.meeko", page("import plain from 'acme-plain';\nconst label = String(plain);"));
  await assert.rejects(buildProject(root, { adapter: "node" }), /imports server-only module acme-plain|Server-only module reached the client bundle|Meeko module setup reached the client bundle/);
});
