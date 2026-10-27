import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { appendFile, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, unlink, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import type { EditorBridgeDescriptor } from "../src/devtools-bridge-protocol.ts";
import { editorBridgeFile } from "../src/framework/editor-bridge.ts";
import { hmrPortFor, isPortFree } from "../src/framework/dev-port.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { repositoryRoot, stopChild, tempProject } from "./helpers/temp-project.ts";

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
  const links = [join(meeko, "node_modules"), join(app, "node_modules", "@meekojs", "meeko"), join(app, "node_modules", "vite")];
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
  await link(join(repositoryRoot, "node_modules"), links[0]!);
  await initFrameworkProject(app);
  await mkdir(join(app, "node_modules", "@meekojs"), { recursive: true });
  await link(meeko, links[1]!);
  await link(join(repositoryRoot, "node_modules", "vite"), links[2]!);

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
  await until(() => logs.includes(`${origin}\n`) || running.exitCode !== null, () => `meeko dev did not listen: ${logs}`, 60_000);
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
  assert.equal(count(logs, `${origin}\n`), 2, logs);
  assert.doesNotMatch(logs, /http:\/\/127\.0\.0\.1:4173\n/);
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
  await until(async () => count(logs, `${origin}\n`) === 3 && await serves(), () => `No server after the build completed: ${logs}`, 60_000);
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
  assert.doesNotMatch(logs, /http:\/\/127\.0\.0\.1:/);
});
