/**
 * `useForm`: the state of a form in a component script. One writable signal per field, client
 * validation with a Standard Schema, the server's `400` issues mapped onto the same fields, a
 * form-level message, `pending`, `dirty` and `reset`.
 */
import { componentErrorReporter } from "../component-errors.js";
import { useId } from "../ids.js";
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
   * valores iniciales de `dirty`. Borra `errors`, `error`, `failure` y `submitted`. Tras `commit`,
   * los valores iniciales son los de `commit`.
   */
  readonly reset: (values?: Partial<Values>) => void;
  /**
   * Envía el formulario como `submit`, pero resuelve con un {@link FormSubmission} que dice cómo
   * terminó: `{ ok: true, result }`, o `{ ok: false, reason }` con `"invalid"`, `"error"` o
   * `"skipped"`. Nunca rechaza.
   * @since 1.5.0
   */
  readonly trySubmit: (event?: Event) => Promise<FormSubmission<Result>>;
  /**
   * Escribe `values` en sus campos y toma los valores de todos los campos como los nuevos valores
   * iniciales: `dirty` vuelve a `false` y `reset()` vuelve a ellos. A diferencia de `reset`, no
   * borra `submitted`, `errors`, `error` ni `failure`. Sirve tras guardar, para que lo guardado sea
   * la nueva referencia sin perder el «Guardado».
   * @since 1.5.0
   */
  readonly commit: (values?: Partial<Values>) => void;
  /**
   * Las piezas de un campo para cablearlo en un componente propio: su señal, su mensaje, si es
   * inválido, su `name` y unos `id` estables entre SSR e hidratación (véase {@link FormField}).
   * Devuelve siempre el mismo objeto para el mismo campo.
   * @since 1.5.0
   */
  readonly field: <K extends keyof Values & string>(name: K) => FormField<Values[K]>;
}

/**
 * Cómo terminó un envío de {@link Form.trySubmit}:
 *
 * - `{ ok: true, result }`: `submit` terminó bien y devolvió `result`.
 * - `{ ok: false, reason: "invalid" }`: los datos no superaron el schema del navegador, o el
 *   servidor respondió con `issues` (un `400`, o un `ApiError` con `issues`); `errors` y `error`
 *   son los mensajes que muestra el formulario, y `failure`, el `ClientError` del servidor (`null`
 *   si validó el navegador).
 * - `{ ok: false, reason: "error" }`: el envío falló sin `issues`, como un `409` o un fallo de red;
 *   `error` es el texto de `errorMessage` (`null` si un `reset` lo descartó).
 * - `{ ok: false, reason: "skipped" }`: no se envió nada, porque ya había un envío en curso, porque
 *   el script se ejecuta sólo para producir HTML (SSR) o porque un `reset` descartó los valores
 *   mientras el schema validaba.
 *
 * @typeParam Result Lo que devuelve `submit` cuando el envío termina bien.
 * @since 1.5.0
 * @example
 * ```ts
 * async function save(event: SubmitEvent): Promise<void> {
 *   const outcome = await form.trySubmit(event);
 *   if (outcome.ok) lastSaved.value = outcome.result.updatedAt;
 *   else if (outcome.reason === "error") console.warn(outcome.failure);
 * }
 * ```
 */
export type FormSubmission<Result> =
  | {
    /** El envío terminó bien. */
    readonly ok: true;
    /** Lo que devolvió `submit`. */
    readonly result: Result;
  }
  | {
    /** El envío no terminó bien. */
    readonly ok: false;
    /** Los datos no superaron el schema, o el servidor respondió con `issues`. */
    readonly reason: "invalid";
    /** Los mensajes por ruta que muestra `form.errors`. */
    readonly errors: Readonly<Record<string, string>>;
    /** El mensaje del formulario que muestra `form.error`, o `null`. */
    readonly error: string | null;
    /** El `ClientError` del servidor, o `null` si validó el navegador. */
    readonly failure: Error | null;
  }
  | {
    /** El envío no terminó bien. */
    readonly ok: false;
    /** El envío falló sin `issues`: un error del servidor o de red. */
    readonly reason: "error";
    /** El texto de `errorMessage` que muestra `form.error`, o `null` si un `reset` lo descartó. */
    readonly error: string | null;
    /** El error original. */
    readonly failure: Error;
  }
  | {
    /** No se envió nada. */
    readonly ok: false;
    /** Había un envío en curso, el script sólo producía HTML o un `reset` descartó los valores. */
    readonly reason: "skipped";
  };

