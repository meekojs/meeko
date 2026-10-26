import { captureParentOwner, isWritableSignal } from "./reactivity.js";
import { borrowedKey } from "./models.js";
import { parseRegionHtml } from "./dom.js";
import type { DomScope } from "./dom.js";

/**
 * Valores de las señales editables de un componente, por nombre, que HMR transfiere en memoria
 * entre dos versiones del módulo. Es independiente del estado JSON que viaja del servidor al
 * navegador.
 *
 * @example
 * ```ts
 * import type { HotState } from "@meekojs/meeko";
 *
 * // Lo que conserva un contador al editar su .meeko durante el desarrollo.
 * const state: HotState = { count: 3 };
 * ```
 */
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
  withParent: <T>(work: () => T) => T;
}

interface HotSlot {
  current: HotInstance;
  stop: () => void;
  forget: () => void;
}

const enabled = new Set<string>();
const instances = new Map<string, Map<Element | Comment, HotSlot>>();

/** Copia solo las señales editables de un setup, sin serializarlas. */
export function snapshotSignals(bindings: Record<string, unknown>): HotState {
  const state: HotState = {};
  // Models shared by the parent belong to the parent's state, not to this instance's.
  const borrowed = (bindings as { [borrowedKey]?: ReadonlySet<unknown> })[borrowedKey];
  for (const [name, value] of Object.entries(bindings)) {
    if (isWritableSignal(value) && !borrowed?.has(value)) state[name] = value.value;
  }
  return state;
}

/** Restaura señales compatibles antes de renderizar o hidratar la nueva versión. */
export function restoreSignals(bindings: Record<string, unknown>, state?: HotState): void {
  if (!state) return;
  for (const [name, value] of Object.entries(state)) {
    const target = bindings[name];
    if (isWritableSignal(target) && !(bindings as { [borrowedKey]?: ReadonlySet<unknown> })[borrowedKey]?.has(target)) target.value = value;
  }
}

/** Activa el seguimiento de instancias solo para módulos servidos por Vite. */
export function enableHotModule(id: string): void {
  enabled.add(id);
}

function registerHotTarget<Props>(id: string, key: Element | Comment, target: HotInstance["target"], props: Props, component: HotComponent<Props>, snapshot: () => HotState, dispose: () => void): () => void {
  if (!enabled.has(id)) return dispose;
  const entry: HotInstance = { target, props, component: component as HotComponent, snapshot, dispose, withParent: captureParentOwner() };
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
    forget: () => {
      if (group.get(key) !== slot) return;
      group.delete(key);
      if (group.size === 0) instances.delete(id);
    },
    stop: () => {
      if (group.get(key) !== slot) return;
      slot.forget();
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
  // Same parser as a late mount: the scripts of `html="..."` content never run.
  const content = parseRegionHtml(scope.start!.parentNode!, html);
  range.deleteContents();
  range.insertNode(content);
}

/** Aplica CSS nuevo después de la hoja virtual cargada por Vite. */
export function replaceHotStyle(id: string, css: string): void {
  if (typeof document === "undefined") return;
  // Module IDs are file paths and may contain CSS selector metacharacters.
  let style = [...document.querySelectorAll<HTMLStyleElement>("style[data-meeko-hot]")]
    .find((candidate) => candidate.dataset.meekoHot === id);
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
    return { slot, entry, state, html: entry.withParent(() => component.renderToString(entry.props, state)), previous };
  });
  type Prepared = (typeof prepared)[number];
  const committed: Prepared[] = [];
  const rollback = ({ slot, entry, state, previous }: Prepared, failures: unknown[]): void => {
    const partial = slot.current !== entry ? slot.current : undefined;
    if (partial) {
      try { partial.dispose(); }
      catch (cleanupError) { failures.push(cleanupError); }
    }
    try {
      if (entry.target.kind === "root") entry.target.root.innerHTML = previous as string;
      else {
        const range = scopeRange(entry.target.scope);
        range.deleteContents();
        range.insertNode(previous as DocumentFragment);
      }
      if (entry.target.kind === "root") {
        const { root } = entry.target;
        entry.withParent(() => entry.component.hydrate(root, entry.props, state));
      } else {
        const { scope } = entry.target;
        entry.withParent(() => entry.component.hydrateScope?.(scope, entry.props, state));
      }
      if (slot.current === entry || slot.current === partial) throw new Error("Restored Meeko component did not register its hydrated instance");
    } catch (rollbackError) {
      failures.push(rollbackError);
      if (slot.current !== entry && slot.current !== partial) {
        try { slot.current.dispose(); }
        catch (cleanupError) { failures.push(cleanupError); }
      }
      slot.forget();
    }
  };
  for (const item of prepared) {
    const { slot, entry, state, html } = item;
    try {
      entry.dispose();
      if (entry.target.kind === "root") entry.target.root.innerHTML = html;
      else replaceScope(entry.target.scope, html);
      if (entry.target.kind === "root") {
        const { root } = entry.target;
        entry.withParent(() => component.hydrate(root, entry.props, state));
      }
      else {
        if (!component.hydrateScope) throw new Error("Updated Meeko child component has no hydrateScope export");
        const { scope } = entry.target;
        entry.withParent(() => component.hydrateScope!(scope, entry.props, state));
      }
      if (slot.current === entry) throw new Error("Updated Meeko component did not register its hydrated instance");
      committed.push(item);
    } catch (error) {
      const failures: unknown[] = [error];
      rollback(item, failures);
      for (const previous of committed.reverse()) rollback(previous, failures);
      if (failures.length === 1) throw error;
      throw new AggregateError(failures, "Meeko hot replacement and recovery failed");
    }
  }
  replaceHotStyle(id, component.css ?? "");
}
