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
    assert.equal(packageFile.scripts.dev, "meeko dev .");
    assert.equal(packageFile.scripts.check, "meeko check .");
    assert.equal(packageFile.scripts.build, "meeko build .");
    assert.equal(packageFile.scripts.start, "meeko start .");
    assert.ok(packageFile.dependencies["@meekojs/meeko"]);
    const page = await readFile(join(target, "app/pages/index.meeko"), "utf8");
    const layout = await readFile(join(target, "app/layouts/default.meeko"), "utf8");
    const appShell = await readFile(join(target, "app/app.meeko"), "utf8");
    const globalCss = await readFile(join(target, "app/styles/main.css"), "utf8");
    assert.match(compile(page, join(target, "app/pages/index.meeko")).code, /renderWithState/);
    assert.match(compile(layout, join(target, "app/layouts/default.meeko")).code, /renderComponent/);
    assert.match(compile(appShell, join(target, "app/app.meeko")).code, /renderComponent/);
    assert.match(layout, /<component is="props\.outlet"><\/component>/);
    assert.match(layout, /outlet: Component<Record<string, unknown>>/);
    assert.match(appShell, /outlet: Component<Record<string, unknown>>/);
    assert.match(globalCss, /box-sizing: border-box/);
    const tsconfig = JSON.parse(await readFile(join(target, "tsconfig.json"), "utf8")) as {
      references: { path: string }[];
    };
    assert.deepEqual(tsconfig.references.map(({ path }) => path), [
      "./.meeko/tsconfig.app.json", "./.meeko/tsconfig.server.json", "./.meeko/tsconfig.shared.json",
    ]);
    const runtime = await readFile(join(target, "server/runtime.ts"), "utf8");
    assert.match(runtime, /export default defineServerRuntime\(\(\{ production, prerendering \}\) =>/);
    assert.match(runtime, /if \(production && !prerendering\) throw new Error\("Configure a persistent SessionStore in server\/runtime\.ts/);
    for (const file of ["server/session.ts", "app/entry-client.ts", "server/entry.ts", "server.mjs", "vite.config.ts", "vite.server.config.ts", "tsconfig.app.json", "tsconfig.server.json", "tsconfig.shared.json"]) {
      await assert.rejects(readFile(join(target, file), "utf8"), /ENOENT/);
    }
    await assert.rejects(initFrameworkProject(target), /Destination is not empty/);
    const cliTarget = join(root, "cli-app");
    const cli = spawnSync(process.execPath, [resolve("dist/cli.js"), "init-framework", cliTarget], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal((JSON.parse(await readFile(join(cliTarget, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts.dev, "meeko dev .");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
