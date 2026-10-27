import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { editorBridgeFile, startEditorBridge } from "../../meeko/src/framework/editor-bridge.js";
import type { EditorBridge, EditorBridgeHotChannel, EditorBridgeHotClient } from "../../meeko/src/framework/editor-bridge.js";
import { BridgeConnection } from "../src/live/client.js";
import type { LiveChange } from "../src/live/client.js";

type Listener = (data: unknown, client: EditorBridgeHotClient) => void;

/** `meeko dev` mínimo: servidor HTTP en loopback con el puente real y una pestaña de navegador falsa. */
async function devServer(root: string, port = 0) {
  const listeners = new Map<string, Set<Listener>>();
  const hot: EditorBridgeHotChannel = {
    on(event, listener) { (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(listener); },
    off(event, listener) { listeners.get(event)?.delete(listener); },
    send() {},
  };
  const commands: Array<{ request: number; name: string; value: unknown }> = [];
  const tab: EditorBridgeHotClient = {
    send(_event, payload) {
      const message = payload as { type: string; request: number; name: string; value: unknown };
      if (message.type !== "setSignal") return;
      commands.push(message);
      for (const listener of listeners.get("meeko:live:result") ?? []) listener({ request: message.request, result: { ok: true } }, tab);
    },
  };
  const emit = (event: string, data: unknown) => { for (const listener of listeners.get(event) ?? []) listener(data, tab); };
  let bridge: EditorBridge | undefined;
  const server: Server = createServer((request, response) => { if (!bridge?.handle(request, response)) response.end(); });
  server.listen(port, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  bridge = await startEditorBridge({ root, origin: `http://127.0.0.1:${address.port}`, hot });
  const running = bridge;
  return {
    commands, emit, port: address.port, file: running.file,
    async stop() { await running.close(); server.closeAllConnections(); server.close(); await once(server, "close"); },
  };
}

async function until(condition: () => boolean, message: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    if (condition()) return;
    await new Promise((done) => setTimeout(done, 15));
  }
  throw new Error(message);
}

test("la extensión se conecta al puente, recibe valores, edita y reconecta tras reiniciar meeko dev", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "meeko-live-client-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  let dev = await devServer(root);
  const states: boolean[] = [];
  const changes: LiveChange[] = [];
  assert.equal(dev.file, join(root, editorBridgeFile(dev.port)));
  const connection = new BridgeConnection({
    descriptor: dev.file,
    onState: (connected) => states.push(connected),
    onChange: (change) => changes.push(change),
    retryDelays: [20],
  });
  t.after(async () => { connection.dispose(); await dev.stop(); });
  connection.reload();
  await until(() => connection.isConnected, "No se conectó");
  assert.match(connection.url ?? "", /^http:\/\/127\.0\.0\.1:\d+\/__meeko\/editor-bridge$/);

  const signal = { instanceId: "meeko-1", component: "Counter", file: "D:/app/Counter.meeko", name: "count", line: 2, column: 7, json: "1", truncated: false };
  dev.emit("meeko:live:hello", {});
  dev.emit("meeko:live:update", { reset: true, removed: [], signals: [signal] });
  await until(() => connection.signals.get("tab1/meeko-1/count")?.json === "1", "No llegó el valor inicial");
  dev.emit("meeko:live:update", { reset: false, removed: [], signals: [{ ...signal, json: "2" }] });
  await until(() => connection.signals.get("tab1/meeko-1/count")?.json === "2", "No llegó el cambio");
  assert.deepEqual(changes.at(-1), { changed: ["tab1/meeko-1/count"], removed: [], reset: false });

  assert.deepEqual(await connection.setSignal("tab1/meeko-1/count", { n: 3 }), { ok: true });
  assert.deepEqual(dev.commands.map((command) => [command.name, command.value]), [["count", { n: 3 }]]);
  const missing = await connection.setSignal("tab1/meeko-9/count", 1);
  assert.equal(missing.ok, false);

  // meeko dev restarts on the same port: the same descriptor with another token.
  await dev.stop();
  await until(() => !connection.isConnected, "No detectó el cierre");
  assert.equal(connection.signals.size, 0, "Al desconectarse no quedan valores viejos");
  dev = await devServer(root, dev.port);
  connection.reload();
  await until(() => connection.isConnected, "No reconectó al nuevo meeko dev");
  assert.deepEqual(states.slice(0, 3), [true, false, true]);
  assert.deepEqual(await connection.setSignal("tab1/meeko-1/count", 1), { ok: false, error: "Unknown live signal: tab1/meeko-1/count" });
});

test("un descriptor huérfano de un meeko dev cerrado a la fuerza no se reintenta sin fin", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "meeko-live-stale-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { mkdir, writeFile } = await import("node:fs/promises");
  const { spawn } = await import("node:child_process");
  const finished = spawn(process.execPath, ["-e", ""]);
  await once(finished, "exit");
  const port = await new Promise<number>((done) => {
    const probe = createServer();
    probe.listen(0, "127.0.0.1", () => { const address = probe.address(); probe.close(() => done(typeof address === "object" && address ? address.port : 1)); });
  });
  await mkdir(join(root, ".meeko", "dev"), { recursive: true });
  await writeFile(join(root, editorBridgeFile(port)), JSON.stringify({ protocol: 1, url: `http://127.0.0.1:${port}/__meeko/editor-bridge`, token: "t", pid: finished.pid, root, startedAt: "" }));
  const logs: string[] = [];
  const connection = new BridgeConnection({ descriptor: join(root, editorBridgeFile(port)), onState: () => {}, onChange: () => {}, log: (message) => logs.push(message), retryDelays: [10] });
  t.after(() => connection.dispose());
  connection.reload();
  await until(() => logs.some((message) => message.includes("ya no se ejecuta")), `No detectó el proceso cerrado: ${logs.join("\n")}`);
  const attempts = logs.length;
  await new Promise((done) => setTimeout(done, 150));
  assert.equal(logs.length, attempts, "Sin proceso no hay más intentos hasta que cambie el descriptor");
  assert.equal(connection.isConnected, false);
});

test("un descriptor que apunta fuera de loopback no se usa", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "meeko-live-remote-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(root, ".meeko", "dev"), { recursive: true });
  await writeFile(join(root, editorBridgeFile(80)), JSON.stringify({ protocol: 1, url: "http://example.com/__meeko/editor-bridge", token: "t", pid: 1, root, startedAt: "" }));
  const logs: string[] = [];
  const connection = new BridgeConnection({ descriptor: join(root, editorBridgeFile(80)), onState: () => {}, onChange: () => {}, log: (message) => logs.push(message), retryDelays: [20] });
  t.after(() => connection.dispose());
  connection.reload();
  await until(() => logs.length > 0, "No rechazó el descriptor");
  assert.match(logs[0] ?? "", /loopback/);
  assert.equal(connection.isConnected, false);
});
