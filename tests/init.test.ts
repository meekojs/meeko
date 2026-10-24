import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

test("CLI init creates an SSR project and refuses to overwrite it", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-init-"));
  const target = join(root, "starter-app");
  try {
    const cli = resolve("dist/cli.js");
    const first = spawnSync(process.execPath, [cli, "init", target], { encoding: "utf8" });
    assert.equal(first.status, 0, first.stderr);
    const expected = ["package.json", "vite.config.ts", "server.mjs", "src/App.meeko", "src/entry-client.ts", "src/entry-server.ts"];
    for (const filename of expected) assert.ok((await readFile(join(target, filename), "utf8")).length > 0, filename);
    const manifest = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as { scripts: Record<string, string>; dependencies: Record<string, string> };
    const engine = JSON.parse(await readFile(resolve("package.json"), "utf8")) as { version: string };
    assert.equal(manifest.dependencies["@meekojs/meeko"], engine.version);
    assert.match(manifest.scripts.build ?? "", /--ssr src\/entry-server\.ts/);
    assert.match(await readFile(join(target, "src/entry-server.ts"), "utf8"), /renderWithState/);
    assert.match(await readFile(join(target, "src/entry-client.ts"), "utf8"), /hydrate\(root/);
    const second = spawnSync(process.execPath, [cli, "init", target], { encoding: "utf8" });
    assert.equal(second.status, 1);
    assert.match(second.stderr, /Destination is not empty/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI init reutiliza el directorio preparado por pnpm sin perder sus archivos", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-init-pnpm-"));
  const manifest = {
    name: "diegootayza", version: "1.0.0", type: "commonjs",
    scripts: { test: "echo existing" }, dependencies: { "@meekojs/meeko": "^0.0.2" },
    devDependencies: { vite: "^8.3.5" },
  };
  const workspace = "minimumReleaseAgeExclude:\n  - '@meekojs/meeko@0.0.2'\n";
  try {
    await writeFile(join(root, "package.json"), JSON.stringify(manifest));
    await writeFile(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    await writeFile(join(root, "pnpm-workspace.yaml"), workspace);
    await mkdir(join(root, "node_modules"));
    await writeFile(join(root, "node_modules", "sentinel"), "original");
    const cli = resolve("dist/cli.js");
    const result = spawnSync(process.execPath, [cli, "init", "."], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Next: pnpm install && pnpm run dev/);
    const updated = JSON.parse(await readFile(join(root, "package.json"), "utf8")) as typeof manifest & {
      private: boolean; scripts: Record<string, string>; devDependencies: Record<string, string>;
    };
    const engine = JSON.parse(await readFile(resolve("package.json"), "utf8")) as { version: string };
    assert.equal(updated.name, manifest.name);
    assert.equal(updated.scripts.test, manifest.scripts.test);
    assert.equal(updated.dependencies["@meekojs/meeko"], engine.version);
    assert.equal(updated.devDependencies.vite, "^8.3.5");
    assert.equal(updated.private, true);
    assert.equal(await readFile(join(root, "pnpm-workspace.yaml"), "utf8"), workspace);
    assert.equal(await readFile(join(root, "node_modules", "sentinel"), "utf8"), "original");
    assert.match(await readFile(join(root, "src", "App.meeko"), "utf8"), /<template>/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI init no transforma un proyecto que ya contiene código", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-init-existing-"));
  const manifest = '{"name":"existing","type":"commonjs"}';
  try {
    await writeFile(join(root, "package.json"), manifest);
    await mkdir(join(root, "src"));
    await writeFile(join(root, "src", "index.ts"), "export const existing = true;\n");
    const result = spawnSync(process.execPath, [resolve("dist/cli.js"), "init", "."], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Destination is not empty/);
    assert.equal(await readFile(join(root, "package.json"), "utf8"), manifest);
    assert.equal(await readFile(join(root, "src", "index.ts"), "utf8"), "export const existing = true;\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
