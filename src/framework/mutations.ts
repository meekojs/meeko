/**
 * Mutations of `useRpcMutation` and `useApiMutation`, and their retry-safe mode.
 *
 * A retry-safe mutation saves its intent (input and a client-generated idempotency key) in the
 * browser storage before sending it, and sends that key in the `Idempotency-Key` header. A request
 * without an answer (a network failure, a 5xx, 408 or 429) keeps the intent: `uncertain` shows it,
 * and it is sent again with the same key on `retry()`, when the browser comes back `online` and
 * when a component that uses it mounts, also after a reload. An answer (2xx or another 4xx)
 * settles it. The server deduplicates by that key; Meeko only carries it.
 */
import { whenMounted } from "../lifecycle.js";
import { batch, computed, signal, untrack } from "../reactivity.js";
import type { ReadonlySignal, Signal } from "../reactivity.js";
import { ClientError } from "./clients.js";
import { currentBrowser, storageSignal } from "./storage.js";
import type { Decoded, StorageArea } from "./storage.js";

/**
 * Opciones del modo `retrySafe` de `useRpcMutation` y `useApiMutation`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { RetrySafeOptions } from "@meekojs/meeko/framework";
 *
 * const retrySafe: RetrySafeOptions = { key: "pos:sale" };
 * const charge = useRpcMutation("sales.checkout", { retrySafe });
 * ```
 */
export interface RetrySafeOptions {
  /**
   * Clave del almacenamiento donde se guarda la intención mientras su resultado es incierto, como
   * `"pos:sale"`. Use una clave por mutación: dos componentes con la misma clave comparten la
   * intención. Inclúyale lo que la distinga entre usuarios o cuentas si comparten navegador.
   */
  readonly key: string;
  /** `"local"` (por defecto) sobrevive a una recarga y a cerrar el navegador; `"session"`, sólo a una recarga. */
  readonly storage?: StorageArea;
}

/**
 * Opciones de `useRpcMutation` y `useApiMutation`.
 *
 * @since 1.2.0
 * @example
 * ```ts
 * import type { MutationOptions } from "@meekojs/meeko/framework";
 *
 * const options: MutationOptions = { retrySafe: { key: "kitchen:step", storage: "session" } };
 * const step = useRpcMutation("kitchen.step", options);
 * ```
 */
export interface MutationOptions {
  /**
   * Hace la mutación segura ante reintentos: cada intención lleva una clave de idempotencia
   * (cabecera `Idempotency-Key`), se guarda antes de enviarse y, si no hay respuesta, se reintenta
   * con la misma clave. Véase {@link RetrySafeMutation}.
   */
  readonly retrySafe?: RetrySafeOptions;
}

/**
 * Una intención enviada sin respuesta: el servidor pudo aplicarla o no. La expone
 * {@link RetrySafeMutation.uncertain}.
 *
 * @typeParam Input Entrada de la mutación.
 * @since 1.2.0
 * @example
 * ```ts
 * import type { UncertainMutation } from "@meekojs/meeko/framework";
 *
 * function describe(intent: UncertainMutation<{ totalCents: number }>): string {
 *   const minutes = Math.round((Date.now() - intent.startedAt) / 60_000);
 *   return `Venta de ${intent.input.totalCents / 100} € sin confirmar desde hace ${minutes} min`;
 * }
 * ```
 */
export interface UncertainMutation<Input> {
  /** UUID que viaja en la cabecera `Idempotency-Key`; es el mismo en cada reintento. */
  readonly idempotencyKey: string;
  /** Entrada que se envió, tal como viaja en JSON. */
  readonly input: Input;
  /** Momento del primer envío, en milisegundos desde la época Unix (`Date.now()`). */
  readonly startedAt: number;
}

