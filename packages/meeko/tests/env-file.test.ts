import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { loadProjectEnv, resolveEnvFileArguments } from "../src/framework/env-file.ts";

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

test("--env-file paths of the Node options resolve against the original cwd, joined or space separated", () => {
  const origin = resolve("launch");
  const before = ["--env-file=.env.local", "--env-file", ".env.dev", "--env-file-if-exists", "../shared/.env", "--env-file-if-exists=.env.optional", "--import", "tsx", "--env-file"];
  assert.deepEqual(resolveEnvFileArguments(before, origin), [
    `--env-file=${resolve(origin, ".env.local")}`,
    "--env-file", resolve(origin, ".env.dev"),
    "--env-file-if-exists", resolve(origin, "../shared/.env"),
    `--env-file-if-exists=${resolve(origin, ".env.optional")}`,
    "--import", "tsx",
    // A trailing flag without a path stays as Node received it.
    "--env-file",
  ]);
  assert.equal(before[2], ".env.dev", "the input is not changed");
  assert.deepEqual(resolveEnvFileArguments(["--import", "tsx"], origin), ["--import", "tsx"]);
});
