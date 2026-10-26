import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";
import test from "node:test";
import { resolveCleanRoot } from "../src/framework/clean.ts";

const repository = resolve(".");

// Runs the CLI from source so the suite does not depend on a built dist/.
function cli(...args: string[]) {
  return spawnSync(process.execPath, ["--import", "tsx", join(repository, "src", "cli.ts"), ...args], { cwd: repository, encoding: "utf8" });
}

async function write(path: string, content = "x"): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/** A junction on Windows (no privilege needed), a directory symlink elsewhere. */
async function linkDirectory(target: string, path: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await symlink(target, path, process.platform === "win32" ? "junction" : "dir");
}

async function withSandbox(run: (sandbox: string) => Promise<void>): Promise<void> {
  const sandbox = await mkdtemp(join(tmpdir(), "meeko-clean-"));
  try { await run(sandbox); }
  finally { await rm(sandbox, { recursive: true, force: true }); }
}

/** A Meeko project with generated output, Vite's cache, dependencies and user files. */
async function project(sandbox: string): Promise<string> {
  const root = join(sandbox, "app");
  await write(join(root, "package.json"), JSON.stringify({ name: "app", private: true, dependencies: { "@meekojs/meeko": "^1.0.0" } }));
  await write(join(root, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  await write(join(root, ".env"), "SECRET=1\n");
  await write(join(root, "app", "pages", "index.meeko"), "<template><h1>Home</h1></template>\n");
  await write(join(root, ".meeko", "types", "routes.d.ts"), "export {};\n");
  await write(join(root, ".meeko", "output", "node", "index.mjs"), "export {};\n");
  await write(join(root, ".meeko", "tsconfig.app.json"), "{}\n");
  await write(join(root, "node_modules", ".vite", "deps", "_metadata.json"), "{}\n");
  await write(join(root, "node_modules", "dependency", "index.js"), "export {};\n");
  return root;
}

function userFilesSurvive(root: string): void {
  for (const file of ["package.json", "pnpm-lock.yaml", ".env", "app/pages/index.meeko"]) {
    assert.ok(existsSync(join(root, file)), `${file} must survive`);
  }
}

test("meeko --help lists clean", () => {
  const result = cli("--help");
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /meeko clean \[directorio\] \[--all\] \[--dry-run\]/);
});

test("meeko clean removes .meeko and the Vite cache and keeps node_modules and user files", async () => {
  await withSandbox(async (sandbox) => {
    const root = await project(sandbox);
    const result = cli("clean", root);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /^Borrado \.meeko \(3 archivos, \d+ B\)$/m);
    assert.match(result.stdout, /^Borrado node_modules\/\.vite \(1 archivo, \d+ B\)$/m);
    assert.match(result.stdout, /^Liberados \d+ B en /m);
    assert.ok(!existsSync(join(root, ".meeko")));
    assert.ok(!existsSync(join(root, "node_modules", ".vite")));
    assert.ok(existsSync(join(root, "node_modules", "dependency", "index.js")));
    userFilesSurvive(root);
    const again = cli("clean", root);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /^Nada que limpiar en /m);
  });
});

test("meeko clean --all also removes node_modules and keeps lockfiles and .env", async () => {
  await withSandbox(async (sandbox) => {
    const root = await project(sandbox);
    // Windows refuses to unlink read-only files; clean must still remove them.
    await chmod(join(root, ".meeko", "tsconfig.app.json"), 0o444);
    const result = cli("clean", "--all", root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Borrado \.meeko /m);
    assert.match(result.stdout, /^Borrado node_modules \(2 archivos, /m);
    assert.doesNotMatch(result.stdout, /node_modules\/\.vite/);
    assert.ok(!existsSync(join(root, ".meeko")));
    assert.ok(!existsSync(join(root, "node_modules")));
    userFilesSurvive(root);
    assert.equal(await readFile(join(root, ".env"), "utf8"), "SECRET=1\n");
  });
});

test("meeko clean --dry-run reports sizes and removes nothing", async () => {
  await withSandbox(async (sandbox) => {
    const root = await project(sandbox);
    await write(join(root, ".meeko", "build", "app-data.json"), "0123456789");
    const result = cli("clean", root, "--all", "--dry-run");
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Se borraría \.meeko \(4 archivos, \d+ B\)$/m);
    assert.match(result.stdout, /^Se borraría node_modules \(2 archivos, \d+ B\)$/m);
    assert.match(result.stdout, /^Se liberarían \d+ B en .+ \(simulación: no se ha borrado nada\)$/m);
    assert.ok(existsSync(join(root, ".meeko", "build", "app-data.json")));
    assert.ok(existsSync(join(root, ".meeko", "types", "routes.d.ts")));
    assert.ok(existsSync(join(root, "node_modules", ".vite", "deps", "_metadata.json")));
    assert.ok(existsSync(join(root, "node_modules", "dependency", "index.js")));
  });
});

test("meeko clean accepts a project identified only by meeko.config.ts", async () => {
  await withSandbox(async (sandbox) => {
    const root = join(sandbox, "configured");
    await write(join(root, "meeko.config.ts"), "export default {};\n");
    await write(join(root, ".meeko", "types", "routes.d.ts"), "export {};\n");
    const result = cli("clean", root);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!existsSync(join(root, ".meeko")));
    assert.ok(existsSync(join(root, "meeko.config.ts")));
  });
});

