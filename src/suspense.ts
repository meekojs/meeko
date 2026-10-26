/**
 * Suspend and retry for the top-level data `await`s of component scripts.
 *
 * The compiler turns `const notes = await useApi(...)` in the synchronous setup into
 * `awaitData(useApi(...))`. With the data at hand it returns it; otherwise the composable starts
 * the request and throws a `Suspension`. The framework renders a page with
 * `renderWithSuspense`: it waits for every request a pass started and renders again, until a
 * pass completes. A plain `renderToString` has no such loop and fails with `SuspendedRenderError`.
 */

import { runDry, switchOwner } from "./reactivity.js";

/**
 * Thrown through a render pass while data it needs is loading. Never an `Error`. `late` marks a
 * component that mounts after its page (see `lateRender`): it waits outside any pass.
 */
export class Suspension {
  constructor(readonly promise: PromiseLike<unknown>, readonly label: string, readonly late = false) {}
  toString(): string { return `Meeko suspension (${this.label})`; }
}

/** A component suspended where no framework render can wait for it. */
export class SuspendedRenderError extends Error {
  readonly code = "MEEKO_SUSPENDED";
  constructor(label: string) {
    super(`MEEKO_SUSPENDED: ${label} is not loaded and this render cannot wait for it. A top-level await of data resolves only in the framework's page render (SSR, hydration and client navigation) and in regions that mount later in the browser; renderToString needs the data already loaded, or useApi/useRpcQuery without await`);
    this.name = "SuspendedRenderError";
  }
}

/** Key of the synchronous read that `awaitData` performs. */
export const awaitSync: unique symbol = Symbol("meeko.awaitSync");

/** A thenable that a synchronous setup can also read at once: the value, a rejection, or a suspension. */
export interface SyncAwaitable<T> extends PromiseLike<T> {
  [awaitSync](): T;
}

/** The compiled form of a top-level data `await` in the synchronous part of a setup. */
export function awaitData<T>(value: PromiseLike<T>): T {
  const read = (value as Partial<SyncAwaitable<T>> | null | undefined)?.[awaitSync];
  if (typeof read !== "function") throw new TypeError("A top-level await in a .meeko script needs a Meeko data composable such as useApi or useRpcQuery");
  return read.call(value);
}

interface PassCollector {
  readonly promises: Set<PromiseLike<unknown>>;
}

let collector: PassCollector | undefined;

/** True while a render pass of `renderWithSuspense` runs and can wait for data. */
export function canSuspend(): boolean {
  return collector !== undefined;
}

/**
 * Suspends the current render pass until `promise` settles. Outside a pass of
 * `renderWithSuspense` it suspends a component that mounts later (`suspendLate`), or throws
 * `SuspendedRenderError`.
 */
export function suspend(promise: PromiseLike<unknown>, label: string): never {
  if (!collector) suspendLate(label);
  collector.promises.add(promise);
  throw new Suspension(promise, label);
}

/** Whether a failure is a suspension that the current pass records and retries. */
export function isPassSuspension(error: unknown): boolean {
  return collector !== undefined && error instanceof Suspension;
}

/** Depth of browser renders whose HTML a binding inserts and hydrates right away. */
let lateDepth = 0;

/**
 * Runs the render of a region that appears after its page hydrated or committed: an `if:` that
 * becomes true, a new `each:` row, another `<component is>` or new props of a child. A component
 * there that awaits data it does not have suspends with a late `Suspension`; `renderComponent`
 * leaves its region empty and `bindComponent` mounts it once the data has loaded.
 */
export function lateRender<T>(work: () => T): T {
  lateDepth++;
  try { return work(); }
  finally { lateDepth--; }
}

/** True inside `lateRender` and outside a pass of `renderWithSuspense`. */
export function canSuspendLate(): boolean {
  return lateDepth > 0 && collector === undefined;
}

/**
 * Data that a component awaits is missing outside a render pass: a late `Suspension` inside
 * `lateRender`, else `SuspendedRenderError` (a plain `renderToString`).
 */
export function suspendLate(label: string): never {
  if (canSuspendLate()) throw new Suspension(Promise.resolve(), label, true);
  throw new SuspendedRenderError(label);
}

/** Whether a failure is the late suspension of a component that mounts after its page. */
export function isLateSuspension(error: unknown): error is Suspension {
  return error instanceof Suspension && error.late;
}

