import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, rmSync } from "node:fs";
import { mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isIP } from "node:net";
import { dirname, join, resolve } from "node:path";
import type {
  EditorBridgeDescriptor, EditorBridgeEvent, EditorCommandResult, EditorLiveAlias, EditorLiveSignal, LiveBrowserResult, LiveServerBody, LiveServerMessage,
} from "../devtools-bridge-protocol.js";
import type { DevtoolsValue } from "../devtools-protocol.js";

/** Directorio, relativo a la raíz del proyecto, donde cada `meeko dev` en marcha publica su descriptor. */
export const editorBridgeDirectory = ".meeko/dev";
/** Nombre de archivo de los descriptores del puente: uno por puerto de `meeko dev`. */
export const editorBridgeFilePattern = /^editor-bridge-\d+\.json$/;

/**
 * Descriptor, relativo a la raíz del proyecto, del `meeko dev` que escucha en `port`, con su URL y
 * el token de la sesión. Cada servidor escribe el suyo: dos `meeko dev` del mismo proyecto no se
 * sustituyen el uno al otro y el editor se conecta a todos.
 */
export function editorBridgeFile(port: number | string): string {
  return `${editorBridgeDirectory}/editor-bridge-${port}.json`;
}

/** Prefijo HTTP del puente en el servidor de desarrollo. */
export const editorBridgePath = "/__meeko/editor-bridge";

const valueLimit = 4096;
const commandBodyLimit = 1024 * 1024;
const maxSignalsPerUpdate = 10_000;

/** `true` si el proceso existe; un error de permisos también indica que existe. */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Borra los descriptores de procesos que ya no existen, p. ej. de un `meeko dev` terminado a la fuerza. */
async function removeStaleDescriptors(directory: string): Promise<void> {
  let names: string[];
  try { names = await readdir(directory); } catch { return; }
  for (const name of names) {
    // `editor-bridge.json` is the single descriptor of earlier development builds.
    if (!editorBridgeFilePattern.test(name) && name !== "editor-bridge.json") continue;
    const path = join(directory, name);
    try {
      const { pid } = JSON.parse(await readFile(path, "utf8")) as Partial<EditorBridgeDescriptor>;
      if (typeof pid === "number" && Number.isInteger(pid) && pid > 0 && !isAlive(pid)) await rm(path, { force: true });
    } catch {
      // Unreadable or removed meanwhile: another process owns it.
    }
  }
}

/** Cliente de HMR que envió un evento; `socket` es el WebSocket de Vite. */
export interface EditorBridgeHotClient {
  send(event: string, payload?: unknown): void;
  readonly socket?: { once(event: "close", listener: () => void): unknown };
}

/** Subconjunto de `ViteDevServer["ws"]` que usa el puente. */
export interface EditorBridgeHotChannel {
  on(event: string, listener: (data: unknown, client: EditorBridgeHotClient) => void): void;
  off(event: string, listener: (data: unknown, client: EditorBridgeHotClient) => void): void;
  send(event: string, payload?: unknown): void;
}

export interface EditorBridgeOptions {
  /** Raíz del proyecto; el descriptor se escribe en `<root>/.meeko/dev/editor-bridge-<puerto>.json`. */
  root: string;
  /** Origen HTTP en loopback donde escucha el servidor de desarrollo, p. ej. `http://127.0.0.1:4173`. */
  origin: string;
  /**
   * Canal de HMR, o una función que devuelve el actual. Vite sustituye `server.ws` al
   * reiniciarse; con la función el puente se vuelve a enganchar al canal nuevo cada vez
   * que lo usa o en {@link EditorBridge.refresh}, con la misma sesión, token y editores.
   */
  hot: EditorBridgeHotChannel | (() => EditorBridgeHotChannel);
  /** Espera máxima de la respuesta del navegador a una orden. */
  commandTimeoutMs?: number;
  /** Intervalo del comentario SSE que mantiene viva la conexión. */
  keepAliveMs?: number;
  /**
   * Espera máxima del estado de las pestañas antes de enviar la instantánea a un editor que
   * llega sin otro conectado; termina antes si todas responden.
   */
  snapshotWaitMs?: number;
}