test("meeko clean aborts without removing anything outside a Meeko project", async () => {
  await withSandbox(async (sandbox) => {
    const root = join(sandbox, "other");
    await write(join(root, "package.json"), JSON.stringify({ name: "other", dependencies: { vite: "^8.0.0" } }));
    await write(join(root, ".meeko", "keep.txt"));
    await write(join(root, "node_modules", ".vite", "keep.txt"));
    for (const args of [[root], [root, "--all"]]) {
      const result = cli("clean", ...args);
      assert.equal(result.status, 1);
      assert.match(result.stderr, /Meeko no limpia .+: no es un proyecto Meeko/);
      assert.equal(result.stdout, "");
    }
    assert.ok(existsSync(join(root, ".meeko", "keep.txt")));
    assert.ok(existsSync(join(root, "node_modules", ".vite", "keep.txt")));
    const missing = cli("clean", join(sandbox, "missing"));
    assert.equal(missing.status, 1);
    assert.match(missing.stderr, /el directorio no existe/);
  });
});

test("meeko clean rejects unknown options and extra arguments", () => {
  for (const [args, problem] of [[["clean", "--force"], "Opción desconocida para clean: --force"], [["clean", "one", "two"], "Argumento de más para clean: two"]] as const) {
    const result = cli(...args);
    assert.equal(result.status, 1);
    assert.equal(result.stderr.split("\n")[0], problem);
    assert.match(result.stderr, /\n\nUso: meeko dev/);
  }
});

test("clean refuses filesystem roots and the home directory before looking for a project", async () => {
  await assert.rejects(resolveCleanRoot(parse(tmpdir()).root), /Meeko no limpia .+: es la raíz del sistema de archivos/);
  await assert.rejects(resolveCleanRoot(homedir()), /Meeko no limpia .+: es la carpeta personal del usuario o la contiene/);
  await assert.rejects(resolveCleanRoot(dirname(homedir())), /Meeko no limpia .+: (es la carpeta personal del usuario o la contiene|es la raíz del sistema de archivos)/);
});

test("meeko clean --all removes links in node_modules and .meeko without following them", async () => {
  await withSandbox(async (sandbox) => {
    const root = await project(sandbox);
    // pnpm link: makes node_modules/@meekojs/meeko a junction to another repository.
    const linkedPackage = join(sandbox, "linked-package");
    await write(join(linkedPackage, "sentinel.txt"), "package");
    await write(join(linkedPackage, "node_modules", "nested", "sentinel.txt"), "nested");
    const linkedOutput = join(sandbox, "linked-output");
    await write(join(linkedOutput, "sentinel.txt"), "output");
    await linkDirectory(linkedPackage, join(root, "node_modules", "@meekojs", "meeko"));
    await linkDirectory(linkedOutput, join(root, ".meeko", "output", "linked"));
    await linkDirectory(linkedPackage, join(root, "node_modules", ".pnpm", "node_modules", "@meekojs", "meeko"));

    const dry = cli("clean", root, "--all", "--dry-run");
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /^Se borraría \.meeko \(3 archivos, 1 enlace \(sin seguir\), \d+ B\)$/m);
    assert.match(dry.stdout, /^Se borraría node_modules \(2 archivos, 2 enlaces \(sin seguir\), \d+ B\)$/m);

    const result = cli("clean", root, "--all");
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    assert.ok(!existsSync(join(root, "node_modules")), "node_modules and its links are gone");
    assert.ok(!existsSync(join(root, ".meeko")), ".meeko and its link are gone");
    assert.equal(await readFile(join(linkedPackage, "sentinel.txt"), "utf8"), "package");
    assert.equal(await readFile(join(linkedPackage, "node_modules", "nested", "sentinel.txt"), "utf8"), "nested");
    assert.equal(await readFile(join(linkedOutput, "sentinel.txt"), "utf8"), "output");
    userFilesSurvive(root);
  });
});

test("meeko clean removes a linked .meeko or node_modules as a link and never cleans behind it", async () => {
  await withSandbox(async (sandbox) => {
    const root = join(sandbox, "app");
    await write(join(root, "meeko.config.ts"), "export default {};\n");
    const externalModules = join(sandbox, "shared-modules");
    await write(join(externalModules, ".vite", "sentinel.txt"), "vite");
    await write(join(externalModules, "dependency", "sentinel.txt"), "dependency");
    const externalGenerated = join(sandbox, "shared-generated");
    await write(join(externalGenerated, "sentinel.txt"), "generated");
    await linkDirectory(externalModules, join(root, "node_modules"));
    await linkDirectory(externalGenerated, join(root, ".meeko"));

    // The Vite cache lives behind a linked node_modules: it is skipped, not followed.
    const result = cli("clean", root);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /^Borrado \.meeko \(0 archivos, 1 enlace \(sin seguir\), 0 B\)$/m);
    assert.match(result.stderr, /^Omitido node_modules\/\.vite: node_modules es un enlace a /m);
    assert.ok(!existsSync(join(root, ".meeko")));
    assert.equal(await readFile(join(externalGenerated, "sentinel.txt"), "utf8"), "generated");
    assert.equal(await readFile(join(externalModules, ".vite", "sentinel.txt"), "utf8"), "vite");
    assert.ok((await lstat(join(root, "node_modules"))).isSymbolicLink());

    const all = cli("clean", root, "--all");
    assert.equal(all.status, 0, all.stderr);
    assert.match(all.stdout, /^Borrado node_modules \(0 archivos, 1 enlace \(sin seguir\), 0 B\)$/m);
    assert.ok(!existsSync(join(root, "node_modules")));
    assert.equal(await readFile(join(externalModules, ".vite", "sentinel.txt"), "utf8"), "vite");
    assert.equal(await readFile(join(externalModules, "dependency", "sentinel.txt"), "utf8"), "dependency");
    assert.ok(existsSync(join(root, "meeko.config.ts")));
  });
});
