import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

function cli(...args: string[]) {
  return spawnSync(process.execPath, [resolve("dist/cli.js"), ...args], { encoding: "utf8" });
}

test("meeko --version prints the package version", async () => {
  const { version } = JSON.parse(await readFile(resolve("package.json"), "utf8")) as { version: string };
  for (const flag of ["--version", "-v"]) {
    const result = cli(flag);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, `${version}\n`);
  }
});

test("meeko --help prints usage to stdout and succeeds", () => {
  for (const flag of ["--help", "-h", "help"]) {
    const result = cli(flag);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Usage: meeko dev/);
    assert.equal(result.stderr, "");
  }
});

test("an unknown command prints usage to stderr and fails", () => {
  const result = cli("unknown");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /^Usage: meeko dev/);
});

test("meeko --help lists build adapters and preview", () => {
  const result = cli("--help");
  assert.match(result.stdout, /meeko build \[project-directory\] \[--adapter <node\|cloudflare\|deno\|bun>\]/);
  assert.match(result.stdout, /meeko preview \[project-directory\]/);
});

test("meeko build rejects unknown and unavailable adapters before building", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-cli-adapter-"));
  try {
    const unknown = cli("build", root, "--adapter", "lambda");
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown adapter lambda; use node, cloudflare, deno or bun/);
    for (const args of [["--adapter", "deno"], ["--adapter=deno"]]) {
      const unavailable = cli("build", root, ...args);
      assert.equal(unavailable.status, 1);
      assert.match(unavailable.stderr, /The deno adapter cannot be built by this Meeko version; build with --adapter node/);
    }
    const missing = cli("build", root, "--adapter");
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /^Usage: meeko dev/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("meeko start and preview require the Node build output", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-cli-preview-"));
  try {
    for (const command of ["start", "preview"]) {
      const result = cli(command, root);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Missing production build at .*index\.mjs; run meeko build/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
