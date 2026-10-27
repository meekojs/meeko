/**
 * `useStorage`: a signal persisted as JSON in `localStorage` or `sessionStorage`.
 *
 * SSR and the hydration of server HTML use the initial value, so the HTML matches; the stored
 * value reaches the signal once the hydration batch ends (`afterMountBatch`), before `onMounted`.
 * A browser render whose HTML is inserted right away (a region that appears later, a client
 * navigation) reads the stored value first. One signal per key and storage area is shared by every
 * component of the document; the `storage` event of other tabs updates it while a component uses
 * it. Storage that the browser blocks (private mode, quota) never throws: the signal keeps working
 * in memory.
 */
import { componentErrorReporter } from "../component-errors.js";
import { logClientError } from "../error-observer.js";
import { afterMountBatch, setupPhase } from "../lifecycle.js";
import { createContext, findContext, isDryRender, markExternalSignal, onCleanup, provide, signal, untrack } from "../reactivity.js";
import type { Signal } from "../reactivity.js";
import { canSuspendLate } from "../suspense.js";

/**
 * Almacenamiento del navegador de {@link useStorage}: `"local"` (`localStorage`, persiste entre
 * sesiones y pestañas) o `"session"` (`sessionStorage`, sólo la pestaña actual).
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { StorageArea } from "@meekojs/meeko/framework";
 *
 * const area: StorageArea = "session";
 * const draft = useStorage("form:draft", "", { storage: area });
 * ```
 */
export type StorageArea = "local" | "session";

type ValidationResult<T> = { readonly value: T; readonly issues?: undefined } | { readonly issues: readonly unknown[] };

/** A Standard Schema (Valibot, Zod, ArkType…) whose output is `T`. */
type StorageSchema<T> = {
  readonly "~standard": {
    readonly validate: (value: unknown) => ValidationResult<T> | Promise<ValidationResult<T>>;
    readonly types?: { readonly input: unknown; readonly output: T } | undefined;
  };
};

/**
 * Opciones de {@link useStorage}.
 *
 * @typeParam T Tipo del valor guardado.
 * @since 1.2.0
 * @example
 * ```ts
 * import * as v from "valibot";
 * import type { StorageOptions } from "@meekojs/meeko/framework";
 *
 * const options: StorageOptions<string[]> = { storage: "local", schema: v.array(v.string()) };
 * const ids = useStorage("cart:ids", [] as string[], options);
 * ```
 */
export interface StorageOptions<T = unknown> {
  /** Dónde se guarda el valor: `"local"` (por defecto) o `"session"`. */
  readonly storage?: StorageArea;
  /**
   * Standard Schema (Valibot, Zod…) que valida lo que se lee del almacenamiento, también lo que
   * llega de otra pestaña. Un valor que no lo cumple se ignora y la señal usa el valor inicial.
   * Debe validar de forma síncrona.
   */
  readonly schema?: StorageSchema<T>;
}

/** What a read of the storage gives: a decoded value, or nothing usable. */
export type Decoded<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

const browserKey = createContext<Window>("Meeko browser window");

/** Makes the browser window of a mounted application available to its component tree. */
export function provideBrowserWindow(browser: Window): void {
  provide(browserKey, browser);
}

/** The window of the running application, or the global one; `undefined` on the server. */
export function currentBrowser(): Window | undefined {
  return findContext(browserKey) ?? (typeof window === "undefined" ? undefined : window);
}

interface StorageEntry {
  readonly id: string;
  readonly key: string;
  readonly area: StorageArea;
  readonly browser: Window;
  readonly initial: unknown;
  readonly decode: (value: unknown) => Decoded<unknown>;
  readonly signal: Signal<unknown>;
  /** `pending` until the stored value was read: writes stay in memory until then. */
  state: "pending" | "loaded";
  /** The JSON last read or written, so an equal write does not touch the storage again. */
  text: string | null | undefined;
  /** Writes that come from the storage itself are not written back. */
  applying: boolean;
  refs: number;
  readonly reporters: Array<(error: unknown) => void>;
  readonly listener: (event: StorageEvent) => void;
}

