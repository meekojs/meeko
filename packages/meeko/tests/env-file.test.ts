import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { loadProjectEnv } from "../src/framework/env-file.ts";

test("the project's .env fills the variables the environment does not set", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-env-"));
  try {
    await writeFile(join(root, ".env"), "# Puerto de desarrollo\nPORT=4198\nPUBLIC_ORIGIN=\"https://example.test\"\nEMPTY=\nSECRET='a b c'\n");
    const env: NodeJS.ProcessEnv = { PUBLIC_ORIGIN: "https://real.example" };
    assert.deepEqual(loadProjectEnv(root, env).sort(), ["EMPTY", "PORT", "SECRET"]);
    assert.deepEqual(env, { PUBLIC_ORIGIN: "https://real.example", PORT: "4198", EMPTY: "", SECRET: "a b c" }, "the real environment wins");
    const empty = await mkdtemp(join(tmpdir(), "meeko-env-"));
    try { assert.deepEqual(loadProjectEnv(empty, {}), [], "a project without .env loads nothing"); }
    finally { await rm(empty, { recursive: true, force: true }); }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
