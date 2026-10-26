import { createContext, createRoot, finishWithCleanup, inject, provide, signal } from "../reactivity.js";
import type { Signal } from "../reactivity.js";
import { serializeJson } from "../server.js";

const stateKey = createContext<StateStore>("Meeko framework state");

function assertKey(key: string): void {
  if (!key || key === "__proto__" || key === "constructor" || key === "prototype") throw new TypeError("Invalid state key");
}

/** A server request wrote state after its HTML and payload were produced. */
export class StateSealedError extends Error {
  readonly code = "STATE_SEALED";
  constructor(key: string) {
    super(`STATE_SEALED: Meeko state "${key}" cannot change after the page was rendered; the browser already received it`);
    this.name = "StateSealedError";
  }
}

/** Replaces the setter of a store signal, keeping its identity and its reads. */
function sealSignal(key: string, target: Signal<unknown>): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, "value");
  if (!descriptor?.get || !descriptor.configurable) return;
  Object.defineProperty(target, "value", {
    get: descriptor.get,
    set() { throw new StateSealedError(key); },
    enumerable: descriptor.enumerable ?? true,
    configurable: false,
  });
}

/**
 * Almacén del estado de `useState`: una señal por clave, serializable en JSON. En el servidor hay
 * uno por petición y se transfiere al navegador en el payload; en el navegador hay uno por
 * aplicación montada (`ClientApp.state`). Los hosts propios lo crean y lo pasan a sus loaders.
 *
 * @example
 * ```ts
 * import { StateStore } from "@meekojs/meeko/framework";
 *
 * const state = new StateStore({ theme: "dark" });
 * const theme = state.get("theme", () => "light"); // conserva "dark"
 * const count = state.get("count", () => 0);
 * count.value++;
 * state.snapshot(); // { theme: "dark", count: 1 }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#streaming-ssr-render-stream
 */
export class StateStore {
  private readonly values = new Map<string, Signal<unknown>>();
  #sealed = false;

  /**
   * @param initial Valores iniciales por clave; deben ser serializables en JSON.
   * @throws {TypeError} Si un valor no se puede serializar o una clave no es válida.
   */
  constructor(initial: Readonly<Record<string, unknown>> = {}) {
    serializeJson(initial);
    for (const [key, value] of Object.entries(initial)) { assertKey(key); this.values.set(key, signal(value)); }
  }

  /** `true` cuando el servidor ya transfirió este almacén al navegador. */
  get sealed(): boolean { return this.#sealed; }

  /**
   * Congela el estado de una petición del servidor tras su render síncrono: claves nuevas, `seed`
   * y escrituras lanzan `STATE_SEALED`, porque el payload ya salió.
   */
  seal(): void {
    if (this.#sealed) return;
    this.#sealed = true;
    for (const [key, value] of this.values) sealSignal(key, value);
  }

  /**
   * Devuelve la señal de `key` y la crea con `factory()` si no existe. Es lo que hace `useState`.
   * @throws {TypeError} Si la clave está vacía o es `__proto__`, `constructor` o `prototype`.
   * @throws {StateSealedError} `STATE_SEALED` si la clave es nueva y el almacén está sellado.
   */
  get<T>(key: string, factory: () => T): Signal<T> {
    assertKey(key);
    let value = this.values.get(key);
    if (!value) {
      if (this.#sealed) throw new StateSealedError(key);
      value = signal(factory());
      this.values.set(key, value);
    }
    return value as Signal<T>;
  }

  /** Añade los valores de una navegación posterior del servidor sin sustituir las claves que ya existen. */
  seed(values: Readonly<Record<string, unknown>>): void {
    serializeJson(values);
    const entries = Object.entries(values);
    for (const [key] of entries) assertKey(key);
    if (this.#sealed && entries.length) throw new StateSealedError(entries[0]![0]);
    for (const [key, value] of entries) {
      if (!this.values.has(key)) this.values.set(key, signal(value));
    }
  }

  /** Aplica el estado de una navegación sólo si `commit`, el cambio síncrono del DOM, termina bien. */
  seedForNavigation<T>(values: Readonly<Record<string, unknown>>, commit: () => T): T {
    const previousKeys = new Set(this.values.keys());
    this.seed(values);
    try { return commit(); }
    catch (error) {
      for (const key of this.values.keys()) if (!previousKeys.has(key)) this.values.delete(key);
      throw error;
    }
  }

  /**
   * Da a un loader asíncrono del navegador un estado provisional aislado. `commit(work)` aplica sus
   * cambios al confirmar la ruta, y falla si otra parte cambió esas mismas claves mientras tanto.
   */
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

  /** Copia los valores actuales por clave, comprobando que se pueden serializar en JSON. */
  snapshot(): Record<string, unknown> {
    const result: Record<string, unknown> = Object.create(null);
    for (const [key, value] of this.values) result[key] = value.value;
    serializeJson(result);
    return result;
  }
}

/**
 * Devuelve la señal de estado de la aplicación con clave `key`, creada con `factory()` la primera
 * vez. En SSR es por petición y se transfiere al navegador en el payload; en el navegador se
 * comparte entre los componentes de la aplicación. El valor debe ser serializable en JSON. Se
 * autoimporta y es la base de los stores de `app/stores`.
 *
 * @param key Clave única en la aplicación, como `"cart:items"`.
 * @param factory Valor inicial si la clave no existe todavía.
 * @returns La señal compartida de esa clave.
 * @throws {Error} Fuera de una aplicación de Meeko («Missing Meeko context»).
 * @throws {StateSealedError} `STATE_SEALED` al crear o escribir una clave después de enviar la página.
 * @example
 * ```ts
 * // app/stores/cart.ts
 * import { useState } from "@meekojs/meeko/framework";
 *
 * export function useCart() {
 *   const items = useState("cart:items", (): string[] => []);
 *   const add = (id: string): void => { items.value = [...items.value, id]; };
 *   return { items, add };
 * }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#autoimports-y-typescript
 */
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
