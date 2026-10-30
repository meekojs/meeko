import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { appendFile, chmod, cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, unlink, utimes, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import test from "node:test";
import type { EditorBridgeDescriptor } from "../src/devtools-bridge-protocol.ts";
import { editorBridgeFile } from "../src/framework/editor-bridge.ts";
import { hmrPortFor, isPortFree } from "../src/framework/dev-port.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { linkRepositoryDependencies, repositoryRoot, stopChild, tempProject } from "./helpers/temp-project.ts";

/** A junction on Windows (no privilege needed), a directory symlink elsewhere. */
const link = (target: string, path: string) => symlink(target, path, process.platform === "win32" ? "junction" : "dir");

async function until(condition: () => boolean | Promise<boolean>, message: () => string, timeout = 30_000): Promise<void> {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeout) throw new Error(message());
    await new Promise((done) => setTimeout(done, 50));
  }
}

/** `true` while the process exists; a permissions error also means it exists. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Listens on `port` when it is free; `undefined` when something else already holds it. */
async function occupy(port: number): Promise<Server | undefined> {
  const server = createServer();
  try {
    server.listen(port, "127.0.0.1");
    await once(server, "listening");
    return server;
  } catch {
    return undefined;
  }
}

async function release(server: Server | undefined): Promise<void> {
  if (!server?.listening) return;
  server.close();
  await once(server, "close");
}

const count = (text: string, part: string) => text.split(part).length - 1;
const restartLine = "[meeko] Meeko enlazado cambió; reiniciando meeko dev…";

