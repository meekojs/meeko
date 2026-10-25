import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

function cli(...args: string[]) {
  return spawnSync(process.execPath, [resolve("dist/cli.js"), ...args], { encoding: "utf8" });
}

function cliWithoutPath(...args: string[]) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
  return spawnSync(process.execPath, [resolve("dist/cli.js"), ...args], { encoding: "utf8", env: { ...env, PATH: "" } });
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
  assert.match(result.stdout, /meeko preview \[project-directory\] \[--adapter <node\|cloudflare\|bun\|deno>\]/);
});

test("meeko build rejects unknown adapters before building", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-cli-adapter-"));
  try {
    const unknown = cli("build", root, "--adapter", "lambda");
    assert.equal(unknown.status, 1);
    assert.match(unknown.stderr, /Unknown adapter lambda; use node, cloudflare, deno or bun/);
    const missing = cli("build", root, "--adapter");
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /^Usage: meeko dev/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("meeko preview requires the adapter output and names a missing runtime", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-cli-preview-adapter-"));
  try {
    for (const [adapter, file] of [["bun", "index.js"], ["deno", "main.js"]] as const) {
      const missing = cli("preview", root, "--adapter", adapter);
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, new RegExp(`Missing production build at .*${file.replace(".", "\\.")}; run meeko build --adapter ${adapter}`));
      const output = join(root, ".meeko", "output", adapter);
      await mkdir(output, { recursive: true });
      await writeFile(join(output, file), "", "utf8");
      const runtime = cliWithoutPath("preview", root, `--adapter=${adapter}`);
      assert.equal(runtime.status, 1);
      assert.match(runtime.stderr, new RegExp(`${adapter === "bun" ? "Bun" : "Deno"} is not installed or not on PATH`));
    }
    // wrangler dev needs the generated configuration next to the Worker bundle.
    for (const args of [["--adapter", "cloudflare"], ["--adapter=cloudflare"]]) {
      const missing = cli("preview", root, ...args);
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, /Missing production build at .*wrangler\.jsonc; run meeko build --adapter cloudflare/);
    }
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
