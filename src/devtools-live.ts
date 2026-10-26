import type { DevtoolsCommandResult, DevtoolsEvent, DevtoolsValue } from "./devtools-protocol.js";
import type { LiveBrowserResult, LiveBrowserSignal, LiveBrowserUpdate, LiveServerMessage } from "./devtools-bridge-protocol.js";
import { devtoolsHook, devtoolsInstanceIds, devtoolsLiveInstance, observeDevtoolsEvents } from "./devtools.js";

/** Subconjunto de `import.meta.hot` de Vite que usa el puente del editor. */
export interface LiveHotContext {
  send(event: string, data?: unknown): void;
  on(event: string, listener: (data: unknown) => void): void;
}

/** Intervalo mínimo entre dos envíos de valores al servidor de desarrollo. */
export const liveThrottleMs = 100;
/** Caracteres máximos del JSON de un valor; el resto se recorta y se marca `truncated`. */
export const liveValueLimit = 4096;
/** Tamaño aproximado máximo de un envío; lo pendiente sale en el siguiente intervalo. */
export const liveMessageLimit = 128 * 1024;

const contexts = new WeakSet<LiveHotContext>();
let sender: LiveHotContext | undefined;
let session = "";
let lastSeq = 0;
let active = false;
let stopObserving: (() => void) | undefined;
/** Instancias con señales pendientes: `true` reenvía todas sus señales. */
let dirty = new Map<string, Set<string> | true>();
let removed = new Set<string>();
let reset = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastFlush = Number.NEGATIVE_INFINITY;

function now(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}

function markAll(id: string): void {
  dirty.set(id, true);
}

function markSignal(id: string, name: string): void {
  const entry = dirty.get(id);
  if (entry === true) return;
  if (entry) entry.add(name);
  else dirty.set(id, new Set([name]));
}

function observe(event: DevtoolsEvent): void {
  if (!active) return;
  switch (event.kind) {
    case "signal":
      if (event.detail !== undefined) markSignal(event.instanceId, event.detail);
      break;
    case "mount":
      markAll(event.instanceId);
      break;
    case "hmr":
      // The new version may have renamed or removed signals; drop the old ones first.
      removed.add(event.instanceId);
      markAll(event.instanceId);
      break;
    case "unmount":
      removed.add(event.instanceId);
      dirty.delete(event.instanceId);
      break;
    default:
      return;
  }
  schedule();
}

function schedule(): void {
  if (timer !== undefined || !active) return;
  timer = setTimeout(flush, Math.max(0, lastFlush + liveThrottleMs - now()));
}

function encode(value: DevtoolsValue): { json: string; truncated: boolean } {
  const json = JSON.stringify(value);
  return json.length > liveValueLimit ? { json: json.slice(0, liveValueLimit), truncated: true } : { json, truncated: false };
}

function flush(): void {
  timer = undefined;
  if (!active || !sender) return;
  lastFlush = now();
  const signals: LiveBrowserSignal[] = [];
  let size = 0;
  const pending = dirty;
  dirty = new Map();
  for (const [id, names] of pending) {
    if (size >= liveMessageLimit) {
      dirty.set(id, names);
      continue;
    }
    const instance = devtoolsLiveInstance(id, names === true ? undefined : names);
    if (!instance) continue;
    for (const signal of instance.signals) {
      const { json, truncated } = encode(signal.value);
      const { alias } = signal;
      size += json.length + signal.name.length + instance.file.length + (alias ? alias.file.length + 128 : 0) + 64;
      signals.push({
        instanceId: instance.id, component: instance.name, file: instance.file, name: signal.name,
        ...(signal.site ? { line: signal.site.line, column: signal.site.column } : {}),
        json, truncated,
        ...(alias ? { alias: {
          instanceId: alias.instanceId, component: alias.component, file: alias.file, name: alias.name,
          ...(alias.site ? { line: alias.site.line, column: alias.site.column } : {}),
        } } : {}),
      });
    }
  }
  const update: LiveBrowserUpdate = { reset, removed: [...removed], signals };
  reset = false;
  removed = new Set();
  // An empty reset still tells the server that this tab has reported.
  if (update.reset || update.removed.length || update.signals.length) sender.send("meeko:live:update", update);
  if (dirty.size) schedule();
}

function activate(): void {
  if (!active) {
    active = true;
    stopObserving = observeDevtoolsEvents(observe);
  }
  // The server keeps nothing while no editor listens: send every instance again, right away,
  // since the server holds the new editor's snapshot until it arrives. A timer would wait up
  // to a second in a background tab.
  reset = true;
  removed = new Set();
  dirty = new Map(devtoolsInstanceIds().map((id) => [id, true as const]));
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  flush();
}

function deactivate(): void {
  active = false;
  stopObserving?.();
  stopObserving = undefined;
  if (timer !== undefined) clearTimeout(timer);
  timer = undefined;
  dirty = new Map();
  removed = new Set();
  reset = false;
}

function isMessage(data: unknown): data is LiveServerMessage {
  if (typeof data !== "object" || data === null) return false;
  const message = data as Partial<Record<keyof LiveServerMessage, unknown>>;
  return typeof message.seq === "number" && typeof message.session === "string" && typeof message.type === "string";
}

function runCommand(message: Extract<LiveServerMessage, { type: "setSignal" }>): DevtoolsCommandResult {
  const hook = devtoolsHook();
  if (!hook) return { ok: false, error: "Meeko DevTools is not installed in this page" };
  try {
    return hook.setSignal(message.instanceId, message.name, message.value);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function receive(data: unknown): void {
  if (!isMessage(data)) return;
  // Every module's hot context registers this listener; handle each message once.
  if (data.session !== session) {
    session = data.session;
    lastSeq = 0;
  }
  if (data.seq <= lastSeq) return;
  lastSeq = data.seq;
  if (data.type === "state") {
    if (data.active) activate();
    else deactivate();
  } else if (data.type === "setSignal") {
    const result: LiveBrowserResult = { request: data.request, result: runCommand(data) };
    sender?.send("meeko:live:result", result);
  }
}

/**
 * Conecta el runtime de desarrollo con el puente del editor de `meeko dev` mediante el
 * WebSocket de HMR de Vite. El plugin de Vite lo llama sólo en desarrollo, con
 * `import.meta.hot` de cada módulo `.meeko`. No envía valores hasta que el servidor
 * avisa de que un editor está suscrito.
 */
export function connectLiveBridge(hot: LiveHotContext | undefined): void {
  if (!hot || typeof window === "undefined" || contexts.has(hot)) return;
  contexts.add(hot);
  const first = sender === undefined;
  // Vite drops a module's listeners when it is replaced; each new context registers again.
  sender = hot;
  hot.on("meeko:live", receive);
  if (first) hot.send("meeko:live:hello", {});
}

/** Detiene el envío y olvida la conexión. Uso interno de pruebas. */
export function disconnectLiveBridge(): void {
  deactivate();
  sender = undefined;
  session = "";
  lastSeq = 0;
}
