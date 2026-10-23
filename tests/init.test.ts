import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
