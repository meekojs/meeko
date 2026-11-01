---
title: defineRpc
group: macros
since: 1.0.0
description: Declares an RPC procedure in server/rpc with input and output schemas, guards and a handler, called by the application with typed rpc.*.
symbols:
  - "@meekojs/meeko/server#defineRpc"
types:
  - "@meekojs/meeko/server#RpcDefinition"
related:
  - docs/como-elegir.md
  - "@meekojs/meeko/server#defineApiRoute"
  - "@meekojs/meeko/server#ApiError"
  - "autoimport:rpc"
  - "autoimport:useRpcQuery"
  - "autoimport:useRpcMutation"
  - docs/framework.md#api-y-rpc
  - docs/framework.md#valores-por-petición-locals
source-hash: 0b4712873756597ca1c48f308be0b9c0eb27f56c56af09613a708fd05a0fd3ac
---

`defineRpc` declares an RPC procedure: the default export of `server/rpc/<ruta>.ts`. `server/rpc/orders/create.ts` is the `orders.create` procedure, called with `POST /_meeko/rpc/orders/create` and, from the application, with `rpc.orders.create(input)`, `useRpcQuery` or `useRpcMutation`, with its schemas' types.

Unlike `defineApiRoute`, an RPC does not model HTTP resources: it receives an `input`, returns an `output` and always responds `200`. It is the shortest form for the application's own actions.

## Usage

<!-- no-check -->

```ts
// shared/schemas/orders.ts
import * as v from "valibot";

export const newOrder = v.object({ item: v.pipe(v.string(), v.minLength(1, "Elige un producto.")), qty: v.number() });
export const orderSchema = v.object({ id: v.string(), item: v.string(), qty: v.number() });
```

<!-- no-check -->

```ts
// server/rpc/orders/create.ts
import { defineRpc } from "@meekojs/meeko/server";
import { newOrder, orderSchema } from "../../../shared/schemas/orders";

export default defineRpc({
  input: newOrder,
  output: orderSchema,
  auth: "required",
  handler: async ({ input, context }) => createOrder(context.session.current!.data, input),
});
```

In the application, `await rpc.orders.create({ item: "té", qty: 2 })` returns `{ id: string; item: string; qty: number }`.

## Options

| Option      | Type                                                                                              | Default                         | Description                                                                                                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `input`     | Standard Schema from `shared/` or a simple composition of them                                    | required                        | The input. Input that fails it returns `400 INVALID_INPUT` with `issues`.                                                                                                                                                                                            |
| `output`    | Standard Schema from `shared/` or a simple composition of them (`v.array(itemSchema)`, since 1.8) | required                        | The handler's result. A result that fails it returns `500` without details.                                                                                                                                                                                          |
| `auth`      | `"required" \| "optional"`                                                                        | `"optional"`                    | With `"required"`, a call without a session returns `401`.                                                                                                                                                                                                           |
| `authorize` | `(context) => boolean \| Promise<boolean>`                                                        | none                            | With `false`, `403 FORBIDDEN`.                                                                                                                                                                                                                                       |
| `origin`    | `"required" \| "none"`                                                                            | `Origin` required (since `1.8`) | Since `1.8`, every call requires an allowed `Origin`, with or without a session; `"required"` makes it explicit. `"none"` (**unsafe**) disables it on calls without a session, for a service or app without `Origin`; with a session, `Origin` and CSRF still apply. |
| `rateLimit` | `{ limit, window, key? }`                                                                         | none                            | Since `1.2`. Call limit per window; above it, `429` with `Retry-After`. Without `key`, counts by client IP (`context.clientAddress`; behind Cloudflare Tunnel, `MEEKO_TRUST_PROXY=cloudflare`).                                                                      |
| `locals`    | `(context) => L \| Promise<L>`                                                                    | none                            | Since `1.2`. A per-call value received with types by the handler. Declare before `handler`.                                                                                                                                                                          |
| `handler`   | `({ input, context, locals }) => output`                                                          | required                        | The logic. `context` is the `RequestContext`.                                                                                                                                                                                                                        |

## Return value

The same definition, with inferred types. Responses follow the API: `200` with `output`, `400 INVALID_INPUT` with `issues`, the status of an `ApiError`, and `500 INTERNAL_ERROR` for any other error. There is no `status`: an RPC always responds `200`.

## Examples

### A login

Since `1.8`, every call requires an allowed `Origin` even without a session yet; `origin: "required"` makes it explicit at login, and `rateLimit` slows attempts:

<!-- no-check -->

