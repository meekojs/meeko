import type { DevtoolsReadSite } from "./devtools-protocol.js";
import { logClientError, observeCallback, observeReturnedPromise } from "./error-observer.js";

/**
 * Señal de sólo lectura: leer `value` dentro de un `effect`, un `computed` o la plantilla registra
 * la dependencia. La devuelven `computed`, `useNavigation` y los composables de datos.
 *
 * @example
 * ```ts
 * import { computed, signal } from "@meekojs/meeko";
 * import type { ReadonlySignal } from "@meekojs/meeko";
 *
 * const count = signal(2);
 * const double: ReadonlySignal<number> = computed(() => count.value * 2);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#reactividad
 */
export interface ReadonlySignal<T> {
  /** Valor actual; leerlo registra la dependencia en el observador activo. */
  readonly value: T;
}

/**
 * Señal editable: escribir `value` notifica a los observadores que la leyeron, salvo que el valor
 * sea igual (`Object.is`). Las señales del script de un componente forman parte de su estado SSR.
 *
 * @example
 * ```ts
 * import { signal } from "@meekojs/meeko";
 * import type { Signal } from "@meekojs/meeko";
 *
 * const name: Signal<string> = signal("Ada");
 * name.value = "Grace";
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#reactividad
 */
export interface Signal<T> extends ReadonlySignal<T> {
  /** Valor actual; asignarlo notifica a los observadores. */
  value: T;
}

/**
 * Clave nominal para compartir un valor tipado entre instancias anidadas con `provide` e `inject`.
 * Créela con {@link createContext}.
 *
 * @example
 * ```ts
 * import { createContext } from "@meekojs/meeko";
 * import type { ContextKey, Signal } from "@meekojs/meeko";
 *
 * export const themeKey: ContextKey<Signal<"light" | "dark">> = createContext("theme");
 * ```
 */
export type ContextKey<T> = symbol & { readonly __meekoValue?: (value: T) => T };

/**
 * Crea una clave de contexto única. El tipo `T` se declara en la clave, no se infiere de un valor
 * global compartido.
 *
 * @param description Descripción que aparece en el error de `inject` si falta el proveedor.
 * @returns Una clave nueva.
 * @example
 * ```ts
 * // app/composables/theme.ts
 * import { createContext, inject, provide, signal } from "@meekojs/meeko";
 * import type { Signal } from "@meekojs/meeko";
 *
 * const themeKey = createContext<Signal<"light" | "dark">>("theme");
 * export function provideTheme(): Signal<"light" | "dark"> {
 *   const theme = signal<"light" | "dark">("light");
 *   provide(themeKey, theme);
 *   return theme;
 * }
 * export const useTheme = (): Signal<"light" | "dark"> => inject(themeKey);
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#ciclo-de-vida
 */
export function createContext<T>(description?: string): ContextKey<T> {
  return Symbol(description) as ContextKey<T>;
}

/** Ubicación de una expresión que lee una señal durante desarrollo. */
export type EffectSource = DevtoolsReadSite;

interface Observer {
  run: () => void;
  dependencies: Set<InternalSignal<unknown>>;
  disposed: boolean;
  /** Lecturas atribuidas a tramos concretos durante la última ejecución; sólo en desarrollo. */
  readSites?: { owner: Owner | undefined; bySignal: Map<InternalSignal<unknown>, EffectSource[]> } | undefined;
}

interface Owner {
  observers: Set<Observer>;
  children: Set<() => unknown>;
  parent: Owner | undefined;
  context: Map<symbol, unknown>;
}

interface InternalSignal<T> extends Signal<T> {
  subscribers: Set<Observer> | undefined;
}

const writableSignals = new WeakSet<object>();
const derivedSignals = new WeakSet<object>();
const effectSources = new WeakMap<Observer, { owner: Owner | undefined; source: EffectSource }>();

/** Identifica señales editables creadas por Meeko para conservarlas durante HMR. */
export function isWritableSignal(value: unknown): value is Signal<unknown> {
  return typeof value === "object" && value !== null && writableSignals.has(value) && !derivedSignals.has(value);
}

/** Any signal created by Meeko, writable or derived (`computed`). Internal. */
export function isSignal(value: unknown): value is ReadonlySignal<unknown> {
  return typeof value === "object" && value !== null && writableSignals.has(value);
}