/** One registry per window: a storage area belongs to its document. */
const registries = new WeakMap<object, Map<string, StorageEntry>>();

function registryOf(browser: Window): Map<string, StorageEntry> {
  let registry = registries.get(browser);
  if (!registry) {
    registry = new Map();
    registries.set(browser, registry);
  }
  return registry;
}

/** The storage area, or `undefined` when the browser blocks it (a `SecurityError` on access). */
function areaOf(entry: Pick<StorageEntry, "browser" | "area">): Storage | undefined {
  try {
    const storage = entry.area === "session" ? entry.browser.sessionStorage : entry.browser.localStorage;
    return storage ?? undefined;
  } catch {
    return undefined;
  }
}

function report(entry: StorageEntry, error: unknown): void {
  const reporter = entry.reporters[0];
  if (reporter) reporter(error);
  else logClientError(`Meeko useStorage("${entry.key}") failed`, error);
}

/** Decodes stored JSON; corrupt or invalid text gives nothing, a failing schema is reported. */
function decodeText(entry: StorageEntry, text: string | null): Decoded<unknown> {
  if (text === null) return { ok: false };
  let parsed: unknown;
  try { parsed = JSON.parse(text); }
  catch { return { ok: false }; }
  try { return entry.decode(parsed); }
  catch (error) {
    report(entry, error);
    return { ok: false };
  }
}

/** Reads the stored text; a blocked storage reads as empty. */
function readText(entry: StorageEntry): string | null {
  const storage = areaOf(entry);
  if (!storage) return null;
  try { return storage.getItem(entry.key); }
  catch { return null; }
}

/** Writes a value that came from the storage into the signal, without writing it back. */
function apply(entry: StorageEntry, value: unknown, text: string | null): void {
  entry.text = text;
  entry.applying = true;
  try { entry.signal.value = value; }
  finally { entry.applying = false; }
}

/** Reads the stored value into the signal; nothing usable keeps the value in memory. */
function load(entry: StorageEntry): void {
  entry.state = "loaded";
  const text = readText(entry);
  const decoded = decodeText(entry, text);
  if (decoded.ok) apply(entry, decoded.value, text);
}

function persist(entry: StorageEntry, value: unknown): void {
  let text: string | null = null;
  if (value !== undefined) {
    let serialized: string | undefined;
    try { serialized = JSON.stringify(value); }
    catch (error) {
      report(entry, error);
      return;
    }
    if (serialized === undefined) {
      report(entry, new TypeError(`useStorage("${entry.key}") cannot store ${typeof value} values as JSON`));
      return;
    }
    text = serialized;
  }
  if (text === entry.text) return;
  entry.text = text;
  const storage = areaOf(entry);
  if (!storage) return;
  try {
    if (text === null) storage.removeItem(entry.key);
    else storage.setItem(entry.key, text);
  } catch {
    // Blocked or full storage: the value lives in memory for this document.
  }
}

/**
 * A signal of this module: its value comes from the storage, not from the SSR state, so the page
 * state and HMR leave it out (a stored value never travels in the payload).
 */
function detached<T>(value: T): Signal<T> {
  const result = signal(value);
  markExternalSignal(result as Signal<unknown>);
  return result;
}

/** A signal whose writes also persist, once the stored value was read. */
function persistedSignal(initial: unknown, entry: () => StorageEntry): Signal<unknown> {
  const base = detached(initial);
  const descriptor = Object.getOwnPropertyDescriptor(base, "value")!;
  const read = descriptor.get!;
  const write = descriptor.set!;
  Object.defineProperty(base, "value", {
    get: read,
    set(next: unknown) {
      const current = entry();
      if (!current.applying && current.state === "loaded" && !Object.is(untrack(() => read.call(base)), next)) persist(current, next);
      write.call(base, next);
    },
    enumerable: descriptor.enumerable ?? true,
    configurable: true,
  });
  return base;
}

