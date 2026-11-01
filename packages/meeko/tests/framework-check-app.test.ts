import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { checkApp } from "../src/framework/check-app.ts";

const execFileAsync = promisify(execFile);

test("check-app checks every discovered page, including a newly added second page", async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko/check-app-test-"));
  const pages = join(root, "app", "pages");
  await mkdir(pages, { recursive: true });
  await writeFile(join(pages, "index.meeko"), `<script lang="ts">const greeting = "Hello";</script><template><p>{greeting}</p></template>`);
  await writeFile(join(pages, "second.meeko"), `<script lang="ts">const value = ;</script><template><p>{value}</p></template>`);
  try {
    const diagnostics = await checkApp(root);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0]?.code, "MEEK013");
    assert.equal(diagnostics[0]?.filename, join(pages, "second.meeko"));
    await assert.rejects(execFileAsync(process.execPath, [resolve("dist/cli.js"), "check-app", root]), (error: unknown) => {
      assert.match(String(error), /second\.meeko.*MEEK013/s);
      return true;
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("check-app types snippets named after a generic key: valid, unknown name and extra params", { timeout: 120_000 }, async () => {
  await mkdir(resolve(".meeko"), { recursive: true });
  const root = await mkdtemp(resolve(".meeko/check-app-snippets-"));
  const pages = join(root, "app", "pages");
  const components = join(root, "app", "components");
  await mkdir(pages, { recursive: true });
  await mkdir(components, { recursive: true });
  await writeFile(join(components, "KeyGrid.meeko"), `<script lang="ts" generic="Row extends object">
const props = defineProps<{ rows: readonly Row[] }>();
const snippets = defineSnippets<{ [K in Extract<keyof Row, string> as \`cell-\${K}\`]?: [row: Row, value: Row[K]] } & { empty?: [] }>();
</script>
<template><p if:when="props.rows.length === 0"><render snippet="snippets.empty" /></p></template>`);
  const page = (snippet: string): string => `<script lang="ts">
import * as KeyGrid from "../components/KeyGrid.meeko";
const users = [{ id: 1, email: "ada@x.io" }];
</script>
<template><KeyGrid bind:rows="users">${snippet}</KeyGrid></template>`;
  await writeFile(join(pages, "index.meeko"), page(`<snippet name="cell-email" params="row, value">{value.toUpperCase()}{row.id}</snippet>`));
  await writeFile(join(pages, "unknown.meeko"), page(`<snippet name="cell-nope">x</snippet>`));
  await writeFile(join(pages, "params.meeko"), page(`<snippet name="cell-id" params="row, value, extra">{value}</snippet>`));
  try {
    const diagnostics = await checkApp(root);
    const of = (name: string): string[] => diagnostics.filter((item) => item.filename === join(pages, name)).map((item) => item.code);
    assert.deepEqual(of("index.meeko"), [], JSON.stringify(diagnostics));
    assert.deepEqual(diagnostics.filter((item) => item.filename === join(components, "KeyGrid.meeko")), [], JSON.stringify(diagnostics));
    assert.ok(of("unknown.meeko").includes("TS2353"), JSON.stringify(diagnostics));
    assert.ok(of("params.meeko").includes("TS2345"), JSON.stringify(diagnostics));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
