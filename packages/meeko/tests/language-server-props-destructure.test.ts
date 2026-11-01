import type { MarkupContent } from "vscode-languageserver/node";

import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import type { LanguageProject } from "./language-server-workspace.ts";

import { componentSummary } from "../src/language-server/components.ts";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { componentTagMembers, directiveNameCompletion, hover, prepareRename, rename } from "../src/language-server/features.ts";
import { languageProject } from "./language-server-workspace.ts";

/** Defaults in the destructuring, a renamed prop and a rest view. */
const tag = `<script lang="ts">
interface Props {
  label: string;
  size?: "sm" | "md" | "lg";
  tags?: string[];
  class?: string;
  title?: string;
}
const { label, size = "md", tags = [], class: className, ...rest } = defineProps<Props>();
const upper = computed(() => label.toUpperCase());
</script>
<template><span bind:class="className" bind="rest">{upper.value}{label}{size}{tags.length}</span></template>
`;

/** Defaults in the argument. */
const counter = `<script lang="ts">
const props = defineProps<{ step?: number; label: string }>({ step: 1 });
</script>
<template><b>{props.label}{props.step}</b></template>
`;

const parent = `<script lang="ts">
import * as AppTag from "./AppTag.meeko";
import * as AppCounter from "./AppCounter.meeko";
</script>
<template><AppTag label="Hola" size="lg" /><AppCounter label="Visitas" step="2" /><AppTag label="x" s /></template>
`;

/** A union whose discriminant has a default: optional only in the member that admits it. */
const choice = `<script lang="ts">
type Props = { kind: "a"; a: string; b?: never } | { kind: "b"; b: string; a?: never };
const { kind = "a", a, b } = defineProps<Props>();
</script>
<template><p>{kind === "a" ? a.length : b.length}</p></template>
`;