/** Puente activo de una sesión de `meeko dev`. */
export interface EditorBridge {
  readonly url: string;
  readonly file: string;
  /** Atiende una petición bajo `/__meeko/editor-bridge`; devuelve `false` para cualquier otra ruta. */
  handle(request: IncomingMessage, response: ServerResponse): boolean;
  /**
   * Vuelve a leer el canal de HMR y, si cambió, mueve a él los oyentes y olvida las pestañas
   * del anterior. Debe llamarse antes de que llegue el primer mensaje del canal nuevo, p. ej.
   * en su evento `connection`.
   */
  refresh(): void;
  close(): Promise<void>;
}

interface Tab {
  id: string;
  client: EditorBridgeHotClient;
  signals: Map<string, EditorLiveSignal>;
}

function isLoopbackAddress(address: string | undefined): boolean {
  if (!address) return false;
  const normalized = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  if (isIP(normalized) === 4) return normalized.startsWith("127.");
  return normalized === "::1";
}

function isLoopbackHostname(hostname: string): boolean {
  const bare = hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  return bare.toLowerCase() === "localhost" || isLoopbackAddress(bare);
}

/** Host de una URL de loopback para un servidor que escucha en `address`, o `undefined` si no escucha en loopback. */
export function editorBridgeHost(address: string): string | undefined {
  if (address === "0.0.0.0" || address === "::" || address === "::ffff:0.0.0.0") return "127.0.0.1";
  if (!isLoopbackAddress(address)) return undefined;
  const bare = address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
  return isIP(bare) === 6 ? `[${bare}]` : bare;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function text(value: unknown, limit: number): value is string {
  return typeof value === "string" && value.length <= limit;
}

/** Señal principal de un alias que envió el navegador, con su ID en la pestaña `tab`. */
function aliasOf(value: unknown, tab: string): EditorLiveAlias | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const alias = value as Partial<Record<keyof EditorLiveAlias, unknown>>;
  if (!text(alias.instanceId, 200) || !text(alias.component, 200) || !text(alias.file, 4096) || !text(alias.name, 200)) return undefined;
  return {
    id: `${tab}/${alias.instanceId}/${alias.name}`, instanceId: alias.instanceId, component: alias.component, name: alias.name, file: alias.file,
    ...(positiveInteger(alias.line) && positiveInteger(alias.column) ? { line: alias.line, column: alias.column } : {}),
  };
}

/**
 * Arranca el puente de valores en vivo de `meeko dev`: recibe del navegador, por el WebSocket
 * de HMR, los valores de las señales y los publica por SSE a herramientas locales con el token
 * de la sesión. Sólo debe usarse en desarrollo y con un servidor que escuche en loopback.
 */