/**
 * Un campo de un {@link Form}, como lo devuelve `form.field(name)`: lo necesario para que un
 * componente de campo propio enlace su control, su etiqueta y su mensaje sin recibir el formulario
 * entero. `id` y los demás IDs salen de `useId`, así que coinciden entre SSR e hidratación y no se
 * repiten entre formularios.
 *
 * @typeParam Value Tipo del valor del campo.
 * @since 1.5.0
 * @example
 * ```html
 * <!-- app/components/AppField.meeko -->
 * <script lang="ts">
 * import type { FormField } from "@meekojs/meeko/framework";
 * const props = defineProps<{ field: FormField<string>; label: string; type?: string; hint?: string }>();
 * const describedBy = computed(() => [props.hint ? props.field.hintId : "", props.field.describedBy.value ?? ""].filter(Boolean).join(" ") || null);
 * </script>
 * <template>
 *   <label bind:for="props.field.id">{props.label}</label>
 *   <input bind:id="props.field.id" bind:name="props.field.name" bind:type="props.type ?? 'text'" model="props.field.value"
 *     bind:aria-invalid="props.field.invalid.value ? 'true' : null" bind:aria-describedby="describedBy.value">
 *   <p if:when="props.hint" bind:id="props.field.hintId">{props.hint}</p>
 *   <p if:when="props.field.error.value" bind:id="props.field.errorId">{props.field.error.value}</p>
 * </template>
 * ```
 * ```html
 * <AppField bind:field="form.field('email')" label="Correo" type="email" />
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#componentes-de-campo-formfield
 */
export interface FormField<Value> {
  /** Nombre del campo en el formulario, para el atributo `name` del control. */
  readonly name: string;
  /** ID del control, para su `id` y el `for` de su `<label>`. */
  readonly id: string;
  /** ID del mensaje de error (`${id}-error`). */
  readonly errorId: string;
  /** ID de un texto de ayuda (`${id}-hint`), para `aria-describedby`. */
  readonly hintId: string;
  /** La misma señal escribible que `form.fields[name]`, para `model`. */
  readonly value: Signal<Value>;
  /** Primer mensaje de error del campo (o de una ruta anidada, como `items.0.name`), o `undefined`. */
  readonly error: ReadonlySignal<string | undefined>;
  /** `true` si el campo tiene algún error. */
  readonly invalid: ReadonlySignal<boolean>;
  /** `errorId` mientras el campo tiene un error, o `undefined`: el valor de `aria-describedby`. */
  readonly describedBy: ReadonlySignal<string | undefined>;
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
  /**
   * Se ejecuta tras un envío correcto, con `submitted` ya en `true`, con el resultado y el propio
   * formulario: por ejemplo, `(saved, form) => form.commit({ name: saved.name })`. Un error que
   * lance llega al observador de errores del componente y no cambia el resultado del envío.
   * @since 1.5.0
   */
  readonly onSuccess?: (result: Result, form: Form<Values, Result>) => void;
  /**
   * Con `true`, tras un envío con errores en los campos (del schema o del servidor), mueve el foco
   * al primer control inválido del `<form>` del evento, una vez pintados los mensajes. Busca, en el
   * orden del documento, un control cuyo `name` o cuyo `id` (de `form.field`) sea el de un campo con
   * error, o con `aria-invalid="true"`. Sin evento, lo busca en todo el documento.
   * @since 1.5.0
   */
  readonly focusInvalid?: boolean;
}

