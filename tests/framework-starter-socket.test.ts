import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import WebSocket from "ws";
import { initFrameworkProject } from "../src/framework/init.ts";

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

test("generated starter serves a real Socket channel and shuts its Node transport down", { timeout: 30_000 }, async (context) => {
  const projectRoot = resolve(".meeko");
  await mkdir(projectRoot, { recursive: true });
  const root = await mkdtemp(join(projectRoot, "starter-socket-"));
  const repository = resolve(".");
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  await initFrameworkProject(root);
  await mkdir(join(root, "shared", "schemas"), { recursive: true });
  await mkdir(join(root, "server", "socket"), { recursive: true });
  await writeFile(join(root, "shared", "schemas", "chat.ts"), "export const messageSchema = { '~standard': { version: 1 as const, validate(value: unknown) { return value && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string' ? { value: value as { text: string } } : { issues: [{}] }; } } };\n");
  await writeFile(join(root, "server", "socket", "chat.ts"), "import { defineSocketChannel } from '@meekojs/meeko/server';\nimport { messageSchema } from '../../shared/schemas/chat.js';\nexport default defineSocketChannel({ clientToServer: { message: messageSchema }, serverToClient: { message: messageSchema }, handlers: { message: ({ payload, emit }) => emit('message', payload) } });\n");
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(repository, join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(join(repository, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
  const child = spawn(process.execPath, ["server.mjs"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), PUBLIC_ORIGIN: origin },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  context.after(async () => {
    if (child.exitCode === null) child.kill("SIGINT");
    await rm(root, { recursive: true, force: true });
  });
  await new Promise<void>((done, fail) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (logs.includes(origin)) { clearInterval(timer); done(); }
      else if (child.exitCode !== null) { clearInterval(timer); fail(new Error(`Starter exited before listening: ${logs}`)); }
      else if (Date.now() - start > 20_000) { clearInterval(timer); fail(new Error(`Starter did not listen: ${logs}`)); }
    }, 25);
  });
  const response = await fetch(origin);
  assert.equal(response.status, 200, logs);
  const peer = new WebSocket(`ws://127.0.0.1:${port}/_meeko/socket/chat`, { headers: { origin } });
  await once(peer, "open");
  const reply = once(peer, "message");
  peer.send(JSON.stringify({ event: "message", payload: { text: "from starter" } }));
  assert.deepEqual(JSON.parse(String((await reply)[0])) as unknown, { event: "message", payload: { text: "from starter" } });
  const closed = once(peer, "close");
  const exited = once(child, "exit");
  child.kill("SIGINT");
  await closed;
  await exited;
  await assert.rejects(fetch(origin));
});
