import type { DomScope } from "./dom.js";
import { effect, isWritableSignal, untrack } from "./reactivity.js";
import type { Signal } from "./reactivity.js";

/** Valores seguros para transportar una captura al panel de desarrollo. */
export type DevtoolsValue = null | boolean | number | string | DevtoolsValue[] | { [key: string]: DevtoolsValue };

/** Estado serializable de una instancia hidratada. */
export interface DevtoolsInstance {
  id: string;
  componentId: string;
  name: string;
  file: string;
  props: DevtoolsValue;
  signals: Record<string, DevtoolsValue>;
  parentId: string | null;
  childIds: string[];
  status: "hydrated";
  breakpoint: boolean;
}

/** Cambio reciente del árbol de componentes o de una señal. */
export interface DevtoolsEvent {
  id: number;
  at: number;
  kind: "mount" | "unmount" | "signal" | "breakpoint" | "select" | "hmr";
  instanceId: string;
  detail?: string;
}

/** Captura independiente de referencias DOM y de valores no serializables. */
export interface DevtoolsSnapshot {
  instances: DevtoolsInstance[];
  events: DevtoolsEvent[];
  selectedId: string | null;
}

/** Interfaz pública que consume una extensión o un panel de desarrollo. */
export interface DevtoolsHook {
  snapshot(): DevtoolsSnapshot;
  subscribe(listener: () => void): () => void;
  select(id: string | null): void;
  highlight(id: string | null): void;
  setBreakpoint(id: string, enabled: boolean): void;
}

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
    try { untrack(listener); } catch { /* Un panel externo no debe romper la aplicación. */ }
  }
}

function record(kind: DevtoolsEvent["kind"], instanceId: string, detail?: string): void {
  const event: DevtoolsEvent = { id: nextEvent++, at: Date.now(), kind, instanceId };
  if (detail !== undefined) event.detail = detail;
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
      return { instances, events: recent.map((event) => ({ ...event })), selectedId };
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
};

function unregister(entry: ActiveInstance): void {
  if (active.get(entry.id) !== entry) return;
  for (const stop of entry.stopSignals) stop();
  active.delete(entry.id);
  if (selectedId === entry.id) selectedId = null;
  if (highlightedId === entry.id) removeHighlight();
  record("unmount", entry.id);
}

/** Registra señales y ámbito de una instancia hidratada en Vite desarrollo. */
export function registerDevtoolsInstance(input: DevtoolsRegistration): () => void {
  if (typeof window === "undefined" || typeof Node === "undefined") return () => {};
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
  const entry: ActiveInstance = { ...input, id: identity.id, key, breakpoint: identity.breakpoint, stopSignals: [] };
  active.set(entry.id, entry);
  for (const [name, value] of Object.entries(input.bindings)) {
    if (!isWritableSignal(value)) continue;
    const signal = value as Signal<unknown>;
    let initial = true;
    entry.stopSignals.push(effect(() => {
      void signal.value;
      if (initial) { initial = false; return; }
      record("signal", entry.id, name);
      if (entry.breakpoint) {
        debugger;
      }
    }));
  }
  record(previous ? "hmr" : "mount", entry.id);
  return () => { unregister(entry); };
}
