import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import { chromium } from "playwright-core";
import type { EditorBridgeDescriptor } from "../src/devtools-bridge-protocol.ts";
import { editorBridgeFile } from "../src/framework/editor-bridge.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
import { BridgeConnection } from "../editors/vscode/src/live/client.ts";
import { createTempProject, linkRepositoryPackages, repositoryRoot } from "./helpers/temp-project.ts";

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

async function until(condition: () => boolean | Promise<boolean>, message: () => string, timeout = 15_000): Promise<void> {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeout) throw new Error(message());
    await new Promise((done) => setTimeout(done, 50));
  }
}

const livePage = `<script lang="ts">
export interface Props {
  params: Record<string, string>;
  search: Record<string, string | string[]>;
  data?: unknown;
}

const count = signal(0);
const profile = signal({ name: "Ada", tags: ["a", "b"] });
</script>

<template>
  <button id="count" type="button" on:click="() => count.value++">{count.value}</button>
  <p id="name">{profile.value.name}</p>
</template>
`;

// meeko dev, a real browser and the editor's client: values reach the editor,
// clicks update them and an editor command changes the page.
test("meeko dev publishes live signal values to the editor and applies its edits", { timeout: 90_000 }, async (context) => {
  // Outside the repository: an editor with the Meeko extension watching a workspace that
  // contains or links this checkout would discover the descriptor and connect as an editor.
  const project = await createTempProject("editor-bridge");
  const root = project.root;
  const repository = repositoryRoot;
  await initFrameworkProject(root);
  await writeFile(join(root, "app", "pages", "live.meeko"), livePage);
  await linkRepositoryPackages(root, ["@meekojs/meeko", "vite"]);
  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const child = spawn(process.execPath, [join(repository, "dist", "cli.js"), "dev", root], {
    cwd: root, env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(await freePort()) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  let logs = "";
  child.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  child.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  const browser = await chromium.launch({
    ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: "chrome" as const }),
    headless: true,
  });
  let connection: BridgeConnection | undefined;
  context.after(async () => {
    connection?.dispose();
    await browser.close();
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill("SIGINT"); await exited; }
    await project.remove();
  });
  await until(() => logs.includes(origin) || child.exitCode !== null, () => `meeko dev did not listen: ${logs}`, 30_000);
  assert.equal(child.exitCode, null, logs);

  const descriptorFile = join(root, editorBridgeFile(port));
  assert.ok(existsSync(descriptorFile), "meeko dev writes the editor bridge descriptor");
  const descriptor = JSON.parse(await readFile(descriptorFile, "utf8")) as EditorBridgeDescriptor;
  assert.equal(descriptor.url, `${origin}/__meeko/editor-bridge`);
  assert.equal((await fetch(`${descriptor.url}/events`)).status, 401, "The endpoint requires the session token");

  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const sent: string[] = [];
  page.on("websocket", (socket) => socket.on("framesent", (frame) => { if (typeof frame.payload === "string" && frame.payload.includes("meeko:live:update")) sent.push(frame.payload); }));
  await page.goto(`${origin}/live`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => Boolean(window.__MEEKO_DEVTOOLS__?.snapshot().instances.some((instance) => instance.name === "live")));
  await page.locator("#count").click();
  await new Promise((done) => setTimeout(done, 400));
  assert.deepEqual(sent, [], "With no editor connected the browser sends no values");

  let connected = false;
  connection = new BridgeConnection({ descriptor: descriptorFile, onState: (state) => { connected = state; }, onChange: () => {}, retryDelays: [100] });
  connection.reload();
  const live = connection;
  const countSignal = () => [...live.signals.values()].find((signal) => signal.component === "live" && signal.name === "count");
  await until(() => connected && countSignal() !== undefined, () => `No live value reached the editor: ${JSON.stringify([...live.signals.values()])} ${logs}`);
  const count = countSignal()!;
  assert.equal(count.json, "1");
  assert.equal(count.file.toLowerCase(), join(root, "app", "pages", "live.meeko").replaceAll("\\", "/").toLowerCase());
  assert.deepEqual([count.line, count.column], [8, 7], "The value maps to the signal's declaration");
  const profile = [...live.signals.values()].find((signal) => signal.name === "profile");
  assert.deepEqual(JSON.parse(profile?.json ?? "null"), { name: "Ada", tags: ["a", "b"] });

  await page.locator("#count").click();
  await page.locator("#count").click();
  await until(() => countSignal()?.json === "3", () => `The click did not reach the editor: ${countSignal()?.json}`);

  assert.deepEqual(await live.setSignal(count.id, 42), { ok: true });
  assert.equal(await page.locator("#count").innerText(), "42");
  assert.deepEqual(await live.setSignal(profile!.id, { name: "Grace", tags: [] }), { ok: true });
  assert.equal(await page.locator("#name").innerText(), "Grace");
  const rejected = await live.setSignal(count.id, undefined);
  assert.equal(rejected.ok, false, "A command without a JSON value is rejected");

  await page.close();
  await until(() => countSignal() === undefined, () => "Closing the tab must remove its values");
  assert.deepEqual(errors, []);

  child.kill("SIGINT");
  await once(child, "exit");
  await until(() => !connected, () => "The editor must notice that meeko dev stopped");
});
