/**
 * `useForm`: the state of a form in a component script. One writable signal per field, client
 * validation with a Standard Schema, the server's `400` issues mapped onto the same fields, a
 * form-level message, `pending`, `dirty` and `reset`.
 */
import { componentErrorReporter } from "../component-errors.js";
import { setupPhase } from "../lifecycle.js";
import { batch, computed, effect, signal, untrack } from "../reactivity.js";
import type { ReadonlySignal, Signal } from "../reactivity.js";
import type { ValidationIssue } from "./clients.js";

type SchemaResult<O> = { value: O; issues?: undefined } | { issues: readonly unknown[] };

/** The Standard Schema v1 subset that `useForm` runs in the browser, as Valibot implements it. */
interface FormSchema<I = unknown, O = I> {
  readonly "~standard": {
    readonly version: 1;
    readonly validate: (value: unknown) => SchemaResult<O> | Promise<SchemaResult<O>>;
    readonly types?: { readonly input: I; readonly output: O } | undefined;
  };
}

type SchemaInput<S> = S extends FormSchema<infer I, unknown> ? I : never;
type SchemaOutput<S> = S extends FormSchema<unknown, infer O> ? O : never;

/**
 * Every key of `T` as a required property. An optional key keeps `undefined` in its type: the
 * key set is not `keyof T` syntactically, so the mapped type does not copy the `?` modifiers.
 */
type Complete<T> = { [K in KeysOf<T>]: T[K] };
type KeysOf<T> = keyof T extends infer K ? K & keyof T : never;

type Leaf = string | number | boolean | bigint | symbol | null | undefined | Date | RegExp | ((...args: never[]) => unknown);
type Previous = [never, 0, 1, 2, 3];
/** Field paths joined with `.`, as the server's `issues` name them, down to four levels. */
type Paths<T, Depth extends number = 4> = [Depth] extends [never] ? never
  : T extends Leaf ? never
  : T extends readonly (infer Item)[] ? `${number}` | `${number}.${Paths<NonNullable<Item>, Previous[Depth]>}`
  : T extends object ? { [K in keyof T & string]-?: K | `${K}.${Paths<NonNullable<T[K]>, Previous[Depth]>}` }[keyof T & string]
  : never;

/**
 * Estado de un formulario que devuelve {@link useForm}. `fields` son señales escribibles, una por
 * campo; las demás propiedades son señales de sólo lectura.
 *
 * @typeParam Values Valores de los campos: la entrada del schema o, sin schema, el tipo de `initial`.
 * @typeParam Result Lo que devuelve `submit` cuando el envío termina bien.
 * @since 1.2.0
 * @example
 * ```html
 * <!-- app/components/NameField.meeko: un campo que recibe el formulario del padre -->
 * <script lang="ts">
 * import type { Form } from "@meekojs/meeko/framework";
 * const props = defineProps<{ form: Form<{ name: string }, unknown> }>();
 * </script>
 * <template>
 *   <input model="props.form.fields.name" bind:aria-invalid="props.form.errors.value.name ? 'true' : null">
 *   <p if:when="props.form.errors.value.name">{props.form.errors.value.name}</p>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#formularios-useform
 */
export interface Form<Values, Result> {
  /** Una señal escribible por campo, con el valor de `initial`; se usa con `model` y `model:value`. */
  readonly fields: { readonly [K in keyof Values]: Signal<Values[K]> };
  /**
   * Primer mensaje de cada campo con un error, por ruta (`"name"`, `"items.0.name"`): de la
   * validación del navegador o de los `issues` de un `400` del servidor. Un campo sin error no
   * tiene clave.
   */
  readonly errors: ReadonlySignal<{ readonly [P in Paths<Values>]?: string }>;
  /**
   * Mensaje del formulario completo, o `null`: un issue con ruta `""` o de un campo que el
   * formulario no tiene, o el texto de un error que no es de validación (véase `errorMessage`).
   */
  readonly error: ReadonlySignal<string | null>;
  /** Error original del último envío fallido (también el `ClientError` de un `400`), o `null`. */
  readonly failure: ReadonlySignal<Error | null>;
  /** `true` mientras se valida de forma asíncrona o se ejecuta `submit`. */
  readonly pending: ReadonlySignal<boolean>;
  /** `true` cuando el último envío terminó bien; vuelve a `false` al enviar de nuevo y con `reset`. */
  readonly submitted: ReadonlySignal<boolean>;
  /** `true` si algún campo difiere (comparando arrays y objetos por contenido) de los valores iniciales. */
  readonly dirty: ReadonlySignal<boolean>;
  /**
   * Envía el formulario: llama a `event.preventDefault()`, valida con el schema, ejecuta `submit`
   * con su salida y lleva los errores a `errors` y `error`. Resuelve con lo que devuelve `submit`,
   * o con `undefined` si los datos no son válidos, si el envío falla o si ya hay uno en curso (se
   * ignora). Nunca rechaza. En SSR no hace nada.
   */
  readonly submit: (event?: Event) => Promise<Result | undefined>;
  /**
   * Vuelve a los valores iniciales, o a `initial` combinado con `values`, que pasan a ser los
   * valores iniciales de `dirty`. Borra `errors`, `error`, `failure` y `submitted`.
   */
  readonly reset: (values?: Partial<Values>) => void;
}

