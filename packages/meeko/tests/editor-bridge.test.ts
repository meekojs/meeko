import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter, once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createServer, request as httpRequest } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Window } from "happy-dom";
import type { EditorBridgeDescriptor, EditorBridgeEvent, LiveServerMessage } from "../src/devtools-bridge-protocol.ts";
import { connectLiveBridge, disconnectLiveBridge } from "../src/devtools-live.ts";
import type { LiveHotContext } from "../src/devtools-live.ts";
import { registerDevtoolsInstance } from "../src/devtools.ts";
import {
  editorBridgeDirectory, editorBridgeFile, editorBridgeFilePattern, editorBridgeHost, editorBridgePath, startEditorBridge,
} from "../src/framework/editor-bridge.ts";
import type { EditorBridge, EditorBridgeHotChannel, EditorBridgeHotClient, EditorBridgeOptions } from "../src/framework/editor-bridge.ts";
import { signal } from "../src/reactivity.ts";
import { meeko } from "../src/vite.ts";

type Listener = (data: unknown, client: EditorBridgeHotClient) => void;

/** Canal HMR falso con pestañas del navegador como clientes WebSocket falsos. */
function fakeHot() {
  const listeners = new Map<string, Set<Listener>>();
  const broadcasts: LiveServerMessage[] = [];
  const channel: EditorBridgeHotChannel = {
    on(event, listener) { (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(listener); },
    off(event, listener) { listeners.get(event)?.delete(listener); },
    send(event, payload) { if (event === "meeko:live") broadcasts.push(payload as LiveServerMessage); },
  };
  const tab = () => {
    const socket = new EventEmitter();
    const received: LiveServerMessage[] = [];
    const client: EditorBridgeHotClient = {
      socket: { once: (event, listener) => socket.once(event, listener) },
      send(event, payload) { if (event === "meeko:live") received.push(payload as LiveServerMessage); },
    };
    return {
      received,
      emit(event: string, data: unknown) { for (const listener of listeners.get(event) ?? []) listener(data, client); },
      close() { socket.emit("close"); },
    };
  };
  return { channel, broadcasts, tab, listenerCount: () => [...listeners.values()].reduce((total, set) => total + set.size, 0) };
}

/**
 * Canal HMR que une el puente con el runtime real del navegador (`devtools-live`): cada
 * mensaje llega en otra vuelta del bucle de eventos, como por el WebSocket de Vite.
 */
function linkedHot() {
  const listeners = new Map<string, Set<Listener>>();
  const pages = new Set<(message: unknown) => void>();
  const channel: EditorBridgeHotChannel = {
    on(event, listener) { (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(listener); },
    off(event, listener) { listeners.get(event)?.delete(listener); },
    send(event, payload) { if (event === "meeko:live") setImmediate(() => { for (const deliver of pages) deliver(payload); }); },
  };
  /** Una carga de la pestaña: su socket HMR y el `import.meta.hot` de un módulo `.meeko`. */
  const page = () => {
    const socket = new EventEmitter();
    const own: Array<(data: unknown) => void> = [];
    const deliver = (message: unknown): void => { for (const listener of [...own]) listener(message); };
    const client: EditorBridgeHotClient = {
      socket: { once: (event, listener) => socket.once(event, listener) },
      send(event, payload) { if (event === "meeko:live") setImmediate(() => deliver(payload)); },
    };
    const hot: LiveHotContext = {
      send(event, data) { setImmediate(() => { for (const listener of listeners.get(event) ?? []) listener(data, client); }); },
      on(event, listener) { if (event === "meeko:live") own.push(listener); },
    };
    pages.add(deliver);
    return { hot, close() { pages.delete(deliver); socket.emit("close"); } };
  };
  return { channel, page };
}

/** Instala `window` y `Node` de happy-dom mientras corre `run`. */
async function withBrowser<T>(run: (window: Window) => Promise<T>): Promise<T> {
  const browser = new Window();
  const names = ["window", "Node"] as const;
  const previous = names.map((name) => ({ name, value: Reflect.get(globalThis, name), present: Reflect.has(globalThis, name) }));
  Reflect.set(globalThis, "window", browser);
  Reflect.set(globalThis, "Node", browser.Node);
  try {
    return await run(browser);
  } finally {
    disconnectLiveBridge();
    for (const item of previous) {
      if (item.present) Reflect.set(globalThis, item.name, item.value);
      else Reflect.deleteProperty(globalThis, item.name);
    }
    browser.happyDOM.abort();
  }
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** Registra en DevTools una instancia `Counter` con la señal `count`, como un componente hidratado. */
function mountCounter(browser: Window, count: ReturnType<typeof signal<number>>): () => void {
  return registerDevtoolsInstance({
    componentId: "c", name: "Counter", file: "/app/Counter.meeko", scope: { root: browser.document.createElement("div") as unknown as Element },
    props: {}, bindings: { count }, sites: { count: { line: 2, column: 7 } },
  });
}

async function listen(handler:(request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

/** Lector SSE mínimo, como el de la extensión. */
function openEvents(url: string, headers: Record<string, string>) {
  const events: EditorBridgeEvent[] = [];
  const waiters: Array<() => void> = [];
  let status = 0;
  const request = httpRequest(`${url}/events`, { headers }, (response) => {
    status = response.statusCode ?? 0;
    response.setEncoding("utf8");
    let buffer = "";
    response.on("data", (chunk: string) => {
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf("\n\n")) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const data = frame.split("\n").filter((line) => line.startsWith("data: ")).map((line) => line.slice(6)).join("\n");
        if (data) events.push(JSON.parse(data) as EditorBridgeEvent);
        for (const waiter of waiters.splice(0)) waiter();
      }
    });
    response.on("end", () => { for (const waiter of waiters.splice(0)) waiter(); });
  });
  request.end();
  return {
    events,
    get status() { return status; },
    close() { request.destroy(); },
    async next(predicate: (event: EditorBridgeEvent) => boolean): Promise<EditorBridgeEvent> {
      const deadline = Date.now() + 3000;
      for (;;) {
        const found = events.find(predicate);
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`Evento no recibido: ${JSON.stringify(events)}`);
        await new Promise<void>((done) => { waiters.push(done); setTimeout(done, 50); });
      }
    },
  };
}

async function setup(t: test.TestContext, options: { channel?: EditorBridgeOptions["hot"]; root?: string; snapshotWaitMs?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), "meeko-editor-bridge-"));
  const hot = fakeHot();
  let bridge: EditorBridge | undefined;
  const { server, origin } = await listen((request, response) => {
    if (bridge?.handle(request, response)) return;
    response.statusCode = 404;
    response.end("app");
  });
  bridge = await startEditorBridge({ root: options.root ?? root, origin, hot: options.channel ?? hot.channel, commandTimeoutMs: 300, ...(options.snapshotWaitMs === undefined ? {} : { snapshotWaitMs: options.snapshotWaitMs }) });
  t.after(async () => {
    await bridge.close();
    server.closeAllConnections();
    server.close();
    await rm(root, { recursive: true, force: true });
  });
  const descriptor = JSON.parse(await readFile(join(options.root ?? root, editorBridgeFile(new URL(origin).port)), "utf8")) as EditorBridgeDescriptor;
  return { root: options.root ?? root, hot, bridge, origin, descriptor, auth: { authorization: `Bearer ${descriptor.token}` } };
}

