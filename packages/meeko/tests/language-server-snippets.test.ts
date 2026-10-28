import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { after, before, describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import ts from "@typescript/typescript6";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { MarkupContent, TextEdit } from "vscode-languageserver/node";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { completion, hover } from "../src/language-server/features.ts";
import type { FeatureContext } from "../src/language-server/features.ts";
import { MeekoProject } from "../src/language-server/project.ts";

const dialog = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const snippets = defineSnippets<{ default: []; title?: []; actions?: [close: () => void, label: string] }>();
const value = defineModel<string>();
const open = defineModel<boolean>("open", { default: false });
const label = signal("Close");
function close(): void { open.value = false; }
</script>
<template><div><h2 if:when="snippets.title"><render snippet="snippets.title" /></h2><render snippet="snippets.default" /><input model="value" /><input type="checkbox" model="open" /><render snippet="snippets.actions" args="close, label.value" /></div></template>`;

const page = (template: string): string => `<script lang="ts">
import { computed, signal } from "@meekojs/meeko";
import * as AppDialog from "./AppDialog.meeko";
const name = signal("x");
const visible = signal(true);
const derived = computed(() => "y");
</script>
<template>${template}</template>`;

const valid = page(`<AppDialog model="name" model:open="visible"><p>{name.value}</p><snippet name="actions" params="close, label"><button on:click="close">{label.toUpperCase()}</button></snippet></AppDialog>`);

describe("language server: defineModel, defineSnippets, <snippet>, <render> and model", () => {
  let root: string;
  let project: MeekoProject;

  before(async () => {
    await mkdir(resolve(".meeko"), { recursive: true });
    root = await mkdtemp(resolve(".meeko", "lsp-snippets-"));
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    // The package resolves to src/ so the test does not depend on a build of dist/.
    await writeFile(join(root, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { strict: true, types: ["node"], paths: { "@meekojs/meeko/internal": ["../../src/internal.ts"], "@meekojs/meeko": ["../../src/index.ts"] } } })}\n`);
    await writeFile(join(root, "AppDialog.meeko"), dialog);
    await writeFile(join(root, "Page.meeko"), valid);
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

  test("the child declares its models and snippets and exposes them in the module shape", () => {
    const child = open("AppDialog.meeko", dialog);
    assert.deepEqual(virtualErrors(child), []);
    assert.match(child.component.code, /export type ComponentModels = \{ "default": import\("@meekojs\/meeko"\)\.Signal<string>; "open"\?: import\("@meekojs\/meeko"\)\.Signal<boolean> \};/);
    assert.match(child.component.code, /export type ComponentSnippets = __MeekoSnippetMap<\{ default: \[\]; title\?: \[\]; actions\?: \[close: \(\) => void, label: string\] \}>;/);
    assert.match(child.component.code, /export declare const __meekoChannels: \{ readonly models: ComponentModels; readonly snippets: ComponentSnippets \};/);
    assert.match(hoverText(child, child.at("open = ")), /const open: Signal<boolean>/);
    assert.match(hoverText(child, child.at("actions\" args", 0)), /actions\?: Snippet<\[close: \(\) => void, label: string\]>/);
  });

  test("the parent types <snippet params> from the child and completes names and parameters", () => {
    open("AppDialog.meeko", dialog);
    const parent = open("Page.meeko", valid);
    assert.deepEqual(virtualErrors(parent), []);
    assert.match(hoverText(parent, parent.at("close, label", 1)), /\(parameter\) close: \(\) => void/);
    assert.match(hoverText(parent, parent.at("label.toUpperCase", 1)), /\(parameter\) label: string/);
    assert.match(hoverText(parent, parent.at("actions\" params", 2)), /\(snippet\) actions\?\(close: \(\) => void, label: string\)/);

    const names = completion(parent, parent.at("actions\" params", 3)) ?? [];
    assert.deepEqual(names.map((item) => item.label), ["default", "title", "actions"]);
    assert.equal((names[1]!.textEdit as TextEdit).newText, "title");
    assert.deepEqual(parent.document.getText((names[1]!.textEdit as TextEdit).range), "actions");

    const partial = valid.replace('params="close, label"', 'params="close, la"');
    const typing = open("Page.meeko", partial);
    const params = completion(typing, typing.at("la\"", 2)) ?? [];
    assert.deepEqual(params.map((item) => [item.label, item.detail]), [["label", "string"]]);
    assert.equal(typing.document.getText((params[0]!.textEdit as TextEdit).range), "la");

    const model = open("Page.meeko", valid.replace("model:open=", "model:o="));
    const models = completion(model, model.at("model:o", 7)) ?? [];
    assert.deepEqual(models.map((item) => item.label), ["open"]);
    assert.equal(model.document.getText((models[0]!.textEdit as TextEdit).range), "o");
    open("Page.meeko", valid);
  });

  test("<snippet if:when> keeps the snippet's types and narrows its content in the editor model", () => {
    open("AppDialog.meeko", dialog);
    const source = (condition: string): string => `<script lang="ts">
import { signal } from "@meekojs/meeko";
import * as AppDialog from "./AppDialog.meeko";
const name = signal("x");
const user = signal<{ name: string } | null>(null);
</script>
<template><AppDialog model="name">x<snippet name="actions" params="close, label"${condition}><button on:click="close">{label}{user.value.name}</button></snippet></AppDialog></template>`;
    const guarded = open("Conditional.meeko", source(` if:when="user.value"`));
    assert.deepEqual(virtualErrors(guarded), []);
    assert.match(hoverText(guarded, guarded.at("close, label", 1)), /\(parameter\) close: \(\) => void/);
    assert.match(hoverText(guarded, guarded.at("name}", 1)), /\(property\) name: string/);
    assert.match(hoverText(guarded, guarded.at("user.value\"", 1)), /const user: Signal<\{\s*name: string;\s*\} \| null>[\s\S]*plantilla `if:when`/);
    // The hover and the completion of the name and the parameters see through the condition.
    assert.match(hoverText(guarded, guarded.at("actions\" params", 2)), /\(snippet\) actions\?\(close: \(\) => void, label: string\)/);
    assert.deepEqual((completion(guarded, guarded.at("actions\" params", 3)) ?? []).map((item) => item.label), ["default", "title", "actions"]);
    const typing = open("Conditional.meeko", source(` if:when="user.value"`).replace('params="close, label"', 'params="close, la"'));
    assert.deepEqual((completion(typing, typing.at("la\"", 2)) ?? []).map((item) => [item.label, item.detail]), [["label", "string"]]);
    const unguarded = open("Conditional.meeko", source(""));
    assert.ok(virtualErrors(unguarded).some((error) => error.startsWith("18047:")), JSON.stringify(virtualErrors(unguarded)));
  });

  test("diagnostics cover <render>, <snippet>, model and model:name", { timeout: 120_000 }, async () => {
    open("AppDialog.meeko", dialog);
    const cases: Array<{ template: string; code: string; text: string }> = [
      { template: `<AppDialog model="name" model:nope="visible">x</AppDialog>`, code: "TS2353", text: "model:nope" },
      { template: `<AppDialog model="name" model:open="name">x</AppDialog>`, code: "TS2322", text: "model:open" },
      { template: `<AppDialog model="derived">x</AppDialog>`, code: "TS2345", text: "derived" },
      { template: `<AppDialog model:open="visible">x</AppDialog>`, code: "TS2741", text: "<AppDialog" },
      { template: `<AppDialog model="name">x<snippet name="nope">t</snippet></AppDialog>`, code: "TS2353", text: "nope" },
      { template: `<AppDialog model="name">x<snippet name="actions" params="close, label">{label.nope}</snippet></AppDialog>`, code: "TS2339", text: "nope" },
      { template: `<AppDialog model="name"><snippet name="title">t</snippet></AppDialog>`, code: "TS2741", text: "<AppDialog" },
      { template: `<div><snippet name="title">t</snippet></div>`, code: "MEEK061", text: "<snippet" },
      { template: `<AppDialog model="name"><snippet name="default" if:when="visible.value">x</snippet></AppDialog>`, code: "MEEK110", text: "if:when" },
      { template: `<input type="checkbox" model="name" />`, code: "TS2322", text: "name" },
    ];
    const filename = join(root, "Page.meeko");
    for (const item of cases) {
      const text = page(item.template);
      const context = open("Page.meeko", text);
      const diagnostics = await componentDiagnostics(project, context.document, filename, () => undefined);
      const found = diagnostics.find((diagnostic) => diagnostic.code === item.code);
      assert.ok(found, `${item.template}: ${JSON.stringify(diagnostics)}`);
      assert.equal(context.document.getText(found.range), item.text, item.template);
      // Each render path reports the same error; the editor shows it once, on the same range.
      assert.equal(diagnostics.filter((diagnostic) => diagnostic.code === item.code).length, 1, `${item.template}: ${JSON.stringify(diagnostics)}`);
    }
    const render = `<script lang="ts">\nconst snippets = defineSnippets<{ a: [n: number] }>();\n</script><template><render snippet="snippets.a" args="'x'" /><render snippet="snippets.a" /></template>`;
    const child = open("Render.meeko", render);
    const diagnostics = await componentDiagnostics(project, child.document, join(root, "Render.meeko"), () => undefined);
    assert.deepEqual(diagnostics.map((item) => [item.code, child.document.getText(item.range)]).sort(), [["TS2322", "'x'"], ["TS2345", "<render"]], JSON.stringify(diagnostics));
    open("Page.meeko", valid);
  });
});
