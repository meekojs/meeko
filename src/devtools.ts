import type { DomScope } from "./dom.js";
import type {
  DevtoolsAssignmentSite, DevtoolsCommandResult, DevtoolsEvent, DevtoolsHook, DevtoolsInstance,
  DevtoolsProtocolVersion, DevtoolsReadSite, DevtoolsValue, DevtoolsWriteSite,
} from "./devtools-protocol.js";
import { logClientError, observeCallback } from "./error-observer.js";
import { currentEffectOwner, effect, isWritableSignal, signalReadSites, untrack } from "./reactivity.js";
import type { Signal } from "./reactivity.js";

export type {
  DevtoolsAssignmentSite, DevtoolsCommandResult, DevtoolsEditSite, DevtoolsEvent, DevtoolsEventKind, DevtoolsHook,
  DevtoolsInstance, DevtoolsProtocolVersion, DevtoolsReadKind, DevtoolsReadSite, DevtoolsSnapshot, DevtoolsValue,
  DevtoolsWriteSite,
} from "./devtools-protocol.js";

/** Versión del protocolo que implementa este runtime. */
export const DEVTOOLS_PROTOCOL_VERSION: DevtoolsProtocolVersion = 1;

/** Datos que entrega un componente compilado cuando se hidrata en desarrollo. */
export interface DevtoolsRegistration {
  componentId: string;
  name: string;
  file: string;
  scope: DomScope;
  props: unknown;
  bindings: Record<string, unknown>;
}

declare global {
  interface Window {
    __MEEKO_DEVTOOLS__?: DevtoolsHook;
  }
}

interface ActiveInstance extends DevtoolsRegistration {
  id: string;
  key: Node;
  owner: object | undefined;
  breakpoint: boolean;
  stopSignals: Array<() => void>;
}

const active = new Map<string, ActiveInstance>();
const identities = new WeakMap<Node, { id: string; breakpoint: boolean }>();
const listeners = new Set<() => void>();
const recent: DevtoolsEvent[] = [];
let nextInstance = 1;
let nextEvent = 1;
let selectedId: string | null = null;
let highlightedId: string | null = null;
let overlay: HTMLElement | undefined;
let highlightObserver: MutationObserver | undefined;
let highlightFrame: number | undefined;
let installed = false;

interface PendingWrite {
  site: DevtoolsWriteSite;
  /** Mientras corre una actualización compuesta cualquier valor nuevo procede de ella. */
  any: boolean;
  expected: unknown;
}

/** Última escritura instrumentada de cada señal; caduca al terminar la tarea síncrona actual. */
const pendingWrites = new WeakMap<object, PendingWrite>();

function markWrite(target: object, entry: PendingWrite): void {
  pendingWrites.set(target, entry);
  queueMicrotask(() => {
    if (pendingWrites.get(target) === entry) pendingWrites.delete(target);
  });
}

function writeSiteFor(target: object, current: unknown): DevtoolsWriteSite | undefined {
  const entry = pendingWrites.get(target);
  if (!entry || (!entry.any && !Object.is(entry.expected, current))) return undefined;
  return entry.site;
}

/** Comprueba que un valor editado desde un panel sea JSON sin prototipos ni referencias especiales. */
function jsonError(value: unknown, depth = 0, seen = new Set<object>()): string | undefined {
  if (value === null || typeof value === "boolean" || typeof value === "string") return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? undefined : "numbers must be finite";
  if (typeof value !== "object") return `unsupported ${typeof value} value`;
  if (depth > 64) return "value is nested too deeply";
  if (seen.has(value)) return "value contains a circular reference";
  const prototype: unknown = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return "only arrays and plain objects are supported";
  seen.add(value);
  try {
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) return "accessor properties are not supported";
      const error = jsonError(descriptor.value, depth + 1, seen);
      if (error) return error;
    }
  } finally {
    seen.delete(value);
  }
  return undefined;
}

/**
 * Registra el origen de `signal.value = value` antes de que el setter notifique.
 * Sólo lo emite el compilador en desarrollo y devuelve `value` sin alterarlo.
 */
export function devtoolsWrite<T>(target: unknown, site: DevtoolsAssignmentSite, value: T): T {
  if (!installed || !isWritableSignal(target)) return value;
  if (!Object.is(untrack(() => target.value), value)) markWrite(target, { site, any: false, expected: value });
  return value;
}

/** Registra el origen de una actualización compuesta (`+=`, `++`, …) de `.value` en desarrollo. */
export function devtoolsUpdate<T>(target: unknown, site: DevtoolsAssignmentSite, update: () => T): T {
  if (!installed || !isWritableSignal(target)) return update();
  const entry: PendingWrite = { site, any: true, expected: undefined };
  markWrite(target, entry);
  try {
    return update();
  } finally {
    entry.any = false;
    entry.expected = untrack(() => target.value);
  }
}

