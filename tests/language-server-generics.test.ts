import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { MarkupContent } from "vscode-languageserver/node";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { completion, hover } from "../src/language-server/features.ts";
import type { FeatureContext } from "../src/language-server/features.ts";
import { MeekoProject } from "../src/language-server/project.ts";

const table = `<script lang="ts" generic="T extends { id: string }">
const props = defineProps<{ rows: T[]; selected?: T }>();
const emit = defineEmits<{ select: [row: T] }>();
const snippets = defineSnippets<{ row: [row: T] }>();
const current = defineModel<T | null>("current");
defineExpose({ first: (): T | undefined => props.rows[0] });
</script>
<template><ul><li each:of="props.rows" each:key="row.id" each:as="row" on:click="() => emit('select', row)"><render snippet="snippets.row" args="row" /></li></ul><p>{current.value?.id}</p></template>`;

const page = (template: string): string => `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as DataTable from "./DataTable.meeko";
interface User { id: string; email: string }
const users = signal<User[]>([]);
const picked = signal<User | null>(null);
const ref = useElementRef("table");
const first = ref.value?.first();
</script>
<template>${template}</template>`;

/** A generic child whose T comes from a static prop, beside a prop with a literal union type. */
const chip = `<script lang="ts" generic="T extends string">
const props = defineProps<{ value: T; tone: "info" | "warn" }>();
const emit = defineEmits<{ change: [value: T] }>();
</script>
<template><button type="button" on:click="() => emit('change', props.value)">{props.value}:{props.tone}</button></template>`;

const valid = page(`<DataTable ref:table bind:rows="users.value" on:select="(u) => console.log(u.email)" model:current="picked"><snippet name="row" params="user">{user.email}</snippet></DataTable>`);

describe("language server: generic components", () => {
  let root: string;
  let project: MeekoProject;

  before(async () => {
    await mkdir(resolve(".meeko"), { recursive: true });
    root = await mkdtemp(resolve(".meeko", "lsp-generics-"));
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    // The package resolves to src/ so the test does not depend on a build of dist/.
    await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { strict: true, types: ["node"], paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] } } })}\n`);
    await writeFile(join(root, "DataTable.meeko"), table);
    await writeFile(join(root, "Users.meeko"), valid);
    await writeFile(join(root, "Chip.meeko"), chip);
    project = new MeekoProject(root, { trusted: false });
    await project.ready();
  });

  after(async () => {
    project?.service.dispose();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  });

  function open(name: string, text: string): FeatureContext & { at(needle: string, delta?: number): { line: number; character: number } } {
    const filename = join(root, name);
    const component = project.setDocument(filename, text);
    assert.ok(component, String(project.componentError(filename)));
    const document = TextDocument.create(pathToFileURL(filename).href, "meeko", 1, text);
    return {
      project, component, document, locate: () => undefined,
      at: (needle, delta = 0) => {
        const offset = text.indexOf(needle);
        assert.ok(offset >= 0, needle);
        return document.positionAt(offset + delta);
      },
    };
  }

  function virtualErrors(context: FeatureContext): string[] {
    const file = context.component.virtualFilename;
    return [...project.service.getSyntacticDiagnostics(file), ...project.service.getSemanticDiagnostics(file)]
      .map((item) => `${item.code}: ${ts.flattenDiagnosticMessageText(item.messageText, " ")}`);
  }

  const hoverText = (context: FeatureContext, position: { line: number; character: number }): string =>
    (hover(context, position)?.contents as MarkupContent | undefined)?.value ?? "";

  test("inside the child each type parameter stands for its constraint, and the module shape is generic", () => {
    const child = open("DataTable.meeko", table);
    assert.deepEqual(virtualErrors(child), []);
    assert.match(child.component.code, /export type ComponentProps<T extends \{ id: string \}> = /);
    assert.match(child.component.code, /export declare const __meekoTag: <T extends \{ id: string \}>\(props: ComponentProps<T> & __MeekoExtraProps/);
    assert.match(hoverText(child, child.at("row.id", 1)), /const row: T/);
    // The parameter in the attribute is the alias the script uses.
    assert.match(hoverText(child, child.at("T extends")), /type T = \{\s+id: string;\s+\}/);
    const members = completion(child, child.at("row.id", 4)) ?? [];
    assert.ok(members.some((item) => item.label === "id"), JSON.stringify(members.map((item) => item.label)));
    // The child's own summary shows its parameters as declared.
    const parent = open("Users.meeko", valid);
    assert.match(hoverText(parent, parent.at("DataTable from", 1)), /\*\*Parámetros de tipo:\*\* `T extends \{ id: string \}`/);
  });

  test("the parent resolves T from the props in the tag hover, the handlers, the snippet and the ref", () => {
    open("DataTable.meeko", table);
    const parent = open("Users.meeko", valid);
    assert.deepEqual(virtualErrors(parent), []);
    const tag = hoverText(parent, parent.at("<DataTable ref", 2));
    assert.match(tag, /\*\*Parámetros de tipo:\*\* `T = User`/);
    assert.match(tag, /`rows: User\[\]`/);
    assert.match(tag, /`on:select\(row: User\)`/);
    assert.match(tag, /`model:current` \(User \| null\)/);
    assert.match(tag, /`row\(row: User\)`/);
    assert.match(tag, /\*\*Expone:\*\* `first: \(\) => User \| undefined`/);
    assert.match(hoverText(parent, parent.at("(u) =>", 1)), /\(parameter\) u: User/);
    assert.match(hoverText(parent, parent.at("user\">", 1)), /\(parameter\) user: User/);
    assert.match(hoverText(parent, parent.at("row\" params", 1)), /\(snippet\) row\(row: User\)/);
    assert.deepEqual((completion(parent, parent.at("row\" params", 1)) ?? []).map((item) => item.label), ["row"]);
    const members = (completion(parent, parent.at("user.email", 5)) ?? []).map((item) => item.label);
    assert.ok(members.includes("email") && members.includes("id"), JSON.stringify(members));
    const params = completion(parent, parent.at("user\">", 0)) ?? [];
    assert.deepEqual(params.map((item) => [item.label, item.detail]), [["row", "User"]]);
    assert.match(hoverText(parent, parent.at("first = ")), /const first: User \| undefined/);
  });

  test("diagnostics cover both sides of a generic component", { timeout: 120_000 }, async () => {
    const cases: Array<{ name: string; source: string; code: string; text: string }> = [
      { name: "Users.meeko", source: valid.replace("{user.email}", "{user.nope}"), code: "TS2339", text: "nope" },
      { name: "Users.meeko", source: valid.replace("u.email", "u.nope"), code: "TS2339", text: "nope" },
      { name: "Users.meeko", source: valid.replace("signal<User[]>([])", "signal<number[]>([])"), code: "TS2322", text: "rows" },
      { name: "DataTable.meeko", source: table.replace("{current.value?.id}", "{current.value?.email}"), code: "TS2339", text: "email" },
      { name: "DataTable.meeko", source: table.replace(`generic="T extends { id: string }"`, `generic="const T"`), code: "MEEK100", text: "const" },
    ];
    for (const item of cases) {
      const context = open(item.name, item.source);
      const diagnostics = await componentDiagnostics(project, context.document, join(root, item.name), () => undefined);
      const found = diagnostics.find((diagnostic) => diagnostic.code === item.code);
      assert.ok(found, `${item.name}: ${JSON.stringify(diagnostics)}`);
      assert.equal(context.document.getText(found.range), item.text, item.source);
    }
    open("DataTable.meeko", table);
    open("Users.meeko", valid);
  });

  test("a generic tag rejects unknown props, keeps static literals and infers T from them", { timeout: 120_000 }, async () => {
    const parent = (tag: string): string => `<script lang="ts">
