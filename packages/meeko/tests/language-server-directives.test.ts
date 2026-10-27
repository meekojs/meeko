import assert from "node:assert/strict";
import test from "node:test";
import { TextDocument } from "vscode-languageserver-textdocument";
import { directiveNameCompletion } from "../src/language-server/features.ts";

/** Directive labels offered where `|` marks the cursor, or `undefined`. */
function labels(template: string): string[] | undefined {
  const text = `<script lang="ts">\nconst variants = signal(["a", "b"]);\n</script>\n<template>\n${template}\n</template>\n`;
  const offset = text.indexOf("|");
  const document = TextDocument.create("file:///Probe.meeko", "meeko", 1, text.replace("|", ""));
  return directiveNameCompletion(document, document.positionAt(offset))?.map((item) => item.label);
}

test("component tags offer the list and condition directives, without the ones already there", () => {
  const offered = labels(`<AppCard\n  each:of="variants.value"\n  each:as="variant"\n  e|\n  bind:variant="variant"\n>`);
  assert.deepEqual(offered, ["if:when", "each:key", "each:index", "bind:", "on:", "ref:", "model:"]);
});

test("each: completes in a component tag and replaces what was typed", () => {
  const text = `<script lang="ts"></script>\n<template><AppCard each:</template>`;
  const document = TextDocument.create("file:///Probe.meeko", "meeko", 1, text);
  const items = directiveNameCompletion(document, document.positionAt(text.indexOf("each:") + 5))!;
  const each = items.find((item) => item.label === "each:of")!;
  assert.ok(each.textEdit && "range" in each.textEdit);
  assert.equal(document.getText(each.textEdit.range), "each:");
  assert.equal(each.textEdit.newText, 'each:of="$1"');
});

test("elements offer the directives first, then their HTML attributes without event handlers", () => {
  const offered = labels(`<p class="x" |>`)!;
  assert.deepEqual(offered.slice(0, 9), ["if:when", "each:of", "each:as", "each:key", "each:index", "bind:", "on:", "ref:", "html"]);
  assert.ok(offered.includes("id") && offered.includes("hidden"), JSON.stringify(offered));
  assert.ok(!offered.includes("class"), "an attribute already written is not offered again");
  assert.ok(!offered.some((label) => /^on[a-z]/.test(label)), "events are written as on:event");
  assert.ok(labels(`<input |>`)!.includes("model"));
  assert.ok(labels(`<input |>`)!.includes("type"));
  assert.ok(!labels(`<input |>`)!.includes("model:"));
});

test("on: on an element offers its DOM events with their description", () => {
  const text = `<script lang="ts"></script>
<template><button on:cl></button></template>`;
  const document = TextDocument.create("file:///Probe.meeko", "meeko", 1, text);
  const items = directiveNameCompletion(document, document.positionAt(text.indexOf("on:cl") + 5))!;
  const click = items.find((item) => item.label === "on:click")!;
  assert.ok(click, JSON.stringify(items.map((item) => item.label)));
  assert.ok(click.textEdit && "range" in click.textEdit);
  assert.equal(document.getText(click.textEdit.range), "on:cl");
  assert.equal(click.textEdit.newText, 'on:click="$1"');
  assert.match(JSON.stringify(click.documentation), /pointing device/);
});

test("values, text, closing tags and names after a prefix are left to the other completions", () => {
  assert.equal(labels(`<p bind:title="va|">`), undefined);
  assert.equal(labels(`<p>texto |</p>`), undefined);
  assert.equal(labels(`<p></p|>`), undefined);
  assert.equal(labels(`<AppCard on:cl|>`), undefined, "a component's events come from its props");
  assert.equal(labels(`<p|>`), undefined);
});