let activeObserver: Observer | undefined;
let activeOwner: Owner | undefined;
let batchDepth = 0;
let flushing = false;
const pending = new Set<Observer>();

/**
 * Publica un valor en la instancia activa y sus descendientes. Las raíces independientes no
 * comparten valores. Si el valor es una señal, los descendientes la leen de forma reactiva.
 *
 * @param key Clave creada con {@link createContext}.
 * @param value Valor que reciben los `inject` de los descendientes.
 * @throws {Error} Sin una raíz de componente activa.
 * @example
 * ```html
 * <!-- app/app.meeko -->
 * <script lang="ts">
 * import { provide, signal } from "@meekojs/meeko";
 * import type { Component } from "@meekojs/meeko";
 * import { themeKey } from "./composables/theme.js";
 * const props = defineProps<{ outlet: Component<Record<string, unknown>> }>();
 * provide(themeKey, signal<"light" | "dark">("dark"));
 * </script>
 * <template><component is="props.outlet"></component></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#ciclo-de-vida
 */
export function provide<T>(key: ContextKey<T>, value: T): void {
  if (!activeOwner) throw new Error("provide() requires an active component root");
  activeOwner.context.set(key, value);
}

/**
 * Lee el valor del proveedor más cercano. Falla si no hay ninguno, en lugar de devolver un valor
 * implícito.
 *
 * @param key Clave creada con {@link createContext}.
 * @returns El valor publicado con `provide`.
 * @throws {Error} `Missing Meeko context` si ningún ancestro publicó la clave.
 * @example
 * ```html
 * <script lang="ts">
 * import { inject } from "@meekojs/meeko";
 * import { themeKey } from "../composables/theme.js";
 * const theme = inject(themeKey);
 * </script>
 * <template><p bind:class="theme.value">Tema {theme.value}</p></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#ciclo-de-vida
 */
export function inject<T>(key: ContextKey<T>): T {
  for (let owner = activeOwner; owner; owner = owner.parent) {
    if (owner.context.has(key)) return owner.context.get(key) as T;
  }
  throw new Error(`Missing Meeko context${key.description ? `: ${key.description}` : ""}`);
}

/** Looks up optional context without creating a process-wide fallback. */
export function findContext<T>(key: ContextKey<T>): T | undefined {
  for (let owner = activeOwner; owner; owner = owner.parent) {
    if (owner.context.has(key)) return owner.context.get(key) as T;
  }
  return undefined;
}

/** Receives a rejection from asynchronous work that an effect or cleanup returned by mistake. */
export type AsyncFailureReporter = (error: unknown, source: "effect" | "cleanup") => void;

const asyncFailureReporterKey = createContext<AsyncFailureReporter>("asynchronous failure reporter");

/** Routes asynchronous effect and cleanup rejections from the active root to an observer. */
export function provideAsyncFailureReporter(reporter: AsyncFailureReporter): void {
  provide(asyncFailureReporterKey, reporter);
}

// Resolved while the owner context is still intact: the rejection arrives after
// a root may already have been disposed and its context cleared.
function asyncFailureReport(owner: Owner | undefined, source: "effect" | "cleanup", label: string): (error: unknown) => void {
  for (let current = owner; current; current = current.parent) {
    if (!current.context.has(asyncFailureReporterKey)) continue;
    const reporter = current.context.get(asyncFailureReporterKey) as AsyncFailureReporter;
    return (error) => observeCallback(() => reporter(error, source),
      (observerError) => logClientError(`${label}; its error observer failed`, observerError, error));
  }
  return (error) => logClientError(label, error);
}

type SyncCleanupCallback<F extends () => unknown> = [Extract<ReturnType<F>, PromiseLike<unknown>>] extends [never] ? F : never;

/**
 * Registra en la raíz activa la liberación síncrona de un recurso externo. Se ejecuta al desmontar
 * o liberar el componente, también tras un render o una hidratación que fallan. TypeScript y el
 * runtime rechazan un callback que devuelve una promesa.
 *
 * @param release Función síncrona que libera el recurso.
 * @throws {Error} Sin una raíz de componente activa.
 * @example
 * ```ts
 * // app/composables/now.ts
 * import { onCleanup, signal } from "@meekojs/meeko";
 * import type { ReadonlySignal } from "@meekojs/meeko";
 *
 * export function useNow(): ReadonlySignal<number> {
 *   const now = signal(Date.now());
 *   const timer = typeof window === "undefined" ? undefined : setInterval(() => { now.value = Date.now(); }, 1_000);
 *   onCleanup(() => clearInterval(timer));
 *   return now;
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#reactividad
 */
