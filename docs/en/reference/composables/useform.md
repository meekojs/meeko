---
title: useForm
group: composables
since: 1.2.0
description: Component form state, with one signal per field, Standard Schema validation, server errors per field, submission and reset.
symbols:
  - "@meekojs/meeko/framework#useForm"
types:
  - "@meekojs/meeko/framework#Form"
  - "@meekojs/meeko/framework#FormSubmission"
  - "@meekojs/meeko/framework#FormField"
related:
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/server#ApiError"
  - "syntax:model"
  - "@meekojs/meeko#useId"
  - "autoimport:useApiMutation"
  - docs/framework.md#formularios-useform
  - docs/framework.md#errores-de-validación-en-formularios
  - docs/framework.md#formularios-sin-javascript-form
source-hash: ff0e7694bcb8b9d54c57b7ca1a2e7b25f3717f9011e224bfe7916915e0038601
---

`useForm` brings together recurring form needs: a writable signal per field for `model`, validation with a [Standard Schema](https://standardschema.dev) (such as Valibot's) on submission, `issues` from a server `400` distributed by field, a whole-form message, `pending`, `submitted`, `dirty`, `reset`, `load` and `commit`. Call it at the top level of a component's `<script>`; it is auto-imported in framework applications.

`Form`, `FormField` and `FormSubmission` are also auto-imported as types in component `<script>` and `app/` code. In `server/`, `shared/` or `<script server>` code, an explicit import is required if you only need to describe a type.

The form is component state: it does not travel in the payload. The server renders it with `initial` and the browser recreates it with the same `initial` during hydration.

## Usage

```html
<!-- app/pages/categories/new.meeko -->
<script lang="ts">
import * as v from "valibot";

const categoryInput = v.object({
  name: v.pipe(v.string(), v.trim(), v.minLength(1, "Escribe un nombre.")),
});

const form = useForm({
  schema: categoryInput,
  initial: { name: "" },
  submit: (values) => api.categories.post({ body: values }),
});
</script>

<template>
  <form on:submit="form.submit" novalidate>
    <p if:when="form.error.value" role="alert">{form.error.value}</p>
    <label>Nombre <input model="form.fields.name"></label>
    <p if:when="form.errors.value.name">{form.errors.value.name}</p>
    <button bind:disabled="form.pending.value">Guardar</button>
  </form>
</template>
```

`on:submit="form.submit"` passes the function as a handler: `submit` calls `event.preventDefault()`, validates with the schema and, if data is valid, runs your `submit` with the schema output.

## Options

`useForm(options)` takes an object:

| Option         | Type                                        | Default           | Description                                                                                                                                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------- | ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema`       | Standard Schema v1                          | no schema         | Validates fields on submission. With a schema, fields have its **input** type and `submit` receives its **output** (a `v.transform` can convert text to a number). Without a schema, only the server validates.                                                                                                                                 |
| `initial`      | `Values`                                    | required          | Each field's initial value. With a schema, one key per input key, including optional keys (with `undefined`). Must depend only on props, route data and state, because the browser reevaluates it during hydration.                                                                                                                             |
| `submit`       | `(values) => Result \| PromiseLike<Result>` | required          | Sends valid data and returns the result, or rejects. Receives schema output, or field values without a schema.                                                                                                                                                                                                                                  |
| `errorMessage` | `(failure: unknown) => string`              | `failure.message` | `error` text for a failure without `issues`, such as a `409` or network failure. For a `ClientError`, the default `message` is its `code`.                                                                                                                                                                                                      |
| `onSuccess`    | `(result, form) => void`                    | none              | Since `1.5`. Runs after successful submission, with `submitted` already `true`. An error it throws goes to the component's error observer and does not change the submission result.                                                                                                                                                            |
| `focusInvalid` | `boolean`                                   | `false`           | Since `1.5`. After a submission with field errors, focuses the first invalid control in the event's `<form>` once messages render.                                                                                                                                                                                                              |
| `action`       | `string`                                    | none              | Since `1.7`. Endpoint path with `form` receiving the `<form method="post">` without JavaScript, such as `"/api/feedback"`. On return from submission, SSR renders its result: `errors`, `error` and `failure`, or `submitted`, and values of fields listed by the endpoint in `form.echo` (none by default: other fields start from `initial`). |

## Return value

A `Form<Values, Result>`. `fields` are writable signals; other signals are read-only and `csrfToken` is a string.

| Property            | Type                                         | Description                                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `fields`            | `{ [K in keyof Values]: Signal<Values[K]> }` | One signal per field, for `model` on `<input>`, `<textarea>` and `<select>`, and `model:nombre` on a component.                                                                                                                 |
| `errors`            | `ReadonlySignal<{ [ruta]?: string }>`        | First message for each error path: `errors.value.name`, `errors.value["items.0.name"]`. A field without an error has no key.                                                                                                    |
| `error`             | `ReadonlySignal<string \| null>`             | Whole-form message: an issue at path `""`, an issue for a field absent from the form or `errorMessage` text.                                                                                                                    |
| `failure`           | `ReadonlySignal<Error \| null>`              | Original error from the latest failed submission, including a `400`'s `ClientError`.                                                                                                                                            |
| `pending`           | `ReadonlySignal<boolean>`                    | `true` while an asynchronous schema validates or `submit` runs.                                                                                                                                                                 |
| `submitted`         | `ReadonlySignal<boolean>`                    | `true` when the latest submission succeeded.                                                                                                                                                                                    |
| `dirty`             | `ReadonlySignal<boolean>`                    | `true` if any field differs from initial values. Compares arrays, plain objects and dates by content.                                                                                                                           |
| `submit(event?)`    | `Promise<Result \| undefined>`               | Submits. Resolves with your `submit`'s result, or `undefined` if data is invalid, submission fails or another is already in progress. Never rejects.                                                                            |
| `trySubmit(event?)` | `Promise<FormSubmission<Result>>`            | Since `1.5`. Submits similarly, but resolves with the outcome: `{ ok: true, result }` or `{ ok: false, reason }` with `"invalid"`, `"error"` or `"skipped"`. Never rejects.                                                     |
| `reset(values?)`    | `void`                                       | Returns to `initial`, even after `load` or `commit`. If given values, merges them with `initial` and takes the result as the `dirty` baseline. Accepts the native `reset` event. Clears errors and the latest submission state. |
| `load(values)`      | `void`                                       | Merges a record with current values, takes the result as the `dirty` baseline and clears errors and the latest submission state. `reset()` still returns to `initial`.                                                          |
| `commit(values?)`   | `void`                                       | Since `1.5`. Writes `values` and takes current values as the new `dirty` baseline: returns to `false`. Does not clear `submitted`, `errors`, `error` or `failure`.                                                              |
| `field(name)`       | `FormField<Values[K]>`                       | Since `1.5`. Field pieces for a custom component: signal, message, `invalid`, `name` and IDs stable between SSR and hydration. Always returns the same object for the same field.                                               |
| `csrfToken`         | `string \| undefined`                        | Since `1.7`. Session CSRF token for a native form's hidden `_csrf` field, or `undefined` without a session: in SSR, the request's token; in the browser, from the `meeko-csrf-token` meta tag. A string, not a signal.          |

## Examples

### Server errors in each field

Without a browser schema, the server validates. The `400` response for input failing a `defineApiRoute` schema includes `issues` with `path` and `message`, and `useForm` puts each message in its field. An `ApiError` with `issues` (since `1.5`) does the same with another status, such as a `409`:

<!-- no-check -->

```ts
// server/api/signup.post.ts
import { ApiError, defineApiRoute } from "@meekojs/meeko/server";
import { signupInput, signupResult } from "../../shared/schemas/signup";

export default defineApiRoute({
  body: signupInput,
  response: signupResult,
  status: 201,
  handler: async ({ body }) => {
    if (await emailTaken(body.email)) {
      throw new ApiError("EMAIL_TAKEN", 409, { issues: [{ path: "email", message: "Ese correo ya tiene una cuenta." }] });
    }
    return createUser(body);
  },
});
```

```html
<!-- app/pages/signup.meeko -->
<script lang="ts">
const form = useForm({
  initial: { email: "", password: "" },
  submit: (values) => api.signup.post({ body: values }),
  errorMessage: (failure) => isClientError(failure) ? "No se pudo crear la cuenta." : "No se pudo conectar. Inténtalo de nuevo.",
});
</script>

<template>
  <form on:submit="form.submit" novalidate>
    <p if:when="form.error.value" role="alert">{form.error.value}</p>
    <label>Correo <input type="email" model="form.fields.email"></label>
    <p if:when="form.errors.value.email">{form.errors.value.email}</p>
    <label>Contraseña <input type="password" model="form.fields.password"></label>
    <p if:when="form.errors.value.password">{form.errors.value.password}</p>
    <button bind:disabled="form.pending.value">Crear cuenta</button>
  </form>
</template>
```

With the `409`, `form.errors.value.email` is “Ese correo ya tiene una cuenta.”, `form.error.value` is `null` and `form.failure.value` is the `ClientError`. Without a schema, changing the field clears its server message.

### Edit a record and save as a new baseline

`initial` comes from page data. After saving, `onSuccess` calls `commit` with the server's result: `dirty` returns to `false` and `submitted`'s “Saved” remains.

If the record arrives after component creation, call `form.load({ name: record.name, bio: record.bio })` when loading ends. `load` marks those values clean; `form.reset()` returns to declared `initial` values.

```html
<!-- app/pages/profile.meeko -->
<script server lang="ts">
export const profile = await loadProfile(usePage().context);
</script>

<script lang="ts">
const form = useForm({
  schema: profileInput,
  initial: { name: profile.name, bio: profile.bio },
  submit: (values) => api.profile.put({ body: values }),
  onSuccess: (saved, form) => form.commit({ name: saved.name, bio: saved.bio }),
});
</script>

<template>
  <form on:submit="form.submit">
    <input model="form.fields.name">
    <textarea model="form.fields.bio"></textarea>
    <button bind:disabled="!form.dirty.value || form.pending.value">Guardar</button>
    <p if:when="form.submitted.value && !form.dirty.value">Guardado.</p>
  </form>
</template>
```

### Know how submission ended

`submit` resolves to `undefined` both for invalid data and network failure. `trySubmit` distinguishes the cases:

```ts
import { signal } from "@meekojs/meeko";
import { useForm } from "@meekojs/meeko/framework";

const lastSaved = signal<string | null>(null);

const form = useForm({
  initial: { title: "" },
  submit: async (values): Promise<{ updatedAt: string }> => {
    const response = await fetch("/api/notes", { method: "POST", body: JSON.stringify(values) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return (await response.json()) as { updatedAt: string };
  },
});

async function save(event: SubmitEvent): Promise<void> {
  const outcome = await form.trySubmit(event);
  if (outcome.ok) lastSaved.value = outcome.result.updatedAt;
  else if (outcome.reason === "error") console.warn(outcome.failure);
  // "invalid": los mensajes ya están en form.errors; "skipped": había otro envío en curso.
}
```

### A field component with `form.field`

`form.field(name)` gives a field component everything it needs without receiving the whole form, with matching IDs in server HTML and hydration:

```html
<!-- app/components/AppField.meeko -->
<script lang="ts">
import type { FormField } from "@meekojs/meeko/framework";

const props = defineProps<{ field: FormField<string>; label: string; type?: string }>();
</script>

<template>
  <label bind:for="props.field.id">{props.label}</label>
  <input bind:id="props.field.id" bind:name="props.field.name" bind:type="props.type ?? 'text'" model="props.field.value"
    bind:aria-invalid="props.field.invalid.value ? 'true' : null" bind:aria-describedby="props.field.describedBy.value">
  <p if:when="props.field.error.value" bind:id="props.field.errorId">{props.field.error.value}</p>
</template>
```

```html
<form on:submit="form.submit" novalidate>
  <AppField bind:field="form.field('email')" label="Correo" type="email" />
  <AppField bind:field="form.field('password')" label="Contraseña" type="password" />
</form>
```

### An optional checkbox with a default

Fields have the schema's **input** type, even when a key has a default. With `consent: v.optional(v.boolean(), false)`, `form.fields.consent` is `Signal<boolean | undefined>` and `form.field("consent")` is `FormField<boolean | undefined>`, even though `initial` starts it at `false` and `submit` receives a `boolean`. Since `1.7.1`, `model` on an `<input type="checkbox">` accepts that signal and treats `undefined` as unchecked. A field component declares the same type it receives:

```html
<!-- app/components/AppCheckbox.meeko -->
<script lang="ts">
import type { FormField } from "@meekojs/meeko/framework";

const props = defineProps<{ field: FormField<boolean | undefined>; label: string }>();
</script>

<template>
  <label><input type="checkbox" bind:id="props.field.id" bind:name="props.field.name" model="props.field.value"> {props.label}</label>
  <p if:when="props.field.error.value" bind:id="props.field.errorId">{props.field.error.value}</p>
</template>
```

A `FormField<boolean>` does not accept that field (`TS2322`): the output type cannot be used for the field, because the same type describes a schema whose input genuinely allows `undefined` until the user chooses.

### A form working without JavaScript (since 1.7)

With `form` on the endpoint and `action` in `useForm`, the same form submits JSON with JavaScript and as a native `<form method="post">` before hydration or without JavaScript. Each control has its field's `name`:

<!-- no-check -->

```ts
// server/api/feedback.post.ts
import { defineApiRoute } from "@meekojs/meeko/server";
import { feedbackInput, feedbackSaved } from "../../shared/schemas/feedback.js";

export default defineApiRoute({ body: feedbackInput, response: feedbackSaved, form: { echo: ["comment"] }, handler: ({ body }) => saveFeedback(body) });
```

```html
<!-- app/components/Feedback.meeko -->
<script lang="ts">
const route = useRoute();
const form = useForm({
  schema: feedbackInput,
  initial: { page: route.path.value, helpful: false, comment: "" },
  action: "/api/feedback",
  submit: (values) => api.feedback.post({ body: values }),
});
</script>

<template>
  <form method="post" action="/api/feedback" on:submit="form.submit" novalidate>
    <input type="hidden" name="return" bind:value="route.url.value">
    <input type="hidden" name="_csrf" bind:value="form.csrfToken ?? ''">
    <input type="hidden" name="page" bind:value="form.fields.page.value">
    <p if:when="form.submitted.value">¡Gracias!</p>
    <p if:when="form.error.value" role="alert">{form.error.value}</p>
    <button name="helpful" value="true" on:click="() => { form.fields.helpful.value = true; }">Sí</button>
    <button name="helpful" value="false" on:click="() => { form.fields.helpful.value = false; }">No</button>
    <textarea name="comment" model="form.fields.comment"></textarea>
    <p if:when="form.errors.value.comment">{form.errors.value.comment}</p>
  </form>
</template>
```

Without JavaScript, the server validates with the same `body` schema, responds with `303` back to `return` and stores the result in a single-use cookie; page SSR renders it in the form whose `action` matches, and hydration preserves it. Only `form.echo` field values return (here, the comment); remaining fields display `initial`.

### Confirmation depending on another field

Since `1.5`, each change also revalidates fields already showing a schema error. With a Valibot rule placing the error on `confirm`, correcting the password removes “Las contraseñas no coinciden” without touching confirmation:

<!-- no-check -->

```ts
import * as v from "valibot";

export const passwordInput = v.pipe(
  v.object({ password: v.pipe(v.string(), v.minLength(10, "Usa al menos 10 caracteres.")), confirm: v.string() }),
  v.forward(
    v.partialCheck([["password"], ["confirm"]], (input) => input.password === input.confirm, "Las contraseñas no coinciden."),
    ["confirm"],
  ),
);
```

## Common mistakes

### Pass `.value` to `model`

`model` needs the field's signal, not its value.

```html bad
<input model="form.fields.name.value">
```

`meeko check` reports `TS2322: Type 'string' is not assignable to type '{ value: string; }'` on the attribute, and at runtime the binding throws `TypeError: Meeko model expects a writable signal, not a computed signal or a plain value`.

```html good
<input model="form.fields.name">
```

### Call `submit` in the handler

`on:submit` expects a function. `form.submit()` runs during rendering and passes a promise.

```html bad
<form on:submit="form.submit()">
```

`meeko check` reports `TS2345: Argument of type 'Promise<…>' is not assignable to parameter of type '(event: SubmitEvent & { readonly currentTarget: HTMLFormElement; }) => unknown'`.

```html good
<form on:submit="form.submit">
```

To do something with the result, wrap the call in a script function: `async function save(event: SubmitEvent) { const saved = await form.submit(event); … }` and `on:submit="save"`.

### A nonexistent field

Fields come from `initial` (or schema input), so a misspelled name is a type error in `fields`, `errors` and `field`:

```html bad
<input model="form.fields.nmae">
<p>{form.errors.value.nmae}</p>
<AppField bind:field="form.field('nmae')" label="Nombre" />
```

`meeko check` reports `TS2339: Property 'nmae' does not exist on type '{ readonly name: Signal<string>; }'` in `fields` and `errors`, and `TS2345: Argument of type '"nmae"' is not assignable to parameter of type '"name"'` in `field`. If the name arrives untyped, `form.field` throws `TypeError: useForm(): the form has no field "nmae"` at runtime.

```html good
<input model="form.fields.name">
<p>{form.errors.value.name}</p>
<AppField bind:field="form.field('name')" label="Nombre" />
```

### A numeric field in an `<input type="number">`

An `<input>`, including type `number`, provides text. `model` requires a `string` signal.

```ts bad
const form = useForm({ initial: { age: 0 }, submit: save });
// <input type="number" model="form.fields.age">
```

`meeko check` reports `TS2322: Type 'Signal<number>' is not assignable to type '{ value: string; }'`. Store text in the field and convert it in the schema, whose output is received by `submit`:

<!-- no-check -->

```ts good
const ageInput = v.object({ age: v.pipe(v.string(), v.transform(Number), v.integer("Escribe un número entero.")) });
const form = useForm({ schema: ageInput, initial: { age: "" }, submit: (values) => save(values) }); // values.age es number
// <input type="number" model="form.fields.age">
```

### `initial` missing schema keys

With a schema, `initial` needs a value per input key, including optional ones.

<!-- no-check -->

```ts bad
const signupInput = v.object({ name: v.string(), email: v.string() });
const form = useForm({ schema: signupInput, initial: { name: "" }, submit });
```

`meeko check` reports `TS2769: No overload matches this call` with `Property 'email' is missing in type '{ name: string; }' but required in type 'Complete<{ name: string; email: string; }>'`.

<!-- no-check -->

```ts good
const form = useForm({ schema: signupInput, initial: { name: "", email: "" }, submit });
```

### Mutate a field's array

A signal notifies when assigned a new value. `push` changes the same array: neither the template nor `dirty` is notified, and no error flags it.

```ts bad
form.fields.tags.value.push(tag);
```

<!-- no-check -->

```ts good
form.fields.tags.value = [...form.fields.tags.value, tag];
```

### Treat `csrfToken` as a signal

`csrfToken` is a string, or `undefined` without a session.

```html bad
<input type="hidden" name="_csrf" bind:value="form.csrfToken.value">
```

`meeko check` reports `TS18048: 'form.csrfToken' is possibly 'undefined'` and `TS2551: Property 'value' does not exist on type 'string'. Did you mean 'valueOf'?`.

```html good
<input type="hidden" name="_csrf" bind:value="form.csrfToken ?? ''">
```

## Notes

- **Where to call it.** At the top level of `<script>`, before any `await`, like `useId`: `form.field` IDs come from `useId` and depend on call order. Does not need `await` or have `useApi`'s `MEEK054` restriction.
- **SSR.** The server renders the form with `initial` and never submits: `submit` or `trySubmit` called while the script only produces HTML (SSR or a navigation dry run) resolves with `{ ok: false, reason: "skipped" }`.
- **Hydration.** Fields neither travel in the payload nor survive HMR: the browser reruns `useForm` with the same `initial`. User input before hydration is preserved because `model` copies it to the field signal when hydration ends. Since `1.7`, with `action`, the result of a non-JavaScript submission does travel in page state so hydration renders the same as SSR; the browser uses it once.
- **Validation timing.** The schema runs on submission, not while typing. After an error, the field is revalidated on every change and its message disappears once valid; an error-free field is not validated until the next submission. With an asynchronous schema, `pending` is `true` while validating, and only the latest validation applies.
- **Concurrent submissions.** While a submission is in flight, another `submit` is ignored (resolves to `undefined`) and also prevents native browser submission.
- **Unexpected failures.** A `ClientError` is an expected server response. Any other error (network failure, an error in your `submit` or a throwing schema) also reaches the component's error observer, `provideErrorHandler` or `mountClientApp`'s `onError`, with source `"event"`; without an observer, it is written to the console.
- **Security without JavaScript.** A native submission requires an allowed `Origin` (`403 INVALID_ORIGIN` if absent) and, with a session, the token in `_csrf` (`403 INVALID_CSRF`). `return` and `_csrf` never reach the schema.
- **Accessibility.** Mark controls with `aria-invalid` and link messages with `aria-describedby` (`form.field` provides `describedBy`). With `focusInvalid: true`, focus goes to the first invalid control, found by `name`, `form.field`'s `id` or `aria-invalid="true"`.

> [!NOTE]
> `meeko check` checks `initial` against schema input, `fields` names, `errors` paths and that each `model` has the control's type. Run it in CI: it reports every type error on this page before reaching the browser.
