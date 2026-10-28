import { componentErrorReporter } from "./component-errors.js";
import { observeCallback } from "./error-observer.js";
import { enterIdInstance } from "./ids.js";
import { currentEffectOwner, onCleanup, switchOwner, untrack } from "./reactivity.js";

/**
 * What an `onMounted` callback may return: nothing, a synchronous cleanup that runs when the
 * component is released, or a promise whose rejection reaches the component error observer.
 * An asynchronous callback cannot return a cleanup; call `onCleanup` before its first `await`.
 */
export type MountedResult = void | (() => void) | PromiseLike<void>;

type MountedCallback = () => MountedResult;

/** The component is already mounted: a browser continuation of its script runs. */
const mountedNow = "now";

/**
 * `onMounted` callbacks of the component whose setup is running. `null` while a component only
 * renders HTML (SSR, or the render that precedes a client mount); `"now"` inside the browser
 * continuation of a mounted component; `undefined` outside setup.
 */
let activeQueue: MountedCallback[] | null | typeof mountedNow | undefined;

/**
 * Ejecuta `fn` una vez en el navegador, después de que el componente se hidrate o se monte, con sus
 * bindings y refs ya asignados. Nunca se ejecuta en SSR. Los hijos ejecutan el suyo antes que el
 * padre, porque un hijo termina de hidratarse dentro de la plantilla del padre.
 *
 * Si `fn` devuelve una función, se registra como limpieza (`onCleanup`) del componente. Una `fn`
 * asíncrona no puede devolver limpieza: llame a `onCleanup` antes de su primer `await`. Un fallo,
 * síncrono o una promesa rechazada, llega al observador de errores con la fuente `"mounted"`.
 * En las aplicaciones del framework se autoimporta.
 *
 * @param fn Callback que se ejecuta tras montar; puede devolver una limpieza síncrona.
 * @throws {Error} Si se llama fuera del script de un componente.
 * @throws {TypeError} Si `fn` no es una función.
 * @since 1.1.0
 * @example
 * ```html
 * <script lang="ts">
 * import { onMounted, signal } from "@meekojs/meeko";
 * const width = signal(0);
 * onMounted(() => {
 *   const update = (): void => { width.value = window.innerWidth; };
 *   update();
 *   window.addEventListener("resize", update);
 *   return () => window.removeEventListener("resize", update);
 * });
 * </script>
 * <template><p>{width.value}px</p></template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#ciclo-de-vida
 */
export function onMounted(fn: () => MountedResult): void {
  if (activeQueue === null) return;
  if (activeQueue === undefined) throw new Error("onMounted() must be called while a component script runs");
  if (typeof fn !== "function") throw new TypeError("onMounted() expects a function");
  if (activeQueue === mountedNow) runMounted([fn]);
  else activeQueue.push(fn);
}

/**
 * How the running component script executes: `"render"` only produces HTML (SSR, or the render
 * that precedes a client mount), `"mount"` hydrates or mounts it in the browser, or continues it
 * after a browser `await`. `undefined` outside a component script.
 */
export function setupPhase(): "render" | "mount" | undefined {
  if (activeQueue === undefined) return undefined;
  return activeQueue === null ? "render" : "mount";
}

/**
 * Like `onMounted` for Meeko composables: queued while the component hydrates, immediate in a
 * browser continuation and skipped in a render that only produces HTML.
 */
export function whenMounted(fn: () => MountedResult): void {
  onMounted(fn);
}

/** Marks the code that runs until the returned function as a browser continuation. */
export function enterMountedScope(): () => void {
  const previous = activeQueue;
  activeQueue = mountedNow;
  return () => { activeQueue = previous; };
}

/**
 * Runs a component setup and collects its `onMounted` callbacks into `queue`; `null` discards
 * them. It also starts the `useId` counter of the instance. The generated module calls it; it is
 * not part of the public API.
 */
export function collectMounted<T>(queue: MountedCallback[] | null, setup: () => T): T {
  const previous = activeQueue;
  activeQueue = queue;
  // Each run of a component script is one instance: its `useId` calls count from zero.
  const restoreIds = enterIdInstance();
  try { return setup(); }
  finally {
    activeQueue = previous;
    restoreIds();
  }
}

/** `onMounted` callbacks of one hydrated component, waiting for the end of its mount batch. */
interface MountedEntry {
  readonly callbacks: MountedCallback[];
  readonly owner: object | undefined;
  readonly report: (error: unknown) => void;
  released: boolean;
}

/** The mount batch in progress: every component that hydrates inside it queues its callbacks here. */
let batch: MountedEntry[] | undefined;

/** Bindings' work that waits for the end of the mount batch in progress, before its callbacks. */
let settling: Array<() => void> | undefined;

/**
 * Runs `fn` once the mount batch in progress has finished hydrating every binding, before the
 * `onMounted` callbacks of that batch, or at once outside a batch. A binding uses it to write
 * state that other bindings of the same hydration read, such as the value the browser restored
 * in a `model` control: writing it mid-hydration would change regions that have not hydrated yet.
 * `fn` runs untracked and must handle its own errors. The returned function cancels it.
 */
export function afterMountBatch(fn: () => void): () => void {
  if (!settling) {
    untrack(fn);
    return () => {};
  }
  let cancelled = false;
  settling.push(() => { if (!cancelled) untrack(fn); });
  return () => { cancelled = true; };
}

/**
 * Runs a hydration or a mount as one batch: the `onMounted` callbacks of every component that
 * hydrates inside it run only once `work` has finished, children before their parent, each inside
 * its component root. So a callback that writes the state of an ancestor, such as an `emit` in a
 * child's `onMounted`, never meets bindings that are still hydrating. Work deferred with
 * `afterMountBatch` runs first, so those callbacks already see it. A nested batch joins the
 * outer one; a batch that throws drops its callbacks, and a component released before the end of
 * its batch skips them. The generated `hydrateScope` and the bindings that mount regions use it.
 */
export function mountBatch<T>(work: () => T): T {
  if (batch) return work();
  const queue: MountedEntry[] = [];
  const pending: Array<() => void> = [];
  batch = queue;
  settling = pending;
  let result: T;
  try { result = work(); }
  finally {
    batch = undefined;
    settling = undefined;
  }
  for (const run of pending) run();
  for (const entry of queue) {
    if (entry.released) continue;
    const restore = switchOwner(entry.owner);
    try { runCallbacks(entry.callbacks, entry.report); }
    finally { restore(); }
  }
  return result;
}

/**
 * Runs the collected callbacks in order, inside the component root and without tracking reads,
 * or at the end of the mount batch in progress (`mountBatch`). A failure, synchronous or a
 * rejected promise, goes to the component error observer with the source `"mounted"` and does
 * not stop the remaining callbacks or undo the hydration.
 */
export function runMounted(queue: MountedCallback[]): void {
  const callbacks = queue.splice(0);
  if (callbacks.length === 0) return;
  const report = componentErrorReporter("mounted");
  if (batch) {
    const owner = currentEffectOwner();
    const entry: MountedEntry = { callbacks, owner, report, released: false };
    if (owner) onCleanup(() => { entry.released = true; });
    batch.push(entry);
    return;
  }
  runCallbacks(callbacks, report);
}

function runCallbacks(callbacks: readonly MountedCallback[], report: (error: unknown) => void): void {
  for (const callback of callbacks) {
    untrack(() => observeCallback(() => {
      const result = callback();
      if (typeof result !== "function") return result;
      onCleanup(result);
      return undefined;
    }, report));
  }
}
