import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
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
