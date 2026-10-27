/**
 * Runtime behind `useElementRef("name")` and the template directive `ref:name`.
 *
 * The compiler replaces each `useElementRef("name")` with a typed read of the component
 * instance's refs; the hydration of `ref:name` publishes the element, or the `defineExpose`
 * value of a component, and withdraws it when its region is released.
 */
import { signal } from "./reactivity.js";
import type { ReadonlySignal, Signal } from "./reactivity.js";

/** Marks values that an `await` of a browser continuation waits for in its own way. */
export const browserReady: unique symbol = Symbol("meeko.browserReady");

/** A value that a browser `await` waits for, such as an element ref or a Socket client. */
export interface BrowserAwaitable<T> {
  [browserReady](): Promise<T>;
}

/** Waits for the value of a browser `await`: its own readiness, a thenable, or the value itself. */
export function browserValue<T>(value: T): Promise<Awaited<T>> {
  const ready = (value as Partial<BrowserAwaitable<Awaited<T>>> | null | undefined)?.[browserReady];
  if (typeof ready === "function") return ready.call(value);
  return Promise.resolve(value) as Promise<Awaited<T>>;
}

/**
 * The element or component of a `ref:name` directive. `value` is `null` during SSR, before the
 * component hydrates, while an `if:` hides it and after it is released. `await` waits until the
 * target exists, in a browser continuation of the script.
 */
export interface ElementRef<T> extends ReadonlySignal<T | null>, PromiseLike<T> {}

/** A `ref:name` inside `each:of`: every row's target, in document order. */
export type ElementListRef<T> = ReadonlySignal<readonly T[]>;

/** Message of the type error for `await useElementRef(...)` on a component without `defineExpose`. */
export type UnexposedRefMessage = "MEEK080: esta ref nombra un componente sin defineExpose, así que no expone nada que esperar; añade defineExpose al componente o lee .value";

/**
 * `useElementRef("name")` of a component without `defineExpose`: `value` stays `null`. Its `then`
 * is not a promise's, so `await` on it is a type error (MEEK080).
 */
export interface UnexposedRef {
  readonly value: null;
  then(meek080: UnexposedRefMessage): never;
}

/** What `useElementRef("name")` returns for a target of type `T`. */
export type ElementRefOf<T> = [T] extends [null] ? UnexposedRef : ElementRef<T>;

/** Fails `await useElementRef(...)` at run time on a component that has no `defineExpose`. */
export class UnexposedRefError extends Error {
  readonly code = "MEEK080";
  constructor(name: string) {
    super(`MEEK080: await useElementRef("${name}") espera el valor del defineExpose de un componente, pero el componente de ref:${name} no lo tiene. Añade defineExpose a ese componente o lee useElementRef("${name}").value`);
    this.name = "UnexposedRefError";
  }
}

/** Element type of a tag: the HTML or SVG tag map entry, or the generic element type. */
export type ElementOf<Tag extends string, Svg extends boolean> = Svg extends true
  ? Tag extends keyof SVGElementTagNameMap ? SVGElementTagNameMap[Tag] : SVGElement
  : Tag extends keyof HTMLElementTagNameMap ? HTMLElementTagNameMap[Tag] : HTMLElement;

/**
 * Event of `on:name` on a native element: the entry of the element's event map
 * (`HTMLElementEventMap` or `SVGElementEventMap`), or `Event` for an unknown name. The compiler
 * adds `currentTarget` typed with `ElementOf`; the editor declares the same type inline
 * (`templateEventDeclaration`).
 */
export type EventOf<Name extends string, Svg extends boolean> = Svg extends true
  ? Name extends keyof SVGElementEventMap ? SVGElementEventMap[Name] : Event
  : Name extends keyof HTMLElementEventMap ? HTMLElementEventMap[Name] : Event;

interface Waiter {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: unknown) => void;
}

