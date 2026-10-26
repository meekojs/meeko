import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import ts from "@typescript/typescript6";
import { createEditorModel } from "../src/language-server/model.ts";

/**
 * Every public subpath of `package.json#exports` and its source entry. `./internal` is left out:
 * only compiled `.meeko` modules import it.
 */
const entries: Readonly<Record<string, string>> = {
  ".": "src/index.ts",
  "./framework": "src/framework.ts",
  "./vite": "src/vite.ts",
  "./server": "src/framework-server.ts",
  "./node": "src/node.ts",
  "./bun": "src/bun.ts",
  "./deno": "src/deno.ts",
  "./cloudflare": "src/cloudflare.ts",
  "./build": "src/build.ts",
  "./devtools-ui": "src/devtools-ui/index.ts",
  "./prettier": "src/prettier.ts",
};

/**
 * Exports that need a description but no `@example`, as `subpath#name`. Keep it short and
 * justify each entry.
 */
const withoutExample: ReadonlyMap<string, string> = new Map([
]);

/**
 * Policy:
 * - every top-level export of a public subpath has a JSDoc description and an `@example`,
 *   unless `withoutExample` lists it;
 * - every public member of an exported class has a description, its own or the one it
 *   inherits from the interface it implements (what the editor hover shows). The class
 *   `@example` covers its members.
 */
function undocumentedExports(): string[] {
  const parsed = ts.getParsedCommandLineOfConfigFile(resolve("tsconfig.json"), {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic(diagnostic) {
      throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    },
  });
  assert.ok(parsed, "tsconfig.json could not be read");
  const program = ts.createProgram(Object.values(entries).map((file) => resolve(file)), { ...parsed.options, noEmit: true });
  const checker = program.getTypeChecker();
  const problems: string[] = [];
  const seenExceptions = new Set<string>();
  for (const [subpath, file] of Object.entries(entries)) {
    const source = program.getSourceFile(resolve(file));
    assert.ok(source, `${file} is not in the program`);
    const moduleSymbol = checker.getSymbolAtLocation(source);
    assert.ok(moduleSymbol, `${file} is not a module`);
    for (const exported of checker.getExportsOfModule(moduleSymbol)) {
      const id = `${subpath}#${exported.name}`;
      const symbol = exported.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(exported) : exported;
      const description = ts.displayPartsToString(symbol.getDocumentationComment(checker)).trim();
      const hasExample = symbol.getJsDocTags(checker).some((tag) => tag.name === "example");
      if (!description) problems.push(`${id}: missing JSDoc`);
      if (withoutExample.has(id)) {
        seenExceptions.add(id);
        if (hasExample) problems.push(`${id}: has an @example, remove it from withoutExample`);
      } else if (!hasExample) {
        problems.push(`${id}: missing @example`);
      }
      for (const declaration of symbol.declarations ?? []) {
        if (!ts.isClassDeclaration(declaration)) continue;
        for (const member of declaration.members) {
          // Members keyed by a module-private symbol (`[lockSessionCookie]`) cannot be named by consumers.
          if (!member.name || ts.isPrivateIdentifier(member.name) || ts.isComputedPropertyName(member.name)) continue;
          if (ts.getCombinedModifierFlags(member) & (ts.ModifierFlags.Private | ts.ModifierFlags.Protected)) continue;
          const memberSymbol = checker.getSymbolAtLocation(member.name);
          const memberDoc = memberSymbol ? ts.displayPartsToString(memberSymbol.getDocumentationComment(checker)).trim() : "";
          if (!memberDoc) problems.push(`${id}.${member.name.getText()}: missing JSDoc`);
        }
      }
    }
  }
  for (const id of withoutExample.keys()) if (!seenExceptions.has(id)) problems.push(`${id}: listed in withoutExample but not exported`);
  return [...new Set(problems)].sort();
}

test("every public export has JSDoc with an @example", () => {
  const problems = undocumentedExports();
  assert.deepEqual(problems, [], `Public API without documentation:\n${problems.join("\n")}`);
});

test("the editor hover documents every .meeko compiler macro", () => {
  const source = `<script lang="ts">
type Props = { label: string };
const props = defineProps<Props>();
const emit = defineEmits<{ save: [id: number] }>();
const open = defineModel<boolean>("open");
const slots = defineSnippets<{ header: [] }>();
const input = useElementRef("field");
defineExpose({ focus: () => input.value?.focus() });
</script>
<template><input ref:field /><p>{props.label}</p></template>`;
  const model = createEditorModel(source, resolve("tests/fixtures/PublicApiDocs.meeko"));
  try {
    const problems: string[] = [];
    for (const macro of ["defineProps", "defineEmits", "defineModel", "defineSnippets", "useElementRef", "defineExpose"]) {
      const at = model.toGenerated(source.indexOf(`${macro}`));
      const info = at === undefined ? undefined : model.service.getQuickInfoAtPosition(model.virtualFilename, at);
      const documentation = ts.displayPartsToString(info?.documentation ?? []).trim();
      if (!documentation) problems.push(`${macro}: hover without documentation`);
      if (!(info?.tags ?? []).some((tag) => tag.name === "example")) problems.push(`${macro}: hover without @example`);
    }
    assert.deepEqual(problems, []);
  } finally {
    model.dispose();
  }
});
