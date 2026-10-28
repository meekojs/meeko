import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { MarkupContent } from "vscode-languageserver/node";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { completion, directiveNameCompletion, hover } from "../src/language-server/features.ts";
import { languageProject } from "./language-server-workspace.ts";
import type { LanguageProject } from "./language-server-workspace.ts";

const card = `<script lang="ts">
const props = defineProps<{ title: string; tone?: "info" | "warn" }>();
</script>
<template><article>{props.title}</article></template>
`;

const page = `<script lang="ts">
import * as Card from "./Card.meeko";
const props = defineProps<{ href?: string }>();
const state = { "data-kind": "link" };
</script>
<template><component is="props.href ? 'a' : 'button'" bind="state" on:click="(event) => event.currentTarget.focus()">x</component><component is="'section'"></component><a bind="{ hre }">y</a><Card bind="{ ti }" /></template>
`;

/** Labels of the directive and attribute names offered where `|` marks the cursor. */
function attributeLabels(template: string): Array<{ label: string; detail?: string }> {
  const text = `<script lang="ts">\nconst props = defineProps<{ href?: string }>();\n</script>\n<template>\n${template}\n</template>\n`;
  const offset = text.indexOf("|");
  const document = TextDocument.create("file:///Probe.meeko", "meeko", 1, text.replace("|", ""));
  return (directiveNameCompletion(document, document.positionAt(offset)) ?? []).map((item) => ({ label: item.label, ...(item.detail ? { detail: item.detail } : {}) }));
}

test("<component is> with HTML tags offers the attributes of those tags, and bind", () => {
  const offered = attributeLabels(`<component is="props.href ? 'a' : 'button'" |>x</component>`);
  const find = (label: string) => offered.find((item) => item.label === label);
  assert.equal(find("href")?.detail, "Sólo en <a>");
  assert.equal(find("type")?.detail, "Sólo en <button>");
  assert.equal(find("disabled")?.detail, "Sólo en <button>");
  assert.ok(find("class"), "a global attribute");
  assert.equal(find("class")?.detail, undefined);
  assert.ok(find("bind"), "the bind directive");
  assert.equal(find("colspan"), undefined);
  assert.equal(find("model:"), undefined);
  // With a component, the tag offers the component's directives and no HTML attributes.
  const component = attributeLabels(`<component is="Card" |></component>`).map((item) => item.label);
  assert.ok(component.includes("model:"));
  assert.ok(component.includes("bind"));
  assert.ok(!component.includes("href"));
});

describe("language server: <component is> with HTML tags and bind", () => {
  let workspace: LanguageProject;

  before(async () => {
    workspace = await languageProject("lsp-dynamic-tag-", { "Card.meeko": card, "Page.meeko": page });
  });

  after(async () => {
    await workspace?.dispose();
  });

  test("hovering <component> shows the elements it may render", async () => {
    const context = await workspace.open("Page.meeko");
    const value = (hover(context, context.at("<component", 3))?.contents as MarkupContent).value;
    assert.match(value, /\(elemento\) <a> \| <button>/);
    assert.match(value, /no se escribe/);
    // The handler's event has currentTarget typed as the union of both elements.
    const target = (hover(context, context.at("currentTarget.focus", 3))?.contents as MarkupContent).value;
    assert.match(target, /HTMLAnchorElement/);
    assert.match(target, /HTMLButtonElement/);
  });

  test("is completes the tags it may render, and bind the attributes of the tag or the props of the component", async () => {
    const typing = await workspace.open("Page.meeko", page.replace("is=\"'section'\"", "is=\"'s'\""));
    const tags = (completion(typing, typing.at("'s'\"", 2)) ?? []).map((item) => item.label);
    assert.ok(tags.includes("section"), tags.join(","));
    assert.ok(tags.includes("span"));
    assert.ok(!tags.includes("script"), "a tag that <component is> cannot render");
    assert.ok(!tags.includes("iframe"));
    // Also next to a component.
    const mixed = await workspace.open("Page.meeko", page.replace("is=\"'section'\"", "is=\"props.href ? 'se' : Card\""));
    const both = (completion(mixed, mixed.at("'se'", 2)) ?? []).map((item) => item.label);
    assert.ok(both.includes("section"), both.join(","));
    const context = await workspace.open("Page.meeko");
    const attributes = (completion(context, context.at("{ hre }", 5)) ?? []).map((item) => item.label);
    assert.ok(attributes.includes("href"), attributes.join(","));
    assert.ok(attributes.includes("download"));
    assert.ok(!attributes.includes("colspan"));
    const props = (completion(context, context.at("{ ti }", 4)) ?? []).map((item) => item.label);
    assert.ok(props.includes("title"), props.join(","));
    assert.ok(props.includes("tone"));
  });

  test("the editor reports MEEK112 and MEEK113 like meeko check, on the attribute or the value", async () => {
    const source = `<script lang="ts">
const props = defineProps<{ href?: string; as: "div" | "iframe" }>();
</script>
<template><component is="props.href ? 'a' : 'button'" bind:colspan="2">x</component><component is="props.as">y</component><p bind="{ onclick: 'x' }">z</p></template>
`;
    const context = await workspace.open("Diagnostics.meeko", source);
    const diagnostics = await componentDiagnostics(workspace.project, context.document, workspace.file("Diagnostics.meeko"), context.locate);
    // The other diagnostics come from the test project, whose tsconfig has no Node types.
    const shown = diagnostics.filter((item) => String(item.code).startsWith("MEEK")).map((item) => `${String(item.code)} ${context.document.getText(item.range)}`).sort();
    assert.deepEqual(shown, ["MEEK112 bind:colspan", "MEEK112 props.as", "MEEK113 onclick"]);
  });
});
