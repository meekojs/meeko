import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkSource } from "../src/check.ts";
import { compile } from "../src/compiler.ts";
import { createEditorModel } from "../src/language-server/model.ts";

/** A project folder whose components resolve the package from `src`, like the other check tests. */
async function checkProject(files: Record<string, string>): Promise<{ root: string; cleanup: () => Promise<void> }> {
  const parent = resolve(".meeko");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "if-narrowing-"));
  await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
  await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { types: ["node"], paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] } } })}\n`);
  for (const [name, content] of Object.entries(files)) await writeFile(join(root, name), content);
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) };
}

const header = `<script lang="ts">
const props = defineProps<{ staff: { name: string } }>();
const snippets = defineSnippets<{ default: []; aside?: [note: string] }>();
</script>
<template><h1>{props.staff.name}</h1><render snippet="snippets.default" /><render if:when="snippets.aside" snippet="snippets.aside" args="'note'" /></template>`;

const script = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as WorkspaceHeader from "./WorkspaceHeader.meeko";
const user = signal<{ name: string; tags: string[] } | null>(null);
const session = { data: signal<{ staff: { name: string } | null }>({ staff: null }) };
const rows = signal([{ id: 1, owner: null as { name: string } | null }]);
function greet(name: string): () => void { return () => void name; }
</script>
`;

// Every kind of binding inside an if:when reads the narrowed reference: text, attribute, event
// handler expression, component props and children, nested conditions, lists, keys and snippets.
// As in TypeScript, the narrowing does not reach inside an arrow function written in the template.
const template = `<template>
  <p if:when="user.value" bind:title="user.value.name" on:click="greet(user.value.name)">{user.value.name}</p>
  <WorkspaceHeader bind:staff="session.data.value.staff" if:when="session.data.value.staff">
    <b>{session.data.value.staff.name}</b>
    <snippet name="aside" params="note"><i>{note}{session.data.value.staff.name}</i></snippet>
  </WorkspaceHeader>
  <template if:when="user.value">
    <ul><li each:of="user.value.tags" each:as="tag" each:key="tag + user.value.name">{tag}:{user.value.name}<em if:when="user.value.name">{user.value.name.length}</em></li></ul>
  </template>
  <div each:of="rows.value" each:as="row" each:key="row.id"><span if:when="row.owner">{row.owner.name}</span></div>
</template>`;

test("if:when narrows the types of its element's bindings and children in meeko check", { timeout: 120_000 }, async () => {
  const { root, cleanup } = await checkProject({ "WorkspaceHeader.meeko": header });
  try {
    const source = `${script}${template}`;
    assert.deepEqual(await checkSource(source, join(root, "Narrowed.meeko")), []);
    // Without the condition each read is still an error, reported once where it is written.
    const unguarded = source.replace(`<p if:when="user.value" `, "<p ").replace(` if:when="row.owner"`, "");
    const diagnostics = await checkSource(unguarded, join(root, "Unguarded.meeko"));
    const start = unguarded.indexOf("<p ");
    const expected = [
      unguarded.indexOf("user.value.name", start),
      unguarded.indexOf("user.value.name", unguarded.indexOf("greet(", start)),
      unguarded.indexOf("user.value.name", unguarded.indexOf("{user", start)),
      unguarded.indexOf("row.owner.name"),
    ];
    const nullable = diagnostics.filter((item) => item.code === "TS18047" || item.code === "TS2531");
    assert.deepEqual([...new Set(nullable.map((item) => item.location.offset))].sort((a, b) => a - b), expected.sort((a, b) => a - b), JSON.stringify(diagnostics));
    assert.equal(nullable.length, diagnostics.length, JSON.stringify(diagnostics));
  } finally {
    await cleanup();
  }
});

test("a narrowing condition only changes the module that meeko check type-checks", () => {
  const source = `${script.replace(/import \* as WorkspaceHeader.*\n/, "const WorkspaceHeader = {} as never;\n")}${template}`;
  const runtime = compile(source, "Narrowed.meeko").code;
  const checked = compile(source, "Narrowed.meeko", { typeCheck: true }).code;
  assert.doesNotMatch(runtime, /!!\(/);
  assert.match(checked, /__meeko\.renderIf\(\d+, user\.value, \(\) => \(!!\(user\.value\) \? /);
  // A row's item shadows nothing here, so the outer condition still guards the row's content.
  assert.match(checked, /\(tag, index\) => \(!!\(user\.value\) \? /);
  // A snippet parameter keeps the guards that do not read it.
  assert.match(checked, /__meeko\.snippet\(\(note\) => \(!!\(session\.data\.value\.staff\) \? /);
});

test("the editor narrows the content of an if:when like the CLI", () => {
  const source = `<script lang="ts">
const WorkspaceHeader = {} as import("@meekojs/meeko").Component<{ staff: { name: string } }>;
const user = { value: null as { name: string } | null };
const session = { data: { value: { staff: null as { name: string } | null } } };
</script>
<template>
  <p if:when="user.value" bind:title="user.value.name">{user.value.name}</p>
  <WorkspaceHeader bind:staff="session.data.value.staff" if:when="session.data.value.staff" />
  <span>{user.value.name}</span>
</template>`;
  const model = createEditorModel(source, resolve("examples/regions/Narrowed.meeko"));
  try {
    const diagnostics = model.service.getSemanticDiagnostics(model.virtualFilename);
    // Only the read outside the condition is an error.
    assert.deepEqual(diagnostics.map((item) => [item.code, model.toSource(item.start ?? -1)]), [[18047, source.indexOf("user.value.name", source.indexOf("<span>"))]]);
    const inside = model.toGenerated(source.indexOf("user.value.name", source.indexOf("{user")) + "user.value.".length);
    assert.notEqual(inside, undefined);
    const info = model.service.getQuickInfoAtPosition(model.virtualFilename, inside!);
    assert.match(info?.displayParts?.map((part) => part.text).join("") ?? "", /name: string/);
  } finally { model.dispose(); }
  // Children of a component tag are snippet functions: they repeat the conditions around the tag,
  // except one that reads a snippet parameter, which shadows its name.
  const withSnippets = source.replace(`<WorkspaceHeader bind:staff="session.data.value.staff" if:when="session.data.value.staff" />`,
    `<WorkspaceHeader bind:staff="session.data.value.staff" if:when="session.data.value.staff"><b>{session.data.value.staff.name}</b><snippet name="aside" params="session">{session}</snippet></WorkspaceHeader>`);
  const nested = createEditorModel(withSnippets, resolve("examples/regions/Narrowed.meeko"));
  try {
    assert.deepEqual(nested.service.getSyntacticDiagnostics(nested.virtualFilename).map((item) => item.messageText), []);
    const nullable = nested.service.getSemanticDiagnostics(nested.virtualFilename).filter((item) => item.code === 18047);
    assert.deepEqual(nullable.map((item) => nested.toSource(item.start ?? -1)), [withSnippets.indexOf("user.value.name", withSnippets.indexOf("<span>"))]);
  } finally { nested.dispose(); }
});
