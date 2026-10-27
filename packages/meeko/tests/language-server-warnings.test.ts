import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DiagnosticSeverity } from "vscode-languageserver/node";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { languageProject } from "./language-server-workspace.ts";
import type { LanguageProject } from "./language-server-workspace.ts";

const badge = `<script lang="ts">
import { onMounted } from "@meekojs/meeko";
const props = defineProps<{ label: string; items: string[] }>();
onMounted(() => { void props.items.length; });
</script>
<template><span>{props.label}</span></template>
`;

describe("language server: compiler warnings", () => {
  let workspace: LanguageProject;

  before(async () => {
    workspace = await languageProject("lsp-warnings-", { "app/components/Badge.meeko": badge });
  });

  after(async () => {
    await workspace?.dispose();
  });

  test("a prop read once in onMounted is a warning on the props identifier", { timeout: 120_000 }, async () => {
    const component = await workspace.open("app/components/Badge.meeko");
    const diagnostics = await componentDiagnostics(workspace.project, component.document, workspace.file("app/components/Badge.meeko"), () => undefined);
    const warnings = diagnostics.filter((item) => item.code === "MEEK101");
    assert.deepEqual(warnings.map((item) => [component.document.getText(item.range), item.severity]), [["props", DiagnosticSeverity.Warning]], JSON.stringify(diagnostics));
    assert.equal(component.document.offsetAt(warnings[0]!.range.start), component.offset("props.items"));
    assert.match(String(warnings[0]!.message), /onMounted se ejecuta una sola vez/);
  });
});