import * as Chip from "./Chip.meeko";
</script>
<template>${tag}</template>`;
    // T is the literal of the static prop "draft", so the handler's parameter is "draft".
    const validTag = `<Chip value="draft" tone="warn" on:change="(v) => { const draft: 'draft' = v; void draft; }" />`;
    assert.deepEqual(virtualErrors(open("Tags.meeko", parent(validTag))), []);
    const cases: Array<{ tag: string; code: string; text: string }> = [
      { tag: validTag.replace(`tone="warn"`, `tone="warn" label="x"`), code: "TS2353", text: "label" },
      { tag: validTag.replace(`tone="warn"`, `tone="warn" bind:label="'x'"`), code: "TS2353", text: "label" },
      { tag: validTag.replace("on:change=", "on:nope="), code: "TS2353", text: "on:nope" },
      { tag: validTag.replace(`tone="warn"`, `tone="tertiary"`), code: "TS2322", text: "tone" },
      { tag: validTag.replace("const draft: 'draft'", "const draft: 'other'"), code: "TS2322", text: "draft" },
    ];
    for (const item of cases) {
      const context = open("Tags.meeko", parent(item.tag));
      // The editor's own TypeScript service sees the same single error as meeko check.
      assert.deepEqual(virtualErrors(context).map((error) => error.split(":")[0]), [String(item.code.slice(2))], `${item.tag}: ${virtualErrors(context).join(" | ")}`);
      const diagnostics = await componentDiagnostics(project, context.document, join(root, "Tags.meeko"), () => undefined);
      assert.equal(diagnostics.length, 1, `${item.tag}: ${JSON.stringify(diagnostics)}`);
      assert.equal(diagnostics[0]!.code, item.code, item.tag);
      assert.equal(context.document.getText(diagnostics[0]!.range), item.text, item.tag);
    }
  });
});