test("el puente escribe la URL y el token de la sesión y exige loopback, origen local y token", async (t) => {
  const { origin, descriptor, bridge, root } = await setup(t);
  assert.equal(descriptor.protocol, 1);
  assert.equal(descriptor.url, `${origin}${editorBridgePath}`);
  assert.equal(descriptor.root, root);
  assert.match(descriptor.token, /^[\w-]{43}$/);
  assert.equal(bridge.file, join(root, editorBridgeFile(new URL(origin).port)));

  const fetchStatus = async (path: string, headers: Record<string, string> = {}, method = "GET") => {
    const response = await fetch(`${descriptor.url}${path}`, { method, headers });
    await response.body?.cancel();
    return response.status;
  };
  assert.equal(await fetchStatus("/events"), 401, "Sin token");
  assert.equal(await fetchStatus("/events", { authorization: "Bearer wrong" }), 401, "Token incorrecto");
  assert.equal(await fetchStatus("/events", { authorization: descriptor.token }), 401, "Sin esquema Bearer");
  assert.equal(await fetchStatus("/command", { authorization: `Bearer ${descriptor.token}`, origin: "https://evil.example" }, "POST"), 403, "Origen web ajeno");
  assert.equal(await fetchStatus("/command", { authorization: `Bearer ${descriptor.token}`, origin: "null" }, "POST"), 403, "Origen opaco");
  // Any page in the browser sends `Origin`, also one served on another localhost port.
  assert.equal(await fetchStatus("/events", { authorization: `Bearer ${descriptor.token}`, origin: "http://localhost:5173" }), 403, "Página en loopback");
  assert.equal(await fetchStatus("/command", { authorization: `Bearer ${descriptor.token}`, origin }, "POST"), 403, "Página del propio servidor");
  // fetch cannot override Host; a page served from a rebound DNS name sends its own.
  const rebound = await new Promise<number>((done, fail) => {
    httpRequest(`${descriptor.url}/events`, { headers: { authorization: `Bearer ${descriptor.token}`, host: "evil.example:80" } }, (response) => {
      response.resume();
      done(response.statusCode ?? 0);
    }).on("error", fail).end();
  });
  assert.equal(rebound, 403, "DNS rebinding");
  assert.equal(await fetchStatus("/command", { authorization: `Bearer ${descriptor.token}` }), 405);
  assert.equal(await fetchStatus("/other", { authorization: `Bearer ${descriptor.token}` }), 404);
  assert.equal((await fetch(`${origin}/app`)).status, 404, "Las demás rutas siguen en la aplicación");

  // A request from another machine never reaches the handlers, even with the token.
  let status = 0;
  const remote = {
    url: `${editorBridgePath}/events`, method: "GET",
    headers: { host: "127.0.0.1", authorization: `Bearer ${descriptor.token}` },
    socket: { remoteAddress: "192.168.1.20" },
  } as unknown as IncomingMessage;
  const response = { writeHead(code: number) { status = code; return this; }, end() { return this; } } as unknown as ServerResponse;
  assert.equal(bridge.handle(remote, response), true);
  assert.equal(status, 403);
  const ipv4Mapped = { ...remote, socket: { remoteAddress: "::ffff:10.0.0.2" } } as unknown as IncomingMessage;
  bridge.handle(ipv4Mapped, response);
  assert.equal(status, 403);
});

