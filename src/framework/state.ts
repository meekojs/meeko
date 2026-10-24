import { createContext, createRoot, inject, provide, signal } from "../reactivity.js";
import type { Signal } from "../reactivity.js";
import { serializeJson } from "../server.js";

const stateKey = createContext<StateStore>("Meeko framework state");

function assertKey(key: string): void {
  if (!key || key === "__proto__" || key === "constructor" || key === "prototype") throw new TypeError("Invalid state key");
}

export class StateStore {
  private readonly values = new Map<string, Signal<unknown>>();

  constructor(initial: Readonly<Record<string, unknown>> = {}) {
    serializeJson(initial);
    for (const [key, value] of Object.entries(initial)) { assertKey(key); this.values.set(key, signal(value)); }
  }

  get<T>(key: string, factory: () => T): Signal<T> {
    assertKey(key);
    let value = this.values.get(key);
    if (!value) {
      value = signal(factory());
      this.values.set(key, value);
    }
    return value as Signal<T>;
  }

  /** Seeds values returned by a later server navigation without replacing local state. */
  seed(values: Readonly<Record<string, unknown>>): void {
    serializeJson(values);
    for (const [key, value] of Object.entries(values)) {
      assertKey(key);
      if (!this.values.has(key)) this.values.set(key, signal(value));
    }
  }

  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, value] of this.values) result[key] = value.value;
    serializeJson(result);
    return result;
  }
}

/** One keyed signal per application request or browser app instance. */
export function useState<T>(key: string, factory: () => T): Signal<T> {
  return inject(stateKey).get(key, factory);
}

/** Runs synchronous SSR rendering with a state provider and releases its root. */
export function withStateStore<T>(store: StateStore, render: () => T): T {
  return createRoot((dispose) => {
    provide(stateKey, store);
    try { return render(); }
    finally { dispose(); }
  });
}

/** Keeps the provider alive until the hydrated component is released. */
export function hydrateWithStateStore(store: StateStore, hydrate: () => () => void): () => void {
  return createRoot((dispose) => {
    provide(stateKey, store);
    const release = hydrate();
    return () => { try { release(); } finally { dispose(); } };
  });
}