/** Copia datos arbitrarios con profundidad y tamaño acotados sin invocar getters. */
function safeValue(value: unknown, depth = 0, seen = new WeakSet<object>()): DevtoolsValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "string") return value.length > 500 ? `${value.slice(0, 500)}…` : value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (typeof value === "undefined") return "[undefined]";
  if (typeof value === "bigint") return `${value}n`;
  if (typeof value === "symbol") return "[symbol]";
  if (typeof value === "function") return "[function]";
  if (typeof value !== "object") return "[unknown]";
  if (typeof Node !== "undefined" && value instanceof Node) return "[DOM node]";
  try {
    if (typeof Reflect.get(value, "nodeType") === "number" && typeof Reflect.get(value, "nodeName") === "string") return "[DOM node]";
  } catch {
    return "[uninspectable]";
  }
  if (seen.has(value)) return "[circular]";
  if (depth >= 4) return "[max depth]";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "[invalid date]" : value.toISOString();
  if (value instanceof Error) return safeValue(`[${value.name}: ${value.message}]`);
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const items: DevtoolsValue[] = [];
      for (let index = 0; index < Math.min(value.length, 50); index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        items.push(descriptor && "value" in descriptor ? safeValue(descriptor.value, depth + 1, seen) : descriptor ? "[accessor]" : "[empty]");
      }
      if (value.length > 50) items.push(`[${value.length - 50} more]`);
      return items;
    }
    const result: Record<string, DevtoolsValue> = Object.create(null) as Record<string, DevtoolsValue>;
    const keys = Object.keys(value);
    for (const key of keys.slice(0, 50)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      result[key] = descriptor && "value" in descriptor ? safeValue(descriptor.value, depth + 1, seen) : "[accessor]";
    }
    if (keys.length > 50) result["…"] = `[${keys.length - 50} more]`;
    return result;
  } catch {
    return "[uninspectable]";
  } finally {
    seen.delete(value);
  }
}

function notify(): void {
  for (const listener of [...listeners]) {
    observeCallback(() => untrack(listener), (error) => logClientError("Meeko DevTools subscriber failed", error));
  }
}

function record(kind: DevtoolsEvent["kind"], instanceId: string, detail?: string, value?: DevtoolsValue, source?: ActiveInstance, reads?: DevtoolsReadSite[], write?: DevtoolsWriteSite): void {
  const event: DevtoolsEvent = { id: nextEvent++, at: Date.now(), kind, instanceId };
  if (detail !== undefined) event.detail = detail;
  const entry = source ?? active.get(instanceId);
  if (entry) {
    event.componentName = entry.name;
    event.file = entry.file;
  }
  if (value !== undefined) event.value = value;
  if (reads?.length) event.reads = reads;
  if (write) event.write = write;
  recent.push(event);
  if (recent.length > 100) recent.shift();
  notify();
}

function keyOf(scope: DomScope): Node {
  return scope.start ?? scope.root;
}

function isInside(parent: ActiveInstance, child: ActiveInstance): boolean {
  if (parent.id === child.id || parent.key === child.key) return false;
  const node = child.key;
  if (!parent.scope.start || !parent.scope.end) return parent.scope.root.contains(node);
  const { start, end } = parent.scope;
  return Boolean(start.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)
    && Boolean(end.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING);
}

function parentOf(child: ActiveInstance): ActiveInstance | undefined {
  let parent: ActiveInstance | undefined;
  for (const candidate of active.values()) {
    if (!isInside(candidate, child)) continue;
    if (!parent || isInside(parent, candidate)) parent = candidate;
  }
  return parent;
}

function bounds(instance: ActiveInstance): DOMRect {
  if (!instance.scope.start || !instance.scope.end) return instance.scope.root.getBoundingClientRect();
  const range = instance.scope.start.ownerDocument.createRange();
  range.setStartAfter(instance.scope.start);
  range.setEndBefore(instance.scope.end);
  return range.getBoundingClientRect();
}

function positionHighlight(): void {
  const entry = highlightedId ? active.get(highlightedId) : undefined;
  if (!entry || !overlay) return;
  try {
    const rect = bounds(entry);
    Object.assign(overlay.style, {
      left: `${rect.left}px`, top: `${rect.top}px`,
      width: `${rect.width}px`, height: `${rect.height}px`,
    });
  } catch {
    removeHighlight();
  }
}

function scheduleHighlight(): void {
  if (highlightFrame !== undefined) return;
  highlightFrame = window.requestAnimationFrame(() => {
    highlightFrame = undefined;
    positionHighlight();
  });
}

function removeHighlight(): void {
  window.removeEventListener("scroll", scheduleHighlight, true);
  window.removeEventListener("resize", scheduleHighlight);
  highlightObserver?.disconnect();
  highlightObserver = undefined;
  if (highlightFrame !== undefined) window.cancelAnimationFrame(highlightFrame);
  highlightFrame = undefined;
  overlay?.remove();
  overlay = undefined;
  highlightedId = null;
}