export function onCleanup<const F extends () => unknown>(release: SyncCleanupCallback<F>): void {
  if (!activeOwner) throw new Error("onCleanup() requires an active component root");
  activeOwner.children.add(release);
}

function detach(observer: Observer): void {
  for (const dependency of observer.dependencies) dependency.subscribers?.delete(observer);
  observer.dependencies.clear();
  if (observer.readSites) observer.readSites = undefined;
}

function flush(): void {
  if (flushing || batchDepth > 0) return;
  flushing = true;
  const failures: unknown[] = [];
  try {
    let iterations = 0;
    while (pending.size > 0) {
      if (++iterations > 1000) {
        pending.clear();
        failures.push(new Error("Reactive update cycle exceeded 1000 iterations"));
        break;
      }
      const observers = [...pending];
      pending.clear();
      for (const observer of observers) {
        if (observer.disposed) continue;
        try { observer.run(); }
        catch (error) { failures.push(error); }
      }
    }
  } finally {
    flushing = false;
  }
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1) throw new AggregateError(failures, "Meeko reactive observers failed");
}

/**
 * Crea un valor observable y editable. Las escrituras de un valor igual (`Object.is`) no notifican.
 * En el script de un componente, sus señales forman el estado que `renderWithState` transfiere y
 * que HMR conserva por nombre.
 *
 * @param initial Valor inicial.
 * @returns La señal.
 * @example
 * ```html
 * <script lang="ts">
 * import { signal } from "@meekojs/meeko";
 * const count = signal(0);
 * </script>
 * <template><button on:click="() => count.value++">{count.value}</button></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#reactividad
 */
export function signal<T>(initial: T): Signal<T> {
  let current = initial;
  const result: InternalSignal<T> = {
    subscribers: undefined,
    get value() {
      if (activeObserver) {
        (result.subscribers ??= new Set()).add(activeObserver);
        activeObserver.dependencies.add(result as InternalSignal<unknown>);
      }
      return current;
    },
    set value(next: T) {
      if (Object.is(current, next)) return;
      current = next;
      if (result.subscribers) for (const observer of result.subscribers) pending.add(observer);
      flush();
    },
  };
  writableSignals.add(result);
  return result;
}

type SyncEffectCallback<F extends () => unknown> = [Extract<ReturnType<F>, PromiseLike<unknown>>] extends [never] ? F : never;

/**
 * Depth of renders whose output is discarded and that must not touch the browser: the render
 * that loads a client navigation's data before its commit, and the one that loads the data of a
 * component that mounts later. `effect` callbacks do not run there.
 */
let dryDepth = 0;

/**
 * Runs `work` as a dry render: an `effect` created inside never runs and its stop does nothing;
 * `computed` still derives its value. Internal to the framework's data loading.
 */
export function runDry<T>(work: () => T): T {
  dryDepth++;
  try { return work(); }
  finally { dryDepth--; }
}

/**
 * Ejecuta `fn` ahora y cada vez que cambia una señal que leyó. Pertenece a la raíz activa y se
 * libera con ella. El callback debe ser síncrono: TypeScript y el runtime rechazan uno que devuelve
 * una promesa. En SSR sólo se ejecuta la primera vez.
 *
 * @param fn Callback síncrono que lee señales.
 * @param source Ubicación de la expresión para DevTools; la añade el compilador en desarrollo.
 * @returns Una función que detiene el observador.
 * @example
 * ```ts
 * import { effect, signal } from "@meekojs/meeko";
 *
 * const query = signal("");
 * const stop = effect(() => {
 *   document.title = query.value ? `Buscar: ${query.value}` : "Buscar";
 * });
 * query.value = "meeko";
 * stop();
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#reactividad
 */
export function effect<const F extends () => unknown>(fn: SyncEffectCallback<F>, source?: EffectSource): () => void {
  if (dryDepth > 0) return () => {};
  return observe(fn, source);
}