interface FormOptions<Values, Output, Result> {
  /** Valor inicial de cada campo. Con schema, uno por cada clave de su entrada. */
  readonly initial: Values;
  /** Envía los datos válidos (la salida del schema) y devuelve el resultado, o rechaza. */
  readonly submit: (values: Output) => Result | PromiseLike<Result>;
  /**
   * Texto de `error` para un fallo sin issues de validación, como un `ClientError` `409` o un fallo
   * de red. Por defecto, su `message` (el `code` en un `ClientError`).
   */
  readonly errorMessage?: (failure: unknown) => string;
}

/**
 * Crea el estado de un formulario sin schema: los campos y los valores de `submit` tienen el tipo
 * de `initial`, y sólo el servidor valida. Sus `issues` llegan igualmente a `errors`.
 *
 * @param options `initial`, `submit` y `errorMessage`.
 * @returns El {@link Form}.
 * @since 1.2.0
 * @example
 * ```ts
 * import { ClientError, useForm } from "@meekojs/meeko/framework";
 *
 * const form = useForm({
 *   initial: { email: "", password: "" },
 *   submit: (values) => api.session.post({ body: values }),
 *   errorMessage: (failure) => failure instanceof ClientError && failure.code === "INVALID_CREDENTIALS"
 *     ? "El correo o la contraseña no coinciden."
 *     : "No se pudo conectar. Inténtalo de nuevo.",
 * });
 * ```
 */
export function useForm<Values extends object, Result = unknown>(
  options: FormOptions<Values, Values, Result> & { readonly schema?: undefined },
): Form<Values, Result>;
/**
 * Crea el estado de un formulario: una señal por campo para `model`, validación con un Standard
 * Schema (Valibot) al enviar, los `issues` de un `400` del servidor llevados a cada campo, un
 * mensaje del formulario, `pending`, `submitted`, `dirty` y `reset`. Se autoimporta en los `.meeko`.
 *
 * Tras un error, un campo se vuelve a validar cada vez que cambia, y su mensaje desaparece en cuanto
 * es válido. Un fallo que no es un `ClientError` (un error de red o de su `submit`) también llega al
 * observador de errores del componente (`provideErrorHandler` u `onError`) con la fuente `"event"`.
 * Los campos son estado del componente que no viaja en el payload: el navegador los crea de nuevo
 * con `initial`, así que `initial` debe depender sólo de props, datos de la ruta y estado.
 *
 * @param options `schema` (opcional), `initial`, `submit` y `errorMessage`.
 * @returns El {@link Form}, con los tipos de los campos tomados de la entrada del schema y los
 * valores de `submit`, de su salida.
 * @since 1.2.0
 * @example
 * ```html
 * <script lang="ts">
 * import * as v from "valibot";
 * const categoryInput = v.object({ name: v.pipe(v.string(), v.trim(), v.minLength(1, "Escribe un nombre.")) });
 * const form = useForm({
 *   schema: categoryInput,
 *   initial: { name: "" },
 *   submit: (values) => api.menu.categories.post({ body: values }),
 * });
 * </script>
 * <template>
 *   <form on:submit="form.submit">
 *     <p if:when="form.error.value" role="alert">{form.error.value}</p>
 *     <input model="form.fields.name">
 *     <p if:when="form.errors.value.name">{form.errors.value.name}</p>
 *     <button bind:disabled="form.pending.value">Guardar</button>
 *   </form>
 * </template>
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#formularios-useform
 */
