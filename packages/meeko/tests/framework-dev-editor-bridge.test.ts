import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import test from "node:test";
import type { EditorBridgeDescriptor, EditorBridgeEvent, LiveServerMessage } from "../src/devtools-bridge-protocol.ts";
import { editorBridgeFile } from "../src/framework/editor-bridge.ts";
import { initFrameworkProject } from "../src/framework/init.ts";
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

async function until(condition: () => boolean | Promise<boolean>, message: () => string, timeout = 15_000): Promise<void> {
  const start = Date.now();
  while (!(await condition())) {
    if (Date.now() - start > timeout) throw new Error(message());
    await new Promise((done) => setTimeout(done, 25));
  }
}

/** Lector SSE del puente, como el de la extensión. */
function openEvents(url: string, token: string) {
  const events: EditorBridgeEvent[] = [];
  const abort = new AbortController();
  let open = true;
  void (async () => {
    try {
      const response = await fetch(`${url}/events`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal });
      assert.equal(response.status, 200);
      const decoder = new TextDecoder();
      let buffer = "";
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        buffer += decoder.decode(chunk, { stream: true });
        let end: number;
        while ((end = buffer.indexOf("\n\n")) >= 0) {
          const frame = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          const data = frame.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
          if (data) events.push(JSON.parse(data) as EditorBridgeEvent);
        }
      }
    } catch {
      // Aborted at the end of the test or the server stopped.
    } finally {
      open = false;
    }
  })();
  return { events, get open() { return open; }, close() { abort.abort(); } };
}

/** Pestaña mínima: un cliente WebSocket de HMR de Vite que habla el protocolo `meeko:live`. */
async function openTab(url: string) {
  const socket = new WebSocket(url, "vite-hmr");
  const received: LiveServerMessage[] = [];
  let closed = false;
  socket.addEventListener("message", (event) => {
    const payload = JSON.parse(String(event.data)) as { type: string; event?: string; data?: unknown };
    if (payload.type === "custom" && payload.event === "meeko:live") received.push(payload.data as LiveServerMessage);
  });
  socket.addEventListener("close", () => { closed = true; });
  await new Promise<void>((done, fail) => {
    socket.addEventListener("open", () => done(), { once: true });
    socket.addEventListener("error", () => fail(new Error(`HMR WebSocket unavailable: ${url}`)), { once: true });
  });
  return {
    received,
    get closed() { return closed; },
    send(event: string, data: unknown) { socket.send(JSON.stringify({ type: "custom", event, data })); },
    close() { socket.close(); },
  };
}

