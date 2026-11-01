import type { CompletionItem, MarkupContent } from "vscode-languageserver/node";

import ts from "@typescript/typescript6";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { describe, test } from "node:test";

import type { LanguageProject, OpenedComponent } from "./language-server-workspace.ts";

import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { codeActions, completionList, isGlobalOrKeyword, resolveCompletion } from "../src/language-server/features.ts";
import { languageProject } from "./language-server-workspace.ts";

const paths = {
  "@meekojs/meeko/framework": ["../../src/framework.ts"],
  "@meekojs/meeko/server": ["../../src/framework-server.ts"],
  "@meekojs/meeko/internal": ["../../src/internal.ts"],
  "@meekojs/meeko/builtins/*": ["../../src/builtins/*.compiled.ts"],
  "@meekojs/meeko": ["../../src/index.ts"],
};

/** A tsconfig like the one of `languageProject`, with another module resolution or `include`. */
function tsconfig(options: { module?: string; moduleResolution?: string; include?: string[] } = {}): string {
  return `${JSON.stringify({
    compilerOptions: {
      strict: true, module: options.module ?? "esnext", moduleResolution: options.moduleResolution ?? "bundler", target: "es2023",
      types: [], noEmit: true, allowArbitraryExtensions: true, paths,
    },
    include: options.include ?? ["**/*.ts"],
  })}\n`;
}

const shells = {
  "app/app.meeko": (script: string) => `<script lang="ts">\n${script}\n</script>\n<template><main><MeekoOutlet /></main></template>\n`,
  "app/layouts/default.meeko": (script: string) => `<script lang="ts">\n${script}\n</script>\n<template><div><MeekoOutlet /></div></template>\n`,
  "app/pages/index.meeko": (script: string) => `<script lang="ts">\n${script}\n</script>\n<template><p>page</p></template>\n`,
  "app/components/Price.meeko": (script: string) => `<script lang="ts">\n${script}\n</script>\n<template><span>price</span></template>\n`,
};

/** The completion items labelled `label` where `needle` ends, with their resolved details. */
function completed(context: OpenedComponent, needle: string, label: string): CompletionItem[] {
  const list = completionList(context, context.at(needle, needle.length));
  return (list?.items ?? []).filter((item) => item.label === label).map((item) => resolveCompletion(context, structuredClone(item)));
}

async function withProject(prefix: string, files: Record<string, string>, run: (workspace: LanguageProject) => Promise<void>): Promise<void> {
  const workspace = await languageProject(prefix, files);
  try { await run(workspace); } finally { await workspace.dispose(); }
}

