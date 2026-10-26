import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DiagnosticSeverity, DiagnosticTag } from "vscode-languageserver/node";
import type { MarkupContent } from "vscode-languageserver/node";
import type ts from "@typescript/typescript6";
import { componentDiagnostics } from "../src/language-server/diagnostics.ts";
import { documentationMarkdown, hover } from "../src/language-server/features.ts";
import { languageProject } from "./language-server-workspace.ts";
import type { LanguageProject } from "./language-server-workspace.ts";

const page = `<script lang="ts">
import { useSocket, useSocketClient } from "@meekojs/meeko/framework";
import { legacy } from "../../lib/legacy.js";
const pick = () => useSocket;
const same = pick() === useSocketClient;
const value = legacy(1);
</script>
<template><p>{String(same)}{value}</p></template>
`;

const legacyModule = `/** Old helper. Prefer {@link modern} or {@link https://example.com/guide the guide}. */
export function legacy(value: number): number;
/** @deprecated Use the one-argument form. */
export function legacy(value: number, extra: number): number;
export function legacy(value: number): number { return value; }
/** Modern helper. */
export function modern(value: number): number { return value; }
`;

describe("language server: deprecated symbols and JSDoc links", () => {
  let workspace: LanguageProject;

  before(async () => {
    workspace = await languageProject("lsp-deprecated-", { "app/pages/index.meeko": page, "lib/legacy.ts": legacyModule });
  });

  after(async () => {
    await workspace?.dispose();
  });

  test("each use of a @deprecated symbol is a struck-through hint with its reason", { timeout: 120_000 }, async () => {
    const component = await workspace.open("app/pages/index.meeko");
    const diagnostics = await componentDiagnostics(workspace.project, component.document, workspace.file("app/pages/index.meeko"), () => undefined);
    const deprecated = diagnostics.filter((item) => item.tags?.includes(DiagnosticTag.Deprecated));
    // The import specifier and the use in the script; useSocketClient is not deprecated.
    assert.deepEqual(deprecated.map((item) => [component.document.getText(item.range), item.code, item.severity]), [
      ["useSocket", "TS6385", DiagnosticSeverity.Hint],
      ["useSocket", "TS6385", DiagnosticSeverity.Hint],
    ], JSON.stringify(diagnostics));
    assert.deepEqual(deprecated.map((item) => component.document.offsetAt(item.range.start)), [
      component.offset("useSocket,"), component.offset("useSocket;"),
    ]);
    assert.equal(deprecated[0]!.message, "«useSocket» está obsoleto: Desde 1.1.0: use useSocketClient. Se retirará en 2.0.");
    // A deprecated overload is not reported when the call uses the current one.
    assert.equal(diagnostics.some((item) => component.document.getText(item.range) === "legacy" && item.tags?.includes(DiagnosticTag.Deprecated)), false);
    // The component itself type-checks (the package's own Node imports are outside this test project's types).
    assert.equal(diagnostics.some((item) => item.severity === DiagnosticSeverity.Error && item.range.start.line > 0), false, JSON.stringify(diagnostics));
  });

  test("a deprecated overload in a call is struck through too", { timeout: 120_000 }, async () => {
    const text = page.replace("legacy(1)", "legacy(1, 2)");
    const component = await workspace.open("app/pages/index.meeko", text);
    const diagnostics = await componentDiagnostics(workspace.project, component.document, workspace.file("app/pages/index.meeko"), () => undefined);
    const overload = diagnostics.find((item) => item.code === "TS6387");
    assert.ok(overload, JSON.stringify(diagnostics));
    assert.equal(component.document.getText(overload.range), "legacy");
    assert.deepEqual(overload.tags, [DiagnosticTag.Deprecated]);
    assert.equal(overload.message, "Esta firma de «legacy» está obsoleta: Use the one-argument form.");
    await workspace.open("app/pages/index.meeko");
  });

  test("hovers render {@link} as readable text instead of the literal tag", async () => {
    const component = await workspace.open("app/pages/index.meeko");
    const socket = (hover(component, component.at("useSocket;", 2))?.contents as MarkupContent).value;
    assert.match(socket, /Alias obsoleto de `useSocketClient`/);
    assert.match(socket, /clientes con `useSocketChannel` y no está obsoleto/);
    assert.doesNotMatch(socket, /\{@link/);
    assert.match(socket, /\*@deprecated\* — Desde 1\.1\.0: use useSocketClient/);
    const legacy = (hover(component, component.at("legacy(1)", 2))?.contents as MarkupContent).value;
    assert.match(legacy, /Prefer `modern` or \[the guide\]\(https:\/\/example\.com\/guide\)\./);
    assert.doesNotMatch(legacy, /\{@link/);
  });

  test("documentationMarkdown keeps plain text and converts each kind of link", () => {
    const part = (kind: string, text: string): ts.SymbolDisplayPart => ({ kind, text });
    assert.equal(documentationMarkdown(undefined), "");
    assert.equal(documentationMarkdown([part("text", "Plain "), part("text", "text.")]), "Plain text.");
    assert.equal(documentationMarkdown([part("text", "See "), part("link", "{@link "), part("linkName", "useSocketClient"), part("link", "}"), part("text", ".")]), "See `useSocketClient`.");
    assert.equal(documentationMarkdown([part("link", "{@linkcode "), part("linkName", "Foo"), part("linkText", " the foo"), part("link", "}")]), "the foo");
    assert.equal(documentationMarkdown([part("link", "{@link "), part("linkText", "https://example.com"), part("link", "}")]), "[https://example.com](https://example.com)");
    assert.equal(documentationMarkdown([part("link", "{@link "), part("linkText", "https://example.com docs"), part("link", "}")]), "[docs](https://example.com)");
    assert.equal(documentationMarkdown([part("link", "{@link "), part("linkName", "Unclosed")]), "`Unclosed`");
  });
});
