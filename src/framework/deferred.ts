import { signal } from "../reactivity.js";
import type { Signal } from "../reactivity.js";

/** Lifecycle of a value returned with `defer`. */
export type DeferredStatus = "pending" | "resolved" | "rejected";

/** Public failure of a deferred value; private details stay in the server's `onError`. */
export interface DeferredError {
  readonly code: string;
  readonly status: number;
}

export interface DeferOptions {
  /** Milliseconds, counted from when the loader returns; defaults to 10 000. */
  readonly timeoutMs?: number;
}

/**
 * Starts deferred work when the loader returns. `signal` aborts when the value
 * stops being awaited: timeout, client disconnect, session revocation, a
 * cancelled stream, a `HEAD` request or, in the browser, leaving the route.
 */
export type DeferredFactory<T> = (signal: AbortSignal) => PromiseLike<T> | T;

/**
 * A loader value that may arrive after the page. Reading `status`, `value` or
 * `error` inside a template or effect subscribes to its settlement.
 */
export interface Deferred<T> {
  readonly status: DeferredStatus;
  readonly value: T | undefined;
  readonly error: DeferredError | undefined;
}

/** Settled form of a deferred value; `value` is absent when it resolved to `undefined`. */
export type DeferredOutcome =
  | { readonly status: "resolved"; readonly value?: unknown }
  | { readonly status: "rejected"; readonly error: DeferredError };

export const DEFAULT_DEFER_TIMEOUT_MS = 10_000;

// Symbol.for keeps detection working when two copies of Meeko share a process.
const brand = Symbol.for("meeko.deferred");
/** @internal The source work and timeout of a value created with `defer`. */
export const deferredSource = Symbol.for("meeko.deferred.source");
/** @internal Settles a value once; later calls are ignored. */
export const deferredSettle = Symbol.for("meeko.deferred.settle");

interface DeferredSnapshot {
  readonly status: DeferredStatus;
  readonly value: unknown;
  readonly error: DeferredError | undefined;
}

export interface DeferredSourceRecord {
  /** Starts the work once; later calls return the same promise. */
  readonly start: (signal: AbortSignal) => Promise<unknown>;
  readonly timeoutMs: number;
}

/** @internal Runtime shape shared by server and browser copies of a deferred value. */
export interface DeferredInternals<T = unknown> extends Deferred<T> {
  readonly [deferredSource]: DeferredSourceRecord | undefined;
  [deferredSettle](outcome: DeferredOutcome): void;
}

class DeferredValue<T> implements DeferredInternals<T> {
  readonly #state: Signal<DeferredSnapshot>;
  readonly [deferredSource]: DeferredSourceRecord | undefined;

  constructor(source: DeferredSourceRecord | undefined) {
    this.#state = signal<DeferredSnapshot>({ status: "pending", value: undefined, error: undefined });
    this[deferredSource] = source;
    Object.defineProperty(this, brand, { value: true });
  }

