---
title: api
group: utils
since: 1.0.0
description: Generated client for server/api endpoints, typed by their schemas, working the same way in the browser and on the server.
symbols:
  - "autoimport:api"
types:
  - "@meekojs/meeko/framework#ApiClient"
related:
  - "@meekojs/meeko/server#defineApiRoute"
  - "autoimport:useApi"
  - "autoimport:useApiMutation"
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/framework#createApiClient"
  - "autoimport:rpc"
  - docs/framework.md#api-y-rpc
  - docs/framework.md#segmentos-dinámicos-en-api
source-hash: 479d1a2f3e81199b02c74b4a2f33b9cace3b8a1abbc4378bd8534c31c03933ea
---

`api` is the client Meeko generates from `server/api` endpoints: each folder or file is a level, each method suffix (`.get.ts`, `.post.ts`…) is a method, and each dynamic segment is called with its parameter. Input and response types come from the endpoint's public schemas, so an incorrect route, parameter or field is a `meeko check` error.

It is auto-imported in application and server code. In the browser it uses same-origin `fetch` with the CSRF token; on the server it dispatches locally through the same pipeline, with the request's session, without going over the network.

## Usage

```text
server/api/users/index.get.ts       → api.users.get()
server/api/users/[id].get.ts        → api.users({ id }).get()
server/api/users/[id].patch.ts      → api.users({ id }).patch({ body })
server/api/orgs/[org]/users.get.ts  → api.orgs({ org }).users.get({ query })
```

```html
<!-- app/components/RenameUser.meeko -->
<script lang="ts">
const props = defineProps<{ id: string }>();
const name = signal("");
const saved = signal<string | null>(null);
async function save(event: SubmitEvent): Promise<void> {
  event.preventDefault();
  const user = await api.users({ id: props.id }).patch({ body: { name: name.value } });
  saved.value = user.name;
}
</script>

<template>
  <form on:submit="save">
    <input model="name" aria-label="Name">
    <button>Save</button>
    <p if:when="saved.value" role="status">Saved as {saved.value}</p>
  </form>
</template>
```

## Parameters

Each method takes an optional object:

| Option   | Type                        | Description             |
| -------- | --------------------------- | ----------------------- |
| `query`  | input of the `query` schema | The query string.       |
| `body`   | input of the `body` schema  | The body, sent as JSON. |
| `signal` | `AbortSignal`               | Cancels the request.    |

A dynamic segment is called with an object containing its single parameter, as text: `api.users({ id: "7" })`. A catch-all `[...path]` takes segments joined with `/`.

## Return value

A promise with the output of the endpoint's `response` schema (`undefined` with `status: 204`). An error response rejects with a `ClientError`, with `code`, `status`, `requestId` and `issues` for a validation `400` or an `ApiError` with `issues`.

## Examples

### On the server, with the request's session

In a `<script server>`, `api.*` reuses the current request: its session, services and `requestId`.

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
const { params } = usePage();
export const user = await api.users({ id: params.id }).get();
</script>

<template><h1>{user.name}</h1></template>
```

### Handle an API error

```ts
import { isClientError } from "@meekojs/meeko/framework";

export async function safeName(load: () => Promise<{ name: string }>): Promise<string> {
  try {
    return (await load()).name;
  } catch (error) {
    if (isClientError(error, "NOT_FOUND")) return "Usuario borrado";
    throw error;
  }
}
```

With `safeName(() => api.users({ id }).get())`, an endpoint `404` yields “Usuario borrado” (user deleted) and any other error propagates.

### Cancel a search

<!-- no-check -->

```ts
let controller: AbortController | undefined;
async function search(q: string) {
  controller?.abort();
  controller = new AbortController();
  return api.products.get({ query: { q }, signal: controller.signal });
}
```

For searches as you type, `useApi(…, { debounceMs })` handles this for you since `1.7`.

## Common mistakes

### `await api.*` at script top level

```html bad
<script lang="ts">
const users = await api.users.get();
</script>
```

`MEEK055: El await de nivel superior sólo se admite sobre useElementRef, useSocket, useSocketClient, useApi, useRpcQuery; mueve el resto del trabajo asíncrono a una función o a onMounted`. To load data in a component with SSR and hydration, use `useApi`.

```html good
<script lang="ts">
const users = await useApi("/api/users");
</script>
```

### Missing or non-text segment parameters

```ts bad
await api.users({}).get();
await api.users({ id: 7 }).get();
```

`meeko check` reports `TS2741: Property 'id' is missing in type '{}' but required in type '{ readonly id: string; }'.` and `TS2322: Type 'number' is not assignable to type 'string'.` At runtime, an object without the parameter throws `TypeError`.

<!-- no-check -->

```ts good
await api.users({ id: String(userId) }).get();
```

### A method or field the endpoint does not have

```ts bad
await api.items.post();
await api.users({ id: "1" }).patch({ body: { title: "x" } });
```

`meeko check` reports `TS2339: Property 'post' does not exist on type 'ApiMethods<…>'.` and `TS2353: Object literal may only specify known properties, and 'title' does not exist in type '{ name: string; }'.`

<!-- no-check -->

```ts good
await api.items.get();
await api.users({ id: "1" }).patch({ body: { name: "x" } });
```

### The old form with `params`

```ts bad
await api.users.get({ params: { id: "1" } });
```

`meeko check` reports `TS2339: Property 'get' does not exist on type …`: since `1.2`, the dynamic segment is called with its parameter. The `api.users.byId.get({ params })` form still works in `1.x`, deprecated, and will be removed in `2.0`.

<!-- no-check -->

```ts good
await api.users({ id: "1" }).get();
```

## Notes

- **Generation.** `meeko routes`, `meeko check` and `meeko dev` generate `.meeko/generated/clients.client.ts` and `clients.server.ts` with public descriptors and inferred types; they never import handlers. A new endpoint needs one of these commands.
- **Security.** In the browser, the client reads the CSRF token from the `meeko-csrf-token` meta and sends it with every mutation. Private server errors never reach it: an unknown failure is `INTERNAL_ERROR`.
- **SSR.** On the server, a call outside a request (a script, a timer) fails with a clear error: there is no session or pipeline to reuse.
- **Components.** To read data with SSR, hydration and loading state, use `useApi`; for mutations with submission state, use `useApiMutation`. `api.*` is the direct call, in handlers, loaders and server code.
- **Non-JSON responses.** An endpoint with `contentType: "response"` returns the `Response` as is.
