import { compile } from "@meekojs/meeko/compiler";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { format } from "prettier";

import plugin from "../dist/index.js";

for (const name of ["button", "dashboard", "error", "login"]) {
  test(`formats ${name} with the existing public formatting contract`, async () => {
    const base = new URL(`../../meeko/tests/fixtures/prettier/${name}`, import.meta.url);
    const source = await readFile(`${fileURLToPath(base)}.meeko`, "utf8");
    const expected = await readFile(`${fileURLToPath(base)}.formatted.meeko`, "utf8");
    const options = { filepath: "Component.meeko", plugins: [plugin] };
    const formatted = await format(source, options);
    assert.equal(formatted, expected.replaceAll("\r\n", "\n"));
    assert.equal(await format(formatted, options), formatted);
    compile(formatted, "Component.meeko");
  });
}

test("keeps self-closing HTML elements and empty elements with end tags as written", async () => {
  const source = `<script lang="ts">\nconst title = "t"\n</script>\n\n<template>\n<div class="a"   bind:title="title" /><span/><p>after</p><ul><li /><li>b</li></ul><svg><path d="M0" /></svg><em></em>\n</template>\n`;
  const options = { filepath: "Component.meeko", plugins: [plugin] };
  const formatted = await format(source, options);
  assert.match(formatted, /<div class="a" bind:title="title" \/>/);
  assert.match(formatted, /<span \/>/);
  assert.match(formatted, /<li \/>\s*<li>b<\/li>/);
  assert.match(formatted, /<path d="M0" \/>/);
  assert.match(formatted, /<em><\/em>/);
  assert.equal(await format(formatted, options), formatted);
  compile(formatted, "Component.meeko");
});

test("keeps hyphenated snippet names, as cell-<key> of a generic table", async () => {
  const source = `<script lang="ts">\nimport * as Grid from "./Grid.meeko"\nconst users = [{ id: 1, email: "ada@x.io" }]\n</script>\n\n<template>\n<Grid bind:rows="users"><snippet name="cell-email" params="row,value"><a>{value}</a></snippet><snippet name="header-created-at">On</snippet></Grid>\n</template>\n`;
  const options = { filepath: "Component.meeko", plugins: [plugin] };
  const formatted = await format(source, options);
  assert.match(formatted, /<snippet\s+name="cell-email"/);
  assert.match(formatted, /name="header-created-at"/);
  assert.equal(await format(formatted, options), formatted);
  compile(formatted, "Component.meeko");
});