function observe(fn: () => unknown, source?: EffectSource): () => void {
  const owner = activeOwner;
  const observer: Observer = {
    dependencies: new Set(),
    disposed: false,
    run() {
      detach(observer);
      const previous = activeObserver;
      const previousOwner = activeOwner;
      activeObserver = observer;
      activeOwner = owner;
      try {
        const result: unknown = fn();
        if (observeReturnedPromise(result, asyncFailureReport(owner, "effect", "Meeko asynchronous effect rejected"))) {
          stop();
          throw new TypeError("Meeko effect callbacks must be synchronous");
        }
      } finally {
        activeObserver = previous;
        activeOwner = previousOwner;
      }
    },
  };
  if (source) effectSources.set(observer, { owner, source });
  owner?.observers.add(observer);
  function stop(): void {
    observer.disposed = true;
    pending.delete(observer);
    detach(observer);
    owner?.observers.delete(observer);
  }
  try { observer.run(); }
  catch (error) {
    stop();
    throw error;
  }
  return stop;
}

/** Identidad opaca de la raíz reactiva activa; permite aislar instancias anidadas. */
export function currentEffectOwner(): object | undefined {
  return activeOwner;
}

/**
 * Makes `owner` (from `currentEffectOwner`) the active root, without a tracking observer, until
 * the returned function restores the previous ones. A browser continuation of a component uses
 * it to resume its root after each `await`. Internal to compiled components.
 */
export function switchOwner(owner: object | undefined): () => void {
  const previousOwner = activeOwner;
  const previousObserver = activeObserver;
  activeOwner = owner as Owner | undefined;
  activeObserver = undefined;
  return () => {
    activeOwner = previousOwner;
    activeObserver = previousObserver;
  };
}

/** Captures the parent of a component root for a later HMR replacement. */
export function captureParentOwner(): <T>(work: () => T) => T {
  const parent = activeOwner?.parent;
  return <T>(work: () => T): T => {
    const previous = activeOwner;
    activeOwner = parent;
    try { return work(); }
    finally { activeOwner = previous; }
  };
}

/**
 * Atribuye a `source` las señales que lee `read` dentro del observador activo.
 * El compilador sólo lo emite en desarrollo; fuera de un observador ejecuta `read` sin coste añadido.
 */
export function trackReadSite<T>(source: EffectSource, read: () => T): T {
  const outer = activeObserver;
  if (!outer) return read();
  const probe: Observer = { run() {}, dependencies: new Set(), disposed: false };
  activeObserver = probe;
  try {
    return read();
  } finally {
    activeObserver = outer;
    if (!outer.disposed) {
      const sites = outer.readSites ??= { owner: activeOwner, bySignal: new Map() };
      for (const dependency of probe.dependencies) {
        dependency.subscribers?.delete(probe);
        (dependency.subscribers ??= new Set()).add(outer);
        outer.dependencies.add(dependency);
        const list = sites.bySignal.get(dependency);
        if (!list) sites.bySignal.set(dependency, [source]);
        else if (!list.includes(source)) list.push(source);
      }
    } else {
      for (const dependency of probe.dependencies) dependency.subscribers?.delete(probe);
    }
  }
}

/** Crea una vez una lectura atribuida a `source`; el compilador la usa con `computed` en desarrollo. */
export function withReadSite<A extends unknown[], T>(source: EffectSource, read: (...args: A) => T): (...args: A) => T {
  return function (this: unknown, ...args: A): T {
    return trackReadSite(source, () => read.apply(this, args));
  };
}

/** Devuelve las expresiones actualmente dependientes de una señal en una raíz. */
export function signalReadSites(value: Signal<unknown>, owner: object | undefined): EffectSource[] {
  if (!owner || !isWritableSignal(value)) return [];
  const sites = new Map<string, EffectSource>();
  const add = (source: EffectSource): void => {
    const key = `${source.file}\u0000${source.line}\u0000${source.column}\u0000${source.kind}\u0000${source.expression}\u0000${source.name ?? ""}`;
    if (!sites.has(key)) sites.set(key, source);
  };
  const internal = value as InternalSignal<unknown>;
  for (const observer of internal.subscribers ?? []) {
    if (observer.disposed) continue;
    const metadata = effectSources.get(observer);
    if (metadata?.owner === owner) add(metadata.source);
    if (observer.readSites?.owner === owner) for (const source of observer.readSites.bySignal.get(internal) ?? []) add(source);
  }
  return [...sites.values()];
}

