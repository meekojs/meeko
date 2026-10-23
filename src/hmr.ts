import { isWritableSignal } from "./reactivity.js";
import type { DomScope } from "./dom.js";

/** Valores de señales transferidos en memoria entre versiones de un componente. */
export type HotState = Record<string, unknown>;

/** Contrato mínimo de un módulo Meeko reemplazable en desarrollo. */
export interface HotComponent<Props = unknown> {
  renderToString(props: Props, state?: HotState): string;
  hydrate(root: Element, props: Props, state?: HotState): () => void;
  hydrateScope?(scope: DomScope, props: Props, state?: HotState): () => void;
  css?: string;
}

interface HotInstance {
  target: { kind: "root"; root: Element } | { kind: "scope"; scope: DomScope };
  props: unknown;
  component: HotComponent;
  snapshot: () => HotState;
  dispose: () => void;
}

interface HotSlot {
  current: HotInstance;
  stop: () => void;
}

const enabled = new Set<string>();
const instances = new Map<string, Map<Element | Comment, HotSlot>>();

/** Copia solo las señales editables de un setup, sin serializarlas. */
export function snapshotSignals(bindings: Record<string, unknown>): HotState {
  const state: HotState = {};
  for (const [name, value] of Object.entries(bindings)) {
    if (isWritableSignal(value)) state[name] = value.value;
  }
  return state;
}

/** Restaura señales compatibles antes de renderizar o hidratar la nueva versión. */
export function restoreSignals(bindings: Record<string, unknown>, state?: HotState): void {
  if (!state) return;
  for (const [name, value] of Object.entries(state)) {
    const target = bindings[name];
    if (isWritableSignal(target)) target.value = value;
  }
}

/** Activa el seguimiento de instancias solo para módulos servidos por Vite. */
export function enableHotModule(id: string): void {
  enabled.add(id);
}

function registerHotTarget<Props>(id: string, key: Element | Comment, target: HotInstance["target"], props: Props, component: HotComponent<Props>, snapshot: () => HotState, dispose: () => void): () => void {
  if (!enabled.has(id)) return dispose;
  const entry: HotInstance = { target, props, component: component as HotComponent, snapshot, dispose };
  let group = instances.get(id);
  if (!group) {
    group = new Map();
    instances.set(id, group);
  }
  const existing = group.get(key);
  if (existing) {
    existing.current = entry;
    return existing.stop;
  }
  const slot: HotSlot = {
    current: entry,
    stop: () => {
      if (group.get(key) !== slot) return;
      group.delete(key);
      if (group.size === 0) instances.delete(id);
      slot.current.dispose();
    },
  };
  group.set(key, slot);
  return slot.stop;
}

/** Registra una raíz hidratada y elimina el registro al liberarla. */
export function registerHotInstance<Props>(id: string, root: Element, props: Props, component: HotComponent<Props>, snapshot: () => HotState, dispose: () => void): () => void {
  return registerHotTarget(id, root, { kind: "root", root }, props, component, snapshot, dispose);
}

/** Registra un componente hijo delimitado por comentarios para actualizarlo sin tocar al padre. */
export function registerHotScope<Props>(id: string, scope: DomScope, props: Props, component: HotComponent<Props>, snapshot: () => HotState, dispose: () => void): () => void {
  if (!scope.start || !scope.end) throw new Error("Hot child component requires a bounded scope");
  return registerHotTarget(id, scope.start, { kind: "scope", scope }, props, component, snapshot, dispose);
}

function scopeRange(scope: DomScope): Range {
  if (!scope.start || !scope.end) throw new Error("Hot child component lost its markers");
  const range = scope.start.ownerDocument.createRange();
  range.setStartAfter(scope.start);
  range.setEndBefore(scope.end);
  return range;
}

function replaceScope(scope: DomScope, html: string): void {
  const range = scopeRange(scope);
  const content = range.createContextualFragment(html);
  range.deleteContents();
  range.insertNode(content);
}

/** Aplica CSS nuevo después de la hoja virtual cargada por Vite. */
export function replaceHotStyle(id: string, css: string): void {
  if (typeof document === "undefined") return;
  let style = document.querySelector<HTMLStyleElement>(`style[data-meeko-hot="${id}"]`);
  if (!style) {
    style = document.createElement("style");
    style.dataset.meekoHot = id;
    document.head.appendChild(style);
  }
  style.textContent = css;
}

/** Sustituye las instancias activas sin recargar la página y conserva señales editables. */
export function replaceHotModule(id: string, next: unknown): void {
  if (typeof next !== "object" || next === null || !("renderToString" in next) || !("hydrate" in next)
    || typeof next.renderToString !== "function" || typeof next.hydrate !== "function") {
    throw new TypeError("Invalid Meeko hot module");
  }
  const component = next as HotComponent;
  const prepared = [...(instances.get(id)?.values() ?? [])].map((slot) => {
    const entry = slot.current;
    const state = entry.snapshot();
    const previous = entry.target.kind === "root" ? entry.target.root.innerHTML : scopeRange(entry.target.scope).cloneContents();
    return { slot, entry, state, html: component.renderToString(entry.props, state), previous };
  });
  for (const { slot, entry, state, html, previous } of prepared) {
    entry.dispose();
    if (entry.target.kind === "root") entry.target.root.innerHTML = html;
    else replaceScope(entry.target.scope, html);
    try {
      if (entry.target.kind === "root") component.hydrate(entry.target.root, entry.props, state);
      else {
        if (!component.hydrateScope) throw new Error("Updated Meeko child component has no hydrateScope export");
        component.hydrateScope(entry.target.scope, entry.props, state);
      }
      if (slot.current === entry) throw new Error("Updated Meeko component did not register its hydrated instance");
    } catch (error) {
      if (entry.target.kind === "root") entry.target.root.innerHTML = previous as string;
      else {
        const range = scopeRange(entry.target.scope);
        range.deleteContents();
        range.insertNode(previous as DocumentFragment);
      }
      if (entry.target.kind === "root") entry.component.hydrate(entry.target.root, entry.props, state);
      else entry.component.hydrateScope?.(entry.target.scope, entry.props, state);
      throw error;
    }
  }
  replaceHotStyle(id, component.css ?? "");
}
