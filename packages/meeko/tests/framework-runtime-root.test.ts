import assert from "node:assert/strict";
import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdir, rename, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import test from "node:test";

import { prepareFrameworkTypes } from "../src/framework/check-project.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { buildProject } from "../src/framework/project.ts";
import { repositoryRoot, stopChild, tempProject } from "./helpers/temp-project.ts";

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  server.close();
  await once(server, "close");
  return address.port;
}

/** A project whose runtime publishes `root` as a service, and an API that returns it. */
async function rootApp(root: string): Promise<void> {
  await initFrameworkProject(root);
  await mkdir(join(root, "server", "api"), { recursive: true });
  // A persistent store, so that production starts without MEEKO_REDIS_URL.
  await writeFile(join(root, "server", "runtime.ts"), `import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(({ production, root }) => {
  const memory = new MemorySessionStore();
  return {
    sessions: new SessionManager({ secure: false, production, store: {
      persistent: true,
      get: (id) => memory.get(id),
      set: (record) => memory.set(record),
      delete: (id) => memory.delete(id),
      replace: (oldId, record) => memory.replace(oldId, record),
      revokeFamily: (familyId) => memory.revokeFamily(familyId),
      close: () => memory.close(),
    } }),
    services: { root: root ?? null },
  };
});
`);
  await writeFile(join(root, "server", "api", "root.get.ts"), `import { defineApiRoute } from "@meekojs/meeko/server";

export default defineApiRoute({ contentType: "response", handler: ({ context }) => Response.json(context.services) });
`);
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(repositoryRoot, join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(join(repositoryRoot, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
}

/** Starts a process that prints `http://localhost:<port>` and returns the root it serves at `/api/root`. */
async function servedRoot(child: ChildProcess, port: number): Promise<unknown> {
  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const start = Date.now();
  while (!logs.includes(`http://localhost:${port}\n`)) {
    if (child.exitCode !== null || Date.now() - start > 60_000) throw new Error(`The server did not listen: ${logs}`);
    await new Promise((done) => setTimeout(done, 25));
  }
  const response = await fetch(`http://127.0.0.1:${port}/api/root`);
  assert.equal(response.status, 200, logs);
  return ((await response.json()) as { root: unknown }).root;
}

test("meeko dev gives the runtime the project root, whatever the working directory", { timeout: 120_000 }, async (context) => {
  let child: ChildProcess | undefined;
  const root = await tempProject(context, "runtime-root-dev", () => stopChild(child));
  await rootApp(root);
  const port = await freePort();
  const hmrPort = await freePort();
  child = spawn(process.execPath, [join(repositoryRoot, "dist", "cli.js"), "dev", root], {
    cwd: repositoryRoot,
    env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmrPort), MEEKO_LINK_WATCH: "0", MEEKO_EDITOR_BRIDGE: "0" },
    stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  assert.equal(await servedRoot(child, port), resolve(root));
});

test("the Node output gives the runtime the project root, and MEEKO_ROOT when the output moves", { timeout: 180_000 }, async (context) => {
  let child: ChildProcess | undefined;
  const root = await tempProject(context, "runtime-root-build", () => stopChild(child, "SIGTERM"));
  await rootApp(root);
  await prepareFrameworkTypes(root);
  const { output } = await buildProject(root, { adapter: "node" });
  const serve = async (entry: string, cwd: string, env: Record<string, string> = {}): Promise<unknown> => {
    const port = await freePort();
    child = spawn(process.execPath, [entry], {
      cwd, env: { ...process.env, MEEKO_PORT: String(port), MEEKO_HOST: "127.0.0.1", ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
    });
    try { return await servedRoot(child, port); }
    finally { await stopChild(child, "SIGTERM"); }
  };
  // meeko start runs the output from the project.
  const port = await freePort();
  child = spawn(process.execPath, [join(repositoryRoot, "dist", "cli.js"), "start", root], {
    cwd: repositoryRoot, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1" }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  assert.equal(await servedRoot(child, port), resolve(root));
  await stopChild(child, "SIGTERM");
  // `node .meeko/output/node/index.mjs` from another working directory: the root is three folders up.
  assert.equal(await serve(join(output, "index.mjs"), repositoryRoot), resolve(root));
  // A moved output no longer sits three levels below the project: MEEKO_ROOT names it, relative to the working directory.
  const moved = join(root, "deploy", "srv", "app", "node");
  await mkdir(join(root, "deploy", "srv", "app"), { recursive: true });
  await rename(output, moved);
  assert.equal(await serve(join(moved, "index.mjs"), root), join(root, "deploy"));
  assert.equal(await serve(join(moved, "index.mjs"), root, { MEEKO_ROOT: "." }), resolve(root));
  assert.equal(await serve(join(moved, "index.mjs"), repositoryRoot, { MEEKO_ROOT: root }), resolve(root));
});
