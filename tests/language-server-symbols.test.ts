import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { DocumentSymbol, Range } from "vscode-languageserver/node";
import { documentSymbols } from "../src/language-server/features.ts";
import { MeekoProject } from "../src/language-server/project.ts";

const source = `<script lang="ts">
import { signal } from "@meekojs/meeko";
const sender = signal<() => Promise<void>>(async () => {});
const handlers = { open: () => {} };
function connected(): void {
  sender.value = async () => {
    await Promise.resolve();
  };
  handlers.open = function () {};
}
</script>
<template><p on:click="connected">x</p></template>
<style>.a { color: red; }</style>
`;

const before = (left: Range["start"], right: Range["start"]): boolean =>
  left.line < right.line || (left.line === right.line && left.character <= right.character);

function assertContained(symbols: readonly DocumentSymbol[], path: string[] = []): number {
  let count = 0;
  for (const symbol of symbols) {
    const name = [...path, symbol.name].join(" > ");
    assert.ok(before(symbol.range.start, symbol.selectionRange.start) && before(symbol.selectionRange.end, symbol.range.end),
      `${name}: selectionRange ${JSON.stringify(symbol.selectionRange)} is outside range ${JSON.stringify(symbol.range)}`);
    count += 1 + assertContained(symbol.children ?? [], [...path, symbol.name]);
  }
  return count;
}

test("document symbols keep every selectionRange inside its range, also for property assignments", async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko", "lsp-symbols-"));
  const project = new MeekoProject(root, { trusted: false });
  try {
    await writeFile(join(root, "package.json"), '{"private":true,"type":"module"}\n');
    const filename = join(root, "Symbols.meeko");
    await writeFile(filename, source);
    await project.ready();
    const component = project.setDocument(filename, source);
    assert.ok(component);
    const document = TextDocument.create(pathToFileURL(filename).href, "meeko", 1, source);
    const symbols = documentSymbols({ project, component, document, locate: () => undefined });
    assert.ok(assertContained(symbols) > 4);
    const script = symbols.find((symbol) => symbol.name === "<script>");
    const connected = script?.children?.find((symbol) => symbol.name === "connected");
    assert.ok(connected, JSON.stringify(script));
    const value = connected.children?.find((symbol) => symbol.name === "value");
    assert.ok(value, JSON.stringify(connected));
    // The range covers the assignment target and the function.
    assert.equal(document.getText(value.selectionRange), "value");
    assert.match(document.getText(value.range), /^value = async \(\) => \{[\s\S]*\}$/);
  } finally {
    project.service.dispose();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
});