```ts
// server/rpc/auth/login.ts
import { ApiError, defineRpc } from "@meekojs/meeko/server";
import { verifyPassword } from "@meekojs/meeko/password";
import { loginInput, loginOutput } from "../../../shared/schemas/auth";

export default defineRpc({
  input: loginInput,
  output: loginOutput,
  origin: "required",
  rateLimit: { limit: 5, window: "5m" },
  handler: async ({ input, context }) => {
    const user = await findUserByEmail(input.email);
    if (!user || !(await verifyPassword(input.password, user.passwordHash))) throw new ApiError("INVALID_CREDENTIALS", 401);
    await context.session.create({ userId: user.id });
    return { ok: true };
  },
});
```

### Data in a component

<!-- no-check -->

```ts
// server/rpc/orders/list.ts
import { defineRpc } from "@meekojs/meeko/server";
import { orderFilter, orderList } from "../../../shared/schemas/orders";

export default defineRpc({
  input: orderFilter,
  output: orderList,
  auth: "required",
  handler: ({ input, context }) => listOrders(context.session.current!.data, input.status),
});
```

```html
<!-- app/pages/orders.meeko -->
<script lang="ts">
const status = signal<"open" | "closed">("open");
const orders = await useRpcQuery("orders.list", () => ({ status: status.value }));
const create = useRpcMutation("orders.create");
</script>

<template>
  <ul><li each:of="orders.data.value" each:as="order" each:key="order.id">{order.item} × {order.qty}</li></ul>
  <button type="button" bind:disabled="create.pending.value" on:click="() => create.mutate({ item: 'té', qty: 1 })">Pedir té</button>
</template>
```

### A user loaded with `locals`

<!-- no-check -->

```ts
// server/rpc/profile/update.ts
import { ApiError, defineRpc } from "@meekojs/meeko/server";
import { profileInput, profileOutput } from "../../../shared/schemas/profile";

export default defineRpc({
  input: profileInput,
  output: profileOutput,
  auth: "required",
  locals: async ({ session }) => {
    const user = await findUser((session.current!.data as { userId: string }).userId);
    if (!user) throw new ApiError("UNAUTHENTICATED", 401);
    return { user };
  },
  handler: ({ input, locals }) => updateProfile(locals.user, input),
});
```

## Common mistakes

### Without `input` or `output`

```ts bad
export default defineRpc({ input: newOrder, handler: ({ input }) => ({ id: "1", ...input }) });
```

`meeko check` stops with `server/rpc/orders/create.ts: el RPC requiere schemas públicos input y output`.

<!-- no-check -->

```ts good
export default defineRpc({ input: newOrder, output: orderSchema, handler: ({ input }) => ({ id: "1", ...input }) });
```

### `status` in an RPC

```ts bad
export default defineRpc({ input: newOrder, output: orderSchema, status: 201, handler: ({ input }) => ({ id: "1", ...input }) });
```

`meeko check` reports `TS2353: Object literal may only specify known properties, and 'status' does not exist in type 'RpcDefinition<…>'.` To choose the status, use `defineApiRoute`.

<!-- no-check -->

```ts good
export default defineRpc({ input: newOrder, output: orderSchema, handler: ({ input }) => ({ id: "1", ...input }) });
```

### A procedure and a directory with the same name

```text bad
server/rpc/orders.ts          ← rpc.orders(…)
server/rpc/orders/create.ts   ← rpc.orders.create(…)
```

`Colisión de procedimientos RPC: server\rpc\orders.ts (orders) y server\rpc\orders\create.ts (orders.create) no pueden ser a la vez rutas invocables del cliente`.

```text good
server/rpc/orders/list.ts     ← rpc.orders.list(…)
server/rpc/orders/create.ts   ← rpc.orders.create(…)
```

## Notes

- **Security.** Every call requires an allowed `Origin` (since `1.8`, also without a session; `origin: "none"` disables it only without a session) and, with a session, the CSRF token; the generated client sends both automatically. A Node `fetch` or `curl` call without `Origin` returns `403 INVALID_ORIGIN`. Route middleware does not protect RPC: use `auth`, `authorize` and `locals`.
- **Order.** `Origin` (since `1.8`, on every call except with `origin: "none"`), session `Origin` and CSRF, `rateLimit`, `auth`, `authorize`, `input`, `locals`, `handler` and `output`.
- **SSR.** On the server, `rpc.*` dispatches locally with the original request's session, without a network call. `await useRpcQuery(…)` loads data in SSR; without `await`, the list is empty in the HTML and `meeko check` warns about the layout shift with `MEEK117`.
- **Errors.** Write messages in the `input` schema: they travel in `issues` and `useForm` distributes them by field. An error other than `ApiError` never exposes its message.
- **Names.** The procedure name comes from the file path (`orders/create.ts` is `orders.create`); schemas must be in `shared/`, or, since 1.8, be a simple composition of them using package functions such as `v.array(itemSchema)`, and have concrete types (neither `any` nor `unknown`). See [Public schemas](../../framework.md#public-schemas).