const hook: DevtoolsHook = {
  protocolVersion: DEVTOOLS_PROTOCOL_VERSION,
  snapshot() {
    return untrack(() => {
      const instances: DevtoolsInstance[] = [];
      for (const entry of active.values()) {
        const signals: Record<string, DevtoolsValue> = Object.create(null) as Record<string, DevtoolsValue>;
        for (const [name, value] of Object.entries(entry.bindings)) {
          if (isWritableSignal(value)) signals[name] = safeValue(value.value);
        }
        instances.push({
          id: entry.id,
          componentId: entry.componentId,
          name: entry.name,
          file: entry.file,
          props: safeValue(entry.props),
          signals,
          parentId: parentOf(entry)?.id ?? null,
          childIds: [],
          status: "hydrated",
          breakpoint: entry.breakpoint,
        });
      }
      const byId = new Map(instances.map((instance) => [instance.id, instance]));
      for (const instance of instances) {
        if (instance.parentId) byId.get(instance.parentId)?.childIds.push(instance.id);
      }
      return { protocolVersion: DEVTOOLS_PROTOCOL_VERSION, instances, events: recent.map((event) => ({ ...event })), selectedId };
    });
  },
  subscribe(listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  select(id) {
    if (id !== null && !active.has(id)) return;
    selectedId = id;
    record("select", id ?? "");
  },
  highlight(id) {
    removeHighlight();
    if (id === null) return;
    const entry = active.get(id);
    if (!entry) return;
    const document = entry.key.ownerDocument ?? window.document;
    const element = document.createElement("div");
    element.setAttribute("data-meeko-devtools-highlight", "");
    Object.assign(element.style, {
      position: "fixed",
      outline: "2px solid #7c3aed", background: "rgba(124, 58, 237, 0.12)",
      pointerEvents: "none", zIndex: "2147483647",
    });
    document.body.appendChild(element);
    overlay = element;
    highlightedId = id;
    positionHighlight();
    window.addEventListener("scroll", scheduleHighlight, true);
    window.addEventListener("resize", scheduleHighlight);
    highlightObserver = new window.MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.target !== overlay && !overlay?.contains(mutation.target))) scheduleHighlight();
    });
    highlightObserver.observe(entry.scope.root, { attributes: true, characterData: true, childList: true, subtree: true });
  },
  setBreakpoint(id, enabled) {
    const entry = active.get(id);
    if (!entry) return;
    entry.breakpoint = enabled;
    const identity = identities.get(entry.key);
    if (identity) identity.breakpoint = enabled;
    record("breakpoint", id, enabled ? "enabled" : "disabled");
  },
  setSignal(instanceId, name, value): DevtoolsCommandResult {
    if (typeof instanceId !== "string" || typeof name !== "string") return { ok: false, error: "Instance ID and signal name must be strings" };
    const entry = active.get(instanceId);
    if (!entry) return { ok: false, error: `Unknown Meeko instance: ${instanceId}` };
    const target = Object.hasOwn(entry.bindings, name) ? entry.bindings[name] : undefined;
    if (!isWritableSignal(target)) return { ok: false, error: `${entry.name} has no writable signal named ${JSON.stringify(name)}` };
    const invalid = jsonError(value);
    if (invalid) return { ok: false, error: `Invalid JSON value: ${invalid}` };
    if (Object.is(untrack(() => target.value), value)) return { ok: true };
    markWrite(target, { site: { kind: "devtools" }, any: false, expected: value });
    try {
      target.value = value;
    } catch (error) {
      return { ok: false, error: `Signal updated, but an observer failed: ${error instanceof Error ? error.message : String(error)}` };
    }
    return { ok: true };
  },
};

function unregister(entry: ActiveInstance): void {
  if (active.get(entry.id) !== entry) return;
  for (const stop of entry.stopSignals) stop();
  active.delete(entry.id);
  if (selectedId === entry.id) selectedId = null;
  if (highlightedId === entry.id) removeHighlight();
  record("unmount", entry.id, undefined, undefined, entry);
}

/** Registra señales y ámbito de una instancia hidratada en Vite desarrollo. */
export function registerDevtoolsInstance(input: DevtoolsRegistration): () => void {
  if (typeof window === "undefined" || typeof Node === "undefined") return () => {};
  installed = true;
  if (!window.__MEEKO_DEVTOOLS__) {
    window.__MEEKO_DEVTOOLS__ = hook;
    window.dispatchEvent(new window.Event("meeko:devtools-ready"));
  }
  const key = keyOf(input.scope);
  const previous = identities.get(key);
  const identity = previous ?? { id: `meeko-${nextInstance++}`, breakpoint: false };
  identities.set(key, identity);
  const existing = active.get(identity.id);
  if (existing) unregister(existing);
  const entry: ActiveInstance = { ...input, id: identity.id, key, owner: currentEffectOwner(), breakpoint: identity.breakpoint, stopSignals: [] };
  active.set(entry.id, entry);
  for (const [name, value] of Object.entries(input.bindings)) {
    if (!isWritableSignal(value)) continue;
    const signal = value as Signal<unknown>;
    let initial = true;
    entry.stopSignals.push(effect(() => {
      const current = signal.value;
      if (initial) { initial = false; return; }
      record("signal", entry.id, name, safeValue(current), entry, signalReadSites(signal, entry.owner), writeSiteFor(signal, current));
      if (entry.breakpoint) {
        debugger;
      }
    }));
  }
  record(previous ? "hmr" : "mount", entry.id);
  return () => { unregister(entry); };
}
