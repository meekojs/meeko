/** Señal de solo lectura que registra dependencias al consultar su valor. */
export interface ReadonlySignal<T> {
  readonly value: T;
}

/** Señal cuyo valor puede actualizarse de forma reactiva. */
export interface Signal<T> extends ReadonlySignal<T> {
  value: T;
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
  children: Set<() => void>;
  parent: Owner | undefined;
}

interface InternalSignal<T> extends Signal<T> {
  subscribers: Set<Observer>;
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

function detach(observer: Observer): void {
  for (const dependency of observer.dependencies) dependency.subscribers.delete(observer);
  observer.dependencies.clear();
}

function flush(): void {
  if (flushing || batchDepth > 0) return;
  flushing = true;
  try {
    let iterations = 0;
    while (pending.size > 0) {
      if (++iterations > 1000) throw new Error("Reactive update cycle exceeded 1000 iterations");
      const observers = [...pending];
      pending.clear();
      for (const observer of observers) if (!observer.disposed) observer.run();
    }
  } finally {
    flushing = false;
  }
}

/** Crea un valor observable. Las escrituras iguales no notifican cambios. */
export function signal<T>(initial: T): Signal<T> {
  let current = initial;
  const subscribers = new Set<Observer>();
  const result: InternalSignal<T> = {
    subscribers,
    get value() {
      if (activeObserver) {
        subscribers.add(activeObserver);
        activeObserver.dependencies.add(result as InternalSignal<unknown>);
      }
      return current;
    },
    set value(next: T) {
      if (Object.is(current, next)) return;
      current = next;
      for (const observer of subscribers) pending.add(observer);
      flush();
    },
  };
  writableSignals.add(result);
  return result;
}

/** Ejecuta una función cuando cambian las señales leídas por ella. */
export function effect(fn: () => void, source?: EffectSource): () => void {
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
        fn();
      } finally {
        activeObserver = previous;
        activeOwner = previousOwner;
      }
    },
  };
  if (source) effectSources.set(observer, { owner, source });
  owner?.observers.add(observer);
  observer.run();
  return () => {
    observer.disposed = true;
    pending.delete(observer);
    detach(observer);
    owner?.observers.delete(observer);
  };
}

/** Identidad opaca de la raíz reactiva activa; permite aislar instancias anidadas. */
export function currentEffectOwner(): object | undefined {
  return activeOwner;
}

/** Devuelve expresiones de plantilla actualmente dependientes de una señal en una raíz. */
export function signalReadSites(value: Signal<unknown>, owner: object | undefined): EffectSource[] {
  if (!owner || !isWritableSignal(value)) return [];
  const sites = new Map<string, EffectSource>();
  for (const observer of (value as InternalSignal<unknown>).subscribers) {
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
  try {
    return fn();
  } finally {
    batchDepth--;
    flush();
  }
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
  const owner: Owner = { observers: new Set(), children: new Set(), parent: activeOwner };
  const previous = activeOwner;
  activeOwner = owner;
  const dispose = () => {
    for (const child of [...owner.children]) child();
    owner.children.clear();
    for (const observer of owner.observers) {
      observer.disposed = true;
      pending.delete(observer);
      detach(observer);
    }
    owner.observers.clear();
    owner.parent?.children.delete(dispose);
  };
  owner.parent?.children.add(dispose);
  try {
    return fn(dispose);
  } catch (error) {
    dispose();
    throw error;
  } finally {
    activeOwner = previous;
  }
}