export function useForm<S extends FormSchema<object, unknown>, Result = unknown>(
  options: FormOptions<Complete<SchemaInput<S>>, SchemaOutput<S>, Result> & {
    /** Standard Schema que valida los campos antes de `submit`, como un `v.object(...)` de Valibot. */
    readonly schema: S;
  },
): Form<Complete<SchemaInput<S>>, Result>;
export function useForm(options: FormOptions<Record<string, unknown>, unknown, unknown> & { readonly schema?: FormSchema | undefined }): Form<Record<string, unknown>, unknown> {
  const { schema, initial } = options;
  const keys = Object.keys(initial);
  const fields: Record<string, Signal<unknown>> = Object.create(null);
  for (const key of keys) fields[key] = signal(initial[key]);
  const baseline = signal<Record<string, unknown>>({ ...initial });
  const errors = signal<Readonly<Record<string, string>>>(empty);
  const error = signal<string | null>(null);
  const failure = signal<Error | null>(null);
  const pending = signal(false);
  const submitted = signal(false);
  const dirty = computed(() => {
    const base = baseline.value;
    return keys.some((key) => !sameValue(fields[key]!.value, base[key]));
  });
  const report = componentErrorReporter("event");
  const fieldSet = new Set(keys);
  let running = false;
  // A submission or a reset makes the results of earlier validations and submissions stale.
  let epoch = 0;
  const revisions = new Map<string, number>();

  const values = (): Record<string, unknown> => untrack(() => {
    const result: Record<string, unknown> = {};
    for (const key of keys) result[key] = fields[key]!.value;
    return result;
  });

  /** Path messages by field, and the form-level message for `""` and paths outside the form. */
  const sortIssues = (issues: readonly ValidationIssue[]): { byPath: Record<string, string>; form: string | null } => {
    const byPath: Record<string, string> = {};
    let form: string | null = null;
    for (const issue of issues) {
      if (issue.path !== "" && fieldSet.has(rootOf(issue.path))) {
        if (!Object.hasOwn(byPath, issue.path)) byPath[issue.path] = issue.message;
      } else {
        form ??= issue.message;
      }
    }
    return { byPath, form };
  };

  const showFailure = (cause: unknown): void => {
    const issues = issuesOf(cause);
    if (issues?.length) {
      const sorted = sortIssues(issues);
      batch(() => {
        errors.value = Object.freeze(sorted.byPath);
        error.value = sorted.form;
        failure.value = toError(cause);
      });
      return;
    }
    let message: string;
    try { message = options.errorMessage ? options.errorMessage(cause) : messageOf(cause); }
    catch (messageError) { report(messageError); message = messageOf(cause); }
    batch(() => {
      error.value = message;
      failure.value = toError(cause);
    });
    // A server's public error is an expected answer; anything else must not go unnoticed.
    if (!isClientError(cause)) report(cause);
  };

  const revalidate = (key: string): void => {
    const current = untrack(() => errors.value);
    if (!Object.keys(current).some((path) => belongsTo(path, key))) return;
    const revision = (revisions.get(key) ?? 0) + 1;
    revisions.set(key, revision);
    const started = epoch;
    const apply = (issues: readonly ValidationIssue[]): void => {
      if (started !== epoch || revisions.get(key) !== revision) return;
      const next: Record<string, string> = {};
      for (const [path, message] of Object.entries(errors.value)) if (!belongsTo(path, key)) next[path] = message;
      for (const [path, message] of Object.entries(sortIssues(issues).byPath)) if (belongsTo(path, key)) next[path] = message;
      errors.value = Object.freeze(next);
    };
    if (!schema) return apply([]);
    let result: SchemaResult<unknown> | Promise<SchemaResult<unknown>>;
    try { result = schema["~standard"].validate(values()); }
    catch (validationError) { report(validationError); return; }
    if (isThenable(result)) {
      result.then((settled) => apply(publicIssues(settled.issues)), report);
    } else {
      apply(publicIssues(result.issues));
    }
  };

  for (const key of keys) {
    let first = true;
    effect(() => {
      void fields[key]!.value;
      if (first) { first = false; return; }
      untrack(() => revalidate(key));
    });
  }

  const run = async (): Promise<unknown> => {
    const started = ++epoch;
    const current = values();
    let output: unknown = current;
    if (schema) {
      let result = schema["~standard"].validate(current);
      if (isThenable(result)) {
        pending.value = true;
        result = await result;
        // A reset while the schema ran discarded these values: they are not sent.
        if (started !== epoch) return undefined;
      }
      if (result.issues) {
        const sorted = sortIssues(publicIssues(result.issues));
        batch(() => {
          errors.value = Object.freeze(sorted.byPath);
          error.value = sorted.form;
          failure.value = null;
          submitted.value = false;
        });
        return undefined;
      }
      output = result.value;
    }
    batch(() => {
      pending.value = true;
      errors.value = empty;
      error.value = null;
      failure.value = null;
      submitted.value = false;
    });
    let value: unknown;
    try {
      value = await options.submit(output);
    } catch (cause) {
      if (started === epoch) showFailure(cause);
      return undefined;
    }
    if (started === epoch) submitted.value = true;
    return value;
  };

  const submit = async (event?: Event): Promise<unknown> => {
    event?.preventDefault();
    // A render that only produces HTML (SSR, or a navigation's dry pass) never submits.
    if (running || setupPhase() === "render") return undefined;
    running = true;
    try {
      return await run();
    } catch (cause) {
      // A schema that throws instead of returning issues.
      showFailure(cause);
      return undefined;
    } finally {
      running = false;
      pending.value = false;
    }
  };

  const reset = (next?: Partial<Record<string, unknown>>): void => {
    epoch++;
    const restored: Record<string, unknown> = { ...initial };
    if (next) for (const key of keys) if (Object.hasOwn(next, key)) restored[key] = next[key];
    batch(() => {
      // Errors go first, so that the field writes below have nothing to revalidate.
      errors.value = empty;
      error.value = null;
      failure.value = null;
      submitted.value = false;
      baseline.value = restored;
      for (const key of keys) fields[key]!.value = restored[key];
    });
  };

  return { fields, errors, error, failure, pending, submitted, dirty, submit, reset } as Form<Record<string, unknown>, unknown>;
}

