import type { ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";

import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { applyAutoImports } from "../src/autoimports/transform.ts";
import { linkRepositoryPackages, repositoryRoot, stopChild, tempProject } from "./helpers/temp-project.ts";

const run = promisify(execFile);
const cli = join(repositoryRoot, "dist", "cli.js");

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      server.close(() => done(port));
    });
  });
}

async function put(root: string, path: string, source: string): Promise<void> {
  const file = join(root, path);
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, source);
}

async function project(context: { after(fn: () => Promise<void>): void }, name: string, files: Readonly<Record<string, string>>): Promise<string> {
  const root = await tempProject(context, name);
  await linkRepositoryPackages(root);
  await put(root, "package.json", '{"private":true,"type":"module"}\n');
  await put(root, "meeko.config.mjs", "export default {};\n");
  await mkdir(join(root, "node_modules", "@types"), { recursive: true });
  await linkRepositoryPackages(root, ["vite", "@types/node"]);
  for (const [path, source] of Object.entries(files)) await put(root, path, source);
  return root;
}

/** Exit code and output of a command of the CLI. */
async function command(root: string, name: "check" | "build"): Promise<{ code: number; output: string }> {
  try {
    const { stdout, stderr } = await run(process.execPath, [cli, name, "."], { cwd: root, timeout: 180_000, windowsHide: true, env: { ...process.env, MEEKO_EDITOR_BRIDGE: "0" } });
    return { code: 0, output: `${stdout}${stderr}` };
  } catch (error) {
    const failure = error as { code?: number; stdout?: string; stderr?: string };
    return { code: failure.code ?? 1, output: `${failure.stdout ?? ""}${failure.stderr ?? ""}` };
  }
}

/** Status and body of the home in a real `meeko dev`. */
async function devPage(root: string): Promise<{ status: number; body: string }> {
  const port = await freePort();
  const hmr = await freePort();
  let child: ChildProcess | undefined;
  try {
    const running = spawn(process.execPath, [cli, "dev", "."], { cwd: root, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmr), MEEKO_EDITOR_BRIDGE: "0", MEEKO_LINK_WATCH: "0" } });
    child = running;
    let logs = "";
    running.stdout.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    running.stderr.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
    const start = Date.now();
    while (!logs.includes(`:${port}`)) {
      if (running.exitCode !== null || Date.now() - start > 60_000) throw new Error(`meeko dev did not listen: ${logs}`);
      await new Promise((done) => setTimeout(done, 100));
    }
    const response = await fetch(`http://127.0.0.1:${port}/`, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(40_000) });
    return { status: response.status, body: await response.text() };
  } finally {
    await stopChild(child);
  }
}

const page = (name: string): string => `<script lang="ts">\nconst value: ${name}Type = ${name}();\n</script>\n<template><p class="value">{value}</p></template>\n`;
const module = (name: string, label: string): string => `export const ${name} = (): string => "${label}";\nexport type ${name}Type = string;\n`;

test("the import of an autoimport has the extension of its source, as its declaration", () => {
  const entry = (name: string, file: string) => ({ name, imported: name, file, scope: "app" as const, typeOnly: false, component: false });
  const code = applyAutoImports("a(); b(); c();", "/app/app/pages/index.meeko", [entry("a", "/app/app/utils/a.ts"), entry("b", "/app/app/utils/b.mts"), entry("c", "/app/app/utils/c.cts")], "client");
  assert.match(code, /from "\.\.\/utils\/a\.js"/);
  assert.match(code, /from "\.\.\/utils\/b\.mjs"/);
  assert.match(code, /from "\.\.\/utils\/c\.cjs"/);
});

test("the exports of a .mts are autoimports: meeko check, meeko build and meeko dev", { timeout: 300_000 }, async (context) => {
  // Before 1.8 the generated import pointed to .js: TS2307 in check and build, and a 500 in dev.
  const root = await project(context, "autoimports-mts", { "app/utils/module.mts": module("fromMts", "from mts"), "app/pages/index.meeko": page("fromMts") });
  const check = await command(root, "check");
  assert.equal(check.code, 0, check.output);
  const build = await command(root, "build");
  assert.equal(build.code, 0, build.output);
  const dev = await devPage(root);
  assert.equal(dev.status, 200, dev.body.slice(0, 500));
  assert.match(dev.body, /from mts/);
});

test("a .cts contributes its types; an exported value is TS1287 in check and build and fails in dev", { timeout: 300_000 }, async (context) => {
  const types = await project(context, "autoimports-cts-types", { "app/types/shapes.cts": "export type FromCts = string;\n", "app/pages/index.meeko": '<script lang="ts">\nconst value: FromCts = "a";\n</script>\n<template><p>{value}</p></template>\n' });
  const typesCheck = await command(types, "check");
  assert.equal(typesCheck.code, 0, typesCheck.output);

  const values = await project(context, "autoimports-cts-values", { "app/utils/common.cts": module("fromCts", "from cts"), "app/pages/index.meeko": page("fromCts") });
  for (const name of ["check", "build"] as const) {
    const result = await command(values, name);
    assert.notEqual(result.code, 0, name);
    assert.match(result.output, /TS1287/, name);
    assert.doesNotMatch(result.output, /TS2307/, name);
  }
  assert.equal((await devPage(values)).status, 500);
});