interface RefSlot {
  name: string;
  readonly entries: Map<object, unknown>;
  /** Hydrated components of this ref that expose nothing. */
  readonly unexposed: Set<object>;
  readonly current: Signal<unknown>;
  readonly items: Signal<readonly unknown[]>;
  readonly waiters: Set<Waiter>;
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && typeof (value as Node).compareDocumentPosition === "function";
}

/** Refs of one component instance, by the id of their `ref:` directive. */
export class ElementRefs {
  readonly #slots = new Map<number, RefSlot>();

  slot(id: number): RefSlot {
    let slot = this.#slots.get(id);
    if (!slot) {
      slot = { name: String(id), entries: new Map(), unexposed: new Set(), current: signal<unknown>(null), items: signal<readonly unknown[]>([]), waiters: new Set() };
      this.#slots.set(id, slot);
    }
    return slot;
  }
}

/** Creates the refs of a component instance; an HTML render keeps every ref `null`. */
export function createRefs(): ElementRefs {
  return new ElementRefs();
}

function publish(slot: RefSlot): void {
  const values = [...slot.entries.values()];
  // List rows: document order for elements, insertion order for exposed values.
  const ordered = values.every(isNode)
    ? [...values].sort((left, right) => (left.compareDocumentPosition(right) & 4 ? -1 : 1))
    : values;
  slot.items.value = ordered;
  const current = ordered.at(-1) ?? null;
  slot.current.value = current;
  if (current === null && slot.unexposed.size === 0) return;
  const waiters = [...slot.waiters];
  slot.waiters.clear();
  for (const waiter of waiters) {
    if (current === null) waiter.reject(new UnexposedRefError(slot.name));
    else waiter.resolve(current);
  }
}

/**
 * A publisher for one hydrated target of ref `id`: `set(value)` publishes it and `set(null)`
 * withdraws it. Every row of a list ref gets its own publisher. A component binding passes
 * `hydrated` with the value of its instance, `null` when the component has no `defineExpose`.
 */
export function refTarget(refs: ElementRefs, id: number): (value: unknown, hydrated?: boolean) => void {
  const slot = refs.slot(id);
  const token = {};
  return (value, hydrated) => {
    if (value === null || value === undefined) {
      const removed = slot.entries.delete(token);
      const changed = hydrated ? !slot.unexposed.has(token) : slot.unexposed.has(token);
      if (hydrated) slot.unexposed.add(token);
      else slot.unexposed.delete(token);
      if (!removed && !changed) return;
    } else {
      slot.unexposed.delete(token);
      slot.entries.set(token, value);
    }
    publish(slot);
  };
}

/**
 * `useElementRef("name")` of a ref outside `each:of`. Awaiting the ref of a component without
 * `defineExpose` rejects with `UnexposedRefError` (MEEK080) once that component hydrates.
 */
export function elementRef<T>(name: string, refs: ElementRefs, id: number): ElementRefOf<T> {
  const slot = refs.slot(id);
  slot.name = name;
  const wait = (): Promise<T> => new Promise<T>((resolve, reject) => {
    const current = slot.current.value;
    if (current !== null) resolve(current as T);
    else if (slot.unexposed.size > 0) reject(new UnexposedRefError(name));
    else slot.waiters.add({ resolve: resolve as (value: unknown) => void, reject });
  });
  return {
    get value() { return slot.current.value as T | null; },
    then<R1 = T, R2 = never>(onfulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null, onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null): PromiseLike<R1 | R2> {
      return wait().then(onfulfilled, onrejected);
    },
    [browserReady]: wait,
  } as ElementRef<T> & BrowserAwaitable<T> as unknown as ElementRefOf<T>;
}

/** `useElementRef("name")` of a ref inside `each:of`. */
export function elementListRef<T>(_name: string, refs: ElementRefs, id: number): ElementListRef<T> {
  const slot = refs.slot(id);
  return { get value() { return slot.items.value as readonly T[]; } };
}
