import type { DomScope } from "./dom.js";
import type {
  DevtoolsAssignmentSite, DevtoolsCommandResult, DevtoolsEvent, DevtoolsHook, DevtoolsInstance,
  DevtoolsProtocolVersion, DevtoolsReadSite, DevtoolsSignalSite, DevtoolsValue, DevtoolsWriteSite,
} from "./devtools-protocol.js";
import { logClientError, observeCallback } from "./error-observer.js";
import { borrowedKey } from "./models.js";
import { isReactiveProps, trackProps } from "./props.js";
import { currentEffectOwner, effect, isWritableSignal, signalReadSites, untrack } from "./reactivity.js";
import type { Signal } from "./reactivity.js";

export type {
  DevtoolsAssignmentSite, DevtoolsCommandResult, DevtoolsEditSite, DevtoolsEvent, DevtoolsEventKind, DevtoolsHook,
  DevtoolsInstance, DevtoolsProtocolVersion, DevtoolsReadKind, DevtoolsReadSite, DevtoolsSignalSite, DevtoolsSnapshot,
  DevtoolsValue, DevtoolsWriteSite,
} from "./devtools-protocol.js";

/** Versión del protocolo que implementa este runtime. */
export const DEVTOOLS_PROTOCOL_VERSION: DevtoolsProtocolVersion = 1;

/**
 * Datos que entrega un componente compilado al registrarse en DevTools cuando se hidrata en
 * desarrollo. El compilador genera este registro; una aplicación sólo lo lee.
 *
 * @example
 * ```ts
 * import type { DevtoolsRegistration } from "@meekojs/meeko";
 *
 * const describe = (registration: DevtoolsRegistration): string =>
 *   `${registration.name} (${registration.file}): ${Object.keys(registration.bindings).join(", ")}`;
 * ```
 */