  get status(): DeferredStatus { return this.#state.value.status; }
  get value(): T | undefined { return this.#state.value.value as T | undefined; }
  get error(): DeferredError | undefined { return this.#state.value.error; }

  [deferredSettle](outcome: DeferredOutcome): void {
    if (this.#state.value.status !== "pending") return;
    this.#state.value = outcome.status === "resolved"
      ? { status: "resolved", value: outcome.value, error: undefined }
      : { status: "rejected", value: undefined, error: { code: outcome.error.code, status: outcome.error.status } };
  }
}

/**
 * Lets a `render: "stream"` page send its HTML before the value settles. With
 * `render: "ssr"` or `"prerender"` the server awaits it before rendering, so
 * the HTML always contains the settled value. A factory receives an
 * `AbortSignal` that aborts when the value stops being awaited; a promise that
 * is already running is only abandoned.
 */
export function defer<T>(factory: DeferredFactory<T>, options?: DeferOptions): Deferred<T>;
export function defer<T>(promise: PromiseLike<T> | T, options?: DeferOptions): Deferred<T>;
export function defer<T>(source: DeferredFactory<T> | PromiseLike<T> | T, options: DeferOptions = {}): Deferred<T> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_DEFER_TIMEOUT_MS;
  if (typeof timeoutMs !== "number" || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("defer timeoutMs must be a positive finite number of milliseconds");
  }
  let started: Promise<unknown> | undefined;
  const start = typeof source === "function"
    ? (signal: AbortSignal): Promise<unknown> => started ??= new Promise((resolve) => resolve((source as DeferredFactory<T>)(signal)))
    : (): Promise<unknown> => started ??= Promise.resolve(source);
  // A running promise is observed by the host later; an early rejection is not unhandled.
  if (typeof source !== "function") void start(new AbortController().signal).catch(() => {});
  return new DeferredValue<T>({ start, timeoutMs });
}

/** @internal A value whose outcome comes from the server payload or a streamed chunk. */
export function createDeferred(outcome?: DeferredOutcome): DeferredInternals {
  const value = new DeferredValue<unknown>(undefined);
  if (outcome) value[deferredSettle](outcome);
  return value;
}

export function isDeferred(value: unknown): value is DeferredInternals {
  return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[brand] === true;
}

export type DeferredPath = readonly (string | number)[];

export interface FoundDeferred {
  readonly path: DeferredPath;
  readonly deferred: DeferredInternals;
}

/**
 * Returns a copy of `value` with every deferred value replaced by `null`, and
 * their paths. Only plain objects and arrays are traversed; anything else is
 * left for `serializeJson` to accept or reject.
 */
export function extractDeferred(value: unknown, path: DeferredPath = []): { value: unknown; found: FoundDeferred[] } {
  const found: FoundDeferred[] = [];
  const ancestors = new Set<object>();
  const visit = (current: unknown, at: DeferredPath): unknown => {
    if (isDeferred(current)) {
      // The browser refuses this key when it places the value; fail at render instead.
      if (at.includes("__proto__")) throw new TypeError(`A deferred value cannot be placed under a "__proto__" key: ${at.join(".")}`);
      found.push({ path: at, deferred: current });
      return null;
    }
    if (typeof current !== "object" || current === null || ancestors.has(current)) return current;
    const before = found.length;
    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        const copy = current.map((item, index) => visit(item, [...at, index]));
        return found.length === before ? current : copy;
      }
      const prototype: unknown = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) return current;
      const copy: Record<string, unknown> = Object.create(prototype as object | null);
      for (const key of Object.keys(current)) {
        const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
        const next = "value" in descriptor ? visit(descriptor.value, [...at, key]) : undefined;
        Object.defineProperty(copy, key, "value" in descriptor ? { value: next, enumerable: true, writable: true, configurable: true } : descriptor);
      }
      return found.length === before ? current : copy;
    } finally {
      ancestors.delete(current);
    }
  };
  return { value: visit(value, path), found };
}

/**
 * Puts a deferred value at a payload path that holds `null`; returns false for
 * an invalid path. Every step must be an own property, so `constructor` and
 * `prototype` are ordinary keys; `__proto__` is refused on both sides.
 */
export function placeDeferred(root: Record<string, unknown>, path: DeferredPath, value: Deferred<unknown>): boolean {
  if (path.length === 0) return false;
  let container: unknown = root;
  for (let index = 0; index < path.length; index++) {
    const key = path[index]!;
    if (typeof container !== "object" || container === null) return false;
    if (Array.isArray(container)) {
      if (typeof key !== "number" || !Number.isInteger(key) || key < 0 || key >= container.length) return false;
    } else if (typeof key !== "string" || key === "__proto__" || !Object.hasOwn(container, key)) return false;
    const target = container as Record<string | number, unknown>;
    if (index === path.length - 1) {
      if (target[key] !== null) return false;
      Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
      return true;
    }
    container = target[key];
  }
  return false;
}
