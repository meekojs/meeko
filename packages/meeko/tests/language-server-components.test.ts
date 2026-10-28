import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { MarkupContent } from "vscode-languageserver/node";
import { componentSummary } from "../src/language-server/components.ts";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { completion, definition, hover } from "../src/language-server/features.ts";
import { languageProject } from "./language-server-workspace.ts";
import type { LanguageProject } from "./language-server-workspace.ts";

const button = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const props = defineProps<{ label: string; disabled?: boolean }>();
const emit = defineEmits<{ save: [id: number]; close: [] }>();
const value = defineModel<string>();
const open = defineModel<boolean>("open", { default: false });
const snippets = defineSnippets<{ default: []; icon?: [size: number] }>();
const count = signal(0);
function focus(): void {}
defineExpose({ focus, count });
</script>
<template><button bind:disabled="props.disabled" on:click="() => emit('save', 1)">{props.label}{value.value}{String(open.value)}<render snippet="snippets.default" /></button></template>
`;

const parent = `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as AppButton from "./AppButton.meeko";
const name = signal("");
</script>
<template><AppButton label="Hi" model="name">Go</AppButton><component is="AppButton" label="x"></component></template>
`;

const plain = `<script lang="ts">
const props = defineProps<{ title: string }>();
</script>
<template><h1>{props.title}</h1></template>
`;

const documented = `<script lang="ts">
type CardVariant = "primary" | "secondary";
interface Props {
  /** Estilo de la tarjeta. */
  variant?: CardVariant;
  title: string;
}
const props = defineProps<Props>();
</script>
<template><h1>{props.title}{props.variant}</h1></template>
`;

const documentedParent = `<script lang="ts">
import * as Plain from "./Plain.meeko";
import * as Documented from "./Documented.meeko";
</script>
<template><Plain title="x" /><Documented title="y" /></template>
`;

describe("language server: component hover", () => {
  test("the signature leaves out empty channels and shows the declared types with their JSDoc", async () => {
    await workspace.open("Plain.meeko");
    await workspace.open("Documented.meeko");
    const context = await workspace.open("DocumentedParent.meeko");
    const plainTag = (hover(context, context.at("<Plain", 2))?.contents as MarkupContent).value;
    assert.match(plainTag, /^```ts\n<Plain\n {2}title: string\n\/>\n```\n\nComponente · \[Plain\.meeko\]\(file:\/\/\/[^)]+\/Plain\.meeko\)$/);
    assert.doesNotMatch(plainTag, /ninguno|Eventos|Modelos|Snippets/);
    const documentedTag = (hover(context, context.at("<Documented", 2))?.contents as MarkupContent).value;
    // The alias of an optional prop, not its union with undefined, and its JSDoc below.
    assert.match(documentedTag, /\n {2}variant\?: CardVariant\n/);
    assert.match(documentedTag, /\*\*Props\*\*\n- `variant`: Estilo de la tarjeta\./);
  });

  let workspace: LanguageProject;

  before(async () => {
    workspace = await languageProject("lsp-components-", {
      "AppButton.meeko": button, "Parent.meeko": parent, "Plain.meeko": plain, "Documented.meeko": documented, "DocumentedParent.meeko": documentedParent,
    });
  });

  after(async () => {
    await workspace?.dispose();
  });

  test("the summary lists props, events, models, snippets and exposed members", async () => {
    const child = await workspace.open("AppButton.meeko");
    const summary = componentSummary(workspace.project.service.getProgram()!, child.component)!;
    const show = (members: ReadonlyArray<{ name: string; type: string; optional: boolean }>) => members.map((member) => `${member.name}${member.optional ? "?" : ""}: ${member.type}`);
    assert.deepEqual(show(summary.props), ["label: string", "disabled?: boolean"]);
    assert.deepEqual(show(summary.events), ["save: [id: number]", "close: []"]);
    assert.deepEqual(show(summary.models), ["default: string", "open?: boolean"]);
    assert.deepEqual(show(summary.snippets), ["default: []", "icon?: [size: number]"]);
    assert.deepEqual(show(summary.exposed ?? []), ["focus: () => void", "count: Signal<number>"]);
    const none = componentSummary(workspace.project.service.getProgram()!, (await workspace.open("Plain.meeko")).component)!;
    assert.deepEqual([none.events, none.models, none.snippets, none.exposed], [[], [], [], undefined]);
  });

  test("hovering <AppButton> and <component is> shows the summary of the child", async () => {
    await workspace.open("AppButton.meeko");
    const context = await workspace.open("Parent.meeko");
    const tag = (hover(context, context.at("<AppButton", 2))?.contents as MarkupContent).value;
    // The tag's signature in a TypeScript block: props, events, models, snippets and the exposed value.
    assert.equal(tag.slice(0, tag.indexOf("```", 5) + 3), [
      "```ts",
      "<AppButton",
      "  label: string",
      "  disabled?: boolean",
      "  on:save(id: number)",
      "  on:close()",
      "  model: string",
      "  model:open?: boolean",
      ">",
      "  default()",
      "  icon?(size: number)",
      "</AppButton>",
      "// ref: expone",
      "focus: () => void",
      "count: Signal<number>",
      "```",
    ].join("\n"));
    assert.match(tag, /Componente · \[AppButton\.meeko\]\(file:\/\/\/.+\/AppButton\.meeko\)/);
    const dynamic = (hover(context, context.at("is=\"AppButton", 5))?.contents as MarkupContent).value;
    assert.match(dynamic, /\[AppButton\.meeko\]\(file:/);
    assert.match(dynamic, /\n {2}on:save\(id: number\)\n/);
  });
});