test("el puente sólo activa el navegador con editores, publica valores y reenvía setSignal", async (t) => {
  const { hot, descriptor, auth } = await setup(t);
  const browser = hot.tab();
  browser.emit("meeko:live:hello", {});
  assert.deepEqual(browser.received.map((message) => message.type === "state" && message.active), [false], "Sin editores el navegador queda en silencio");
  browser.emit("meeko:live:update", { reset: true, removed: [], signals: [{ instanceId: "meeko-1", component: "C", file: "/a.meeko", name: "count", json: "1", truncated: false }] });

  const editor = openEvents(descriptor.url, auth);
  t.after(() => editor.close());
  const hello = await editor.next((event) => event.type === "hello");
  assert.equal(hello.type === "hello" && hello.protocol, 1);
  const snapshot = await editor.next((event) => event.type === "snapshot");
  assert.deepEqual(snapshot.type === "snapshot" && snapshot.signals, [], "Lo enviado sin editores se descarta");
  assert.equal(editor.status, 200);
  assert.deepEqual(hot.broadcasts.map((message) => message.type === "state" && message.active), [true]);

  browser.emit("meeko:live:update", {
    reset: true, removed: [],
    signals: [
      { instanceId: "meeko-1", component: "Counter", file: "D:/app/Counter.meeko", name: "count", line: 2, column: 7, json: "3", truncated: false },
      { instanceId: "meeko-1", component: "Counter", file: "D:/app/Counter.meeko", name: "huge", line: 0, column: 1, json: "x".repeat(5000), truncated: false },
      { instanceId: 4, name: "bad" },
    ],
  });
  const update = await editor.next((event) => event.type === "update");
  assert.equal(update.type, "update");
  if (update.type !== "update") return;
  const count = update.signals.find((signal) => signal.name === "count");
  assert.deepEqual(count, { id: "tab1/meeko-1/count", tab: "tab1", instanceId: "meeko-1", component: "Counter", name: "count", file: "D:/app/Counter.meeko", line: 2, column: 7, json: "3", truncated: false });
  const huge = update.signals.find((signal) => signal.name === "huge");
  assert.equal(huge?.truncated, true);
  assert.equal(huge?.json.length, 4096);
  assert.equal(huge?.line, undefined, "Una línea inválida no se publica");
  assert.equal(update.signals.length, 2, "Las señales mal formadas se descartan");

  const command = fetch(`${descriptor.url}/command`, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: JSON.stringify({ type: "setSignal", id: "tab1/meeko-1/count", value: { n: 5 } }) });
  for (let attempt = 0; attempt < 50 && !browser.received.some((message) => message.type === "setSignal"); attempt++) await new Promise((done) => setTimeout(done, 10));
  const forwarded = browser.received.find((message) => message.type === "setSignal");
  assert.ok(forwarded && forwarded.type === "setSignal");
  assert.deepEqual({ instanceId: forwarded.instanceId, name: forwarded.name, value: forwarded.value }, { instanceId: "meeko-1", name: "count", value: { n: 5 } });
  const other = hot.tab();
  other.emit("meeko:live:result", { request: forwarded.request, result: { ok: false, error: "spoofed" } });
  browser.emit("meeko:live:result", { request: forwarded.request, result: { ok: true } });
  const answer = await command;
  assert.equal(answer.status, 200);
  assert.deepEqual(await answer.json(), { ok: true }, "Sólo la pestaña que recibió la orden puede contestarla");

  const unknown = await fetch(`${descriptor.url}/command`, { method: "POST", headers: auth, body: JSON.stringify({ type: "setSignal", id: "tab9/meeko-1/count", value: 1 }) });
  assert.equal(unknown.status, 404);
  const invalid = await fetch(`${descriptor.url}/command`, { method: "POST", headers: auth, body: "{" });
  assert.equal(invalid.status, 400);
  const silent = await fetch(`${descriptor.url}/command`, { method: "POST", headers: auth, body: JSON.stringify({ type: "setSignal", id: "tab1/meeko-1/count", value: 2 }) });
  assert.equal(silent.status, 409);
  assert.match(((await silent.json()) as { error: string }).error, /did not answer/);

  browser.emit("meeko:live:update", { reset: false, removed: ["meeko-1"], signals: [] });
  const removed = await editor.next((event) => event.type === "update" && event.removed.includes("tab1/meeko-1/count"));
  assert.ok(removed);
  browser.emit("meeko:live:update", { reset: false, removed: [], signals: [{ instanceId: "meeko-2", component: "C", file: "/b.meeko", name: "open", json: "true", truncated: false }] });
  await editor.next((event) => event.type === "update" && event.signals.some((signal) => signal.id === "tab1/meeko-2/open"));
  browser.close();
  await editor.next((event) => event.type === "update" && event.removed.includes("tab1/meeko-2/open"));

  editor.close();
  for (let attempt = 0; attempt < 100 && hot.broadcasts.length < 2; attempt++) await new Promise((done) => setTimeout(done, 10));
  assert.deepEqual(hot.broadcasts.map((message) => message.type === "state" && message.active), [true, false], "Sin editores el navegador deja de enviar");
});