describe("language server: completion of the project's autoimports", () => {
  test("an export of app/utils completes without an import in app.meeko, a layout, a page and a component", { timeout: 120_000 }, async () => {
    const files: Record<string, string> = {
      "app/utils/price.ts": "/** Formats a price. */\nexport function formatPrice(value: number): string { return `$${value}`; }\nexport type Money = { amount: number };\n",
      ...Object.fromEntries(Object.entries(shells).map(([name, shell]) => [name, shell("const label = formatP\nlet money: Mon")])),
    };
    await withProject("ls-autoimport-utils-", files, async (workspace) => {
      for (const name of Object.keys(shells)) {
        const context = await workspace.open(name);
        const [item, ...others] = completed(context, "formatP", "formatPrice");
        assert.ok(item, name);
        assert.deepEqual(others, [], name);
        assert.equal(item.labelDetails?.description, "app/utils/price.ts", name);
        assert.equal(item.additionalTextEdits, undefined, `${name}: ${JSON.stringify(item.additionalTextEdits)}`);
        assert.match(String(item.detail), /formatPrice\(value: number\): string/, name);
        assert.match((item.documentation as MarkupContent).value, /Formats a price\.[\s\S]*Autoimportado de `app\/utils\/price\.ts`/, name);
        const [type] = completed(context, "let money: Mon", "Money");
        assert.ok(type, name);
        assert.equal(type.additionalTextEdits, undefined, name);
        // The editor accepts what it completed, as the build does.
        const accepted = workspace.file(name);
        const source = shells[name as keyof typeof shells]("const label = formatPrice(1)\nlet money: Money = { amount: 1 }\nvoid label; void money");
        const opened = await workspace.open(name, source);
        const diagnostics = await componentDiagnostics(workspace.project, opened.document, accepted, opened.locate);
        assert.deepEqual(diagnostics.filter((item) => !String(item.message).startsWith("../../src/")).map((item) => `${item.code}: ${item.message}`), [], name);
      }
    });
  });

  test("an autoimport outside the TypeScript program, or named like a DOM global, is still offered without an import", { timeout: 120_000 }, async () => {
    await withProject("ls-autoimport-global-", {
      // As in a project without tsconfig: only the imported files are in the program.
      "tsconfig.json": tsconfig({ include: ["shared/**/*.ts"] }),
      "app/utils/navigation.ts": 'export const navigation = [{ label: "Inicio", href: "/" }] as const;\n',
      "app/app.meeko": shells["app/app.meeko"]("const items = navig"),
    }, async (workspace) => {
      const context = await workspace.open("app/app.meeko");
      const items = completed(context, "navig", "navigation");
      // Not the Navigation API of the DOM (`var navigation: Navigation`), which the autoimport replaces.
      assert.equal(items.length, 1, JSON.stringify(items));
      assert.equal(items[0]!.labelDetails?.description, "app/utils/navigation.ts");
      assert.equal(items[0]!.additionalTextEdits, undefined);
      assert.doesNotMatch(String(items[0]!.detail), /Navigation\b/);
    });
  });

  test("an export added while the editor runs is offered at once", { timeout: 120_000 }, async () => {
    await withProject("ls-autoimport-added-", {
      "app/utils/labels.ts": 'export const SITE = "site";\n',
      "app/app.meeko": shells["app/app.meeko"]("const label = shellL"),
    }, async (workspace) => {
      assert.deepEqual(completed(await workspace.open("app/app.meeko"), "shellL", "shellLabel"), []);
      await writeFile(workspace.file("app/utils/labels.ts"), 'export const SITE = "site";\nexport function shellLabel(): string { return SITE; }\n');
      assert.ok(workspace.project.filesChanged([workspace.file("app/utils/labels.ts")]));
      await workspace.project.ready();
      const [item] = completed(await workspace.open("app/app.meeko"), "shellL", "shellLabel");
      assert.ok(item);
      assert.equal(item.additionalTextEdits, undefined);
    });
  });

  test("a component under server/ completes the server autoimports, as its virtual code and the SSR graph resolve them", { timeout: 120_000 }, async () => {
    const script = "const from = mailF";
    await withProject("ls-autoimport-server-component-", {
      "server/utils/mail.ts": 'export function mailFrom(): string { return "hola@example.test"; }\n',
      "server/emails/Welcome.meeko": `<script lang="ts">\n${script}\n</script>\n<template><p>welcome</p></template>\n`,
      "app/pages/index.meeko": shells["app/pages/index.meeko"](script),
    }, async (workspace) => {
      const [item, ...others] = completed(await workspace.open("server/emails/Welcome.meeko"), "mailF", "mailFrom");
      assert.ok(item);
      assert.deepEqual(others, []);
      assert.equal(item.labelDetails?.description, "server/utils/mail.ts");
      assert.equal(item.additionalTextEdits, undefined, JSON.stringify(item.additionalTextEdits));
      // The editor accepts what it completed.
      const source = `<script lang="ts">\nconst from = mailFrom()\nvoid from\n</script>\n<template><p>welcome</p></template>\n`;
      const opened = await workspace.open("server/emails/Welcome.meeko", source);
      const diagnostics = await componentDiagnostics(workspace.project, opened.document, workspace.file("server/emails/Welcome.meeko"), opened.locate);
      assert.deepEqual(diagnostics.filter((entry) => !String(entry.message).startsWith("../../src/")).map((entry) => `${entry.code}: ${entry.message}`), []);
      // A page also runs in the browser: never a server autoimport.
      assert.deepEqual(completed(await workspace.open("app/pages/index.meeko"), "mailF", "mailFrom"), []);
    });
  });

  test("TypeScript still sorts the globals of the libraries as isGlobalOrKeyword expects", () => {
    // TypeScript has no public flag for these entries: a release that changes its internal
    // `SortText.GlobalsOrKeywords` must fail here, not silently in the editor.
    const filename = "/virtual/globals.ts";
    const text = "const local = 1;\nvoid local;\n";
    const host: ts.LanguageServiceHost = {
      getCompilationSettings: () => ({ target: ts.ScriptTarget.ES2023, lib: ["lib.es2023.d.ts", "lib.dom.d.ts"] }),
      getScriptFileNames: () => [filename],
      getScriptVersion: () => "1",
      getScriptSnapshot: (name) => {
        const content = name === filename ? text : ts.sys.readFile(name);
        return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
      },
      getCurrentDirectory: () => "/virtual",
      getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
      fileExists: (name) => name === filename || ts.sys.fileExists(name),
      readFile: (name) => name === filename ? text : ts.sys.readFile(name),
    };
    const service = ts.createLanguageService(host);
    try {
      const result = service.getCompletionsAtPosition(filename, text.length, {});
      assert.ok(result?.isGlobalCompletion);
      const entry = (name: string) => result.entries.find((candidate) => candidate.name === name);
      for (const name of ["setTimeout", "navigation", "Math", "const"]) assert.ok(isGlobalOrKeyword(entry(name)!), `${name}: ${JSON.stringify(entry(name))}`);
      assert.equal(isGlobalOrKeyword(entry("local")!), false);
    } finally {
      service.dispose();
    }
  });
});

