import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { connect, createServer } from "node:net";
import { ServerResponse } from "node:http";
import { once } from "node:events";
import { mkdir, readFile, readdir, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import WebSocket from "ws";
import { prepareFrameworkTypes } from "../src/framework/check-project.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { buildProject, startProject } from "../src/framework/project.ts";
import { createTempProject, repositoryRoot, stopChild, tempProject } from "./helpers/temp-project.ts";

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

test("starter preserves an occupied-port error and reports failed startup cleanup", { timeout: 30_000 }, async () => {
  const project = await createTempProject("starter-port-conflict");
  const root = project.root;
  const repository = repositoryRoot;
  const port = await freePort();
  const occupied = createServer();
  occupied.listen(port, "127.0.0.1");
  await once(occupied, "listening");
  const hmrPort = await freePort();
  const previousPort = process.env.PORT;
  const previousHmrPort = process.env.MEEKO_HMR_PORT;
  const previousCwd = process.cwd();
  const signalsBefore = { int: process.listenerCount("SIGINT"), term: process.listenerCount("SIGTERM") };
  try {
    await initFrameworkProject(root);
    await writeFile(join(root, "server", "runtime.ts"), `import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

class FailingSessionStore extends MemorySessionStore {
  override async close(): Promise<void> {
    await super.close();
    throw new Error("session cleanup failed");
  }
}

export default defineServerRuntime(() => ({
  sessions: new SessionManager({ store: new FailingSessionStore(), production: false }),
}));
`);
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(repository, join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await symlink(join(repository, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
    await prepareFrameworkTypes(root);
    process.env.PORT = String(port);
    process.env.MEEKO_HMR_PORT = String(hmrPort);
    process.chdir(root);
    const logged: unknown[][] = [];
    const previousConsoleError = console.error;
    console.error = (...values: unknown[]) => { logged.push(values); };
    try {
      await assert.rejects(startProject(root, false), (error: unknown) =>
        error instanceof Error && "code" in error && error.code === "EADDRINUSE");
    } finally {
      console.error = previousConsoleError;
    }
    assert.equal(logged.filter((values) => values.some((value) =>
      value instanceof Error && value.message === "session cleanup failed")).length, 1);
    assert.equal(process.listenerCount("SIGINT"), signalsBefore.int);
    assert.equal(process.listenerCount("SIGTERM"), signalsBefore.term);
  } finally {
    process.chdir(previousCwd);
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
    if (previousHmrPort === undefined) delete process.env.MEEKO_HMR_PORT;
    else process.env.MEEKO_HMR_PORT = previousHmrPort;
    occupied.close();
    await once(occupied, "close");
    await project.remove();
  }
});

test("production asset write failure is reported once per observer with one request ID", { timeout: 45_000 }, async () => {
  const project = await createTempProject("starter-asset-failure");
  const root = project.root;
  const repository = repositoryRoot;
  const port = await freePort();
  const previousPort = process.env.PORT;
  const originalWriteHead = ServerResponse.prototype.writeHead;
  const originalStderrWrite = process.stderr.write;
  let server: Awaited<ReturnType<typeof startProject>> | undefined;
  let logs = "";
  try {
    await initFrameworkProject(root);
    await writeFile(join(root, "server", "runtime.ts"), `import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(({ production }) => {
  const memory = new MemorySessionStore();
  return { sessions: new SessionManager({ store: {
    persistent: true,
    get: (id) => memory.get(id),
    set: (record) => memory.set(record),
    delete: (id) => memory.delete(id),
    replace: (oldId, record) => memory.replace(oldId, record),
    revokeFamily: (familyId) => memory.revokeFamily(familyId),
    close: () => memory.close(),
  }, production }) };
});
`);
    await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
    await symlink(repository, join(root, "node_modules", "@meekojs", "meeko"), "junction");
    await symlink(join(repository, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
    await prepareFrameworkTypes(root);
    await buildProject(root);
    const asset = (await readdir(join(root, ".meeko", "output", "node", "client", "assets"))).find((file) => file.endsWith(".js"));
    assert.ok(asset, "the client build must list a JavaScript asset");
    process.env.PORT = String(port);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      logs += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stderr.write;
    ServerResponse.prototype.writeHead = function () { throw new Error("asset fallback write failed"); } as typeof ServerResponse.prototype.writeHead;
    server = await startProject(root, true);
    await assert.rejects(fetch(`http://127.0.0.1:${port}/assets/${asset}`));
    await new Promise<void>((resolve) => setImmediate(resolve));
    const requestIds = [...logs.matchAll(/\[meeko\] request error ([0-9a-f-]{36})/g)].map((match) => match[1]);
    assert.equal(requestIds.length, 2, logs);
    assert.equal(new Set(requestIds).size, 1, logs);
  } finally {
    ServerResponse.prototype.writeHead = originalWriteHead;
    process.stderr.write = originalStderrWrite;
    if (server?.listening) {
      const closed = once(server, "close");
      process.emit("SIGINT");
      await closed;
    }
    if (previousPort === undefined) delete process.env.PORT;
    else process.env.PORT = previousPort;
    await project.remove();
  }
});

test("generated starter serves a real Socket channel and shuts its Node transport down", { timeout: 30_000 }, async (context) => {
  let child: ChildProcess | undefined;
  const root = await tempProject(context, "starter-socket", () => stopChild(child));
  const repository = repositoryRoot;
  const port = await freePort();
  const hmrPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  await initFrameworkProject(root);
  await mkdir(join(root, "shared", "schemas"), { recursive: true });
  await mkdir(join(root, "server", "socket"), { recursive: true });
  await writeFile(join(root, "shared", "schemas", "chat.ts"), "export const messageSchema = { '~standard': { version: 1 as const, types: undefined as unknown as { input: { text: string }; output: { text: string } }, validate(value: unknown) { return value && typeof value === 'object' && typeof (value as { text?: unknown }).text === 'string' ? { value: value as { text: string } } : { issues: [{}] }; } } };\n");
  await writeFile(join(root, "server", "socket", "chat.ts"), "import { defineSocketChannel } from '@meekojs/meeko/server';\nimport { messageSchema } from '../../shared/schemas/chat.js';\nexport default defineSocketChannel({ clientToServer: { message: messageSchema }, serverToClient: { message: messageSchema }, handlers: { message: ({ payload, emit }) => emit('message', payload) } });\n");
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(repository, join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(join(repository, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
  const running = spawn(process.execPath, [join(repository, "dist", "cli.js"), "dev", root], {
    cwd: root,
    env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmrPort), PUBLIC_ORIGIN: origin },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child = running;
  let logs = "";
  running.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  running.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  await new Promise<void>((done, fail) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (logs.includes(origin)) { clearInterval(timer); done(); }
      else if (running.exitCode !== null) { clearInterval(timer); fail(new Error(`Starter exited before listening: ${logs}`)); }
      else if (Date.now() - start > 20_000) { clearInterval(timer); fail(new Error(`Starter did not listen: ${logs}`)); }
    }, 25);
  });
  const response = await fetch(origin);
  assert.equal(response.status, 200, logs);
  const malformed = await new Promise<string>((done, fail) => {
    const socket = connect(port, "127.0.0.1", () =>
      socket.write("GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n"));
    let text = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk: string) => { text += chunk; });
    socket.once("end", () => done(text));
    socket.once("error", fail);
  });
  assert.match(malformed, /^HTTP\/1\.1 400 Bad Request/);
  assert.match(malformed, /"code":"INVALID_URL","status":400/);
  assert.equal((await fetch(origin)).status, 200, "the host must remain available after an invalid URL");
  const html = await response.text();
  assert.match(html, /<link rel="stylesheet" href="\/app\/styles\/main\.css\?direct" data-vite-dev-id="[^"]+\/app\/styles\/main\.css">/);
  const stylesheet = await fetch(`${origin}/app/styles/main.css?direct`);
  assert.match(stylesheet.headers.get("content-type") ?? "", /text\/css/);
  assert.match(await stylesheet.text(), /box-sizing: border-box/);
  const peer = new WebSocket(`ws://127.0.0.1:${port}/_meeko/socket/chat`, { headers: { origin } });
  await once(peer, "open");
  const reply = once(peer, "message");
  peer.send(JSON.stringify({ event: "message", payload: { text: "from starter" } }));
  assert.deepEqual(JSON.parse(String((await reply)[0])) as unknown, { event: "message", payload: { text: "from starter" } });
  const closed = once(peer, "close");
  const exited = once(running, "exit");
  running.kill("SIGINT");
  await closed;
  await exited;
  await assert.rejects(fetch(origin));
});

test("generated starter reloads edited pages in SSR and Chrome development", { timeout: 45_000 }, async (context) => {
  let child: ReturnType<typeof spawn> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  const root = await tempProject(context, "starter-hmr", async () => {
    await browser?.close();
    await stopChild(child);
  });
  const repository = repositoryRoot;
  const port = await freePort();
  const origin = "http://127.0.0.1:" + port;
  await initFrameworkProject(root);
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(repository, join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(join(repository, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
  child = spawn(process.execPath, [join(repository, "dist", "cli.js"), "dev", root], {
    cwd: root,
    env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: "" },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  await new Promise<void>((done, fail) => {
    const start = Date.now();
    const timer = setInterval(() => {
      if (logs.includes(origin)) { clearInterval(timer); done(); }
      else if (child?.exitCode !== null) { clearInterval(timer); fail(new Error("Starter exited before listening: " + logs)); }
      else if (Date.now() - start > 20_000) { clearInterval(timer); fail(new Error("Starter did not listen: " + logs)); }
    }, 25);
  });
  const viteClient = await (await fetch(`${origin}/@vite/client`)).text();
  const configuredHmrPort = Number(viteClient.match(/const hmrPort = (\d+);/)?.[1]);
  const wsToken = viteClient.match(/const wsToken = "([^"]+)";/)?.[1];
  assert.ok(Number.isInteger(configuredHmrPort) && configuredHmrPort > 0, "Vite must expose its HMR port");
  assert.ok(wsToken, "Vite must expose its WebSocket token");
  const hmrPeer = new WebSocket(`ws://127.0.0.1:${configuredHmrPort}/?token=${encodeURIComponent(wsToken)}`, "vite-hmr");
  await once(hmrPeer, "open");
  const hmrClosed = once(hmrPeer, "close");
  hmrPeer.close();
  await hmrClosed;
  browser = await chromium.launch({
    ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
    headless: true,
  });
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(origin, { waitUntil: "networkidle" });
  assert.equal(await page.locator("h1").innerText(), "Welcome to Meeko");
  // The global stylesheet loads once, as the server's link, and its imports update it in place.
  const globalSheets = () => page.evaluate(() => [...document.styleSheets].filter((sheet) =>
    sheet.href?.includes("/app/styles/main.css")
    || (sheet.ownerNode as Element).getAttribute("data-vite-dev-id")?.endsWith("/app/styles/main.css")).length);
  assert.equal(await globalSheets(), 1);
  const stylesFile = join(root, "app", "styles", "main.css");
  await writeFile(join(root, "app", "styles", "probe.css"), "body { color: rgb(1, 2, 3); }\n", "utf8");
  await writeFile(stylesFile, `@import "./probe.css";\n${await readFile(stylesFile, "utf8")}`, "utf8");
  await page.waitForFunction(() => getComputedStyle(document.body).color === "rgb(1, 2, 3)", undefined, { timeout: 15_000 });
  await writeFile(join(root, "app", "styles", "probe.css"), "body { background-color: rgb(4, 5, 6); }\n", "utf8");
  await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(4, 5, 6)", undefined, { timeout: 15_000 });
  assert.notEqual(await page.evaluate(() => getComputedStyle(document.body).color), "rgb(1, 2, 3)", "a removed rule must not stay applied");
  assert.equal(await globalSheets(), 1);
  const pageFile = join(root, "app", "pages", "index.meeko");
  const source = await readFile(pageFile, "utf8");
  await writeFile(pageFile, source.replace("Welcome to Meeko", "Updated in development"), "utf8");
  await page.waitForFunction(() => document.querySelector("h1")?.textContent === "Updated in development", undefined, { timeout: 15_000 });
  assert.match(await (await fetch(origin)).text(), /Updated in development/);
  const layoutFile = join(root, "app", "layouts", "default.meeko");
  const layoutSource = await readFile(layoutFile, "utf8");
  await writeFile(layoutFile, layoutSource.replace("<a href=\"/\">Meeko</a>", "<a href=\"/\">Updated shell</a>"), "utf8");
  await page.waitForFunction(() => document.querySelector("header")?.textContent?.includes("Updated shell"), undefined, { timeout: 15_000 });
  assert.match(await (await fetch(origin)).text(), /Updated shell/);
  await page.getByRole("button", { name: "Count: 0" }).click();
  assert.equal(await page.getByRole("button").innerText(), "Count: 1");
  assert.deepEqual(errors, []);
});
