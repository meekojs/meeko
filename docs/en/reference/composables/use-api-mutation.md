---
title: useApiMutation
group: composables
since: 1.2.0
description: Sends an on-demand POST, PUT, PATCH or DELETE request to a server/api endpoint, with pending state, errors and safe retries.
symbols:
  - "autoimport:useApiMutation"
types:
  - "@meekojs/meeko/framework#UseApiMutation"
  - "@meekojs/meeko/framework#ApiMutation"
  - "@meekojs/meeko/framework#MutationOptions"
  - "@meekojs/meeko/framework#RetrySafeMutation"
related:
  - "autoimport:useApi"
  - "autoimport:useRpcMutation"
  - "@meekojs/meeko/framework#useForm"
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/server#defineApiRoute"
  - docs/framework.md#mutaciones
  - docs/framework.md#mutaciones-seguras-ante-reintentos
source-hash: 83850e340654cde540b2bcf30fbd58efc4debb803269ac8bd04af8023bee96d9
---

`useApiMutation(ruta, método, opciones?)` prepares a write to a non-`GET` `server/api` endpoint. It makes no request until you call `mutate({ params, query, body })`, and reflects the latest call in `pending`, `data` and `error`. `mutate` sends the session's CSRF token, checks input against the endpoint contract and returns its response, or rejects with its error.

Write `ruta` as in [`useApi`](/en/docs/reference/use-api), and `método` is `"POST"`, `"PUT"`, `"PATCH"` or `"DELETE"`: TypeScript only accepts methods that exist for that route. Application clients generate it and it is auto-imported in `.meeko` files; your own export named `useApiMutation` takes priority.

## Usage

```html
<!-- app/components/NewNote.meeko -->
<script lang="ts">
const create = useApiMutation("/api/notes", "POST");
const text = signal("");
async function save(): Promise<void> {
  await create.mutate({ body: { text: text.value } });
  text.value = "";
}
</script>

<template>
  <textarea model="text"></textarea>
  <button type="button" bind:disabled="create.pending.value" on:click="save">Guardar</button>
  <p if:when="create.error.value" role="alert">No se pudo guardar.</p>
</template>
```

## Parameters

| Parameter            | Type                                     | Default  | Description                                                                                                                          |
| -------------------- | ---------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `ruta`               | an endpoint path                         | required | Such as `"/api/notes"` or `"/api/notes/[id]"`.                                                                                       |
| `método`             | `"POST" \| "PUT" \| "PATCH" \| "DELETE"` | required | One of the endpoint's declared methods for that route. `"GET"` throws `TypeError: useApiMutation: GET <ruta> is a read; use useApi`. |
| `opciones.retrySafe` | `{ key, storage? }`                      | none     | Makes the write safe to retry: stores the intent with an idempotency key and retries with the same key if no response arrives.       |
| `opciones.onSuccess` | `(output, attempt) => unknown`           | none     | Called once per successful attempt, including automatic retries, with state already updated.                                         |
| `opciones.onError`   | `(error, attempt) => unknown`            | none     | Called once per failed attempt. `attempt.uncertain` is `true` if no response arrived.                                                |

## Return value

An `ApiMutation`:

| Property         | Type                             | Description                                                                                                                                                                                                                   |
| ---------------- | -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `mutate(input?)` | `Promise<Output>`                | Sends `{ params, query, body }`, checked against the contract. No arguments if the operation requires nothing. A `204` endpoint resolves with `undefined`. Rejects with a `ClientError` if the server responds with an error. |
| `pending`        | `ReadonlySignal<boolean>`        | `true` while a call is in flight.                                                                                                                                                                                             |
| `data`           | `ReadonlySignal<Output \| null>` | Latest successful call's response, or `null`.                                                                                                                                                                                 |
| `error`          | `ReadonlySignal<Error \| null>`  | Latest call's failure, or `null`.                                                                                                                                                                                             |

With `retrySafe`, adds `uncertain` (the sent intent without a response), `retry()` and `discard()`. Outside a component script, throws `Error: useApiMutation("<ruta>", "<método>") must be called while a component script runs, at the top level of <script>`.

## Examples

### Delete and reload the list

```html
<script lang="ts">
const notes = await useApi("/api/notes");
const remove = useApiMutation("/api/notes/[id]", "DELETE");
async function erase(id: string): Promise<void> {
  await remove.mutate({ params: { id } });
  await notes.refresh();
}
</script>

<template>
  <li each:of="notes.data.value" each:as="note" each:key="note.id">
    {note.text}
    <button type="button" bind:disabled="remove.pending.value" on:click="() => erase(note.id)">Borrar</button>
  </li>
</template>
```

