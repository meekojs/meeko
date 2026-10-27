import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { CodeAction, TextEdit } from "vscode-languageserver/node";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { createComponentActions, itemName, listItemActions, propsReadActions } from "../src/language-server/quick-fixes.ts";
import { languageProject } from "./language-server-workspace.ts";
import type { LanguageProject } from "./language-server-workspace.ts";

const reads = `<script lang="ts">
const props = defineProps<{ label: string; items: string[] }>();
const upper = props.label.toUpperCase();
const { items, label: title } = props;
const first = props.items[0];
const view = { upper };
</script>
<template><p bind:title="view.upper">{upper} {title} {items.length} {first}</p></template>
`;

const parent = `<script lang="ts">
const name = signal("Ada");
</script>
<template><AppNuevo bind:title="name.value" bind:count="3" bind:open="true" /></template>
`;

/** The text after applying the edits of `action` to this document. */
function applied(document: TextDocument, action: CodeAction | undefined): string {
  assert.ok(action?.edit?.changes, JSON.stringify(action));
  const edits: TextEdit[] = action.edit.changes[document.uri] ?? [];
  return TextDocument.applyEdits(document, edits);
}

describe("language server: quick fixes", () => {
  let workspace: LanguageProject;

  before(async () => {
    workspace = await languageProject("lsp-fixes-", {
      "app/components/Reads.meeko": reads,
      "app/components/App/Card.meeko": "<template><div></div></template>\n",
      "app/pages/index.meeko": parent,
    });
  });

  after(async () => {
    await workspace?.dispose();
  });

  test("a prop copied by the setup becomes a computed, with .value in every use", { timeout: 120_000 }, async () => {
    const context = await workspace.open("app/components/Reads.meeko");
    const diagnostics = await componentDiagnostics(workspace.project, context.document, workspace.file("app/components/Reads.meeko"), () => undefined);
    const actions = propsReadActions(context, diagnostics);
    const upper = applied(context.document, actions.find((action) => action.title === "Convertir upper en computed para que siga a la prop"));
    assert.match(upper, /const upper = computed\(\(\) => props\.label\.toUpperCase\(\)\);/);
    assert.match(upper, /const view = \{ upper: upper\.value \};/, "a shorthand property keeps its key");
    assert.match(upper, /\{upper\.value\} \{title\}/);
    const destructuring = applied(context.document, actions.find((action) => action.title === "Convertir la desestructuración de props en computed"));
    assert.match(destructuring, /const items = computed\(\(\) => props\.items\);\nconst title = computed\(\(\) => props\.label\);/);
    assert.match(destructuring, /\{title\.value\} \{items\.value\.length\}/);
    const once = applied(context.document, actions.find((action) => action.title === "Leer props.items sólo una vez con untrack"));
    assert.match(once, /const first = untrack\(\(\) => props\.items\)\[0\];/);
  });

  test("an unknown component tag creates the component, with one typed prop per bind:", { timeout: 120_000 }, async () => {
    const context = await workspace.open("app/pages/index.meeko");
    const diagnostics = await componentDiagnostics(workspace.project, context.document, workspace.file("app/pages/index.meeko"), () => undefined);
    assert.equal(createComponentActions(context, diagnostics, {}).length, 0, "only clients that can create files");
    const [action] = createComponentActions(context, diagnostics, { createFiles: true });
    assert.equal(action?.title, "Crear el componente AppNuevo en app/components/App/Nuevo.meeko");
    const [create, write] = action!.edit!.documentChanges!;
    assert.ok(create && "kind" in create && create.kind === "create");
    assert.equal(fileURLToPath(create.uri), workspace.file("app/components/App/Nuevo.meeko"));
    assert.ok(write && "edits" in write);
    assert.equal((write.edits[0] as TextEdit).newText, `<script lang="ts">
export interface Props {
  title: string;
  count: number;
  open: boolean;
}

const props = defineProps<Props>();
</script>

<template>
  <div></div>
</template>
`);
  });

  test("a list without each:as gets an item named after the list", () => {
    const text = `<script lang="ts">\nconst variants = signal(["a"]);\n</script>\n<template><AppCard each:of="variants.value" bind:variant="x"></AppCard></template>\n`;
    const document = TextDocument.create("file:///List.meeko", "meeko", 1, text);
    const start = document.positionAt(text.indexOf("<AppCard"));
    const [action] = listItemActions(document, [{ range: { start, end: start }, message: "", code: "MEEK022" }]);
    assert.equal(action?.title, 'Añadir each:as="variant"');
    assert.match(applied(document, action), /each:of="variants\.value" each:as="variant" bind:variant/);
    assert.deepEqual(["entries", "boxes", "data", "class", "users.value"].map(itemName), ["entry", "boxe", "item", "item", "user"]);
  });
});