const empty: Readonly<Record<string, string>> = Object.freeze({});

function rootOf(path: string): string {
  const dot = path.indexOf(".");
  return dot === -1 ? path : path.slice(0, dot);
}

function belongsTo(path: string, key: string): boolean {
  return path === key || path.startsWith(`${key}.`);
}

function isThenable<T>(value: T | Promise<T>): value is Promise<T> {
  return value !== null && typeof value === "object" && typeof (value as { then?: unknown }).then === "function";
}

/** The same `path` the server sends in `issues`: the keys of a Standard Schema issue joined with `.`. */
function issuePath(path: unknown): string {
  if (!Array.isArray(path)) return "";
  return path.map((segment: unknown) => {
    const key = segment !== null && typeof segment === "object" && "key" in segment ? (segment as { key: unknown }).key : segment;
    return typeof key === "symbol" ? key.description ?? "" : String(key);
  }).join(".");
}

function publicIssues(issues: readonly unknown[] | undefined): ValidationIssue[] {
  const result: ValidationIssue[] = [];
  for (const issue of issues ?? []) {
    if (issue === null || typeof issue !== "object") continue;
    const { message, path } = issue as { message?: unknown; path?: unknown };
    if (typeof message === "string" && message) result.push({ path: issuePath(path), message });
  }
  return result;
}

/** A `ClientError`, also from another copy of the runtime (a separate Vite module graph). */
function isClientError(value: unknown): value is Error & { readonly code: string; readonly issues?: readonly ValidationIssue[] } {
  return value instanceof Error && value.name === "ClientError" && typeof (value as { code?: unknown }).code === "string";
}

function issuesOf(value: unknown): readonly ValidationIssue[] | undefined {
  if (!isClientError(value) || !Array.isArray(value.issues)) return undefined;
  return value.issues.filter((issue) => typeof issue?.path === "string" && typeof issue.message === "string");
}

function messageOf(value: unknown): string {
  if (value instanceof Error) return value.message || value.name;
  return String(value);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value), { cause: value });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/** Equality by content for arrays and plain objects, as `dirty` compares field values. */
function sameValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left)) {
    return Array.isArray(right) && left.length === right.length && left.every((item, index) => sameValue(item, right[index]));
  }
  if (left instanceof Date && right instanceof Date) return left.getTime() === right.getTime();
  if (isPlainObject(left) && isPlainObject(right)) {
    const leftKeys = Object.keys(left);
    return leftKeys.length === Object.keys(right).length
      && leftKeys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
  }
  return false;
}
