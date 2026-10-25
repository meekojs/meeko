import { logClientError, observeCallback, observeReturnedPromise } from "./error-observer.js";

/** Señal de solo lectura que registra dependencias al consultar su valor. */
export interface ReadonlySignal<T> {
  readonly value: T;
}

/** Señal cuyo valor puede actualizarse de forma reactiva. */
export interface Signal<T> extends ReadonlySignal<T> {
  value: T;
}

/** Clave nominal para compartir un valor tipado entre instancias anidadas. */
export type ContextKey<T> = symbol & { readonly __meekoValue?: (value: T) => T };

/** Crea una clave única; el tipo no se infiere de un valor global compartido. */
export function createContext<T>(description?: string): ContextKey<T> {
  return Symbol(description) as ContextKey<T>;
}

/** Ubicación de una expresión de plantilla que lee una señal durante desarrollo. */
export interface EffectSource {
  file: string;
  line: number;
  column: number;
  expression: string;
  kind: "text" | "attribute";
}

interface Observer {
  run: () => void;
  dependencies: Set<InternalSignal<unknown>>;
  disposed: boolean;
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

let activeObserver: Observer | undefined;
let activeOwner: Owner | undefined;
let batchDepth = 0;
let flushing = false;
const pending = new Set<Observer>();

/** Publica un valor en la instancia activa y sus descendientes. */
export function provide<T>(key: ContextKey<T>, value: T): void {
  if (!activeOwner) throw new Error("provide() requires an active component root");
  activeOwner.context.set(key, value);
}

/** Lee el proveedor más cercano; falla si falta para evitar un valor implícito. */
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

/** Registers a synchronous external-resource release with the current component root. */
export function onCleanup<const F extends () => unknown>(release: SyncCleanupCallback<F>): void {
  if (!activeOwner) throw new Error("onCleanup() requires an active component root");
  activeOwner.children.add(release);
}

function detach(observer: Observer): void {
  for (const dependency of observer.dependencies) dependency.subscribers?.delete(observer);
  observer.dependencies.clear();
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

/** Crea un valor observable. Las escrituras iguales no notifican cambios. */
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

/** Ejecuta una función cuando cambian las señales leídas por ella. */
type SyncEffectCallback<F extends () => unknown> = [Extract<ReturnType<F>, PromiseLike<unknown>>] extends [never] ? F : never;

export function effect<const F extends () => unknown>(fn: SyncEffectCallback<F>, source?: EffectSource): () => void {
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

/** Devuelve expresiones de plantilla actualmente dependientes de una señal en una raíz. */
export function signalReadSites(value: Signal<unknown>, owner: object | undefined): EffectSource[] {
  if (!owner || !isWritableSignal(value)) return [];
  const sites = new Map<string, EffectSource>();
  for (const observer of (value as InternalSignal<unknown>).subscribers ?? []) {
    const metadata = effectSources.get(observer);
    if (observer.disposed || metadata?.owner !== owner || !metadata) continue;
    const source = metadata.source;
    const key = `${source.file}\u0000${source.line}\u0000${source.column}\u0000${source.kind}\u0000${source.expression}`;
    sites.set(key, source);
  }
  return [...sites.values()];
}

/** Deriva un valor de otras señales y lo actualiza cuando cambian. */
export function computed<T>(fn: () => T): ReadonlySignal<T> {
  const result = signal<T>(undefined as T);
  derivedSignals.add(result);
  effect(() => {
    result.value = fn();
  });
  return result;
}

/** Agrupa varias escrituras en una sola ronda de notificaciones. */
export function batch<T>(fn: () => T): T {
  batchDepth++;
  return finishWithCleanup(fn, () => {
    batchDepth--;
    flush();
  });
}

/** Lee señales sin registrar dependencias en el observador activo. */
export function untrack<T>(fn: () => T): T {
  const previous = activeObserver;
  activeObserver = undefined;
  try {
    return fn();
  } finally {
    activeObserver = previous;
  }
}

/** Asocia efectos a una instancia y entrega una función para liberarlos. */
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
