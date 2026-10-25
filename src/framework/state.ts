import { createContext, createRoot, finishWithCleanup, inject, provide, signal } from "../reactivity.js";
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
    const entries = Object.entries(values);
    for (const [key] of entries) assertKey(key);
    for (const [key, value] of entries) {
      if (!this.values.has(key)) this.values.set(key, signal(value));
    }
  }

  /** Applies navigation state only if the synchronous DOM commit succeeds. */
  seedForNavigation<T>(values: Readonly<Record<string, unknown>>, commit: () => T): T {
    const previousKeys = new Set(this.values.keys());
    this.seed(values);
    try { return commit(); }
    catch (error) {
      for (const key of this.values.keys()) if (!previousKeys.has(key)) this.values.delete(key);
      throw error;
    }
  }

  /** Gives an async client loader isolated signals until its route commits. */
  navigationDraft(): { state: StateStore; commit<T>(work: () => T): T } {
    const initial = JSON.parse(serializeJson(this.snapshot())) as Record<string, unknown>;
    const draft = new StateStore(initial);
    return {
      state: draft,
      commit: <T>(work: () => T): T => {
        const next = draft.snapshot();
        const changed = Object.entries(next).filter(([key, value]) =>
          !Object.hasOwn(initial, key) || serializeJson(value) !== serializeJson(initial[key]));
        const current = this.snapshot();
        for (const [key] of changed) {
          if (Object.hasOwn(current, key) !== Object.hasOwn(initial, key)
            || (Object.hasOwn(initial, key) && serializeJson(current[key]) !== serializeJson(initial[key]))) {
            throw new Error(`Meeko state changed while navigating: ${key}`);
          }
        }
        const previous = new Map([...this.values].map(([key, value]) => {
          const serialized = serializeJson(value.value);
          return [key, { signal: value, serialized, value: JSON.parse(serialized) as unknown }] as const;
        }));
        try {
          for (const [key, value] of changed) {
            const existing = this.values.get(key);
            if (existing) existing.value = value;
            else this.values.set(key, signal(value));
          }
          return work();
        } catch (error) {
          const failures: unknown[] = [error];
          for (const key of this.values.keys()) if (!previous.has(key)) this.values.delete(key);
          for (const [key, prior] of previous) {
            this.values.set(key, prior.signal);
            let unchanged = false;
            try { unchanged = serializeJson(prior.signal.value) === prior.serialized; }
            catch { /* A now-invalid value still needs restoration. */ }
            if (!unchanged) {
              try { prior.signal.value = prior.value; }
              catch (restoreError) { failures.push(restoreError); }
            }
          }
          if (failures.length > 1) throw new AggregateError(failures, "Meeko navigation state recovery failed");
          throw error;
        }
      },
    };
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
    return finishWithCleanup(render, dispose);
  });
}

/** Keeps the provider alive until the hydrated component is released. */
export function hydrateWithStateStore(store: StateStore, hydrate: () => () => void): () => void {
  return createRoot((dispose) => {
    provide(stateKey, store);
    const release = hydrate();
    return () => finishWithCleanup(release, dispose);
  });
}