export interface DevtoolsRegistration {
  /** Identificador estable del componente compilado. */
  componentId: string;
  /** Nombre del componente. */
  name: string;
  /** Archivo `.meeko` de origen. */
  file: string;
  /** Fragmento de DOM de la instancia. */
  scope: DomScope;
  /** Props de la instancia. */
  props: unknown;
  /** Bindings del setup por nombre; las señales editables aparecen en el panel. */
  bindings: Record<string, unknown>;
  /**
   * Línea y columna (desde 1) de la declaración de cada binding en `file`; sólo las emite la
   * compilación `hot`.
   * @since 1.1.0
   */
  sites?: Record<string, { line: number; column: number }>;
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
/** Observadores internos de cada evento, como el puente del editor; vacío salvo que un editor esté suscrito. */
const observers = new Set<(event: DevtoolsEvent) => void>();
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
  for (const observer of [...observers]) {
    observeCallback(() => untrack(() => observer(event)), (error) => logClientError("Meeko DevTools observer failed", error));
  }
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

function siteOf(entry: DevtoolsRegistration, name: string): DevtoolsSignalSite | undefined {
  const site = entry.sites && Object.hasOwn(entry.sites, name) ? entry.sites[name] : undefined;
  return site ? { file: entry.file, line: site.line, column: site.column } : undefined;
}

const hook: DevtoolsHook = {
  protocolVersion: DEVTOOLS_PROTOCOL_VERSION,
  snapshot() {
    return untrack(() => {
      const instances: DevtoolsInstance[] = [];
      for (const entry of active.values()) {
        const signals: Record<string, DevtoolsValue> = Object.create(null) as Record<string, DevtoolsValue>;
        const signalSites: Record<string, DevtoolsSignalSite> = Object.create(null) as Record<string, DevtoolsSignalSite>;
        let sited = false;
        for (const [name, value] of Object.entries(entry.bindings)) {
          if (!isWritableSignal(value)) continue;
          signals[name] = safeValue(value.value);
          const site = siteOf(entry, name);
          if (site) { signalSites[name] = site; sited = true; }
        }
        instances.push({
          id: entry.id,
          componentId: entry.componentId,
          name: entry.name,
          file: entry.file,
          props: safeValue(entry.props),
          signals,
          ...(sited ? { signalSites } : {}),
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

/** Binding de una instancia activa que apunta a una señal editable. */
interface SignalBinding {
  entry: ActiveInstance;
  name: string;
  /** La instancia recibió la señal de su padre con `defineModel`. */
  borrowed: boolean;
}

/** Bindings de cada señal editable en orden de registro; varios indican la misma instancia de signal. */
const bindingsBySignal = new Map<object, SignalBinding[]>();

function forgetBindings(entry: ActiveInstance): void {
  for (const value of Object.values(entry.bindings)) {
    if (!isWritableSignal(value)) continue;
    const list = bindingsBySignal.get(value);
    if (!list) continue;
    const kept = list.filter((binding) => binding.entry !== entry);
    if (kept.length) bindingsBySignal.set(value, kept);
    else bindingsBySignal.delete(value);
  }
}

/**
 * Binding principal de una señal compartida: el que no la toma prestada de su padre o, si todos la
 * comparten, el primero registrado. `undefined` si `entry.name` es el principal o no se comparte.
 */
function principalOf(entry: ActiveInstance, name: string, signal: object): SignalBinding | undefined {
  const list = bindingsBySignal.get(signal);
  if (!list || list.length < 2) return undefined;
  const principal = list.find((binding) => !binding.borrowed) ?? list[0]!;
  return principal.entry === entry && principal.name === name ? undefined : principal;
}

function unregister(entry: ActiveInstance): void {
  if (active.get(entry.id) !== entry) return;
  for (const stop of entry.stopSignals) stop();
  forgetBindings(entry);
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
  const borrowed = (input.bindings as { [borrowedKey]?: ReadonlySet<unknown> })[borrowedKey];
  for (const [name, value] of Object.entries(input.bindings)) {
    if (!isWritableSignal(value)) continue;
    const signal = value as Signal<unknown>;
    const shared = bindingsBySignal.get(signal);
    const binding: SignalBinding = { entry, name, borrowed: borrowed?.has(signal) ?? false };
    if (shared) shared.push(binding);
    else bindingsBySignal.set(signal, [binding]);
    let initial = true;
    entry.stopSignals.push(effect(() => {
      const current = signal.value;
      if (initial) { initial = false; return; }
      record("signal", entry.id, name, safeValue(current), entry, signalReadSites(signal, entry.owner), writeSiteFor(signal, current));
      if (entry.breakpoint) {
        // eslint-disable-next-line no-debugger -- DevTools signal breakpoints pause here on purpose.
        debugger;
      }
    }));
  }
  // A prop that its parent changes in place reaches the panel with its next snapshot.
  if (isReactiveProps(input.props)) {
    let initial = true;
    entry.stopSignals.push(effect(() => {
      trackProps(input.props as object);
      if (initial) { initial = false; return; }
      notify();
    }));
  }
  record(previous ? "hmr" : "mount", entry.id);
  return () => { unregister(entry); };
}

/** Señal editable de una instancia activa, con su valor copiado como en una captura. */
export interface DevtoolsLiveSignal {
  name: string;
  value: DevtoolsValue;
  site?: DevtoolsSignalSite;
  /** Binding principal si esta señal es la misma instancia de signal que la de otro binding. */
  alias?: DevtoolsLiveAlias;
}

/** Binding principal de una señal compartida, p. ej. la del padre de un `defineModel`. */
export interface DevtoolsLiveAlias {
  instanceId: string;
  component: string;
  file: string;
  name: string;
  site?: DevtoolsSignalSite;
}

/** Instancia activa vista por el puente del editor. */
export interface DevtoolsLiveInstance {
  id: string;
  name: string;
  file: string;
  signals: DevtoolsLiveSignal[];
}

/**
 * Observa cada evento registrado sin pasar por `subscribe`. Uso interno del puente del editor:
 * mientras nadie observa, el registro de eventos no hace trabajo adicional.
 */
export function observeDevtoolsEvents(observer: (event: DevtoolsEvent) => void): () => void {
  observers.add(observer);
  return () => { observers.delete(observer); };
}

/** IDs de las instancias hidratadas activas. */
export function devtoolsInstanceIds(): string[] {
  return [...active.keys()];
}

/** Valores actuales de las señales editables de una instancia, o `undefined` si ya no está activa. */
export function devtoolsLiveInstance(id: string, names?: ReadonlySet<string>): DevtoolsLiveInstance | undefined {
  const entry = active.get(id);
  if (!entry) return undefined;
  return untrack(() => {
    const signals: DevtoolsLiveSignal[] = [];
    for (const [name, value] of Object.entries(entry.bindings)) {
      if (names && !names.has(name)) continue;
      if (!isWritableSignal(value)) continue;
      const site = siteOf(entry, name);
      const principal = principalOf(entry, name, value);
      const principalSite = principal ? siteOf(principal.entry, principal.name) : undefined;
      const alias: DevtoolsLiveAlias | undefined = principal ? {
        instanceId: principal.entry.id, component: principal.entry.name, file: principal.entry.file, name: principal.name,
        ...(principalSite ? { site: principalSite } : {}),
      } : undefined;
      signals.push({ name, value: safeValue(value.value), ...(site ? { site } : {}), ...(alias ? { alias } : {}) });
    }
    return { id: entry.id, name: entry.name, file: entry.file, signals };
  });
}

/** Hook instalado por la primera instancia registrada en este navegador. */
export function devtoolsHook(): DevtoolsHook | undefined {
  return installed ? hook : undefined;
}
