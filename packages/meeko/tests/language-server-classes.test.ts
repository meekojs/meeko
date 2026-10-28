import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, test } from "node:test";
import { pathToFileURL } from "node:url";
import { TextDocument } from "vscode-languageserver-textdocument";
import {
  CompletionRequest, CompletionResolveRequest, createConnection, createProtocolConnection, DefinitionRequest, DidChangeTextDocumentNotification,
  DidChangeWatchedFilesNotification, DidOpenTextDocumentNotification, FileChangeType, HoverRequest, InitializedNotification, InitializeRequest,
  PublishDiagnosticsNotification, RegistrationRequest, ShutdownRequest, StreamMessageReader, StreamMessageWriter,
} from "vscode-languageserver/node";
import type { CompletionItem, CompletionList, Location, MarkupContent, ProtocolConnection, TextEdit } from "vscode-languageserver/node";
import { classRuleSnippet, cssClassRules, cssImports } from "../src/language-server/class-rules.ts";
import { classCompletion, classDefinition, classHover, ClassIndex, classTokenAt, classView, resolveClassCompletion } from "../src/language-server/classes.ts";
import type { ComponentText } from "../src/language-server/classes.ts";
import { startLanguageServer } from "../src/language-server/server.ts";
import { createTempProject } from "./helpers/temp-project.ts";

/** A text and the offset of `|` in it. */
function cursor(text: string): { source: string; offset: number } {
  return { source: text.replace("|", ""), offset: text.indexOf("|") };
}

const component = (template: string, style = "", attributes = ""): string =>
  `<script lang="ts">\nconst open = signal(false);\n</script>\n<template>\n${template}\n</template>\n${style ? `<style${attributes}>\n${style}\n</style>\n` : ""}`;

async function files(root: string, entries: Record<string, string>): Promise<void> {
  for (const [name, content] of Object.entries(entries)) {
    await mkdir(dirname(join(root, name)), { recursive: true });
    await writeFile(join(root, name), content);
  }
}

const labels = (items: readonly CompletionItem[] | undefined): string[] => (items ?? []).map((item) => item.label);
const detailOf = (items: readonly CompletionItem[] | undefined, label: string): string | undefined => items?.find((item) => item.label === label)?.detail;

