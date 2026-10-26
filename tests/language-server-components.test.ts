import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import type { MarkupContent } from "vscode-languageserver/node";
import { componentSummary } from "../src/language-server/components.ts";
import { hover } from "../src/language-server/features.ts";
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

describe("language server: component hover", () => {
  let workspace: LanguageProject;

  before(async () => {
    workspace = await languageProject("lsp-components-", { "AppButton.meeko": button, "Parent.meeko": parent, "Plain.meeko": plain });
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
    assert.match(tag, /\(componente\) AppButton/);
    assert.match(tag, /\*\*Props:\*\* `label: string`, `disabled\?: boolean`/);
    assert.match(tag, /\*\*Eventos:\*\* `on:save\(id: number\)`, `on:close\(\)`/);
    assert.match(tag, /\*\*Modelos:\*\* `model` \(string\), `model:open\?` \(boolean\)/);
    assert.match(tag, /\*\*Snippets:\*\* `default\(\)`, `icon\?\(size: number\)`/);
    assert.match(tag, /\*\*Expone:\*\* `focus: \(\) => void`, `count: Signal<number>`/);
    const dynamic = (hover(context, context.at("is=\"AppButton", 5))?.contents as MarkupContent).value;
    assert.match(dynamic, /`AppButton\.meeko`/);
    assert.match(dynamic, /\*\*Eventos:\*\* `on:save\(id: number\)`/);
  });
});