/**
 * Data of one deferred mount: what the dry passes loaded, for the final render and the
 * hydration. The framework's data composables provide it (`provideDeferredData`).
 */
export interface DeferredData {
  /** Runs one pass: missing data starts loading and suspends the pass. */
  collect<T>(work: () => T): T;
  /** Runs the final render or the hydration with the loaded data. */
  read<T>(work: () => T): T;
  /** Keeps the loaded data for later renders of the application. */
  keep(): void;
}

const noDeferredData: DeferredData = { collect: (work) => work(), read: (work) => work(), keep: () => {} };
let deferredData: ((signal: AbortSignal) => DeferredData) | undefined;

/** Registers how a deferred mount loads data; called once by the framework's data composables. */
export function provideDeferredData(factory: (signal: AbortSignal) => DeferredData): void {
  deferredData = factory;
}

function withOwner<T>(owner: object | undefined, work: () => T): T {
  const restore = switchOwner(owner);
  try { return work(); }
  finally { restore(); }
}

/**
 * Loads what `render` awaits for a component that mounts later, in dry passes under `owner`
 * (the root the component will mount in, for its context): no effect runs, no socket connects
 * and no `onMounted` or browser continuation starts. Resolves with the loaded data once a pass
 * completes; `signal` cancels it.
 */
export async function loadDeferred(owner: object | undefined, render: () => unknown, signal: AbortSignal): Promise<DeferredData> {
  // Out of the binding that found the suspension: the passes never run inside an update.
  await Promise.resolve();
  signal.throwIfAborted();
  const data = withOwner(owner, () => deferredData?.(signal) ?? noDeferredData);
  await renderWithSuspense(() => withOwner(owner, () => data.collect(() => runDry(render))), { signal });
  signal.throwIfAborted();
  return data;
}

/**
 * Static marks of a compiled component module: `hasDataAwait` (its script has a top-level data
 * `await`) and `__meekoChildren` (the components its template renders, or `null` when one of
 * them is chosen at run time). A layout's `<component is="props.outlet">` is not counted.
 */
interface DataAwaitMarks {
  readonly hasDataAwait?: unknown;
  readonly __meekoChildren?: unknown;
}

/**
 * Whether rendering `module` may suspend on data: its own mark, or a child's. A module without
 * marks (hand-written, or compiled by an older Meeko) or with a dynamic child may.
 */
export function mayAwaitData(module: unknown, seen: Set<unknown> = new Set()): boolean {
  if (seen.has(module)) return false;
  seen.add(module);
  const marks = (module ?? {}) as DataAwaitMarks;
  if (typeof marks.hasDataAwait !== "boolean" || typeof marks.__meekoChildren !== "function") return true;
  if (marks.hasDataAwait) return true;
  let children: unknown;
  try { children = (marks.__meekoChildren as () => unknown)(); }
  catch { return true; }
  if (!Array.isArray(children)) return true;
  return children.some((child) => mayAwaitData(child, seen));
}

/** Default bound of `renderWithSuspense`. */
export const maxSuspensePasses = 10;

export interface SuspenseRenderOptions {
  /** Most passes before failing; each pass waits for the requests the previous one started. */
  readonly maxPasses?: number;
  /** Stops waiting between passes. */
  readonly signal?: AbortSignal;
}

/**
 * Renders until no component suspends. Every pass is synchronous and disposes its own roots
 * when a suspension unwinds it; between passes the requests it started settle. A pass may
 * also complete while children suspended inside it (see `renderComponent`): it is discarded too.
 */
export async function renderWithSuspense<T>(render: (pass: number) => T, options: SuspenseRenderOptions = {}): Promise<T> {
  const maxPasses = options.maxPasses ?? maxSuspensePasses;
  for (let pass = 1; ; pass++) {
    const current: PassCollector = { promises: new Set() };
    const previous = collector;
    collector = current;
    let result: T | undefined;
    try {
      result = render(pass);
    } catch (error) {
      if (!(error instanceof Suspension)) throw error;
    } finally {
      collector = previous;
    }
    if (current.promises.size === 0) return result as T;
    if (pass >= maxPasses) {
      throw new Error(`Meeko render still suspended after ${pass} passes; a data await keeps requesting new data`);
    }
    // A rejection is read again by the next pass, which throws it from the awaiting component.
    await Promise.allSettled([...current.promises]);
    options.signal?.throwIfAborted();
  }
}