describe("CSS classes in the language server", () => {
  test("class selectors are read in nested rules, at-rules, pseudo-class arguments and :global()", () => {
    const css = [
      "@layer components { @media (min-width: 40rem) { .md\\:flex, .w-1\\/2 { display: flex; } } }",
      ".card {\n  padding: 1rem;\n  &.is-open { color: red; }\n  .card-title & { margin: 0; }\n}",
      ":is(.a, .b):not(.c) {}",
      ":global(.external) { margin: 0; }",
      "@utility content-auto { content-visibility: auto; }",
      "@utility tab-* { tab-size: --value(integer); }",
    ].join("\n");
    const rules = cssClassRules(css)!;
    assert.deepEqual(rules.map((rule) => rule.name), ["md:flex", "w-1/2", "card", "is-open", "card-title", "a", "b", "c", "external", "content-auto"]);
    assert.equal(rules.find((rule) => rule.name === "external")!.global, true);
    const escaped = rules.find((rule) => rule.name === "md:flex")!;
    assert.equal(css.slice(escaped.start, escaped.end), ".md\\:flex");
    assert.deepEqual(escaped.context, ["@layer components", "@media (min-width: 40rem)"]);
    const nested = rules.find((rule) => rule.name === "is-open")!;
    assert.equal(classRuleSnippet(css, nested), ".card {\n  &.is-open { color: red; }\n}");
    const utility = rules.find((rule) => rule.name === "content-auto")!;
    assert.equal(css.slice(utility.start, utility.end), "content-auto");
    assert.equal(cssClassRules(".broken { color: red;"), undefined);
    assert.deepEqual(cssImports('@import "tailwindcss";\n@import url(./a.css);\n@import "./b.css" layer(base);\n/* @import "./c.css"; */\n@import "https://x.test/d.css";'),
      ["tailwindcss", "./a.css", "./b.css"]);
  });

  test("the cursor finds its class word in class=\"…\" and in string literals of bind:class", () => {
    const end = cursor(component(`<p class="a b|"></p>`));
    const token = classTokenAt(end.source, end.offset)!;
    assert.equal(end.source.slice(token.start, token.end), "b");
    assert.deepEqual([...token.written], ["a"]);
    const middle = cursor(component(`<p class="first sec|ond third"></p>`));
    const word = classTokenAt(middle.source, middle.offset)!;
    assert.equal(middle.source.slice(word.start, word.end), "second");
    assert.deepEqual([...word.written], ["first", "third"]);
    const empty = cursor(component(`<p class="a |"></p>`));
    const blank = classTokenAt(empty.source, empty.offset)!;
    assert.equal(blank.start, blank.end);
    const ternary = cursor(component(`<p bind:class="open.value ? 'is-op|en' : 'closed'"></p>`));
    const literal = classTokenAt(ternary.source, ternary.offset)!;
    assert.equal(ternary.source.slice(literal.start, literal.end), "is-open");
    assert.equal(literal.dynamic, true);
    const template = cursor(component("<p bind:class=\"`badge ${open.value ? 'x' : ''} wi|de`\"></p>"));
    const segment = classTokenAt(template.source, template.offset)!;
    assert.equal(template.source.slice(segment.start, segment.end), "wide");
    for (const outside of [
      component(`<p bind:class="open.va|lue ? 'a' : 'b'"></p>`),
      component("<p bind:class=\"`badge ${op|en.value}`\"></p>"),
      component(`<p id="a|"></p>`),
      component(`<p class="a">te|xt</p>`),
    ]) {
      const at = cursor(outside);
      assert.equal(classTokenAt(at.source, at.offset), undefined, outside);
    }
  });

  test("a project completes its global stylesheet with its imports, other components' global <style> and the unsaved own <style>", async () => {
    const { root, remove } = await createTempProject("lsp-classes-");
    try {
      await files(root, {
        "package.json": '{"private":true,"type":"module"}\n',
        "app/styles/main.css": '@import "tailwindcss";\n@import "./tokens.css";\n.button { padding: 0.5rem; }\n',
        "app/styles/tokens.css": "@media (prefers-color-scheme: dark) {\n  .theme-dark { color: white; }\n}\n",
      });
      const card = join(root, "app", "components", "Card.meeko");
      const dialog = join(root, "app", "components", "Dialog.meeko");
      const components: ComponentText[] = [
        { filename: card, source: component(`<div class="card"></div>`, ".card { border: 1px solid; }\n.card .card-title { font-weight: 700; }") },
        { filename: dialog, source: component(`<div class="dialog"></div>`, ".dialog { inset: 0; }\n:global(.dialog-open) { overflow: hidden; }", " scoped") },
      ];
      const index = new ClassIndex(root);
      const page = join(root, "app", "pages", "index.meeko");
      const open = (text: string): { document: TextDocument; position: ReturnType<TextDocument["positionAt"]> } => {
        const at = cursor(text);
        const document = TextDocument.create(pathToFileURL(page).href, "meeko", 1, at.source);
        return { document, position: document.positionAt(at.offset) };
      };
      // An unsaved <style> of the component itself, with a class it is still typing.
      const own = open(component(`<main class="button |"></main>`, ".hero { color: navy; }", " scoped"));
      const items = classCompletion(own.document, own.position, page, index, components)!;
      assert.deepEqual(labels(items), ["hero", "card", "card-title", "dialog-open", "theme-dark"]);
      assert.equal(detailOf(items, "hero"), "este componente");
      assert.equal(detailOf(items, "card"), "Card.meeko");
      assert.equal(detailOf(items, "dialog-open"), "Dialog.meeko");
      assert.equal(detailOf(items, "theme-dark"), "tokens.css (global)");
      assert.ok(!labels(items).includes("dialog"), "a class of another component's <style scoped> is not offered");
      assert.ok(!labels(items).includes("button"), "a class already written is not offered again");
      // While the own CSS does not parse, its last classes stay.
      const broken = open(component(`<main class="|"></main>`, ".hero { color: navy; }\n.her", " scoped"));
      assert.ok(labels(classCompletion(broken.document, broken.position, page, index, components)).includes("hero"));

      const view = classView(own.document, page, index, components);
      const resolved = resolveClassCompletion(items.find((item) => item.label === "theme-dark")!, view);
      const documentation = (resolved.documentation as MarkupContent).value;
      assert.match(documentation, /app\/styles\/tokens\.css/);
      assert.match(documentation, /@media \(prefers-color-scheme: dark\) \{\n {2}\.theme-dark \{ color: white; \}\n\}/);

      const hovered = open(component(`<main class="card-ti|tle"></main>`));
      const hover = classHover(hovered.document, hovered.position, page, index, components)!;
      assert.match((hover.contents as MarkupContent).value, /Card\.meeko[\s\S]*\.card \.card-title \{ font-weight: 700; \}/);
      assert.equal(hovered.document.getText(hover.range!), "card-title");

      const target = open(component(`<main class="th|eme-dark"></main>`));
      const [location] = classDefinition(target.document, target.position, page, index, components)!;
      assert.equal(location!.uri, pathToFileURL(join(root, "app", "styles", "tokens.css")).href);
      assert.deepEqual(location!.range.start, { line: 1, character: 2 });
    } finally { await remove(); }
  });

  test("the processed stylesheet of meeko dev adds its generated classes and is read again when it changes", async () => {
    const { root, remove } = await createTempProject("lsp-classes-snapshot-");
    try {
      await files(root, {
        "package.json": '{"private":true,"type":"module"}\n',
        "app/styles/main.css": '@utilities "./utilities.ts" layer(utilities);\n.button { padding: 0.5rem; }\n',
        ".meeko/styles/main.css": "@layer utilities {\n  .text-brand { color: #f60; }\n}\n.button { padding: 0.5rem; }\n",
      });
      const page = join(root, "app", "pages", "index.meeko");
      const index = new ClassIndex(root);
      const at = cursor(component(`<main class="|"></main>`));
      const document = TextDocument.create(pathToFileURL(page).href, "meeko", 1, at.source);
      const position = document.positionAt(at.offset);
      const items = classCompletion(document, position, page, index, [])!;
      assert.deepEqual(labels(items), ["button", "text-brand"]);
      assert.equal(detailOf(items, "button"), "main.css (global)");
      assert.equal(detailOf(items, "text-brand"), "main.css (global, procesada)");

      // A class written in the sources leads there; a generated one, to the processed stylesheet.
      const written = cursor(component(`<main class="but|ton"></main>`));
      const writtenDocument = TextDocument.create(document.uri, "meeko", 1, written.source);
      assert.deepEqual(classDefinition(writtenDocument, writtenDocument.positionAt(written.offset), page, index, [])!.map((location) => location.uri),
        [pathToFileURL(join(root, "app", "styles", "main.css")).href]);
      const generated = cursor(component(`<main class="text-br|and"></main>`));
      const generatedDocument = TextDocument.create(document.uri, "meeko", 1, generated.source);
      const [location] = classDefinition(generatedDocument, generatedDocument.positionAt(generated.offset), page, index, [])!;
      assert.equal(location!.uri, pathToFileURL(join(root, ".meeko", "styles", "main.css")).href);
      assert.deepEqual(location!.range.start, { line: 1, character: 2 });

      await writeFile(join(root, ".meeko", "styles", "main.css"), ".text-accent { color: teal; }\n.button { padding: 0.5rem; }\n");
      index.filesChanged([join(root, ".meeko", "styles", "main.css")]);
      assert.deepEqual(labels(classCompletion(document, position, page, index, [])), ["button", "text-accent"]);
    } finally { await remove(); }
  });

  test("the server completes, resolves, hovers and defines classes over LSP and follows the processed stylesheet", async (context) => {
    const { root, remove } = await createTempProject("lsp-classes-server-");
    const many = 300;
    const generated = 3000;
    const snapshot = (prefix: string): string => Array.from({ length: generated }, (_, item) => `.${prefix}-${item} { order: ${item}; }`).join("\n");
    const entries: Record<string, string> = {
      "package.json": '{"private":true,"type":"module"}\n',
      "app/styles/main.css": ".button { padding: 0.5rem; }\n",
      ".meeko/styles/main.css": snapshot("u"),
      "app/pages/index.meeko": component(`<main class="button " bind:class="open.value ? 'is-' : ''"></main>`, ".page { display: grid; }"),
    };
    for (let item = 0; item < many; item++) {
      entries[`app/components/Item${item}.meeko`] = component(`<p class="item-${item}"></p>`, `.item-${item} { color: red; }\n.item-${item}-title { margin: 0; }`, item % 2 ? " scoped" : "");
    }
    await files(root, entries);
    const toServer = new PassThrough();
    const toClient = new PassThrough();
    const server = createConnection(new StreamMessageReader(toServer), new StreamMessageWriter(toClient));
    startLanguageServer(server);
    server.listen();
    const client: ProtocolConnection = createProtocolConnection(new StreamMessageReader(toClient), new StreamMessageWriter(toServer));
    const watchers: string[] = [];
    client.onRequest(RegistrationRequest.type, (params) => {
      for (const registration of params.registrations) {
        for (const watcher of (registration.registerOptions as { watchers?: { globPattern: string }[] } | undefined)?.watchers ?? []) watchers.push(watcher.globPattern);
      }
    });
    client.onNotification("window/logMessage", () => undefined);
    client.onNotification(PublishDiagnosticsNotification.type, () => undefined);
    client.listen();
    try {
      await client.sendRequest(InitializeRequest.type, {
        processId: null, rootUri: pathToFileURL(root).href, workspaceFolders: [{ uri: pathToFileURL(root).href, name: "classes" }],
        capabilities: {
          workspace: { didChangeWatchedFiles: { dynamicRegistration: true } },
          textDocument: { completion: { completionList: { itemDefaults: ["editRange", "data"] } } },
        },
        // Reading CSS runs no project code: an untrusted workspace gets the same classes.
        initializationOptions: { trusted: false, projectContracts: false, diagnosticsDelay: 60_000 },
      });
      await client.sendNotification(InitializedNotification.type, {});
      const filename = join(root, "app", "pages", "index.meeko");
      const uri = pathToFileURL(filename).href;
      let text = entries["app/pages/index.meeko"]!;
      await client.sendNotification(DidOpenTextDocumentNotification.type, { textDocument: { uri, languageId: "meeko", version: 1, text } });
      const document = (): TextDocument => TextDocument.create(uri, "meeko", 1, text);
      // The shared range and data arrive once in `itemDefaults`; a client applies them to each item.
      const complete = async (needle: string, delta: number): Promise<{ items: CompletionItem[]; elapsed: number }> => {
        const started = performance.now();
        const result = await client.sendRequest(CompletionRequest.type, { textDocument: { uri }, position: document().positionAt(text.indexOf(needle) + delta) });
        const elapsed = performance.now() - started;
        assert.ok(result && !Array.isArray(result), "a completion list with itemDefaults");
        const { itemDefaults, items } = result as CompletionList;
        assert.ok(itemDefaults?.editRange && "start" in itemDefaults.editRange && itemDefaults.data);
        const range = itemDefaults.editRange;
        return { items: items.map((item) => ({ ...item, data: itemDefaults.data, textEdit: { range, newText: item.label } })), elapsed };
      };

      const cold = await complete('button "', "button ".length);
      const names = labels(cold.items);
      assert.equal(names[0], "page");
      assert.ok(names.includes("item-0") && names.includes("item-0-title"), "a <style> without scoped is global");
      assert.ok(!names.includes("item-1"), "a <style scoped> of another component is not");
      assert.ok(names.includes("u-2999") && !names.includes("button"));
      assert.equal(new Set(names).size, names.length, "no duplicates");
      const timings: number[] = [];
      for (let round = 0; round < 10; round++) {
        // Each keystroke changes the own <style>; the rest of the project is not read again.
        text = text.replace(".page {", `.page${round} {`);
        await client.sendNotification(DidChangeTextDocumentNotification.type, { textDocument: { uri, version: round + 2 }, contentChanges: [{ text }] });
        timings.push((await complete('button "', "button ".length)).elapsed);
      }
      timings.sort((a, b) => a - b);
      const median = timings[Math.floor(timings.length / 2)]!;
      context.diagnostic(`completion with ${many} components and ${generated} generated classes: cold ${cold.elapsed.toFixed(1)} ms, warm median ${median.toFixed(1)} ms`);
      assert.ok(median < 250, `warm completion took ${median} ms`);

      const dynamic = await complete("'is-'", "'is-".length);
      assert.ok(labels(dynamic.items).includes("u-1"));
      const edit = dynamic.items.find((item) => item.label === "u-1")!.textEdit as TextEdit;
      assert.equal(document().getText(edit.range), "is-");

      const resolved = await client.sendRequest(CompletionResolveRequest.type, cold.items.find((item) => item.label === "item-0-title")!);
      assert.match((resolved.documentation as MarkupContent).value, /app\/components\/Item0\.meeko[\s\S]*\.item-0-title \{ margin: 0; \}/);

      text = text.replace('class="button "', 'class="button u-7"');
      await client.sendNotification(DidChangeTextDocumentNotification.type, { textDocument: { uri, version: 20 }, contentChanges: [{ text }] });
      const position = document().positionAt(text.indexOf("u-7") + 1);
      const hover = await client.sendRequest(HoverRequest.type, { textDocument: { uri }, position });
      assert.match((hover!.contents as MarkupContent).value, /\.meeko\/styles\/main\.css[\s\S]*\.u-7 \{ order: 7; \}/);
      const definition = await client.sendRequest(DefinitionRequest.type, { textDocument: { uri }, position }) as Location[];
      assert.equal(definition[0]!.uri, pathToFileURL(join(root, ".meeko", "styles", "main.css")).href);
      assert.equal(definition[0]!.range.start.line, 7);

      // `meeko dev` writes the processed stylesheet again: the watcher reports it under .meeko/.
      assert.ok(watchers.includes("**/*.css"), JSON.stringify(watchers));
      await writeFile(join(root, ".meeko", "styles", "main.css"), snapshot("v"));
      await client.sendNotification(DidChangeWatchedFilesNotification.type, {
        changes: [{ uri: pathToFileURL(join(root, ".meeko", "styles", "main.css")).href, type: FileChangeType.Changed }],
      });
      const updated = labels((await complete('button u-7"', "button ".length)).items);
      assert.ok(updated.includes("v-1") && !updated.includes("u-1"), "the new processed stylesheet replaces the old one");
    } finally {
      await client.sendRequest(ShutdownRequest.type);
      client.dispose();
      server.dispose();
      await remove();
    }
  });
});