function createEntry(id: string, key: string, area: StorageArea, browser: Window, initial: unknown, decode: (value: unknown) => Decoded<unknown>): StorageEntry {
  const entry: StorageEntry = {
    id, key, area, browser, initial, decode,
    signal: persistedSignal(initial, () => entry),
    state: "pending",
    text: undefined,
    applying: false,
    refs: 0,
    reporters: [],
    listener: (event) => {
      // Another tab changed this key, or cleared the whole storage (`key` is `null`).
      if (entry.state !== "loaded" || (event.key !== null && event.key !== entry.key)) return;
      const storage = areaOf(entry);
      if (!storage || (event.storageArea && event.storageArea !== storage)) return;
      const text = event.key === null ? null : event.newValue;
      const decoded = decodeText(entry, text);
      apply(entry, decoded.ok ? decoded.value : entry.initial, text);
    },
  };
  return entry;
}

/** Ties an entry to the running component: the `storage` listener lives while a component uses it. */
function acquire(entry: StorageEntry, registry: Map<string, StorageEntry>): void {
  const reporter = componentErrorReporter();
  entry.reporters.push(reporter);
  if (++entry.refs === 1) entry.browser.addEventListener("storage", entry.listener);
  onCleanup(() => {
    const index = entry.reporters.indexOf(reporter);
    if (index >= 0) entry.reporters.splice(index, 1);
    if (--entry.refs > 0) return;
    entry.browser.removeEventListener("storage", entry.listener);
    // The next component that uses the key reads it again.
    if (registry.get(entry.id) === entry) registry.delete(entry.id);
  });
}

/**
 * The persisted signal of `key` for the running component script. `useStorage` and the retry-safe
 * mutations share it. `label` names the caller in errors.
 */
export function storageSignal<T>(label: string, key: string, initial: T, area: StorageArea, decode: (value: unknown) => Decoded<T>): Signal<T> {
  if (typeof key !== "string" || key === "") throw new TypeError(`${label} expects a non-empty storage key`);
  if (area !== "local" && area !== "session") throw new TypeError(`${label}: storage must be "local" or "session"`);
  const phase = setupPhase();
  if (!phase) throw new Error(`${label} must be called while a component script runs`);
  const browser = currentBrowser();
  // SSR, and a render outside the browser, never touch the storage.
  if (!browser) return detached(initial);
  const registry = registryOf(browser);
  const id = `${area}:${key}`;
  let entry = registry.get(id);
  if (phase === "render") {
    if (!canSuspendLate()) {
      // A plain render keeps the initial value, like SSR: server-like HTML may hydrate against it.
      if (!isDryRender()) return detached(initial);
      // A dry pass (the data of a navigation or of a later mount) reads a detached copy of the
      // current value, so the data it requests matches the commit; it is never written back.
      const probe = entry ?? createEntry(id, key, area, browser, initial, decode);
      if (probe.refs > 0) return detached(untrack(() => probe.signal.value) as T);
      const decoded = decodeText(probe, readText(probe));
      return detached(decoded.ok ? decoded.value as T : initial);
    }
    // A browser render whose HTML is inserted and hydrated right away already shows the stored value.
    if (!entry) {
      entry = createEntry(id, key, area, browser, initial, decode);
      registry.set(id, entry);
    }
    // An entry no component uses may be stale: read it again.
    if (entry.refs === 0) load(entry);
    return entry.signal as Signal<T>;
  }
  if (!entry) {
    entry = createEntry(id, key, area, browser, initial, decode);
    registry.set(id, entry);
    const created = entry;
    // Hydration renders the initial value, like SSR; the stored value arrives once the whole
    // hydration batch has finished, before onMounted (at once outside a batch).
    afterMountBatch(() => { if (created.state === "pending") load(created); });
  }
  acquire(entry, registry);
  return entry.signal as Signal<T>;
}