describe("language server: destructured defineProps", () => {
  let workspace: LanguageProject;

  before(async () => {
    workspace = await languageProject("lsp-props-destructure-", { "AppTag.meeko": tag, "AppCounter.meeko": counter, "Parent.meeko": parent, "AppChoice.meeko": choice });
  });

  after(async () => {
    await workspace?.dispose();
  });

  test("the summary of a child gives each prop its default, from the pattern or the argument", async () => {
    const program = (): NonNullable<ReturnType<typeof workspace.project.service.getProgram>> => workspace.project.service.getProgram()!;
    const show = (members: ReadonlyArray<{ name: string; optional: boolean; default?: string }>) => members.map((member) => `${member.name}${member.optional ? "?" : ""}${member.default === undefined ? "" : ` = ${member.default}`}`);
    // A default of the destructuring makes the prop optional for the parent, as in the compiler.
    const child = await workspace.open("AppTag.meeko");
    assert.deepEqual(show(componentSummary(program(), child.component)!.props), ["label", "class?", "title?", "size? = \"md\"", "tags? = []"]);
    const counterChild = await workspace.open("AppCounter.meeko");
    assert.deepEqual(show(componentSummary(program(), counterChild.component)!.props), ["label", "step? = 1"]);
  });

  test("hover of the tag and of a prop on it shows the default; completion details too", async () => {
    await workspace.open("AppTag.meeko");
    await workspace.open("AppCounter.meeko");
    const context = await workspace.open("Parent.meeko");
    const tagHover = (hover(context, context.at("<AppTag", 2))?.contents as MarkupContent).value;
    assert.match(tagHover, /\n {2}size\?: "sm" \| "md" \| "lg" = "md"\n/);
    assert.match(tagHover, /\n {2}tags\?: string\[\] = \[\]\n/);
    const sizeHover = (hover(context, context.at("size=", 1))?.contents as MarkupContent).value;
    assert.match(sizeHover, /size\?: "sm" \| "md" \| "lg"( \| undefined)? = "md"/);
    const stepHover = (hover(context, context.at("step=", 1))?.contents as MarkupContent).value;
    assert.match(stepHover, /step\?: number( \| undefined)? = 1/);
    // The server completes a component tag's attributes from its members, as `server.ts` does.
    const position = context.at(" s />", 2);
    const items = directiveNameCompletion(context.document, position, new Set(), componentTagMembers(context, position)) ?? [];
    const size = items.find((item) => item.label === "size");
    assert.equal(size?.detail, 'size?: "sm" | "md" | "lg" = "md"', JSON.stringify(items.map((item) => item.label)));
  });

  test("a parent must pass a discriminant whose member does not admit its default", async () => {
    const errors = async (body: string): Promise<number[]> => {
      const context = await workspace.open("ChoiceParent.meeko", `<script lang="ts">\nimport * as AppChoice from "./AppChoice.meeko";\n</script>\n<template>${body}</template>\n`);
      const file = context.component.virtualFilename;
      return [...workspace.project.service.getSyntacticDiagnostics(file), ...workspace.project.service.getSemanticDiagnostics(file)].map((item) => item.code);
    };
    await workspace.open("AppChoice.meeko");
    assert.deepEqual(await errors(`<AppChoice a="x" /><AppChoice kind="b" b="y" />`), []);
    assert.notDeepEqual(await errors(`<AppChoice b="hello" />`), []);
  });

  test("a type query of a destructured name is valid in the final diagnostics, and an error keeps its range", async () => {
    const typed = (extra: string): string => `<script lang="ts">\nconst { x } = defineProps<{ x: string }>();\nfunction f(): string {\n  const y: typeof x = x;${extra}\n  return y;\n}\n</script>\n<template><p>{f()}</p></template>\n`;
    // The test project has no Node types: errors of the package's own files are not this component's.
    const own = async (context: Awaited<ReturnType<typeof workspace.open>>) => (await componentDiagnostics(workspace.project, context.document, workspace.file("AppTyped.meeko"), () => undefined))
      .filter((item) => !String(item.message).startsWith("../"));
    const valid = await workspace.open("AppTyped.meeko", typed(""));
    assert.deepEqual(await own(valid), []);
    const wrong = await workspace.open("AppTyped.meeko", typed("\n  const bad: typeof x = 5;"));
    const diagnostics = await own(wrong);
    assert.deepEqual(diagnostics.map((item) => [item.code, item.range.start, item.range.end]), [["TS2322", wrong.at("bad"), wrong.at("bad", 3)]], JSON.stringify(diagnostics));
    await workspace.open("AppTyped.meeko", typed(""));
  });

  test("hover in the child shows a destructured name with its type", async () => {
    const context = await workspace.open("AppTag.meeko");
    const value = (hover(context, context.at("{label}", 2))?.contents as MarkupContent).value;
    assert.match(value, /const label: string/);
  });

  test("renaming a destructured name keeps the prop and renames its uses in script and template", async () => {
    const context = await workspace.open("AppTag.meeko");
    const prepared = prepareRename(context, context.at("label.toUpperCase", 1));
    assert.ok(prepared);
    assert.equal(prepared.placeholder, "label");
    const edit = rename(context, context.at("{label}", 2), "text");
    const changes = Object.values(edit?.changes ?? {}).flat();
    const applied = changes
      .map((change) => ({ start: context.document.offsetAt(change.range.start), end: context.document.offsetAt(change.range.end), text: change.newText }))
      .sort((left, right) => right.start - left.start)
      .reduce((text, change) => text.slice(0, change.start) + change.text + text.slice(change.end), tag);
    assert.match(applied, /const \{ label: text, size = "md"/);
    assert.match(applied, /computed\(\(\) => text\.toUpperCase\(\)\)/);
    assert.match(applied, /\{upper\.value\}\{text\}\{size\}/);
    // The prop keeps its name in the type.
    assert.match(applied, /\n {2}label: string;\n/);
    // A renamed prop renames only its local name.
    const renamed = rename(context, context.at("className\"", 1), "classes");
    const ranges = Object.values(renamed?.changes ?? {}).flat().map((change) => [context.document.getText(change.range), change.newText]);
    assert.deepEqual(ranges, [["className", "classes"], ["className", "classes"]]);
  });
});