const card = `<script lang="ts">
const props = defineProps<{ title?: string }>();
const snippets = defineSnippets<{ header?: []; default: []; footer?: [] }>();
</script>
<template><article><h2>{props.title}</h2><render snippet="snippets.header" /><render snippet="snippets.default" /><render snippet="snippets.footer" /></article></template>
`;

const modal = `<script lang="ts">
const snippets = defineSnippets<Omit<AppCardSnippets, "footer"> & { actions?: [close: () => void] }>();
const title: AppCardProps["title"] = "Hi";
function close(): void {}
</script>
<template><AppCard bind:title="title"><snippet name="header" if:when="snippets.header"><render snippet="snippets.header" /></snippet><render snippet="snippets.default" /><snippet name="footer" if:when="snippets.actions"><render snippet="snippets.actions" args="close" /></snippet></AppCard></template>
`;

describe("language server: the types of each autoimported component", () => {
  let workspace: LanguageProject;

  before(async () => {
    workspace = await languageProject("lsp-component-types-", { "app/components/App/Card.meeko": card, "app/components/App/Modal.meeko": modal });
  });

  after(async () => {
    await workspace?.dispose();
  });

  test("AppCardSnippets types the snippets it reuses, and hover and definition lead to the card", async () => {
    await workspace.open("app/components/App/Card.meeko");
    const context = await workspace.open("app/components/App/Modal.meeko");
    const diagnostics = await componentDiagnostics(workspace.project, context.document, workspace.file("app/components/App/Modal.meeko"), () => undefined);
    // The workspace has no Node types: the package's own sources report them, the modal nothing.
    const message = (item: (typeof diagnostics)[number]): string => typeof item.message === "string" ? item.message : item.message.value;
    const own = diagnostics.filter((item) => !/\.\.\/\.\.\/src\//.test(message(item)));
    assert.deepEqual(own.map((item) => `${String(item.code)}: ${message(item)}`), []);

    const shown = (hover(context, context.at("AppCardSnippets", 3))?.contents as MarkupContent).value;
    assert.match(shown, /type AppCardSnippets/);
    assert.match(shown, /`ComponentSnippets` de \[app\/components\/App\/Card\.meeko\]\(file:/);
    assert.match(shown, /```ts\n<AppCard\n {2}title\?: string\n>\n {2}header\?\(\)\n {2}default\(\)\n {2}footer\?\(\)\n<\/AppCard>\n```/);
    const props = (hover(context, context.at("AppCardProps", 3))?.contents as MarkupContent).value;
    assert.match(props, /`ComponentProps` de \[app\/components\/App\/Card\.meeko\]\(file:/);

    const cardUri = context.locate(workspace.file("app/components/App/Card.meeko"))!.uri;
    const [target] = definition(context, context.at("AppCardSnippets", 3)) ?? [];
    assert.equal(target?.uri, cardUri);
    assert.deepEqual(target?.range.start, { line: 2, character: "const snippets = ".length });
    const [propsTarget] = definition(context, context.at("AppCardProps", 3)) ?? [];
    assert.deepEqual([propsTarget?.uri, propsTarget?.range.start.line], [cardUri, 1]);

    // The snippet parameters the modal reuses reach the tags of a parent.
    const page = await workspace.open("app/pages/index.meeko", `<script lang="ts">
const open = true;
</script>
<template><AppModal><p>Body</p><snippet name="actions" params="close"><button on:click="close">x</button></snippet></AppModal></template>
`);
    const names = completion(page, page.at('name="actions"', 6))?.map((item) => item.label) ?? [];
    assert.deepEqual(names.sort(), ["actions", "default", "header"]);
    const parameters = (hover(page, page.at('params="close"', 9))?.contents as MarkupContent | undefined)?.value ?? "";
    assert.doesNotMatch(parameters, /any/);

    // Completed where TypeScript completes type names, not where it completes values.
    const typing = await workspace.open("app/pages/typing.meeko", `<script lang="ts">
type Reused = AppC;
const value = AppC;
</script>
<template><p>x</p></template>
`);
    const types = completion(typing, typing.at("AppC;", 4)) ?? [];
    const cardSnippets = types.find((item) => item.label === "AppCardSnippets");
    assert.ok(cardSnippets, JSON.stringify(types.filter((item) => item.label.startsWith("App")).map((item) => item.label)));
    assert.equal(cardSnippets.labelDetails?.description, "app/components/App/Card.meeko");
    for (const name of ["AppCardProps", "AppCardModels", "AppCardExposed", "AppModalSnippets"]) assert.ok(types.some((item) => item.label === name), name);
    const values = completion(typing, typing.at("AppC;", 4, "const value")) ?? [];
    assert.ok(!values.some((item) => item.label === "AppCardSnippets"));
  });
});
