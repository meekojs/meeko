import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { CodeAction, DeleteFile, Range, TextDocumentEdit, TextEdit } from "vscode-languageserver/node";
import { parseSfc } from "../src/compiler/sfc.ts";
import { codeActions } from "../src/language-server/features.ts";
import { languageProject } from "./language-server-workspace.ts";
import type { LanguageProject, OpenedComponent } from "./language-server-workspace.ts";

const sidecar = `import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  load: () => ({ title: "About" }),
});
`;

const about = `<script lang="ts">
const props = defineProps<{ data: { title: string } }>();
</script>
<template><h1>{props.data.title}</h1></template>
`;

const lists = `<script lang="ts">
const users = [{ id: 1, name: "Ada" }];
const tags = ["a", "b"];
const points = [{ x: 1, y: 2 }];
</script>
<template>
  <ul><li each:of="users" each:as="user">{user.name}</li></ul>
  <p each:of="tags">{item}</p>
  <p each:of="points" each:as="point">{point.x}</p>
  <p each:of="users" each:as="keyed" each:key="keyed.id">{keyed.name}</p>
</template>
`;

const apply = (text: string, edits: readonly TextEdit[]): string => TextDocument.applyEdits(TextDocument.create("file:///x", "meeko", 1, text), [...edits]);

describe("language server: code actions", () => {
  let workspace: LanguageProject;

  before(async () => {
    workspace = await languageProject("lsp-actions-", {
      "app/pages/about.meeko": about,
      "app/pages/about.route.ts": sidecar,
      "app/pages/lists.meeko": lists,
      "app/components/About.meeko": about,
      "app/components/About.route.ts": sidecar,
    });
  });

  after(async () => {
    await workspace?.dispose();
  });

  const firstLine: Range = { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } };
  const moveAction = (actions: CodeAction[]) => actions.find((action) => action.title.startsWith("Mover "));

  test("a page sidecar moves into <script server> and the sidecar file is deleted in one edit", async () => {
    const page = await workspace.open("app/pages/about.meeko");
    const action = moveAction(codeActions(page, firstLine, [], { deleteFiles: true }));
    assert.ok(action, "the refactoring is offered on the first line");
    assert.equal(action.title, "Mover about.route.ts a <script server>");
    assert.equal(action.kind, "refactor.rewrite");
    const [edit, removal] = action.edit!.documentChanges! as [TextDocumentEdit, DeleteFile];
    assert.equal(edit.textDocument.uri, page.document.uri);
    assert.equal(removal.kind, "delete");
    assert.equal(fileURLToPath(removal.uri).toLowerCase(), workspace.file("app/pages/about.route.ts").toLowerCase());
    const moved = apply(about, edit.edits as TextEdit[]);
    assert.ok(moved.startsWith(`<script server lang="ts">\nimport { definePage } from "@meekojs/meeko/framework";\n`), moved);
    assert.ok(moved.endsWith(about));
    assert.equal(parseSfc(moved, "about.meeko").server?.content.trim(), sidecar.trim());
  });

  test("the sidecar refactoring needs file deletion and a page, and stays off other lines unless asked", async () => {
    const page = await workspace.open("app/pages/about.meeko");
    assert.equal(moveAction(codeActions(page, firstLine, [])), undefined, "a client without delete operations");
    const template = page.at("<h1>");
    const range = { start: template, end: template };
    assert.equal(moveAction(codeActions(page, range, [], { deleteFiles: true })), undefined);
    assert.ok(moveAction(codeActions(page, range, [], { deleteFiles: true }, ["refactor"])), "an explicit refactor request");
    assert.deepEqual(codeActions(page, range, [], { deleteFiles: true }, ["refactor"]).map((action) => action.kind), ["refactor.rewrite"]);
    const component = await workspace.open("app/components/About.meeko");
    assert.equal(moveAction(codeActions(component, firstLine, [], { deleteFiles: true })), undefined, "only pages have route sidecars");
    const block = await workspace.open("app/pages/about.meeko", `<script server lang="ts">\n${sidecar}</script>\n${about}`);
    assert.equal(moveAction(codeActions(block, firstLine, [], { deleteFiles: true })), undefined, "a page that already has <script server>");
  });

  test("each:key is added with item.id, or the item itself for strings", async () => {
    const page: OpenedComponent = await workspace.open("app/pages/lists.meeko");
    const keyAt = (needle: string): CodeAction[] => {
      const position = page.at(needle, 1);
      return codeActions(page, { start: position, end: position }, []).filter((action) => action.title.startsWith("Añadir each:key"));
    };
    const [users] = keyAt("<li each:of");
    assert.equal(users?.title, 'Añadir each:key="user.id"');
    assert.equal(users?.kind, "quickfix");
    assert.match(apply(lists, users!.edit!.changes![page.document.uri]!), /<li each:of="users" each:key="user.id" each:as="user">/);
    assert.deepEqual(keyAt("<p each:of=\"tags\"").map((action) => action.title), ['Añadir each:key="item"']);
    assert.deepEqual(keyAt("<p each:of=\"points\""), [], "an object without an identifying property");
    assert.deepEqual(keyAt("<p each:of=\"users\" each:as=\"keyed\""), [], "a list with a key");
  });
});
