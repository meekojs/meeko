import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { compile } from "../dist/compiler.js";
import { initFrameworkProject } from "../dist/framework/init.js";

test("framework starter creates routable SSR/client sources and refuses overwrite", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-framework-init-"));
  const target = join(root, "app");
  try {
    assert.equal(await initFrameworkProject(target), target);
    const packageFile = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as {
      scripts: Record<string, string>; dependencies: Record<string, string>;
    };
    assert.match(packageFile.scripts.build ?? "", /vite\.server\.config\.ts/);
    assert.ok(packageFile.dependencies["@meekojs/meeko"]);
    const page = await readFile(join(target, "app/pages/index.meeko"), "utf8");
    const layout = await readFile(join(target, "app/pages/+layout.meeko"), "utf8");
    const appShell = await readFile(join(target, "app/app.meeko"), "utf8");
    assert.match(compile(page, join(target, "app/pages/index.meeko")).code, /renderWithState/);
    assert.match(compile(layout, join(target, "app/pages/+layout.meeko")).code, /renderComponent/);
    assert.match(compile(appShell, join(target, "app/app.meeko")).code, /renderComponent/);
    assert.match(layout, /<component is="props\.outlet"><\/component>/);
    assert.match(await readFile(join(target, "app/entry-client.ts"), "utf8"), /mountClientApp/);
    assert.match(await readFile(join(target, "server/entry.ts"), "utf8"), /createFrameworkHandler/);
    const syntax = spawnSync(process.execPath, ["--check", join(target, "server.mjs")], { encoding: "utf8" });
    assert.equal(syntax.status, 0, syntax.stderr);
    await assert.rejects(initFrameworkProject(target), /Destination is not empty/);
    const cliTarget = join(root, "cli-app");
    const cli = spawnSync(process.execPath, [resolve("dist/cli.js"), "init-framework", cliTarget], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(await readFile(join(cliTarget, "app/entry-client.ts"), "utf8"), /mountClientApp/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