/**
 * Deriva un valor de otras señales y lo recalcula cuando cambian. Es de sólo lectura y no forma
 * parte del estado transferido: se vuelve a calcular al hidratar y en HMR.
 *
 * @param fn Función pura que lee señales.
 * @returns Una señal de sólo lectura con el valor derivado.
 * @example
 * ```ts
 * import { computed, signal } from "@meekojs/meeko";
 *
 * const items = signal([{ price: 3 }, { price: 4 }]);
 * const total = computed(() => items.value.reduce((sum, item) => sum + item.price, 0));
 * total.value; // 7
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#reactividad
 */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  const result = signal<T>(undefined as T);
  derivedSignals.add(result);
  // A derived value has no side effects: it keeps working in a dry render.
  observe(() => {
    result.value = fn();
  });
  return result;
}

/**
 * Agrupa varias escrituras en una sola ronda de notificaciones, al terminar `fn`. Si fallan `fn` y
 * algún observador, se conservan ambas causas.
 *
 * @param fn Función que escribe señales.
 * @returns El resultado de `fn`.
 * @example
 * ```ts
 * import { batch, effect, signal } from "@meekojs/meeko";
 *
 * const first = signal("Ada");
 * const last = signal("Lovelace");
 * effect(() => console.log(`${first.value} ${last.value}`));
 * batch(() => {
 *   first.value = "Grace";
 *   last.value = "Hopper";
 * }); // un solo log: "Grace Hopper"
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#reactividad
 */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  return finishWithCleanup(fn, () => {
    batchDepth--;
    flush();
  });
}

/**
 * Ejecuta `fn` leyendo señales sin registrarlas como dependencias del observador activo.
 *
 * @param fn Función que lee señales.
 * @returns El resultado de `fn`.
 * @example
 * ```ts
 * import { effect, signal, untrack } from "@meekojs/meeko";
 *
 * const query = signal("");
 * const page = signal(1);
 * // Sólo se repite al cambiar query; page se lee sin suscribirse.
 * effect(() => console.log(query.value, untrack(() => page.value)));
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#reactividad
 */
export function untrack<T>(fn: () => T): T {
  const previous = activeObserver;
  activeObserver = undefined;
  try {
    return fn();
  } finally {
    activeObserver = previous;
  }
}

/**
 * Crea una raíz reactiva: los efectos, limpiezas y valores de contexto creados dentro de `fn`
 * pertenecen a ella y se liberan al llamar a `dispose`. Los fallos de varias limpiezas se agrupan
 * en un `AggregateError`.
 *
 * @param fn Función que recibe `dispose`.
 * @returns El resultado de `fn`.
 * @example
 * ```ts
 * import { createRoot, effect, signal } from "@meekojs/meeko";
 *
 * const count = signal(0);
 * const dispose = createRoot((dispose) => {
 *   effect(() => console.log(count.value));
 *   return dispose;
 * });
 * dispose(); // detiene el efecto
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#reactividad
 */
export function createRoot<T>(fn: (dispose: () => void) => T): T {
  const owner: Owner = { observers: new Set(), children: new Set(), parent: activeOwner, context: new Map() };
  const previous = activeOwner;
  activeOwner = owner;
  const dispose = () => {
    const failures: unknown[] = [];
    for (const child of [...owner.children]) {
      try {
        const result = child();
        if (observeReturnedPromise(result, asyncFailureReport(owner, "cleanup", "Meeko asynchronous cleanup rejected"))) {
          failures.push(new TypeError("Meeko cleanup callbacks must be synchronous"));
        }
      } catch (error) { failures.push(error); }
    }
    owner.children.clear();
    for (const observer of owner.observers) {
      observer.disposed = true;
      pending.delete(observer);
      detach(observer);
    }
    owner.observers.clear();
    owner.context.clear();
    owner.parent?.children.delete(dispose);
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) throw new AggregateError(failures, "Meeko root cleanup failed");
  };
  owner.parent?.children.add(dispose);
  try {
    return fn(dispose);
  } catch (error) {
    try { dispose(); }
    catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Meeko root setup and cleanup failed");
    }
    throw error;
  } finally {
    activeOwner = previous;
  }
}

/** Runs cleanup on either outcome without losing an earlier failure. */
export function finishWithCleanup<T>(work: () => T, cleanup: () => void): T {
  let failed = false;
  let failure: unknown;
  let value!: T;
  try { value = work(); }
  catch (error) { failed = true; failure = error; }
  try { cleanup(); }
  catch (error) {
    if (failed) throw new AggregateError([failure, error], "Meeko work and cleanup failed");
    throw error;
  }
  if (failed) throw failure;
  return value;
}
