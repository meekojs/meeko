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