/**
 * Crea el estado de un formulario sin schema: los campos y los valores de `submit` tienen el tipo
 * de `initial`, y sólo el servidor valida. Sus `issues` llegan igualmente a `errors`.
 *
 * @param options `initial`, `submit` y, opcionales, `errorMessage`, `onSuccess` y `focusInvalid`.
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
 * es válido. Desde `1.5`, cualquier cambio vuelve a validar también los demás campos que ya muestran
 * un error del schema, así que una confirmación (`v.forward(v.partialCheck(...))`) se corrige al
 * cambiar la contraseña. Un fallo que no es un `ClientError` (un error de red o de su `submit`) también llega al
 * observador de errores del componente (`provideErrorHandler` u `onError`) con la fuente `"event"`.
 * Los campos son estado del componente que no viaja en el payload: el navegador los crea de nuevo
 * con `initial`, así que `initial` debe depender sólo de props, datos de la ruta y estado.
 *
 * @param options `schema` (opcional), `initial`, `submit` y, opcionales, `errorMessage`, `onSuccess` y `focusInvalid`.
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
  // The values that `reset()` restores: `initial`, or the last `commit`.
  let origin: Record<string, unknown> = { ...initial };
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
  // In a component script, the same ID in SSR and hydration; the fields' IDs derive from it.
  const formId = useId();
  let running = false;
  // A submission or a reset makes the results of earlier validations and submissions stale.
  let epoch = 0;
  // Only the latest revalidation applies; it covers every field changed since the last one applied.
  let revision = 0;
  const changed = new Set<string>();
  // Paths whose message came from the server: no browser rule of another field can clear them.
  const serverPaths = new Set<string>();
  // Whether `error` holds a message of the browser schema, which a later revalidation may update.
  let schemaFormError = false;

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

  /** Shows a failed submission; true when it carried validation issues. */
  const showFailure = (cause: unknown): boolean => {
    const issues = issuesOf(cause);
    if (issues?.length) {
      const sorted = sortIssues(issues);
      serverPaths.clear();
      for (const path of Object.keys(sorted.byPath)) serverPaths.add(path);
      schemaFormError = false;
      batch(() => {
        errors.value = Object.freeze(sorted.byPath);
        error.value = sorted.form;
        failure.value = toError(cause);
      });
      return true;
    }
    let message: string;
    try { message = options.errorMessage ? options.errorMessage(cause) : messageOf(cause); }
    catch (messageError) { report(messageError); message = messageOf(cause); }
    schemaFormError = false;
    batch(() => {
      error.value = message;
      failure.value = toError(cause);
    });
    // A server's public error is an expected answer; anything else must not go unnoticed.
    if (!isClientError(cause)) report(cause);
    return false;
  };

  /**
   * Validates again after `key` changed: its own messages, if it has any, and the browser messages
   * of the other fields, whose rules may read `key` (a confirmation that `v.forward` sends to its
   * field). The schema always runs on the whole form, so this costs nothing more. A field without
   * an error never gets one before the next submission.
   */
  const revalidate = (key: string): void => {
    const current = untrack(() => errors.value);
    const paths = Object.keys(current);
    if (paths.some((path) => belongsTo(path, key))) changed.add(key);
    const dependents = new Set<string>();
    if (schema) for (const path of paths) if (!serverPaths.has(path) && !changed.has(rootOf(path))) dependents.add(rootOf(path));
    const formMessage = schema !== undefined && schemaFormError;
    if (changed.size === 0 && dependents.size === 0 && !formMessage) return;
    const started = epoch;
    const latest = ++revision;
    const apply = (issues: readonly ValidationIssue[]): void => {
      if (started !== epoch || latest !== revision) return;
      const sorted = sortIssues(issues);
      const own = new Set(changed);
      changed.clear();
      const replaced = (path: string): boolean => own.has(rootOf(path)) || (dependents.has(rootOf(path)) && !serverPaths.has(path));
      const next: Record<string, string> = {};
      for (const [path, message] of Object.entries(errors.value)) {
        if (replaced(path)) serverPaths.delete(path);
        else next[path] = message;
      }
      for (const [path, message] of Object.entries(sorted.byPath)) {
        const root = rootOf(path);
        if ((own.has(root) || dependents.has(root)) && !Object.hasOwn(next, path)) next[path] = message;
      }
      batch(() => {
        errors.value = Object.freeze(next);
        if (formMessage && schemaFormError) {
          error.value = sorted.form;
          schemaFormError = sorted.form !== null;
        }
      });
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

  const invalid = (cause: Error | null): FormSubmission<unknown> => ({
    ok: false, reason: "invalid", errors: untrack(() => errors.value), error: untrack(() => error.value), failure: cause,
  });

  const run = async (): Promise<FormSubmission<unknown>> => {
    const started = ++epoch;
    const current = values();
    let output: unknown = current;
    if (schema) {
      let result = schema["~standard"].validate(current);
      if (isThenable(result)) {
        pending.value = true;
        result = await result;
        // A reset while the schema ran discarded these values: they are not sent.
        if (started !== epoch) return skipped;
      }
      if (result.issues) {
        const sorted = sortIssues(publicIssues(result.issues));
        serverPaths.clear();
        changed.clear();
        schemaFormError = sorted.form !== null;
        batch(() => {
          errors.value = Object.freeze(sorted.byPath);
          error.value = sorted.form;
          failure.value = null;
          submitted.value = false;
        });
        return invalid(null);
      }
      output = result.value;
    }
    serverPaths.clear();
    changed.clear();
    schemaFormError = false;
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
      if (started !== epoch) return { ok: false, reason: "error", error: null, failure: toError(cause) };
      if (showFailure(cause)) return invalid(toError(cause));
      return { ok: false, reason: "error", error: untrack(() => error.value), failure: toError(cause) };
    }
    if (started === epoch) {
      submitted.value = true;
      if (options.onSuccess) {
        try { untrack(() => options.onSuccess!(value, form)); }
        catch (successError) { report(successError); }
      }
    }
    return { ok: true, result: value };
  };

  const trySubmit = async (event?: Event): Promise<FormSubmission<unknown>> => {
    event?.preventDefault();
    // A render that only produces HTML (SSR, or a navigation's dry pass) never submits.
    if (running || setupPhase() === "render") return skipped;
    // Read before awaiting: `currentTarget` is null once the event has been dispatched.
    const container = options.focusInvalid ? formOf(event) : undefined;
    running = true;
    let outcome: FormSubmission<unknown>;
    try {
      outcome = await run();
    } catch (cause) {
      // A schema that throws instead of returning issues.
      outcome = showFailure(cause) ? invalid(toError(cause)) : { ok: false, reason: "error", error: untrack(() => error.value), failure: toError(cause) };
    } finally {
      running = false;
      pending.value = false;
    }
    if (options.focusInvalid && !outcome.ok && outcome.reason === "invalid") focusFirstInvalid(container ?? null);
    return outcome;
  };

  const submit = async (event?: Event): Promise<unknown> => {
    const outcome = await trySubmit(event);
    return outcome.ok ? outcome.result : undefined;
  };

  const reset = (next?: Partial<Record<string, unknown>>): void => {
    epoch++;
    const restored: Record<string, unknown> = { ...origin };
    if (next) for (const key of keys) if (Object.hasOwn(next, key)) restored[key] = next[key];
    serverPaths.clear();
    changed.clear();
    schemaFormError = false;
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

  const commit = (next?: Partial<Record<string, unknown>>): void => {
    batch(() => {
      if (next) for (const key of keys) if (Object.hasOwn(next, key)) fields[key]!.value = next[key];
    });
    origin = values();
    baseline.value = origin;
  };

  const fieldCache = new Map<string, FormField<unknown>>();
  const field = (name: string): FormField<unknown> => {
    let entry = fieldCache.get(name);
    if (entry) return entry;
    if (!fieldSet.has(name)) throw new TypeError(`useForm(): the form has no field "${name}"`);
    const id = `${formId}-${idSegment(name)}`;
    const errorId = `${id}-error`;
    const fieldError = computed(() => {
      const current = errors.value;
      if (Object.hasOwn(current, name)) return current[name];
      for (const [path, message] of Object.entries(current)) if (belongsTo(path, name)) return message;
      return undefined;
    });
    const fieldInvalid = computed(() => fieldError.value !== undefined);
    entry = Object.freeze({
      name, id, errorId, hintId: `${id}-hint`, value: fields[name]!,
      error: fieldError, invalid: fieldInvalid, describedBy: computed(() => fieldInvalid.value ? errorId : undefined),
    });
    fieldCache.set(name, entry);
    return entry;
  };

  /** The first control of `container` (or the document) with an error, once the messages render. */
  const focusFirstInvalid = (container: ParentNode | null): void => {
    const paths = Object.keys(untrack(() => errors.value));
    if (paths.length === 0) return;
    const names = new Set(paths);
    const ids = new Set<string>();
    for (const path of paths) {
      names.add(rootOf(path));
      if (fieldSet.has(rootOf(path))) ids.add(`${formId}-${idSegment(rootOf(path))}`);
    }
    afterPaint(() => {
      const root = container ?? (globalThis as { document?: Document }).document;
      if (!root) return;
      for (const candidate of Array.from(root.querySelectorAll<HTMLElement>("input, select, textarea, button, [tabindex], [contenteditable], [aria-invalid]"))) {
        const name = candidate.getAttribute("name");
        const matches = (name !== null && names.has(name)) || ids.has(candidate.id) || candidate.getAttribute("aria-invalid") === "true";
        if (!matches || (candidate as { disabled?: boolean }).disabled === true) continue;
        candidate.focus();
        // A marked element that cannot take the focus (a `<p aria-invalid>`) gives way to the next.
        if (candidate.ownerDocument.activeElement === candidate) return;
      }
    });
  };

  const form = { fields, errors, error, failure, pending, submitted, dirty, submit, reset, trySubmit, commit, field } as unknown as Form<Record<string, unknown>, unknown>;
  return form;
}

const skipped: FormSubmission<never> = Object.freeze({ ok: false, reason: "skipped" });

/** The `<form>` of a submit event (its `currentTarget`), or of the control that sent it. */
function formOf(event: Event | undefined): ParentNode | undefined {
  const target = (event?.currentTarget ?? event?.target) as (Element & { form?: unknown }) | null | undefined;
  if (!target || typeof target !== "object") return undefined;
  if ((target as Element).localName === "form") return target;
  if (target.form && typeof target.form === "object") return target.form as ParentNode;
  return typeof target.closest === "function" ? target.closest("form") ?? undefined : undefined;
}

/** After the bindings have written the new messages and before the next paint. */
function afterPaint(work: () => void): void {
  const frame = (globalThis as { requestAnimationFrame?: (callback: () => void) => unknown }).requestAnimationFrame;
  if (typeof frame === "function") frame(work);
  else setTimeout(work, 0);
}

/** A field name as a piece of an HTML ID: letters, digits, `-` and `_`, the rest encoded. */
function idSegment(name: string): string {
  return name.replace(/[^A-Za-z0-9-]/g, (character) => `_${character.codePointAt(0)!.toString(36)}`);
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
