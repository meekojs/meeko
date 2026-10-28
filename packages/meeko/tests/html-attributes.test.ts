import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { isTagName } from "../src/dynamic-tag.ts";
import { elementAccepts, elementAttributeNames, globalAttributeNames, tagsAccepting } from "../src/html-attributes.ts";

interface HtmlData {
  readonly tags: ReadonlyArray<{ readonly name: string; readonly attributes: ReadonlyArray<{ readonly name: string }> }>;
  readonly globalAttributes: ReadonlyArray<{ readonly name: string }>;
}

/** The HTML data of `vscode-html-languageservice`, which the editor uses for completion. */
const htmlData = (createRequire(import.meta.url)("vscode-html-languageservice/lib/umd/languageFacts/data/webCustomData.js") as { htmlData: HtmlData }).htmlData;

test("the attribute data of <component is> is the editor's HTML data", () => {
  const ignored = (name: string): boolean => /^on/.test(name) || name.startsWith("aria-") || name === "is";
  const globals = htmlData.globalAttributes.map((attribute) => attribute.name).filter((name) => !ignored(name)).sort();
  assert.equal(globalAttributeNames, globals.join(" "));
  const global = new Set(globals);
  // `type` of <a> and <area> is a MIME hint: with `is="href ? 'a' : 'button'"` it is the button's.
  const left: Record<string, readonly string[]> = { a: ["type"], area: ["type"] };
  const expected = Object.fromEntries([...htmlData.tags].sort((first, second) => first.name.localeCompare(second.name)).map((tag) => [
    tag.name,
    [...new Set(tag.attributes.map((attribute) => attribute.name).filter((name) => !ignored(name) && !global.has(name) && !(left[tag.name] ?? []).includes(name)))].sort().join(" "),
  ]));
  assert.deepEqual({ ...elementAttributeNames }, expected);
});

test("each attribute applies to the tags whose data has it, and global ones to all", () => {
  assert.deepEqual(tagsAccepting("href", ["a", "button", "area"]), ["a", "area"]);
  assert.deepEqual(tagsAccepting("type", ["a", "button"]), ["button"]);
  assert.equal(tagsAccepting("class", ["a"]), null);
  assert.equal(tagsAccepting("aria-label", ["a"]), null);
  assert.equal(tagsAccepting("data-id", ["a"]), null);
  assert.deepEqual(tagsAccepting("colspan", ["a", "button"]), []);
  assert.ok(elementAccepts("button", "disabled"));
  assert.ok(!elementAccepts("a", "disabled"));
  assert.ok(elementAccepts("a", "aria-disabled"));
  assert.ok(!elementAccepts("x-card", "href"));
});

test("<component is> renders the tags of the data that hold template content", () => {
  for (const tag of ["a", "button", "section", "span", "img", "input", "li", "td"]) assert.ok(isTagName(tag), tag);
  for (const tag of ["script", "style", "iframe", "object", "embed", "template", "slot", "textarea", "title", "base", "link", "meta", "head", "html", "body", "noscript", "param", "fencedframe", "x-card", "svg", "A", "<a>", "", "constructor", "toString"]) {
    assert.ok(!isTagName(tag), tag);
  }
});