/**
 * Lo que añade `retrySafe` a una mutación. `mutate(input)` guarda la intención antes de enviarla
 * con una clave de idempotencia nueva y rechaza con un error `MUTATION_UNCERTAIN` mientras haya
 * otra intención incierta con la misma clave de almacenamiento: resuélvala antes con `retry()` o
 * `discard()`.
 *
 * - Sin respuesta (fallo de red, `5xx`, `408` o `429`): la intención se conserva, `uncertain` la
 *   muestra y `mutate` rechaza con el error. Se reintenta con la misma clave al volver la conexión
 *   (evento `online`), al montarse un componente que la usa (también tras recargar) o con `retry()`.
 * - Con respuesta: un `2xx` la borra y resuelve con la salida; otro `4xx` la borra y rechaza con
 *   su `ClientError`, que también queda en `error`.
 * - Nunca se envía en SSR ni en una pasada en seco.
 *
 * @typeParam Input Entrada de la mutación.
 * @typeParam Output Salida de la mutación.
 * @since 1.2.0
 * @example
 * ```html
 * <script lang="ts">
 * const charge = useRpcMutation("sales.checkout", { retrySafe: { key: "pos:sale" } });
 * function discard(): void {
 *   if (window.confirm("Descártala sólo si comprobaste que no se registró.")) charge.discard();
 * }
 * </script>
 * <template>
 *   <div role="alert" if:when="charge.uncertain.value">
 *     <p>Venta en verificación: se reintentará con la misma clave, sin cobrar dos veces.</p>
 *     <button bind:disabled="charge.pending.value" on:click="() => charge.retry().catch(() => {})">Reintentar</button>
 *     <button on:click="discard">Descartar</button>
 *   </div>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#mutaciones-seguras-ante-reintentos
 */
export interface RetrySafeMutation<Input, Output> {
  /** La intención enviada sin respuesta, o `null`. Mientras se reintenta conserva su valor. */
  readonly uncertain: ReadonlySignal<UncertainMutation<Input> | null>;
  /**
   * Reenvía la intención incierta con la misma clave de idempotencia. Resuelve con la salida, con
   * `undefined` si no hay ninguna, o rechaza con el error del intento.
   */
  retry(): Promise<Output | undefined>;
  /** Olvida la intención incierta sin reenviarla; pida antes confirmación al usuario. */
  discard(): void;
}

/** What a mutation sends: the input as JSON, with the framework's headers. */
export interface MutationTransport {
  readonly label: string;
  /** Identifies the endpoint, so an intent saved by another mutation is never sent here. */
  readonly target: string;
  readonly send: (input: unknown, headers: Readonly<Record<string, string>> | undefined) => Promise<unknown>;
}