test("dos meeko dev del mismo proyecto publican un descriptor cada uno y el editor llega a la pestaña de cualquiera", async (t) => {
  await withBrowser(async (browser) => {
    const root = await mkdtemp(join(tmpdir(), "meeko-editor-bridge-two-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    // The page is open on the first server; then a second `meeko dev` of the same project starts.
    const link = linkedHot();
    const first = await setup(t, { channel: link.channel, root });
    const count = signal(4);
    const release = mountCounter(browser, count);
    connectLiveBridge(link.page().hot);
    await wait(20);
    const second = await setup(t, { root });
    assert.notEqual(second.descriptor.url, first.descriptor.url);

    // The editor connects to every descriptor of the project, as the VS Code extension does.
    const directory = join(root, editorBridgeDirectory);
    const names = (await readdir(directory)).filter((name) => /^editor-bridge.*\.json$/.test(name)).sort();
    const editors = await Promise.all(names.map(async (name) => {
      const found = JSON.parse(await readFile(join(directory, name), "utf8")) as EditorBridgeDescriptor;
      const editor = openEvents(found.url, { authorization: `Bearer ${found.token}` });
      t.after(() => editor.close());
      return editor;
    }));
    const countIs = (json: string) => (event: EditorBridgeEvent) => (event.type === "snapshot" || event.type === "update") && event.signals.some((item) => item.name === "count" && item.json === json);
    // With a single shared descriptor the editor only finds the second server: `snapshot` [] and nothing else.
    await Promise.any(editors.map((editor) => editor.next(countIs("4"))));
    assert.deepEqual(names, [first.origin, second.origin].map((origin) => `editor-bridge-${new URL(origin).port}.json`).sort(), "Cada servidor conserva su descriptor");
    assert.ok(names.every((name) => editorBridgeFilePattern.test(name)));
    count.value = 5;
    await Promise.any(editors.map((editor) => editor.next(countIs("5"))));

    // Stopping the second server leaves the first one's descriptor and values in place.
    await second.bridge.close();
    assert.equal(existsSync(second.bridge.file), false);
    assert.equal(existsSync(first.bridge.file), true);
    count.value = 6;
    await Promise.any(editors.map((editor) => editor.next(countIs("6"))));
    release();
  });
});

test("el puente sigue publicando cuando el último editor se va y se conecta otro", async (t) => {
  await withBrowser(async (browser) => {
    const link = linkedHot();
    const { descriptor, auth } = await setup(t, { channel: link.channel });
    const count = signal(1);
    let release = mountCounter(browser, count);
    let tab = link.page();
    connectLiveBridge(tab.hot);
    await wait(20);
    const countIs = (type: EditorBridgeEvent["type"], json: string) => (event: EditorBridgeEvent) =>
      event.type === type && "signals" in event && event.signals.some((item) => item.name === "count" && item.json === json);

    // An editor that arrives alone gets the tab's state in its snapshot.
    const a = openEvents(descriptor.url, auth);
    t.after(() => a.close());
    await a.next(countIs("snapshot", "1"));
    count.value = 2;
    await a.next(countIs("update", "2"));
    a.close();
    await wait(50);

    // Nobody listened for a while; the next editor must receive the values again.
    const b = openEvents(descriptor.url, auth);
    t.after(() => b.close());
    await b.next(countIs("snapshot", "2"));
    count.value = 3;
    await b.next(countIs("update", "3"));
    b.close();
    await wait(50);

    // A reloaded tab after the list emptied again reports itself to the new editor.
    const c = openEvents(descriptor.url, auth);
    t.after(() => c.close());
    await c.next(countIs("snapshot", "3"));
    release();
    tab.close();
    disconnectLiveBridge();
    const reloaded = signal(10);
    release = mountCounter(browser, reloaded);
    tab = link.page();
    connectLiveBridge(tab.hot);
    const update = await c.next(countIs("update", "10"));
    const id = update.type === "update" ? update.signals.find((item) => item.name === "count")!.id : "";
    const answer = await fetch(`${descriptor.url}/command`, { method: "POST", headers: auth, body: JSON.stringify({ type: "setSignal", id, value: 11 }) });
    assert.equal(answer.status, 200);
    assert.equal(reloaded.value, 11);
    await c.next(countIs("update", "11"));
    release();
  });
});

test("el puente se engancha al canal HMR nuevo tras reiniciarse Vite, con la misma sesión y los mismos editores", async (t) => {
  const first = fakeHot();
  // `ViteDevServer` keeps its identity across restarts but replaces `ws`.
  const devServer = { ws: first.channel };
  const { descriptor, auth, bridge } = await setup(t, { channel: () => devServer.ws });
  const editor = openEvents(descriptor.url, auth);
  t.after(() => editor.close());
  await editor.next((event) => event.type === "snapshot");
  const old = first.tab();
  old.emit("meeko:live:hello", {});
  old.emit("meeko:live:update", { reset: true, removed: [], signals: [{ instanceId: "meeko-1", component: "C", file: "/a.meeko", name: "count", json: "1", truncated: false }] });
  await editor.next((event) => event.type === "update" && event.signals.some((signal) => signal.id === "tab1/meeko-1/count"));
  const stale = fetch(`${descriptor.url}/command`, { method: "POST", headers: auth, body: JSON.stringify({ type: "setSignal", id: "tab1/meeko-1/count", value: 5 }) });
  for (let attempt = 0; attempt < 50 && !old.received.some((message) => message.type === "setSignal"); attempt++) await wait(10);

  // Restart: the previous server dropped its clients and a new channel replaces it.
  const second = fakeHot();
  devServer.ws = second.channel;
  bridge.refresh();
  assert.equal(first.listenerCount(), 0, "Sin oyentes en el canal anterior");
  assert.equal(second.listenerCount(), 3, "Los oyentes pasan al canal nuevo");
  await editor.next((event) => event.type === "update" && event.removed.includes("tab1/meeko-1/count"));
  assert.equal((await stale).status, 409, "La orden a la pestaña del servidor anterior no se queda colgada");

  // The reloaded page says hello on the new channel and is activated again.
  const reloaded = second.tab();
  reloaded.emit("meeko:live:hello", {});
  assert.deepEqual(reloaded.received.map((message) => message.type === "state" && message.active), [true]);
  reloaded.emit("meeko:live:update", { reset: true, removed: [], signals: [{ instanceId: "meeko-1", component: "C", file: "/a.meeko", name: "count", json: "2", truncated: false }] });
  const update = await editor.next((event) => event.type === "update" && event.signals.some((signal) => signal.json === "2"));
  const id = update.type === "update" ? update.signals[0]!.id : "";
  const command = fetch(`${descriptor.url}/command`, { method: "POST", headers: auth, body: JSON.stringify({ type: "setSignal", id, value: 3 }) });
  for (let attempt = 0; attempt < 50 && !reloaded.received.some((message) => message.type === "setSignal"); attempt++) await wait(10);
  const forwarded = reloaded.received.find((message) => message.type === "setSignal");
  assert.ok(forwarded?.type === "setSignal");
  reloaded.emit("meeko:live:result", { request: forwarded.request, result: { ok: true } });
  assert.equal((await command).status, 200);
  assert.equal(old.received.filter((message) => message.type === "setSignal").length, 1, "Nada llega al canal anterior");

  // Without `refresh`, any use of the bridge reads the current channel.
  const third = fakeHot();
  devServer.ws = third.channel;
  const unknown = await fetch(`${descriptor.url}/command`, { method: "POST", headers: auth, body: JSON.stringify({ type: "setSignal", id, value: 4 }) });
  assert.equal(unknown.status, 404, "Las señales de las pestañas del canal anterior se olvidan");
  assert.equal(second.listenerCount(), 0);
  assert.equal(third.listenerCount(), 3);

  // Same session: one hello, the same descriptor, and closing deactivates the current channel.
  assert.equal(editor.events.filter((event) => event.type === "hello").length, 1);
  const current = JSON.parse(await readFile(bridge.file, "utf8")) as EditorBridgeDescriptor;
  assert.equal(current.token, descriptor.token);
  await bridge.close();
  assert.equal(third.listenerCount(), 0);
  assert.deepEqual(third.broadcasts.map((message) => message.type === "state" && message.active), [false]);
});

test("la instantánea de un editor que llega solo espera el estado de las pestañas, como mucho snapshotWaitMs", async (t) => {
  const { hot, descriptor, auth } = await setup(t, { snapshotWaitMs: 5000 });
  const started = Date.now();
  const alone = openEvents(descriptor.url, auth);
  t.after(() => alone.close());
  await alone.next((event) => event.type === "snapshot");
  assert.ok(Date.now() - started < 2000, "Sin pestañas la instantánea sale enseguida");
  alone.close();
  for (let attempt = 0; attempt < 100 && hot.broadcasts.length < 2; attempt++) await wait(10);

  const browser = hot.tab();
  browser.emit("meeko:live:hello", {});
  const editor = openEvents(descriptor.url, auth);
  t.after(() => editor.close());
  for (let attempt = 0; attempt < 100 && hot.broadcasts.length < 3; attempt++) await wait(10);
  await wait(50);
  assert.deepEqual(editor.events.map((event) => event.type), ["hello"], "La instantánea espera a la pestaña");
  browser.emit("meeko:live:update", { reset: true, removed: [], signals: [{ instanceId: "meeko-1", component: "C", file: "/a.meeko", name: "count", json: "7", truncated: false }] });
  const snapshot = await editor.next((event) => event.type === "snapshot");
  assert.deepEqual(snapshot.type === "snapshot" && snapshot.signals.map((signal) => [signal.id, signal.json]), [["tab1/meeko-1/count", "7"]]);
  assert.deepEqual(editor.events.map((event) => event.type), ["hello", "snapshot"], "Lo que llegó durante la espera va en la instantánea, no en un update");
  browser.emit("meeko:live:update", { reset: false, removed: [], signals: [{ instanceId: "meeko-1", component: "C", file: "/a.meeko", name: "count", json: "8", truncated: false }] });
  await editor.next((event) => event.type === "update");

  // A tab that never answers delays the snapshot only up to the limit.
  const quiet = fakeHot();
  const other = await setup(t, { channel: quiet.channel, snapshotWaitMs: 150 });
  quiet.tab().emit("meeko:live:hello", {});
  const begin = Date.now();
  const late = openEvents(other.descriptor.url, other.auth);
  t.after(() => late.close());
  const empty = await late.next((event) => event.type === "snapshot");
  assert.ok(Date.now() - begin >= 140, "Espera a la pestaña conocida");
  assert.deepEqual(empty.type === "snapshot" && empty.signals, []);
});

test("el puente publica los alias de defineModel con el ID de su señal principal", async (t) => {
  const { hot, descriptor, auth } = await setup(t);
  const editor = openEvents(descriptor.url, auth);
  t.after(() => editor.close());
  await editor.next((event) => event.type === "snapshot");
  const browser = hot.tab();
  const principal = { instanceId: "meeko-5", component: "lab", file: "D:/app/pages/lab.meeko", name: "dialogOpen", line: 24, column: 8, json: "false", truncated: false };
  browser.emit("meeko:live:update", {
    reset: true, removed: [],
    signals: [
      principal,
      { instanceId: "meeko-4", component: "Modal", file: "D:/app/Modal.meeko", name: "open", line: 13, column: 8, json: "false", truncated: false, alias: { instanceId: "meeko-5", component: "lab", file: principal.file, name: "dialogOpen", line: 24, column: 8 } },
      { instanceId: "meeko-3", component: "Overlay", file: "D:/app/Overlay.meeko", name: "open", json: "false", truncated: false, alias: { instanceId: "meeko-5", component: "lab", file: principal.file, name: "dialogOpen", line: -1, column: 8 } },
      { instanceId: "meeko-2", component: "Self", file: "/s.meeko", name: "x", json: "1", truncated: false, alias: { instanceId: "meeko-2", component: "Self", file: "/s.meeko", name: "x" } },
      { instanceId: "meeko-1", component: "Bad", file: "/b.meeko", name: "y", json: "1", truncated: false, alias: { instanceId: 5, name: "y" } },
    ],
  });
  const update = await editor.next((event) => event.type === "update");
  assert.ok(update.type === "update");
  const byId = new Map(update.signals.map((signal) => [signal.id, signal]));
  assert.equal(byId.get("tab1/meeko-5/dialogOpen")?.alias, undefined, "La principal no es alias");
  assert.deepEqual(byId.get("tab1/meeko-4/open")?.alias, { id: "tab1/meeko-5/dialogOpen", instanceId: "meeko-5", component: "lab", name: "dialogOpen", file: principal.file, line: 24, column: 8 });
  assert.deepEqual(byId.get("tab1/meeko-3/open")?.alias, { id: "tab1/meeko-5/dialogOpen", instanceId: "meeko-5", component: "lab", name: "dialogOpen", file: principal.file }, "Una posición inválida no se publica");
  assert.equal(byId.get("tab1/meeko-2/x")?.alias, undefined, "Una señal no es alias de sí misma");
  assert.equal(byId.get("tab1/meeko-1/y")?.alias, undefined, "Un alias mal formado se descarta");
  assert.equal(byId.get("tab1/meeko-1/y")?.json, "1", "La señal se publica igualmente");
});

test("cerrar el puente termina los flujos, desactiva el navegador y borra sólo su descriptor", async (t) => {
  const { hot, descriptor, auth, bridge, root } = await setup(t);
  const editor = openEvents(descriptor.url, auth);
  await editor.next((event) => event.type === "snapshot");
  await bridge.close();
  assert.equal(existsSync(bridge.file), false);
  assert.equal(hot.listenerCount(), 0);
  assert.deepEqual(hot.broadcasts.map((message) => message.type === "state" && message.active), [true, false]);
  const closed = await fetch(`${descriptor.url}/events`, { headers: auth });
  assert.equal(closed.status, 503);

  // Each session of the same project has its own descriptor; stopping one keeps the other.
  const { channel } = fakeHot();
  const first = await startEditorBridge({ root, origin: "http://127.0.0.1:1", hot: channel });
  const second = await startEditorBridge({ root, origin: "http://127.0.0.1:2", hot: channel });
  assert.equal(first.file, join(root, editorBridgeFile(1)));
  assert.equal(second.file, join(root, editorBridgeFile(2)));
  await first.close();
  assert.equal(existsSync(first.file), false);
  const current = JSON.parse(await readFile(second.file, "utf8")) as EditorBridgeDescriptor;
  assert.equal(current.url, `http://127.0.0.1:2${editorBridgePath}`);
  await second.close();
  assert.equal(existsSync(second.file), false);

  // A descriptor of a process that no longer runs is removed when another session starts.
  const finished = spawn(process.execPath, ["-e", ""]);
  await once(finished, "exit");
  const stale = join(root, editorBridgeFile(3));
  const legacy = join(root, editorBridgeDirectory, "editor-bridge.json");
  const alive = join(root, editorBridgeFile(4));
  const write = (file: string, pid: number | undefined) => writeFile(file, JSON.stringify({ protocol: 1, url: "http://127.0.0.1:3/__meeko/editor-bridge", token: "t", pid, root, startedAt: "" }));
  await write(stale, finished.pid);
  await write(legacy, finished.pid);
  await write(alive, process.pid);
  const third = await startEditorBridge({ root, origin: "http://127.0.0.1:6", hot: channel });
  assert.equal(existsSync(stale), false, "El descriptor de un proceso terminado se borra");
  assert.equal(existsSync(legacy), false, "También el único descriptor de versiones de desarrollo anteriores");
  assert.equal(existsSync(alive), true, "El de un proceso vivo se conserva");
  await third.close();
});

test("el puente sólo se publica en loopback", async () => {
  assert.equal(editorBridgeHost("127.0.0.1"), "127.0.0.1");
  assert.equal(editorBridgeHost("0.0.0.0"), "127.0.0.1");
  assert.equal(editorBridgeHost("::"), "127.0.0.1");
  assert.equal(editorBridgeHost("::1"), "[::1]");
  assert.equal(editorBridgeHost("192.168.1.5"), undefined);
  assert.equal(editorBridgeHost("::ffff:10.0.0.1"), undefined);
  const { channel } = fakeHot();
  await assert.rejects(startEditorBridge({ root: tmpdir(), origin: "http://192.168.1.5:4173", hot: channel }), /loopback/);
});

test("el plugin de Vite conecta el puente sólo en módulos .meeko servidos en desarrollo", async () => {
  const filename = join(process.cwd(), "examples", "counter", "Counter.meeko");
  const source = await readFile(filename, "utf8");
  const transform = async (command: "serve" | "build"): Promise<string> => {
    const plugin = meeko() as unknown as {
      configResolved(config: { root: string; command: "serve" | "build"; build: { ssr: false } }): void;
      transform(this: unknown, source: string, id: string, options?: { ssr?: boolean }): Promise<{ code: string } | null>;
    };
    plugin.configResolved({ root: join(process.cwd(), "examples", "counter"), command, build: { ssr: false } });
    return (await plugin.transform.call({ resolve: async () => null }, source, filename))?.code ?? "";
  };
  assert.match(await transform("serve"), /if \(import\.meta\.hot\) \{[^}]*__meeko\.connectLiveBridge\(import\.meta\.hot\)/);
  assert.doesNotMatch(await transform("build"), /connectLiveBridge|registerDevtoolsInstance/);
});
