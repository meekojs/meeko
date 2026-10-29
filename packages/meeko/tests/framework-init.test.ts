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
    // The shell and the layout render what goes inside with <MeekoOutlet />, without declaring props.
    assert.match(layout, /<main><MeekoOutlet \/><\/main>/);
    assert.match(layout, /<MeekoLink to="\/">Meeko<\/MeekoLink>/);
    assert.match(appShell, /<MeekoOutlet \/>/);
    assert.doesNotMatch(`${layout}${appShell}`, /defineProps/);
    assert.match(globalCss, /box-sizing: border-box/);
    const tsconfig = JSON.parse(await readFile(join(target, "tsconfig.json"), "utf8")) as {
      references: { path: string }[];
    };
    assert.deepEqual(tsconfig.references.map(({ path }) => path), [
      "./.meeko/tsconfig.app.json", "./.meeko/tsconfig.server.json", "./.meeko/tsconfig.shared.json",
    ]);
    // Sessions need no runtime file: memory in development, MEEKO_REDIS_URL in production.
    const envExample = await readFile(join(target, ".env.example"), "utf8");
    assert.match(envExample, /^# MEEKO_REDIS_URL=/m);
    assert.match(envExample, /^# MEEKO_PUBLIC_ORIGIN=/m);
    assert.doesNotMatch(envExample, /^(?!#)\s*\w+=/m, "the example sets nothing by default");
    assert.match(await readFile(join(target, ".gitignore"), "utf8"), /^\.env$/m);
    for (const file of ["server/runtime.ts", "server/session.ts", "app/entry-client.ts", "server/entry.ts", "server.mjs", "vite.config.ts", "vite.server.config.ts", "tsconfig.app.json", "tsconfig.server.json", "tsconfig.shared.json"]) {
      await assert.rejects(readFile(join(target, file), "utf8"), /ENOENT/);
    }
    await assert.rejects(initFrameworkProject(target), /El destino no está vacío/);
    const cliTarget = join(root, "cli-app");
    const cli = spawnSync(process.execPath, [resolve("dist/cli.js"), "init-framework", cliTarget], { encoding: "utf8" });
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal((JSON.parse(await readFile(join(cliTarget, "package.json"), "utf8")) as { scripts: Record<string, string> }).scripts.dev, "meeko dev .");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("init and init-framework accept the same destinations: only .git, or a package.json with bun.lock", async () => {
  const { initProject } = await import("../src/init.ts");
  const { initFrameworkProject: initFramework } = await import("../src/framework/init.ts");
  const { mkdir, writeFile } = await import("node:fs/promises");
  const root = await mkdtemp(join(tmpdir(), "meeko-init-destinations-"));
  try {
    for (const [name, create] of [["init", initProject], ["init-framework", initFramework]] as const) {
      // A fresh `git init`.
      const repository = join(root, `${name}-git`);
      await mkdir(join(repository, ".git"), { recursive: true });
      assert.equal(await create(repository), repository, name);
      await readFile(join(repository, "package.json"), "utf8");
      // A package started with Bun.
      const bun = join(root, `${name}-bun`);
      await mkdir(bun, { recursive: true });
      await writeFile(join(bun, "package.json"), "{}\n");
      await writeFile(join(bun, "bun.lock"), "{}\n");
      assert.equal(await create(bun), bun, name);
      // A lockfile without its package.json belongs to something else.
      const orphan = join(root, `${name}-orphan`);
      await mkdir(orphan, { recursive: true });
      await writeFile(join(orphan, "bun.lock"), "{}\n");
      await assert.rejects(create(orphan), { message: `El destino no está vacío: ${orphan} (sin package.json)` }, name);
      const busy = join(root, `${name}-busy`);
      await mkdir(busy, { recursive: true });
      await writeFile(join(busy, "notes.txt"), "x\n");
      await assert.rejects(create(busy), { message: `El destino no está vacío: ${busy} (notes.txt)` }, name);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