export async function startEditorBridge(options: EditorBridgeOptions): Promise<EditorBridge> {
  const origin = new URL(options.origin);
  if (origin.protocol !== "http:" || !isLoopbackHostname(origin.hostname)) {
    throw new Error(`The editor bridge only listens on loopback HTTP, not ${options.origin}`);
  }
  const root = resolve(options.root);
  const file = resolve(root, editorBridgeFile(origin.port || "80"));
  const url = `${origin.origin}${editorBridgePath}`;
  const token = randomBytes(32).toString("base64url");
  const tokenDigest = digest(token);
  const session = randomUUID();
  const commandTimeout = options.commandTimeoutMs ?? 5000;
  const hot = options.hot;
  const currentHot = typeof hot === "function" ? hot : () => hot;
  const editors = new Set<ServerResponse>();
  const tabs = new Map<EditorBridgeHotClient, Tab>();
  const signals = new Map<string, { tab: Tab; signal: EditorLiveSignal }>();
  const pending = new Map<number, { tab: Tab; done: (result: EditorCommandResult) => void }>();
  const snapshotWait = options.snapshotWaitMs ?? 300;
  /** Editores conectados que aún esperan su instantánea; no reciben `update` hasta entonces. */
  const waiting = new Set<ServerResponse>();
  /** Pestañas que aún no enviaron su estado desde que se activaron. */
  let settling: { tabs: Set<Tab>; timer: ReturnType<typeof setTimeout> } | undefined;
  let nextTab = 1;
  let seq = 0;
  let nextRequest = 1;
  let closed = false;

  const message = (body: LiveServerBody): LiveServerMessage => ({ ...body, seq: ++seq, session });

  const emit = (event: EditorBridgeEvent, target?: ServerResponse): void => {
    const frame = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
    if (target) { target.write(frame); return; }
    for (const editor of editors) if (!waiting.has(editor)) editor.write(frame);
  };

  const sendSnapshot = (editor: ServerResponse): void => {
    emit({ type: "snapshot", signals: [...signals.values()].map((entry) => entry.signal) }, editor);
  };

  /** Envía la instantánea a los editores en espera; lo que llegó mientras tanto ya está en ella. */
  const settle = (): void => {
    if (settling) clearTimeout(settling.timer);
    settling = undefined;
    for (const editor of waiting) sendSnapshot(editor);
    waiting.clear();
  };

  /** Tras activar las pestañas, espera su estado completo o `snapshotWait` antes de la instantánea. */
  const startSettling = (): void => {
    if (settling || tabs.size === 0) return;
    const timer = setTimeout(settle, snapshotWait);
    timer.unref();
    settling = { tabs: new Set(tabs.values()), timer };
  };

  const tabReported = (tab: Tab): void => {
    if (settling?.tabs.delete(tab) && settling.tabs.size === 0) settle();
  };

  const forgetTab = (tab: Tab): string[] => {
    const ids = [...tab.signals.keys()];
    for (const id of ids) signals.delete(id);
    tab.signals.clear();
    return ids;
  };

  const dropTab = (client: EditorBridgeHotClient): void => {
    const tab = tabs.get(client);
    if (!tab) return;
    tabs.delete(client);
    const removed = forgetTab(tab);
    if (removed.length && editors.size) emit({ type: "update", signals: [], removed });
    tabReported(tab);
    for (const [request, entry] of pending) {
      if (entry.tab !== tab) continue;
      pending.delete(request);
      entry.done({ ok: false, error: "The browser tab closed before answering" });
    }
  };

  const tabOf = (client: EditorBridgeHotClient): Tab => {
    let tab = tabs.get(client);
    if (!tab) {
      tab = { id: `tab${nextTab++}`, client, signals: new Map() };
      tabs.set(client, tab);
      client.socket?.once("close", () => dropTab(client));
    }
    return tab;
  };

  const broadcastState = (): void => {
    channel().send("meeko:live", message({ type: "state", active: editors.size > 0 }));
  };

  const onHello = (_data: unknown, client: EditorBridgeHotClient): void => {
    if (closed) return;
    tabOf(client);
    client.send("meeko:live", message({ type: "state", active: editors.size > 0 }));
  };

  const onUpdate = (data: unknown, client: EditorBridgeHotClient): void => {
    // With no editor listening the browser must not send; ignore a late update.
    if (closed || editors.size === 0 || typeof data !== "object" || data === null) return;
    const update = data as { reset?: unknown; removed?: unknown; signals?: unknown };
    if (!Array.isArray(update.removed) || !Array.isArray(update.signals) || update.signals.length > maxSignalsPerUpdate) return;
    const tab = tabOf(client);
    const removed = new Set<string>();
    if (update.reset === true) for (const id of forgetTab(tab)) removed.add(id);
    const gone = new Set(update.removed.filter((id): id is string => text(id, 200)));
    if (gone.size) {
      for (const [id, signal] of tab.signals) {
        if (!gone.has(signal.instanceId)) continue;
        tab.signals.delete(id);
        signals.delete(id);
        removed.add(id);
      }
    }
    const changed: EditorLiveSignal[] = [];
    for (const raw of update.signals as unknown[]) {
      if (typeof raw !== "object" || raw === null) continue;
      const item = raw as Partial<Record<keyof EditorLiveSignal, unknown>>;
      if (!text(item.instanceId, 200) || !text(item.component, 200) || !text(item.file, 4096) || !text(item.name, 200) || typeof item.json !== "string") continue;
      const truncated = item.truncated === true || item.json.length > valueLimit;
      const id = `${tab.id}/${item.instanceId}/${item.name}`;
      const alias = aliasOf(item.alias, tab.id);
      const signal: EditorLiveSignal = {
        id, tab: tab.id, instanceId: item.instanceId, component: item.component, name: item.name, file: item.file,
        ...(positiveInteger(item.line) && positiveInteger(item.column) ? { line: item.line, column: item.column } : {}),
        json: item.json.slice(0, valueLimit), truncated,
        ...(alias && alias.id !== id ? { alias } : {}),
      };
      tab.signals.set(id, signal);
      signals.set(id, { tab, signal });
      removed.delete(id);
      changed.push(signal);
    }
    if (changed.length || removed.size) emit({ type: "update", signals: changed, removed: [...removed] });
    if (update.reset === true) tabReported(tab);
  };

  const onResult = (data: unknown, client: EditorBridgeHotClient): void => {
    if (typeof data !== "object" || data === null) return;
    const { request, result } = data as Partial<LiveBrowserResult>;
    if (typeof request !== "number") return;
    const entry = pending.get(request);
    if (!entry || entry.tab.client !== client) return;
    pending.delete(request);
    const valid = typeof result === "object" && result !== null && (result.ok === true || (result.ok === false && typeof result.error === "string"));
    entry.done(valid ? (result.ok ? { ok: true } : { ok: false, error: result.error.slice(0, 2000) }) : { ok: false, error: "The browser sent an invalid result" });
  };

  const listeners = [["meeko:live:hello", onHello], ["meeko:live:update", onUpdate], ["meeko:live:result", onResult]] as const;
  /** Canal en el que están los oyentes del puente. */
  let bound: EditorBridgeHotChannel | undefined;

  /** El canal de HMR actual; si Vite lo sustituyó al reiniciarse, el puente se engancha al nuevo. */
  const channel = (): EditorBridgeHotChannel => {
    const current = currentHot();
    if (current === bound || closed) return current;
    const previous = bound;
    bound = current;
    if (previous) for (const [event, listener] of listeners) previous.off(event, listener);
    for (const [event, listener] of listeners) current.on(event, listener);
    // The previous server closed its clients; their pages reconnect, and report again, on this one.
    if (previous) for (const client of [...tabs.keys()]) dropTab(client);
    return current;
  };
  channel();

  const keepAlive = setInterval(() => {
    for (const editor of editors) editor.write(": ping\n\n");
  }, options.keepAliveMs ?? 15_000);
  keepAlive.unref();

  /** Rechaza peticiones de fuera de loopback, de páginas web (con `Origin`) y sin el token de la sesión. */
  const authorize = (request: IncomingMessage): { status: number; error: string } | undefined => {
    if (!isLoopbackAddress(request.socket.remoteAddress)) return { status: 403, error: "The editor bridge only accepts loopback connections" };
    const host = request.headers.host;
    let hostname: string | undefined;
    try { hostname = host ? new URL(`http://${host}`).hostname : undefined; } catch { hostname = undefined; }
    if (!hostname || !isLoopbackHostname(hostname)) return { status: 403, error: "The editor bridge only accepts loopback hosts" };
    // Editors are local processes and send no `Origin`; a browser page always does, even on localhost.
    if (request.headers.origin !== undefined) return { status: 403, error: "The editor bridge rejects browser requests" };
    const header = request.headers.authorization;
    const presented = header?.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
    if (!presented || !timingSafeEqual(digest(presented), tokenDigest)) return { status: 401, error: "Missing or invalid editor bridge token" };
    return undefined;
  };

  const openEvents = (request: IncomingMessage, response: ServerResponse): void => {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-store",
      connection: "keep-alive", "x-content-type-options": "nosniff",
    });
    response.flushHeaders();
    emit({ type: "hello", protocol: 1, session, root }, response);
    const first = editors.size === 0;
    editors.add(response);
    if (first) {
      // The tabs kept nothing here while nobody listened: wait briefly for their state.
      broadcastState();
      startSettling();
    }
    if (settling) waiting.add(response);
    else sendSnapshot(response);
    const close = (): void => {
      waiting.delete(response);
      if (!editors.delete(response)) return;
      if (editors.size === 0 && !closed) {
        // Nobody listens: the browsers stop sending and the next editor gets a fresh reset.
        if (settling) clearTimeout(settling.timer);
        settling = undefined;
        for (const tab of tabs.values()) forgetTab(tab);
        broadcastState();
      }
    };
    request.once("close", close);
    response.once("close", close);
  };

  const runCommand = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of request as AsyncIterable<Buffer>) {
      size += chunk.length;
      if (size > commandBodyLimit) { json(response, 413, { ok: false, error: "Command body is too large" }); request.resume(); return; }
      chunks.push(chunk);
    }
    let command: unknown;
    try { command = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { json(response, 400, { ok: false, error: "Command body must be JSON" }); return; }
    const { type, id, value } = (typeof command === "object" && command !== null ? command : {}) as { type?: unknown; id?: unknown; value?: unknown };
    if (type !== "setSignal" || typeof id !== "string" || value === undefined) {
      json(response, 400, { ok: false, error: "Expected { type: \"setSignal\", id, value }" });
      return;
    }
    const target = signals.get(id);
    if (!target) { json(response, 404, { ok: false, error: `Unknown live signal: ${id}` }); return; }
    const requestId = nextRequest++;
    const result = await new Promise<EditorCommandResult>((done) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        done({ ok: false, error: "The browser did not answer in time" });
      }, commandTimeout);
      pending.set(requestId, { tab: target.tab, done: (outcome) => { clearTimeout(timer); done(outcome); } });
      target.tab.client.send("meeko:live", message({
        type: "setSignal", request: requestId, instanceId: target.signal.instanceId, name: target.signal.name, value: value as DevtoolsValue,
      }));
    });
    json(response, result.ok ? 200 : 409, result);
  };

  const handle = (request: IncomingMessage, response: ServerResponse): boolean => {
    let pathname: string;
    try { pathname = new URL(request.url ?? "/", "http://localhost").pathname; } catch { return false; }
    if (pathname !== editorBridgePath && !pathname.startsWith(`${editorBridgePath}/`)) return false;
    if (closed) { json(response, 503, { ok: false, error: "The editor bridge is closed" }); return true; }
    channel();
    const denied = authorize(request);
    if (denied) { json(response, denied.status, { ok: false, error: denied.error }); return true; }
    const route = pathname.slice(editorBridgePath.length);
    if (route === "/events") {
      if (request.method !== "GET") { json(response, 405, { ok: false, error: "Use GET" }); return true; }
      openEvents(request, response);
    } else if (route === "/command") {
      if (request.method !== "POST") { json(response, 405, { ok: false, error: "Use POST" }); return true; }
      runCommand(request, response).catch((error: unknown) => {
        if (!response.headersSent) json(response, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
        else response.destroy();
      });
    } else {
      json(response, 404, { ok: false, error: "Unknown editor bridge route" });
    }
    return true;
  };

  const removeDescriptor = (): void => {
    try {
      const current = JSON.parse(readFileSync(file, "utf8")) as Partial<EditorBridgeDescriptor>;
      // Another `meeko dev` of the same project may have replaced it.
      if (current.token === token) rmSync(file, { force: true });
    } catch {
      // Already gone or unreadable: nothing of this session to remove.
    }
  };
  process.once("exit", removeDescriptor);

  const descriptor: EditorBridgeDescriptor = { protocol: 1, url, token, pid: process.pid, root, startedAt: new Date().toISOString() };
  await mkdir(dirname(file), { recursive: true });
  await removeStaleDescriptors(dirname(file));
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(descriptor, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);

  return {
    url, file, handle,
    refresh() { channel(); },
    async close() {
      if (closed) return;
      closed = true;
      clearInterval(keepAlive);
      if (settling) clearTimeout(settling.timer);
      settling = undefined;
      waiting.clear();
      if (bound) for (const [event, listener] of listeners) bound.off(event, listener);
      bound = undefined;
      for (const [request, entry] of pending) {
        pending.delete(request);
        entry.done({ ok: false, error: "The development server stopped" });
      }
      const listening = editors.size > 0;
      for (const editor of [...editors]) editor.end();
      editors.clear();
      if (listening) currentHot().send("meeko:live", message({ type: "state", active: false }));
      tabs.clear();
      signals.clear();
      process.off("exit", removeDescriptor);
      removeDescriptor();
    },
  };
}