/** Signals and `mutate` of every mutation, with the retry-safe members when enabled. */
export interface MutationState {
  readonly pending: ReadonlySignal<boolean>;
  readonly error: ReadonlySignal<Error | null>;
  readonly data: ReadonlySignal<unknown>;
  mutate(input?: unknown): Promise<unknown>;
  readonly uncertain?: ReadonlySignal<UncertainMutation<unknown> | null>;
  retry?(): Promise<unknown>;
  discard?(): void;
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A random (version 4) UUID. `crypto.randomUUID` only exists in secure contexts; a point of sale
 * served over plain HTTP in a local network still gets one from `getRandomValues`.
 */
export function randomUuid(): string {
  const source = globalThis.crypto;
  if (typeof source?.randomUUID === "function") return source.randomUUID();
  if (typeof source?.getRandomValues !== "function") throw new Error("Retry-safe mutations need crypto.getRandomValues to create idempotency keys");
  const bytes = source.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** The `Idempotency-Key` header: a Structured Field string, as the IETF draft defines it. */
function idempotencyHeader(key: string): Record<string, string> {
  return { "idempotency-key": `"${key}"` };
}

/** The server answered: the intent is settled. 408 and 429 mean it was not processed, so it is kept. */
function answered(failure: unknown): boolean {
  return failure instanceof ClientError && failure.status < 500 && failure.status !== 408 && failure.status !== 429;
}

interface StoredIntent extends UncertainMutation<unknown> {
  readonly target: string;
}

function intentDecoder(target: string): (value: unknown) => Decoded<StoredIntent | undefined> {
  return (value) => {
    if (value === null) return { ok: true, value: undefined };
    if (!value || typeof value !== "object") return { ok: false };
    const record = value as Record<string, unknown>;
    if (typeof record.idempotencyKey !== "string" || !UUID.test(record.idempotencyKey)) return { ok: false };
    // `input` is absent from the JSON when the mutation had none.
    if (typeof record.startedAt !== "number" || !Number.isFinite(record.startedAt)) return { ok: false };
    // Another mutation saved it under the same key: never send it to this endpoint.
    if (record.target !== target) return { ok: false };
    return { ok: true, value: record as unknown as StoredIntent };
  };
}

/** The request of the intent in flight, by its stored signal: two components never send it twice. */
const inflight = new WeakMap<Signal<StoredIntent | undefined>, { readonly id: string; readonly promise: Promise<unknown> }>();

/**
 * Creates the state of one mutation in a component script. With `retrySafe`, the intent lives in
 * the browser storage and is retried on mount and on `online`.
 */
export function createMutation(transport: MutationTransport, options: MutationOptions | undefined): MutationState {
  const pending = signal(false);
  const error = signal<Error | null>(null);
  const data = signal<unknown>(null);
  const retrySafe = options?.retrySafe;
  if (!retrySafe) {
    return {
      pending, error, data,
      async mutate(input) {
        pending.value = true;
        try {
          const output = await transport.send(input, undefined);
          batch(() => { data.value = output; error.value = null; });
          return output;
        } catch (failure) {
          error.value = toError(failure);
          throw failure;
        } finally {
          pending.value = false;
        }
      },
    };
  }
  if (typeof retrySafe !== "object") throw new TypeError(`${transport.label}: retrySafe expects { key }`);
  const label = `${transport.label} retrySafe`;
  const stored = storageSignal<StoredIntent | undefined>(label, retrySafe.key, undefined, retrySafe.storage ?? "local", intentDecoder(transport.target));
  // The key of a first send in flight: it is not uncertain until it ends without an answer.
  const fresh = signal<string | null>(null);
  const uncertain = computed((): UncertainMutation<unknown> | null => {
    const intent = stored.value;
    return intent && intent.idempotencyKey !== fresh.value ? intent : null;
  });
  const settle = (intent: StoredIntent): void => {
    if (untrack(() => stored.value)?.idempotencyKey === intent.idempotencyKey) stored.value = undefined;
  };
  // One request per intent, shared by every component that uses the key.
  const request = (intent: StoredIntent): Promise<unknown> => {
    const running = inflight.get(stored);
    if (running?.id === intent.idempotencyKey) return running.promise;
    const promise = transport.send(intent.input, idempotencyHeader(intent.idempotencyKey)).then((output) => {
      settle(intent);
      return output;
    }, (failure: unknown) => {
      if (answered(failure)) settle(intent);
      throw failure;
    });
    inflight.set(stored, { id: intent.idempotencyKey, promise });
    const forget = (): void => { if (inflight.get(stored)?.promise === promise) inflight.delete(stored); };
    promise.then(forget, forget);
    return promise;
  };
  // This mutation's own signals follow the shared request.
  const send = (intent: StoredIntent): Promise<unknown> => {
    pending.value = true;
    return request(intent).then((output) => {
      batch(() => {
        if (fresh.value === intent.idempotencyKey) fresh.value = null;
        data.value = output;
        error.value = null;
        pending.value = false;
      });
      return output;
    }, (failure: unknown) => {
      batch(() => {
        if (fresh.value === intent.idempotencyKey) fresh.value = null;
        error.value = toError(failure);
        pending.value = false;
      });
      throw failure;
    });
  };
  const retry = (): Promise<unknown> => {
    const intent = untrack(() => stored.value);
    return intent ? send(intent) : Promise.resolve(undefined);
  };
  // Runs only once the component is mounted in the browser: never in SSR or in a dry pass.
  whenMounted(() => {
    const browser = currentBrowser();
    const resume = (): void => {
      if (browser?.navigator?.onLine === false) return;
      // A failure is already in `error`, and the intent stays uncertain.
      retry().catch(() => {});
    };
    resume();
    if (!browser) return undefined;
    browser.addEventListener("online", resume);
    return () => browser.removeEventListener("online", resume);
  });
  return {
    pending, error, data, uncertain,
    async mutate(input) {
      if (untrack(() => stored.value)) {
        throw new Error(`MUTATION_UNCERTAIN: ${transport.label} has an intent without an answer under "${retrySafe.key}"; retry() or discard() it first`);
      }
      // The intent is sent and retried exactly as it travels: JSON.
      const json = input === undefined ? undefined : JSON.stringify(input);
      const intent: StoredIntent = {
        idempotencyKey: randomUuid(),
        input: json === undefined ? undefined : JSON.parse(json) as unknown,
        startedAt: Date.now(),
        target: transport.target,
      };
      // Saved before sending: if the page closes or the connection drops, it is retried with the same key.
      batch(() => {
        fresh.value = intent.idempotencyKey;
        stored.value = intent;
      });
      return send(intent);
    },
    retry,
    discard() {
      stored.value = undefined;
    },
  };
}
