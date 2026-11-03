---
title: rpc
group: utils
since: 1.0.0
description: Generated client for server/rpc procedures, typed by their input and output schemas, that works the same in the browser and on the server.
symbols:
  - "autoimport:rpc"
types:
  - "@meekojs/meeko/framework#RpcClient"
related:
  - "@meekojs/meeko/server#defineRpc"
  - "autoimport:useRpcQuery"
  - "autoimport:useRpcMutation"
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/framework#createRpcClient"
  - "autoimport:api"
  - docs/framework.md#api-y-rpc
source-hash: 3c139eb1258797c535e1f4cb2bec8a49bf387ffafccf853cbee6b6c7f382c607
---

`rpc` is the client Meeko generates from `server/rpc` procedures: `server/rpc/orders/create.ts` becomes `rpc.orders.create(input)`. The input and result have the types from the procedure's `input` and `output` schemas.

It is auto-imported in application and server code. In the browser it makes a same-origin `POST /_meeko/rpc/<ruta>` with the CSRF token; on the server it dispatches locally, with the request's session.

## Usage

```html
<!-- app/components/QuickOrder.meeko -->
<script lang="ts">
const status = signal<string | null>(null);
async function order(): Promise<void> {
  const created = await rpc.orders.create({ item: "tea", qty: 1 });
  status.value = `Pedido ${created.id}`;
}
</script>

<template>
  <button type="button" on:click="order">Order tea</button>
  <p if:when="status.value" role="status">{status.value}</p>
</template>
```

## Parameters

| Parameter        | Type                        | Description                     |
| ---------------- | --------------------------- | ------------------------------- |
| `input`          | input of the `input` schema | Required: the procedure's data. |
| `options.signal` | `AbortSignal`               | Cancels the call.               |

## Return value

A promise with the `output` schema's output. An error rejects with a `ClientError`: `400 INVALID_INPUT` with field `issues`, the code and status of an `ApiError`, or `INTERNAL_ERROR` for any other failure.

## Examples

### Displaying field validation errors

```ts
import { ClientError } from "@meekojs/meeko/framework";

export async function submitLogin(call: () => Promise<unknown>, fieldErrors: Map<string, string>): Promise<boolean> {
  fieldErrors.clear();
  try {
    await call();
    return true;
  } catch (error) {
    if (!(error instanceof ClientError) || !error.issues) throw error;
    for (const issue of error.issues) fieldErrors.set(issue.path, issue.message);
    return false;
  }
}
```

With `submitLogin(() => rpc.auth.login({ email, password }), errors)`. For forms, `useForm` distributes these errors for you.

### Calling from a page's server code

```html
<!-- app/pages/orders.meeko -->
<script server lang="ts">
export const open = await rpc.orders.list({ status: "open" });
</script>

<template>
  <ul><li each:of="open" each:as="order" each:key="order.id">{order.item} × {order.qty}</li></ul>
</template>
```

### In a component, with loading state

For displayed data, `useRpcQuery` adds SSR, hydration and reloading; for mutations, `useRpcMutation` adds `pending` and `error`:

```html
<script lang="ts">
const orders = await useRpcQuery("orders.list", { status: "open" });
const create = useRpcMutation("orders.create");
</script>

<template>
  <ul><li each:of="orders.data.value" each:as="order" each:key="order.id">{order.item}</li></ul>
  <button type="button" bind:disabled="create.pending.value" on:click="() => create.mutate({ item: 'tea', qty: 1 })">Order</button>
</template>
```

## Common mistakes

### Incomplete input

```ts bad
await rpc.orders.create({ item: "tea" });
```

`meeko check` reports `TS2741: Property 'qty' is missing in type '{ item: string; }' but required in type '{ item: string; qty: number; }'.` If untyped input arrives and fails the schema, the server responds with `400 INVALID_INPUT` and `issues`.

<!-- no-check -->

```ts good
await rpc.orders.create({ item: "tea", qty: 1 });
```

### A procedure that does not exist

```ts bad
await rpc.orders.remove({ id: "1" });
```

`meeko check` reports `TS2339: Property 'remove' does not exist on type '{ create: …; } & { list: …; }'.` A new file in `server/rpc` needs `meeko check`, `meeko dev` or `meeko routes` to appear in the client.

<!-- no-check -->

```ts good
// server/rpc/orders/remove.ts exists
await rpc.orders.remove({ id: "1" });
```

### `await rpc.*` at the script's top level

```html bad
<script lang="ts">
const orders = await rpc.orders.list({ status: "open" });
</script>
```

`MEEK055: El await de nivel superior sólo se admite sobre useElementRef, useSocket, useSocketClient, useApi, useRpcQuery; mueve el resto del trabajo asíncrono a una función o a onMounted`.

```html good
<script lang="ts">
const orders = await useRpcQuery("orders.list", { status: "open" });
</script>
```

## Notes

- **Security.** With a session, each call carries the `Origin` and CSRF token, which the client reads from the `meeko-csrf-token` meta tag. Procedure guards (`auth`, `authorize`) always apply, including during local SSR dispatch.
- **SSR.** On the server, `rpc.*` reuses the current request; outside one (a script, a timer), it fails with a clear error.
- **Names.** The name comes from the file path: `server/rpc/orders/create.ts` is `orders.create`, both in `rpc.orders.create` and in `useRpcQuery("orders.create")`.
- **External clients.** To call another Meeko service, `createRpcClient(manifest, { baseUrl })` creates an explicit client with the same type.