describe("language server: relative imports follow the project's module resolution", () => {
  const files = (config: string): Record<string, string> => ({
    "tsconfig.json": config,
    "app/lib/settings/context.ts": "export const settingsContext = { theme: \"dark\" };\n",
    "app/composables/count.ts": "export function useCount(): number { return 1; }\n",
    "shared/utils/count.ts": "export function useCount(): number { return 2; }\n",
    "app/pages/index.meeko": shells["app/pages/index.meeko"]("const settings = settingsCon\nconst count = useCount()\nvoid count"),
  });

  for (const [resolution, config, extension] of [
    ["Bundler", tsconfig(), ""],
    ["NodeNext", tsconfig({ module: "nodenext", moduleResolution: "nodenext" }), ".js"],
  ] as const) {
    test(`with ${resolution}, completion and quick fixes import "../lib/settings/context${extension}"`, { timeout: 120_000 }, async () => {
      await withProject(`ls-specifier-${resolution.toLowerCase()}-`, files(config), async (workspace) => {
        const context = await workspace.open("app/pages/index.meeko");
        const [item] = completed(context, "settingsCon", "settingsContext");
        assert.ok(item);
        assert.deepEqual(item.additionalTextEdits?.map((edit) => edit.newText), [`import { settingsContext } from "../lib/settings/context${extension}";\n`]);

        // "Add import" of TypeScript, on the name once it is written in full.
        const source = shells["app/pages/index.meeko"]("const settings = settingsContext\nvoid settings");
        const written = await workspace.open("app/pages/index.meeko", source);
        const diagnostics = await componentDiagnostics(workspace.project, written.document, workspace.file("app/pages/index.meeko"), written.locate);
        const missing = diagnostics.find((entry) => entry.code === "TS2304");
        assert.ok(missing, JSON.stringify(diagnostics));
        const actions = codeActions(written, missing.range, [missing]);
        const texts = actions.flatMap((action) => Object.values(action.edit?.changes ?? {}).flat().map((edit) => edit.newText));
        assert.ok(texts.includes(`import { settingsContext } from "../lib/settings/context${extension}";\n`), JSON.stringify(texts));

        // The import that resolves an ambiguous autoimport.
        const original = await workspace.open("app/pages/index.meeko");
        const ambiguous = await componentDiagnostics(workspace.project, original.document, workspace.file("app/pages/index.meeko"), original.locate);
        const problem = ambiguous.find((entry) => entry.code === "MEEK_AUTOIMPORT");
        assert.ok(problem, JSON.stringify(ambiguous));
        const fixes = codeActions(original, problem.range, [problem]).filter((action) => action.title.startsWith("Importar useCount"));
        const statements = fixes.flatMap((action) => Object.values(action.edit?.changes ?? {}).flat().map((edit) => edit.newText.trim())).sort();
        assert.deepEqual(statements, [
          `import { useCount } from "../../shared/utils/count${extension}";`,
          `import { useCount } from "../composables/count${extension}";`,
        ]);
      });
    });
  }
});
