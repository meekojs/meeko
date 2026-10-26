import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { Diagnostic, MarkupContent, TextEdit } from "vscode-languageserver/node";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { codeActions, documentSymbols, hover } from "../src/language-server/features.ts";
import { languageProject } from "./language-server-workspace.ts";
import type { LanguageProject } from "./language-server-workspace.ts";

const overlay = `<script lang="ts">
const props = defineProps<{ dismissible?: boolean; closeOnEscape?: boolean }>();
</script>
<template><div>{String(props.dismissible)}{String(props.closeOnEscape)}</div></template>
`;

const badge = `<script lang="ts">
const props = defineProps<{ variant: "primary" | "secondary"; disabled?: boolean }>();
</script>
<template><span>{props.variant}:{String(props.disabled ?? false)}</span></template>
`;

/** Diagnostics of the component itself; this workspace has no Node types for the package sources. */
function own(diagnostics: readonly Diagnostic[]): Diagnostic[] {
  return diagnostics.filter((item) => typeof item.message !== "string" || !item.message.startsWith("../../src/"));
}

const head = `<script lang="ts">
import * as AppOverlay from "./AppOverlay.meeko";
import * as AppBadge from "./AppBadge.meeko";
</script>
`;

const server = `<script server lang="ts">\nexport const title = "Hola";\n</script>\n<template><h1>{title}</h1></template>\n`;

describe("language server: component props and optional scripts", () => {
  let workspace: LanguageProject;

  before(async () => {
    workspace = await languageProject("lsp-dx-", {
      "AppOverlay.meeko": overlay,
      "AppBadge.meeko": badge,
      "helper.ts": "export function shout(text: string): string { return text.toUpperCase(); }\n",
      "Parent.meeko": `${head}<template><AppBadge variant="primary" /></template>\n`,
      "app/pages/data.meeko": server,
    });
  });

  after(async () => {
    await workspace?.dispose();
  });

  test("unknown props beside known ones and wrong static values are diagnostics on the attribute", { timeout: 120_000 }, async () => {
    const cases: Array<{ template: string; code: string; text: string }> = [
      { template: `<component is="AppOverlay" bind:label="'x'" bind:value="'y'"></component>`, code: "TS2353", text: "label" },
      { template: `<AppOverlay bind:dismissible="true" bind:label="'x'" />`, code: "TS2353", text: "label" },
      { template: `<AppOverlay dismissible label="x" />`, code: "TS2353", text: "label" },
      { template: `<AppOverlay bind:dismissible="'yes'" />`, code: "TS2322", text: "dismissible" },
      { template: `<AppBadge variant="tertiary" />`, code: "TS2322", text: "variant" },
      { template: `<AppBadge variant="primary" bind:variant="'secondary'" />`, code: "MEEK090", text: "bind:variant" },
    ];
    for (const item of cases) {
      const text = `${head}<template>${item.template}</template>\n`;
      const context = await workspace.open("Parent.meeko", text);
      const diagnostics = own(await componentDiagnostics(workspace.project, context.document, workspace.file("Parent.meeko"), () => undefined));
      const found = diagnostics.find((diagnostic) => diagnostic.code === item.code);
      assert.ok(found, `${item.template}: ${JSON.stringify(diagnostics)}`);
      assert.equal(context.document.getText(found.range), item.text, item.template);
    }
    const valid = `${head}<template><AppOverlay dismissible closeOnEscape="" /><component is="AppBadge" variant="secondary" disabled></component><AppBadge bind:variant="'primary'" /></template>\n`;
    const context = await workspace.open("Parent.meeko", valid);
    const diagnostics = own(await componentDiagnostics(workspace.project, context.document, workspace.file("Parent.meeko"), () => undefined));
    // `closeOnEscape=""` passes a string to a boolean prop; everything else is valid.
    assert.ok(diagnostics.some((item) => item.code === "TS2322"), JSON.stringify(diagnostics));
    assert.deepEqual([...new Set(diagnostics.map((item) => context.document.getText(item.range)))], ["closeOnEscape"]);
    // A static prop name hovers like a bind: prop.
    const info = hover(context, context.at("variant=\"secondary\"", 1));
    assert.match((info?.contents as MarkupContent | undefined)?.value ?? "", /variant/);
  });

  test("a component without <script lang=\"ts\"> has no diagnostics, symbols or edits in a script", { timeout: 120_000 }, async () => {
    const only = `<template><p>{"hola"}</p><AppNote /></template>\n`;
    const context = await workspace.open("Plain.meeko", only);
    assert.ok(context.component.implicitScript);
    const diagnostics = own(await componentDiagnostics(workspace.project, context.document, workspace.file("Plain.meeko"), () => undefined));
    // AppNote is not imported: the only error is that name, on the tag.
    assert.deepEqual(diagnostics.map((item) => [item.code, context.document.getText(item.range)]), [["TS2304", "AppNote"]]);
    assert.deepEqual(documentSymbols(context).map((symbol) => symbol.name), ["<template>"]);

    const page = await workspace.open("app/pages/data.meeko", server);
    assert.deepEqual(own(await componentDiagnostics(workspace.project, page.document, workspace.file("app/pages/data.meeko"), () => undefined)), []);

    // A TypeScript import fix adds the missing script before the template.
    const missing = `<template><p>{shout("x")}</p></template>\n`;
    const fixable = await workspace.open("Fix.meeko", missing);
    const errors = own(await componentDiagnostics(workspace.project, fixable.document, workspace.file("Fix.meeko"), () => undefined));
    const unknown = errors.find((item) => item.code === "TS2304");
    assert.ok(unknown, JSON.stringify(errors));
    const fix = codeActions(fixable, unknown.range, [unknown]).find((action) => /helper.js/.test(action.title) && /import/i.test(action.title));
    assert.ok(fix, JSON.stringify(codeActions(fixable, unknown.range, [unknown]).map((action) => action.title)));
    const edits = Object.values(fix.edit?.changes ?? {})[0] as TextEdit[];
    assert.equal(edits.length, 1);
    assert.deepEqual(edits[0]!.range.start, { line: 0, character: 0 });
    assert.match(edits[0]!.newText, /^<script lang="ts">\n.*import \{ shout \} from "\.\/helper\.js";\n<\/script>\n\n$/s);
  });
});