/** Validates with a Standard Schema; an asynchronous schema is a programming error. */
function schemaDecoder<T>(label: string, schema: StorageSchema<T> | undefined): (value: unknown) => Decoded<T> {
  if (!schema) return (value) => ({ ok: true, value: value as T });
  if (typeof schema["~standard"]?.validate !== "function") throw new TypeError(`${label}: schema must be a Standard Schema`);
  return (value) => {
    const result = schema["~standard"].validate(value);
    if (result && typeof (result as PromiseLike<unknown>).then === "function") {
      void Promise.resolve(result).catch(() => {});
      throw new TypeError(`${label}: the schema must validate synchronously`);
    }
    const settled = result as ValidationResult<T>;
    return settled.issues ? { ok: false } : { ok: true, value: (settled as { value: T }).value };
  };
}

/**
 * Devuelve una señal editable cuyo valor se guarda como JSON en `localStorage` (o en
 * `sessionStorage` con `storage: "session"`) bajo `key`. Se autoimporta en los archivos `.meeko`.
 *
 * - En SSR y en la primera pasada de la hidratación vale `initial`, así que el HTML coincide; el
 *   valor guardado se aplica justo al terminar la hidratación, antes de `onMounted`. Un componente
 *   que se monta más tarde, o la página de una navegación en el navegador, ya pinta el valor guardado.
 * - Cada escritura se guarda al momento. Asignar `undefined` borra la clave, y la siguiente lectura
 *   vuelve a `initial`. Asigne valores nuevos (`items.value = [...items.value, x]`), como con
 *   cualquier señal: mutar el objeto no lo guarda.
 * - Un valor ilegible, que no es JSON o que no cumple `schema`, se ignora y la señal vale `initial`.
 * - Si el navegador bloquea el almacenamiento (modo privado, cuota llena), nunca lanza: la señal
 *   sigue funcionando en memoria. Sólo un error inesperado, como un valor que no se puede convertir
 *   a JSON o un `schema` que falla, llega al observador de errores más cercano.
 * - Los cambios de otra pestaña llegan por el evento `storage` mientras el componente está montado.
 * - Dos componentes que usan la misma clave y el mismo almacenamiento comparten una sola señal; el
 *   primero fija `initial` y `schema`.
 *
 * @param key Clave del almacenamiento, como `"pos:ticket"`. Inclúyale lo que la distinga entre
 * usuarios o cuentas si comparten navegador.
 * @param initial Valor en SSR, antes de leer el almacenamiento y cuando no hay nada guardado.
 * @param options `storage` y `schema`.
 * @returns La señal compartida de esa clave.
 * @throws {Error} Fuera del script de un componente.
 * @throws {TypeError} Si `key` está vacía o `storage` no es `"local"` ni `"session"`.
 * @since 1.2.0
 * @example
 * ```html
 * <script lang="ts">
 * const theme = useStorage("theme", "light");
 * const toggle = (): void => { theme.value = theme.value === "light" ? "dark" : "light"; };
 * </script>
 * <template><button bind:data-theme="theme.value" on:click="toggle">Tema: {theme.value}</button></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#estado-persistente-usestorage
 */
export function useStorage<T>(key: string, initial: T, options?: StorageOptions<T> & { readonly schema?: undefined }): Signal<T>;
/**
 * Devuelve una señal guardada en el almacenamiento del navegador cuyo valor leído se valida con
 * `schema`; el tipo sale del schema.
 *
 * @param key Clave del almacenamiento.
 * @param initial Valor en SSR, antes de leer el almacenamiento y cuando lo guardado no es válido.
 * @param options `schema` (Standard Schema síncrono) y `storage`.
 * @returns La señal compartida de esa clave.
 * @since 1.2.0
 * @example
 * ```html
 * <script lang="ts">
 * import * as v from "valibot";
 * const lines = useStorage("pos:ticket", [], { schema: v.array(v.object({ id: v.string(), quantity: v.number() })) });
 * </script>
 * <template><p>{lines.value.length} productos</p></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#estado-persistente-usestorage
 */
export function useStorage<T>(key: string, initial: NoInfer<T>, options: StorageOptions<T> & { readonly schema: StorageSchema<T> }): Signal<T>;
export function useStorage<T>(key: string, initial: T, options: StorageOptions<T> = {}): Signal<T> {
  const label = `useStorage("${String(key)}")`;
  return storageSignal(label, key, initial, options.storage ?? "local", schemaDecoder(label, options.schema));
}
