import assert from "node:assert/strict";
import test from "node:test";

import { isTagName } from "../src/app/runtime/dynamic-tag.ts";
import { booleanAttributeNames } from "../src/core/server.ts";
import { elementAccepts, elementAttributeNames, globalAttributeNames, tagsAccepting } from "../src/shared/html-attributes.ts";
import * as generated from "../src/shared/html-data/attribute-names.ts";

// Since 1.8 the lists come from the HTML data that scripts/html-data.ts generates from the standard;
// tests/html-data.test.ts keeps them in sync with it and with what 1.7 accepted. Here: the
// compiler and the runtime read exactly those lists, under the rules of Meeko.
test("the attribute data of <component is> is the generated HTML data, without on*, is or aria-*", () => {
  assert.equal(globalAttributeNames, generated.globalAttributeNames);
  assert.equal(elementAttributeNames, generated.elementAttributeNames);
  const lists = [globalAttributeNames, ...Object.values(elementAttributeNames)].flatMap((list) => list ? list.split(" ") : []);
  assert.deepEqual(lists.filter((name) => /^on/.test(name) || name.startsWith("aria-") || name.startsWith("data-") || name === "is"), []);
  // `type` of <a> and <area> is a MIME hint: with `is="href ? 'a' : 'button'"` it is the button's.
  assert.ok(!elementAttributeNames.a.split(" ").includes("type"));
  assert.ok(!elementAttributeNames.area.split(" ").includes("type"));
  // The renderer, in core, keeps a copy of the boolean attributes: the same list.
  assert.equal(booleanAttributeNames, generated.booleanAttributeNames);
  // Recent attributes of the standard reach the checks of <component is> and bind="obj".
  assert.ok(elementAccepts("dialog", "closedby"));
  assert.ok(elementAccepts("div", "popover"));
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