### With `useForm`

`useForm` manages form state and field errors; the mutation handles submission:

```html
<script lang="ts">
const create = useApiMutation("/api/notes", "POST");
const form = useForm({
  initial: { text: "" },
  submit: (values) => create.mutate({ body: values }),
});
</script>

<template>
  <form on:submit="form.submit" novalidate>
    <textarea model="form.fields.text"></textarea>
    <p if:when="form.errors.value.text">{form.errors.value.text}</p>
    <button bind:disabled="form.pending.value">Guardar</button>
  </form>
</template>
```

### A charge that is not applied twice

```html
<script lang="ts">
const sale = useApiMutation("/api/sales", "POST", {
  retrySafe: { key: "pos:sale" },
  onSuccess(receipt, attempt) {
    if (attempt.trigger !== "mutate") notify(`Venta #${receipt.number} confirmada.`);
  },
});
</script>

<template>
  <div role="alert" if:when="sale.uncertain.value">
    <p>Venta en verificación: se reintentará con la misma clave, sin cobrar dos veces.</p>
    <button bind:disabled="sale.pending.value" on:click="() => sale.retry().catch(() => {})">Reintentar ahora</button>
  </div>
</template>
```

If the network fails or the server responds with `5xx`, `408` or `429`, the intent remains stored and is retried with the same `Idempotency-Key` header when connection returns, when a component using it mounts or with `retry()`. The server deduplicates using `context.idempotencyKey`.

## Common mistakes

### Await it with `await`

```ts bad
const create = await useApiMutation("/api/notes", "POST");
```

`meeko check` reports `MEEK055: useApiMutation no se puede esperar con await; llámalo sin await y espera su mutate(input) en un handler`.

<!-- no-check -->

```ts good
const create = useApiMutation("/api/notes", "POST");
async function save(text: string): Promise<void> { await create.mutate({ body: { text } }); }
```

### A read operation

```ts bad
const read = useApiMutation("/api/users", "GET");
```

`meeko check` reports `TS2345: Argument of type '"/api/users"' is not assignable to parameter of type '"/api/notes" | "/api/notes/[id]"'`: only routes with write methods are accepted. To read, use [`useApi`](/en/docs/reference/use-api).

<!-- no-check -->

```ts good
const users = useApi("/api/users");
```

### The body without `body`

`mutate` receives operation input (`params`, `query`, `body`), not the body directly.

```ts bad
await create.mutate({ text: "hola" });
```

`meeko check` reports `TS2353: Object literal may only specify known properties, and 'text' does not exist in type 'ApiMutationInput<…>'`.

<!-- no-check -->

```ts good
await create.mutate({ body: { text: "hola" } });
```

### Create it in the handler

```ts bad
async function save(): Promise<void> {
  await useApiMutation("/api/notes", "POST").mutate({ body: { text: "x" } });
}
```

The compiler does not flag this (to avoid rejecting custom functions with the same name), but at runtime it throws `Error: useApiMutation("/api/notes", "POST") must be called while a component script runs, at the top level of <script>`. Create it at the top level:

<!-- no-check -->

```ts good
const create = useApiMutation("/api/notes", "POST");
async function save(): Promise<void> { await create.mutate({ body: { text: "x" } }); }
```

## Notes

- **Never in SSR.** `mutate` only runs in the browser, in a handler. The server never sends mutations, nor do navigation dry runs.
- **Consistent state.** Each submission sets `pending` to `true` and `error` to `null` in one update, and finishes by simultaneously writing `data` or `error` and setting `pending` to `false`.
- **Security.** The request carries the session's CSRF token in `x-meeko-csrf` and the browser's `Origin`; the endpoint applies its own guards (`auth`, `authorize`, `rateLimit`). Do not trust the client for authorization.
- **Errors.** A server error arrives as a `ClientError`, with `code`, `status` and, for a `400`, `issues`. A failure inside `onSuccess` or `onError` goes to the nearest [`provideErrorHandler`](/en/docs/reference/provideerrorhandler) with source `"event"` and does not change the result.
- **`retrySafe`.** Use a key per mutation that includes what distinguishes users or accounts in the same browser. While an uncertain intent exists, `mutate` rejects with `MUTATION_UNCERTAIN` without sending anything: resolve it with `retry()` or `discard()`.