// Vite replaces its HMR WebSocket server when it restarts (a changed `.env`,
// `server.restart()`): the bridge must follow the new one with the same session.
test("meeko dev keeps the editor bridge working after Vite restarts", { timeout: 60_000 }, async (context) => {
  let child: ChildProcess | undefined;
  const tabs: Array<{ close(): void }> = [];
  let editor: ReturnType<typeof openEvents> | undefined;
  const root = await tempProject(context, "dev-editor-bridge", async () => {
    editor?.close();
    for (const tab of tabs) tab.close();
    await stopChild(child);
  });
  const repository = repositoryRoot;
  await initFrameworkProject(root);
  await writeFile(join(root, ".env"), "MEEKO_TEST_RESTART=1\n");
  await mkdir(join(root, "node_modules", "@meekojs"), { recursive: true });
  await symlink(repository, join(root, "node_modules", "@meekojs", "meeko"), "junction");
  await symlink(join(repository, "node_modules", "vite"), join(root, "node_modules", "vite"), "junction");
  const port = await freePort();
  const hmrPort = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  const running = spawn(process.execPath, [join(repository, "dist", "cli.js"), "dev", root], {
    cwd: root, env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmrPort) }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
  });
  child = running;
  let logs = "";
  running.stdout?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  running.stderr?.on("data", (chunk: Buffer) => { logs += chunk.toString(); });
  await until(() => logs.includes(origin) || running.exitCode !== null, () => `meeko dev did not listen: ${logs}`, 30_000);
  assert.equal(running.exitCode, null, logs);

  const descriptorFile = join(root, editorBridgeFile(port));
  const before = await readFile(descriptorFile, "utf8");
  const descriptor = JSON.parse(before) as EditorBridgeDescriptor;
  // No page reads the token: Vite does not serve the descriptor and the bridge rejects browser requests.
  for (const path of [`/.meeko/dev/editor-bridge-${port}.json?import`, `/.meeko/dev/editor-bridge-${port}.json?raw`, `/@fs/${join(root, editorBridgeFile(port)).replaceAll("\\", "/").replace(/^\//, "")}?import`]) {
    const response = await fetch(`${origin}${path}`);
    const body = await response.text();
    assert.ok([403, 404].includes(response.status), `${path} answered ${response.status}`);
    assert.doesNotMatch(body, new RegExp(descriptor.token), path);
  }
  const fromPage = await fetch(`${descriptor.url}/events`, { headers: { authorization: `Bearer ${descriptor.token}`, origin: "http://localhost:5173" } });
  await fromPage.body?.cancel();
  assert.equal(fromPage.status, 403);
  // The page's Vite client connects with the token it embeds.
  const client = await (await fetch(`${origin}/@vite/client`)).text();
  const wsToken = /const wsToken = "([^"]*)"/.exec(client)?.[1] ?? "";
  const hmrUrl = `ws://127.0.0.1:${hmrPort}/?token=${encodeURIComponent(wsToken)}`;

  editor = openEvents(descriptor.url, descriptor.token);
  const events = editor.events;
  await until(() => events.some((event) => event.type === "snapshot"), () => `No snapshot: ${JSON.stringify(events)} ${logs}`);
  const signal = (json: string) => ({ instanceId: "meeko-1", component: "Counter", file: "/app/Counter.meeko", name: "count", json, truncated: false });
  const updated = (json: string) => () => events.some((event) => event.type === "update" && event.signals.some((item) => item.name === "count" && item.json === json));

  const first = await openTab(hmrUrl);
  tabs.push(first);
  first.send("meeko:live:hello", {});
  await until(() => first.received.some((message) => message.type === "state" && message.active), () => `The tab was not activated: ${logs}`);
  first.send("meeko:live:update", { reset: true, removed: [], signals: [signal("1")] });
  await until(updated("1"), () => `The first value did not reach the editor: ${JSON.stringify(events)} ${logs}`);

  // A changed `.env` restarts Vite, which closes its HMR clients and opens a new WebSocket server.
  await writeFile(join(root, ".env"), "MEEKO_TEST_RESTART=2\n");
  await until(() => first.closed, () => `Vite did not restart: ${logs}`, 20_000);
  await until(() => events.some((event) => event.type === "update" && event.removed.some((id) => id.endsWith("/meeko-1/count"))),
    () => `The closed tab kept its values: ${JSON.stringify(events)}`);

  // The reloaded page reaches the new server: it must be activated and its values published.
  let second: Awaited<ReturnType<typeof openTab>> | undefined;
  await until(async () => {
    try { second = await openTab(hmrUrl); return true; } catch { return false; }
  }, () => `The new HMR server did not listen: ${logs}`, 20_000);
  const tab = second!;
  tabs.push(tab);
  tab.send("meeko:live:hello", {});
  await until(() => tab.received.some((message) => message.type === "state" && message.active),
    () => `The bridge ignored the tab after the restart: ${JSON.stringify(tab.received)} ${logs}`, 5000);
  tab.send("meeko:live:update", { reset: true, removed: [], signals: [signal("2")] });
  await until(updated("2"), () => `The value after the restart did not reach the editor: ${JSON.stringify(events)}`);

  // Commands from the editor reach the tab on the new server.
  const current = events.find((event) => event.type === "update" && event.signals.some((item) => item.json === "2"));
  const id = current?.type === "update" ? current.signals[0]!.id : "";
  const command = fetch(`${descriptor.url}/command`, {
    method: "POST", headers: { authorization: `Bearer ${descriptor.token}` }, body: JSON.stringify({ type: "setSignal", id, value: 3 }),
  });
  await until(() => tab.received.some((message) => message.type === "setSignal"), () => `The command did not reach the tab: ${JSON.stringify(tab.received)}`, 5000);
  const forwarded = tab.received.find((message) => message.type === "setSignal");
  assert.ok(forwarded?.type === "setSignal");
  assert.equal(forwarded.value, 3);
  tab.send("meeko:live:result", { request: forwarded.request, result: { ok: true } });
  const answer = await command;
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), { ok: true });

  // Same session: the editor stayed connected and the descriptor and token did not change.
  assert.equal(editor.open, true, "The editor stream survives the restart");
  assert.equal(events.filter((event) => event.type === "hello").length, 1);
  assert.equal(await readFile(descriptorFile, "utf8"), before);
});
