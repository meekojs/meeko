import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
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
    assert.match(second.stderr, /El destino no está vacío/);
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
    assert.match(result.stdout, /Siguiente paso: pnpm install && pnpm run dev/);
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
    assert.match(result.stderr, /El destino no está vacío/);
    assert.equal(await readFile(join(root, "package.json"), "utf8"), manifest);
    assert.equal(await readFile(join(root, "src", "index.ts"), "utf8"), "export const existing = true;\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("CLI init genera un cierre observado que conserva fallos de servidor y Vite", async () => {
  const root = await mkdtemp(join(tmpdir(), "meeko-init-shutdown-"));
  const target = join(root, "starter-app");
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const initialized = spawnSync(process.execPath, [resolve("dist/cli.js"), "init", target], { encoding: "utf8" });
    assert.equal(initialized.status, 0, initialized.stderr);
    const viteRoot = join(target, "node_modules", "vite");
    await mkdir(viteRoot, { recursive: true });
    await writeFile(join(viteRoot, "package.json"), JSON.stringify({ name: "vite", type: "module", exports: "./index.js" }));
    await writeFile(join(viteRoot, "index.js"), `
export async function createServer() {
  setTimeout(() => process.emit("SIGINT"), 100);
  return {
    middlewares(_request, _response, next) { next(); },
    async ssrLoadModule() { throw new Error("unexpected SSR load"); },
    async transformIndexHtml(_path, html) { return html; },
    async close() { throw new Error("fake vite close failure"); },
  };
}
`);
    const preload = join(root, "fail-server-close.mjs");
    await writeFile(preload, `
import http from "node:http";
import { syncBuiltinESMExports } from "node:module";
const createServer = http.createServer;
http.createServer = (...args) => {
  const server = createServer(...args);
  const close = server.close.bind(server);
  server.close = (callback) => close(() => callback?.(new Error("fake server close failure")));
  return server;
};
syncBuiltinESMExports();
`);
    child = spawn(process.execPath, ["--import", pathToFileURL(preload).href, join(target, "server.mjs")], {
      cwd: target,
      env: { ...process.env, PORT: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => { stderr += chunk; });
    const timeout = setTimeout(() => child?.kill(), 5_000);
    const [code] = await once(child, "exit") as [number | null, NodeJS.Signals | null];
    clearTimeout(timeout);
    assert.equal(code, 1, stderr);
    assert.match(stderr, /Meeko server shutdown failed/);
    assert.match(stderr, /fake server close failure/);
    assert.match(stderr, /fake vite close failure/);
    assert.doesNotMatch(stderr, /UnhandledPromiseRejection|triggerUncaughtException/);
  } finally {
    if (child?.exitCode === null) child.kill();
    await rm(root, { recursive: true, force: true });
  }
});