// An app that consumes Meeko through `link:` gets a fresh `meeko dev` process each time the
// linked build changes, on the port the first one chose, and survives a build caught halfway.
test("meeko dev restarts when a linked Meeko is rebuilt", { timeout: 240_000 }, async (context) => {
  let child: ChildProcess | undefined;
  let lastPid: number | undefined;
  let blocker: Server | undefined;
  // Outside the repository: the linked copy is the only Meeko the app can reach.
  const sandbox = await realpath(await mkdtemp(join(tmpdir(), "meeko-dev-restart-")));
  const meeko = join(sandbox, "meeko");
  const app = join(sandbox, "app");
  const links = [join(app, "node_modules", "@meekojs", "meeko"), join(app, "node_modules", "vite")];
  context.after(async () => {
    await stopChild(child);
    if (lastPid !== undefined && isAlive(lastPid)) process.kill(lastPid);
    await release(blocker);
    // Remove the links first, so deleting the sandbox never reaches the repository.
    for (const path of links) await unlink(path).catch(() => undefined);
    await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  await mkdir(meeko, { recursive: true });
  await cp(join(repositoryRoot, "dist"), join(meeko, "dist"), { recursive: true });
  await cp(join(repositoryRoot, "package.json"), join(meeko, "package.json"));
  // The copy resolves the repository's dependencies like a linked checkout resolves its own.
  links.push(...await linkRepositoryDependencies(join(meeko, "node_modules")));
  await initFrameworkProject(app);
  await mkdir(join(app, "node_modules", "@meekojs"), { recursive: true });
  await link(meeko, links[0]!);
  await link(join(repositoryRoot, "node_modules", "vite"), links[1]!);

  // The default port is taken (by this test or by something else): dev moves to the next free one.
  blocker = await occupy(4173);
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ["PORT", "HOST", "MEEKO_HMR_PORT", "MEEKO_LINK_WATCH", "MEEKO_DEV_SUPERVISED", "MEEKO_DEV_SUPERVISED_PORT", "MEEKO_DEV_SUPERVISED_HMR_PORT"]) delete env[name];
  const running = spawn(process.execPath, [join(meeko, "dist", "cli.js"), "dev", app], { cwd: app, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child = running;
  let logs = "";
  running.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  running.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const moved = /\[meeko\] El puerto 4173 está en uso; meeko dev usa el (\d+)/;
  await until(() => moved.test(logs) || running.exitCode !== null, () => `meeko dev did not move off 4173: ${logs}`, 60_000);
  const port = Number(moved.exec(logs)?.[1]);
  assert.ok(port > 4173, logs);
  const origin = `http://127.0.0.1:${port}`;
  // meeko dev listens on 127.0.0.1 and prints localhost.
  const printed = `http://localhost:${port}\n`;
  await until(() => logs.includes(printed) || running.exitCode !== null, () => `meeko dev did not listen: ${logs}`, 60_000);
  assert.equal(running.exitCode, null, logs);
  const descriptorFile = join(app, editorBridgeFile(port));
  const pid = async () => (JSON.parse(await readFile(descriptorFile, "utf8")) as EditorBridgeDescriptor).pid;
  const serves = async () => {
    try { return (await fetch(`${origin}/`, { headers: { accept: "text/html" } })).status === 200; } catch { return false; }
  };
  assert.ok(await serves(), logs);
  const first = await pid();
  assert.notEqual(first, running.pid, "The server runs in a child of the supervisor");
  lastPid = first;

  // 4173 is free now; the restarted server keeps the port of the first one anyway.
  await release(blocker);
  // A build writes many files in bursts: one restart after it settles.
  for (let round = 0; round < 5; round++) {
    for (const file of ["index.js", "framework.js", "cli.js"]) await appendFile(join(meeko, "dist", file), "\n");
    await new Promise((done) => setTimeout(done, 60));
  }
  await until(async () => {
    try { return (await pid()) !== first; } catch { return false; }
  }, () => `No fresh server after the rebuild: ${logs}`, 60_000);
  const second = await pid();
  lastPid = second;
  await until(serves, () => `The restarted server does not answer on ${origin}: ${logs}`);
  assert.equal(isAlive(first), false, "The previous server exited");
  assert.equal(count(logs, restartLine), 1, logs);
  assert.equal(count(logs, printed), 2, logs);
  assert.doesNotMatch(logs, /http:\/\/localhost:4173\n/);
  assert.match(await (await fetch(`${origin}/@vite/client`)).text(), new RegExp(`const hmrPort = ${hmrPortFor(port)};`));
  await new Promise((done) => setTimeout(done, 1500));
  assert.equal(count(logs, restartLine), 1, `The build settled into one restart: ${logs}`);

  // A build caught halfway: the new server cannot load, the supervisor reports it and waits.
  const partial = join(meeko, "dist", "framework", "dev-watch.js");
  const complete = await readFile(partial, "utf8");
  await writeFile(partial, "export const broken = ;\n");
  await until(() => /meeko dev no pudo arrancar con el Meeko enlazado \(código 1\); se reiniciará con el próximo cambio de /.test(logs),
    () => `The failed restart was not reported: ${logs}`, 60_000);
  assert.equal(running.exitCode, null, "The supervisor keeps waiting for a complete build");
  assert.equal(isAlive(second), false);
  // The build finishes: the next server listens on the same port.
  await writeFile(partial, complete);
  await until(async () => count(logs, printed) === 3 && await serves(), () => `No server after the build completed: ${logs}`, 60_000);
  const third = await pid();
  lastPid = third;
  assert.notEqual(third, second);

  // Stopping meeko dev stops its server too and frees the port. On POSIX SIGINT reaches the
  // supervisor, which has the server close and remove its editor descriptor. On Windows `kill`
  // terminates the supervisor outright and the system ends the server with it, as it ended an
  // unsupervised `meeko dev`; the next one removes the stale descriptor.
  await stopChild(running);
  child = undefined;
  await until(() => !isAlive(third), () => `The server outlived its supervisor: ${logs}`, 20_000);
  if (process.platform !== "win32") {
    await until(() => readFile(descriptorFile).then(() => false, () => true), () => "The editor descriptor stayed", 5000);
  }
  await until(() => isPortFree(port, "127.0.0.1"), () => `Port ${port} stayed in use`, 5000);
});

const pause = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds));

/** An app that consumes a built copy of Meeko the way pnpm's `link:` installs it; see {@link linkedApp}. */
interface LinkedApp {
  readonly meeko: string;
  readonly app: string;
  /** `node_modules/.bin` of the app, with the `meeko` bin. */
  readonly bin: string;
}

/**
 * A copy of the built Meeko outside the repository, last read hours ago, linked into a new app by
 * a junction (a directory symlink elsewhere) like pnpm's `link:`, with the bin pnpm writes for it:
 * a `.cmd` shim on Windows, a symlink to `dist/cli.js` elsewhere. The copy exports `buildMarker`,
 * which the page `/build` renders on the server and imports in the browser. `cleanup` runs first.
 */
async function linkedApp(context: { after(fn: () => Promise<void>): void }, prefix: string, cleanup: () => Promise<void>): Promise<LinkedApp> {
  const sandbox = await realpath(await mkdtemp(join(tmpdir(), prefix)));
  const meeko = join(sandbox, "meeko");
  const app = join(sandbox, "app");
  const links = [join(app, "node_modules", "@meekojs", "meeko"), join(app, "node_modules", "vite")];
  context.after(async () => {
    try { await cleanup(); }
    finally {
      // Remove the links first, so deleting the sandbox never reaches the repository.
      for (const path of links) await unlink(path).catch(() => undefined);
      await rm(sandbox, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    }
  });
  await mkdir(meeko, { recursive: true });
  await cp(join(repositoryRoot, "dist"), join(meeko, "dist"), { recursive: true });
  await cp(join(repositoryRoot, "package.json"), join(meeko, "package.json"));
  // `tsc` ends the file with the source map comment and no line break.
  await appendFile(join(meeko, "dist", "index.js"), "\nexport const buildMarker = \"build-1\";\n");
  // A build from yesterday: with access time updates on, Windows reports the first read of each
  // file as a change, which restarted a supervised server that had only loaded it.
  const hoursAgo = new Date(Date.now() - 3 * 3_600_000);
  for (const entry of await readdir(meeko, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const file = join(entry.parentPath, entry.name);
    await utimes(file, hoursAgo, (await stat(file)).mtime);
  }
  links.push(...await linkRepositoryDependencies(join(meeko, "node_modules")));
  await initFrameworkProject(app);
  await writeFile(join(app, "app", "pages", "build.meeko"), `<script lang="ts">
import { buildMarker } from "@meekojs/meeko";
</script>

<template>
  <p id="build">{buildMarker}</p>
</template>
`);
  await mkdir(join(app, "node_modules", "@meekojs"), { recursive: true });
  await link(meeko, links[0]!);
  await link(join(repositoryRoot, "node_modules", "vite"), links[1]!);
  const bin = join(app, "node_modules", ".bin");
  await mkdir(bin, { recursive: true });
  if (process.platform === "win32") {
    // The shim pnpm writes for a bin, which runs it through the link.
    await writeFile(join(bin, "meeko.cmd"), [
      "@SETLOCAL",
      "@IF EXIST \"%~dp0\\node.exe\" (",
      "  \"%~dp0\\node.exe\"  \"%~dp0\\..\\@meekojs\\meeko\\dist\\cli.js\" %*",
      ") ELSE (",
      "  @SET PATHEXT=%PATHEXT:;.JS;=;%",
      "  node  \"%~dp0\\..\\@meekojs\\meeko\\dist\\cli.js\" %*",
      ")",
      "",
    ].join("\r\n"));
  } else {
    await chmod(join(meeko, "dist", "cli.js"), 0o755);
    await symlink(join("..", "@meekojs", "meeko", "dist", "cli.js"), join(bin, "meeko"));
  }
  return { meeko, app, bin };
}

/**
 * Runs `meeko dev .` in the app the way a user does: `cmd /c meeko dev .` on Windows, a shell
 * elsewhere, with the app's `node_modules/.bin` on `PATH` as `npm run` and `pnpm exec` put it.
 */
function launchDev({ app, bin }: LinkedApp): { readonly process: ChildProcess; logs(): string } {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const name of ["PORT", "HOST", "MEEKO_PORT", "MEEKO_HOST", "MEEKO_HMR_PORT", "MEEKO_LINK_WATCH", "MEEKO_DEV_SUPERVISED", "MEEKO_DEV_SUPERVISED_PORT", "MEEKO_DEV_SUPERVISED_HMR_PORT"]) delete env[name];
  const pathKey = Object.keys(env).find((name) => name.toUpperCase() === "PATH") ?? "PATH";
  env[pathKey] = [bin, dirname(process.execPath), env[pathKey]].filter(Boolean).join(delimiter);
  const options = { cwd: app, env, stdio: ["ignore", "pipe", "pipe"] as ["ignore", "pipe", "pipe"], windowsHide: true };
  const running = process.platform === "win32"
    ? spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", "meeko dev ."], options)
    : spawn("/bin/sh", ["-c", "exec meeko dev ."], options);
  let logs = "";
  running.stdout.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  running.stderr.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  return { process: running, logs: () => logs };
}

/** Stops what {@link launchDev} started: on Windows `cmd` and every process under it. */
async function stopDev(running: ChildProcess | undefined): Promise<void> {
  if (!running || running.exitCode !== null || running.signalCode !== null) return;
  if (process.platform !== "win32" || running.pid === undefined) return stopChild(running);
  const exited = once(running, "exit");
  spawnSync("taskkill", ["/pid", String(running.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  await exited;
}

/** The `buildMarker` the server rendered into `/build`. */
async function serverBuild(origin: string): Promise<string | undefined> {
  const html = await (await fetch(`${origin}/build`, { headers: { accept: "text/html" } })).text();
  // Without the hydration markers around the text.
  return /id="build"[^>]*>(.*?)<\/p>/s.exec(html)?.[1]?.replaceAll(/<!--.*?-->/gs, "");
}

/** The `buildMarker` of the `@meekojs/meeko` module Vite serves to the browser for `/build`. */
async function clientBuild(origin: string): Promise<string | undefined> {
  // As the browser asks for a module script: Vite transforms the component instead of serving its source.
  const script = { headers: { "sec-fetch-dest": "script" } };
  const page = await (await fetch(`${origin}/app/pages/build.meeko`, script)).text();
  const url = /["']([^"']*\/meeko\/dist\/index\.js[^"']*)["']/.exec(page)?.[1];
  assert.ok(url, `The page module does not import the linked Meeko:\n${page}`);
  return /buildMarker = "([^"]+)"/.exec(await (await fetch(new URL(url, origin), script)).text())?.[1];
}

/** Rewrites the build like `tsc`: bursts of writes across `dist`, the marker among them. */
async function rebuild(meeko: string, marker: string): Promise<void> {
  const index = join(meeko, "dist", "index.js");
  for (let round = 0; round < 5; round++) {
    for (const file of ["framework.js", "cli.js"]) await appendFile(join(meeko, "dist", file), "\n");
    if (round === 2) await writeFile(index, (await readFile(index, "utf8")).replace(/buildMarker = "[^"]+"/, `buildMarker = "${marker}"`));
    await pause(60);
  }
}

/** The URL meeko dev prints: localhost, although it listens on 127.0.0.1. */
const listening = /http:\/\/localhost:(\d+)\n/;

// The scenario of an app that consumes Meeko through `link:` and runs `cmd /c meeko dev .`: the
// shim reaches the CLI through the junction, the supervisor sees the link, reading the build does
// not restart the server, and after a rebuild the server and the browser get the same build.
test("meeko dev launched through the bin of a linked Meeko serves one build after a rebuild", { timeout: 240_000 }, async (context) => {
  let running: ChildProcess | undefined;
  const linked = await linkedApp(context, "meeko-dev-link-bin-", () => stopDev(running));
  const dev = launchDev(linked);
  running = dev.process;
  await until(() => listening.test(dev.logs()) || running?.exitCode !== null, () => `meeko dev did not listen: ${dev.logs()}`, 90_000);
  assert.equal(running.exitCode, null, dev.logs());
  const port = listening.exec(dev.logs())?.[1];
  const origin = `http://127.0.0.1:${port}`;
  const printed = `http://localhost:${port}\n`;
  assert.equal(await serverBuild(origin), "build-1", dev.logs());
  assert.equal(await clientBuild(origin), "build-1", dev.logs());
  // Loading and serving the build only reads it.
  await pause(1500);
  assert.equal(count(dev.logs(), restartLine), 0, `Reading the linked build restarted meeko dev: ${dev.logs()}`);

  await rebuild(linked.meeko, "build-2");
  await until(async () => {
    if (count(dev.logs(), printed) < 2) return false;
    try { return await serverBuild(origin) === "build-2"; } catch { return false; }
  }, () => `No server with the new build: ${dev.logs()}`, 90_000);
  assert.equal(await clientBuild(origin), "build-2", dev.logs());
  assert.equal(count(dev.logs(), restartLine), 1, dev.logs());
  await pause(1500);
  assert.equal(count(dev.logs(), restartLine), 1, `The rebuild settled into one restart: ${dev.logs()}`);
  assert.equal(count(dev.logs(), printed), 2, dev.logs());
});

// MEEKO_LINK_WATCH=0 in the app's `.env` keeps one process: its server stays on the build it loaded,
// so meeko dev says on every rebuild that it has to be restarted, instead of silently serving a mix.
test("meeko dev with MEEKO_LINK_WATCH=0 says to restart it when the linked Meeko is rebuilt", { timeout: 240_000 }, async (context) => {
  let running: ChildProcess | undefined;
  const linked = await linkedApp(context, "meeko-dev-link-off-", () => stopDev(running));
  await writeFile(join(linked.app, ".env"), "MEEKO_LINK_WATCH=0\n");
  const dev = launchDev(linked);
  running = dev.process;
  await until(() => listening.test(dev.logs()) || running?.exitCode !== null, () => `meeko dev did not listen: ${dev.logs()}`, 90_000);
  assert.equal(running.exitCode, null, dev.logs());
  const port = listening.exec(dev.logs())?.[1];
  const origin = `http://127.0.0.1:${port}`;
  assert.equal(await serverBuild(origin), "build-1", dev.logs());

  const warning = `[meeko] Meeko enlazado cambió (${join(linked.meeko, "dist")}), pero este meeko dev no se reinicia solo (MEEKO_LINK_WATCH=0): `
    + "el servidor sigue con el código anterior y el navegador recibe el nuevo. Reinicia meeko dev.\n";
  await pause(1000);
  assert.equal(count(dev.logs(), warning), 0, `Reading the linked build is not a rebuild: ${dev.logs()}`);
  await rebuild(linked.meeko, "build-2");
  await until(() => dev.logs().includes(warning), () => `The rebuild was not reported: ${dev.logs()}`, 30_000);
  await pause(1500);
  assert.equal(count(dev.logs(), warning), 1, `One warning per build: ${dev.logs()}`);
  assert.equal(count(dev.logs(), restartLine), 0, dev.logs());
  assert.equal(count(dev.logs(), `http://localhost:${port}\n`), 1, dev.logs());
  // The reason for the warning: the same process still renders with the build it loaded.
  assert.equal(await serverBuild(origin), "build-1", dev.logs());
});

// With PORT set, a port in use fails at once with a message that names it; Vite's HMR
// WebSocket, whose derived port the other server also holds, does not fail first.
test("meeko dev with an explicit port in use fails with a clear message", { timeout: 120_000 }, async (context) => {
  let child: ChildProcess | undefined;
  const blockers: Server[] = [];
  const root = await tempProject(context, "dev-port-in-use", async () => {
    await stopChild(child);
    for (const blocker of blockers) await release(blocker);
  });
  await initFrameworkProject(root);
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await link(repositoryRoot, join(root, "node_modules", "@meekojs", "meeko"));
  await link(join(repositoryRoot, "node_modules", "vite"), join(root, "node_modules", "vite"));
  // Another server holds the port and the HMR port derived from it, as another meeko dev does.
  let port = 0;
  for (let candidate = 41_000; candidate < 41_100 && blockers.length < 2; candidate++) {
    const http = await occupy(candidate);
    const hmr = http ? await occupy(hmrPortFor(candidate)) : undefined;
    if (http && hmr) { blockers.push(http, hmr); port = candidate; }
    else await release(http);
  }
  assert.ok(port > 0);
  const env: NodeJS.ProcessEnv = { ...process.env, PORT: String(port) };
  delete env.MEEKO_HMR_PORT;
  const running = spawn(process.execPath, [join(repositoryRoot, "dist", "cli.js"), "dev", root], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
  child = running;
  let logs = "";
  running.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  running.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const [code] = await once(running, "exit") as [number | null];
  assert.equal(code, 1, logs);
  assert.match(logs, new RegExp(`El puerto ${port} de 127\\.0\\.0\\.1 ya está en uso; usa MEEKO_PORT=<otro puerto> o cierra el otro meeko dev`));
  assert.doesNotMatch(logs, /WebSocket server error/);
  assert.doesNotMatch(logs, /http:\/\/localhost:/);
});
