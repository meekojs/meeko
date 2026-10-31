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
