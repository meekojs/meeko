import { signal } from "../reactivity.js";
import type { Signal } from "../reactivity.js";

/**
 * Estado de un valor devuelto con `defer`. Puede ganar miembros en un minor: un `switch`
 * exhaustivo necesita rama por defecto.
 *
 * @example
 * ```ts
 * import type { DeferredStatus } from "@meekojs/meeko/framework";
 *
 * const labels: Record<DeferredStatus, string> = { pending: "Cargando…", resolved: "Listo", rejected: "Error" };
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#streaming-ssr-render-stream
 */
export type DeferredStatus = "pending" | "resolved" | "rejected";

/**
 * Fallo público de un valor diferido. Los detalles privados se quedan en el `onError` del
 * servidor: un `ApiError` conserva su código y estado, y cualquier otro error llega como
 * `INTERNAL_ERROR`/`500`. Un plazo agotado es `DEFERRED_TIMEOUT`/`504`.
 *
 * @example
 * ```html
 * <p if:when="props.data.comments.status === 'rejected'">
 *   No se pudieron cargar ({props.data.comments.error?.code}).
 * </p>
 * ```
 */
export interface DeferredError {
  /** Código público, como `DEFERRED_TIMEOUT` o `SESSION_REVOKED`. */
  readonly code: string;
  /** Estado HTTP equivalente. */
  readonly status: number;
}

/**
 * Opciones de {@link defer}.
 *
 * @example
 * ```ts
 * import { defer } from "@meekojs/meeko/framework";
 *
 * const comments = defer((signal) => fetch("/api/comments", { signal }).then((r) => r.json()), { timeoutMs: 5_000 });
 * ```
 */
export interface DeferOptions {
  /** Plazo en milisegundos, contado desde que el loader devuelve; 10 000 por defecto. */
  readonly timeoutMs?: number;
}

/**
 * Fábrica de un valor diferido: Meeko la llama cuando el loader devuelve. `signal` se aborta cuando
 * el valor deja de esperarse: plazo agotado, cliente desconectado, sesión revocada, stream
 * cancelado, petición `HEAD` o, en el navegador, al salir de la ruta.
 *
 * @example
 * ```ts
 * import type { DeferredFactory } from "@meekojs/meeko/framework";
 *
 * const loadComments: DeferredFactory<string[]> = async (signal) => {
 *   const response = await fetch("https://api.example.com/comments", { signal });
 *   return response.json();
 * };
 * ```
 */
export type DeferredFactory<T> = (signal: AbortSignal) => PromiseLike<T> | T;

/**
 * Valor del loader que puede llegar después de la página. Leer `status`, `value` o `error` en una
 * plantilla o un `effect` se suscribe a su resultado.
 *
 * @example
 * ```html
 * <p if:when="props.data.comments.status === 'pending'">Cargando comentarios…</p>
 * <ul if:when="props.data.comments.status === 'resolved'">
 *   <li each:of="props.data.comments.value ?? []" each:as="comment">{comment.text}</li>
 * </ul>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#streaming-ssr-render-stream
 */
export interface Deferred<T> {
  /** `"pending"` hasta que el valor se resuelve o se rechaza. */
  readonly status: DeferredStatus;
  /** Valor resuelto, o `undefined` mientras no lo está. */
  readonly value: T | undefined;
  /** Fallo público si se rechazó. */
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
 * Marca un dato del loader que puede llegar después de la página. Con `render: "stream"` el HTML
 * se envía antes de que el valor se resuelva y el valor llega después por la misma respuesta. Con
 * `"ssr"` o `"prerender"` el servidor lo espera antes de renderizar, así que el HTML siempre lo
 * contiene. Una fábrica recibe un `AbortSignal` que se aborta cuando el valor deja de esperarse.
 *
 * @param factory Fábrica que Meeko llama cuando el loader devuelve.
 * @param options `timeoutMs`, 10 000 por defecto.
 * @returns El valor diferido, con `status`, `value` y `error` reactivos.
 * @throws {RangeError} Si `timeoutMs` no es un número finito positivo.
 * @example
 * ```ts
 * // app/pages/posts/[id].route.ts
 * import { defer, definePage } from "@meekojs/meeko/framework";
 *
 * export const route = definePage({
 *   render: "stream",
 *   load: async ({ params }) => ({
 *     post: await api.posts.get({ params }),
 *     comments: defer((signal) => api.comments.list({ params, signal }), { timeoutMs: 5_000 }),
 *   }),
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#streaming-ssr-render-stream
 */
export function defer<T>(factory: DeferredFactory<T>, options?: DeferOptions): Deferred<T>;
/**
 * Marca una promesa ya iniciada como dato diferido. Meeko sólo puede dejar de esperarla, no
 * cancelarla; use una fábrica para poder abortar el trabajo.
 *
 * @param promise Promesa o valor.
 * @param options `timeoutMs`, 10 000 por defecto.
 * @returns El valor diferido.
 * @throws {RangeError} Si `timeoutMs` no es un número finito positivo.
 */
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
