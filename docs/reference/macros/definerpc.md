---
title: defineRpc
group: macros
since: 1.0.0
description: Declara un procedimiento RPC de server/rpc con sus schemas de entrada y salida, guardas y handler, que la aplicación llama con rpc.* tipado.
symbols:
  - "@meekojs/meeko/server#defineRpc"
types:
  - "@meekojs/meeko/server#RpcDefinition"
related:
  - "@meekojs/meeko/server#defineApiRoute"
  - "@meekojs/meeko/server#ApiError"
  - "autoimport:rpc"
  - "autoimport:useRpcQuery"
  - "autoimport:useRpcMutation"
  - docs/framework.md#api-y-rpc
  - docs/framework.md#valores-por-petición-locals
---

`defineRpc` declara un procedimiento RPC: el export por defecto de `server/rpc/<ruta>.ts`. `server/rpc/orders/create.ts` es el procedimiento `orders.create`, que se llama con `POST /_meeko/rpc/orders/create` y, desde la aplicación, con `rpc.orders.create(input)`, `useRpcQuery` o `useRpcMutation`, con los tipos de sus schemas.

Frente a `defineApiRoute`, un RPC no modela recursos HTTP: recibe un `input`, devuelve un `output` y siempre responde `200`. Es la forma más corta para acciones de la propia aplicación.

## Uso

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

En la aplicación, `await rpc.orders.create({ item: "té", qty: 2 })` devuelve `{ id: string; item: string; qty: number }`.

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `input` | Standard Schema de `shared/` | obligatorio | La entrada. Una que no lo supera responde `400 INVALID_INPUT` con `issues`. |
| `output` | Standard Schema de `shared/` | obligatorio | El resultado del handler. Uno que no lo supera responde `500` sin detalle. |
| `auth` | `"required" \| "optional"` | `"optional"` | Con `"required"`, una llamada sin sesión responde `401`. |
| `authorize` | `(context) => boolean \| Promise<boolean>` | ninguno | Con `false`, `403 FORBIDDEN`. |
| `origin` | `"required" \| "none"` | según la sesión | `"required"` exige un `Origin` permitido aunque no haya sesión. |
| `rateLimit` | `{ limit, window, key? }` | ninguno | Desde `1.2`. Límite de llamadas por ventana; por encima, `429` con `Retry-After`. |
| `locals` | `(context) => L \| Promise<L>` | ninguno | Desde `1.2`. Un valor por llamada que el handler recibe tipado. Decláralo antes de `handler`. |
| `handler` | `({ input, context, locals }) => output` | obligatorio | La lógica. `context` es el `RequestContext`. |

## Valor devuelto

La misma definición, con sus tipos inferidos. Las respuestas siguen las de la API: `200` con el `output`, `400 INVALID_INPUT` con `issues`, el estado de un `ApiError` y `500 INTERNAL_ERROR` para cualquier otro error. No hay `status`: un RPC siempre responde `200`.

## Ejemplos

### Un inicio de sesión

`origin: "required"` protege el formulario aunque todavía no haya sesión, y `rateLimit` frena los intentos:

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

### Datos en un componente

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

### Un usuario cargado con `locals`

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

## Errores comunes

### Sin `input` u `output`

```ts bad
export default defineRpc({ input: newOrder, handler: ({ input }) => ({ id: "1", ...input }) });
```

`meeko check` se detiene con `server/rpc/orders/create.ts: el RPC requiere schemas públicos input y output`.

<!-- no-check -->
```ts good
export default defineRpc({ input: newOrder, output: orderSchema, handler: ({ input }) => ({ id: "1", ...input }) });
```

### `status` en un RPC

```ts bad
export default defineRpc({ input: newOrder, output: orderSchema, status: 201, handler: ({ input }) => ({ id: "1", ...input }) });
```

`meeko check` da `TS2353: Object literal may only specify known properties, and 'status' does not exist in type 'RpcDefinition<…>'.` Para elegir el estado, usa `defineApiRoute`.

<!-- no-check -->
```ts good
export default defineRpc({ input: newOrder, output: orderSchema, handler: ({ input }) => ({ id: "1", ...input }) });
```

### Un procedimiento y una carpeta con el mismo nombre

```text bad
server/rpc/orders.ts          ← rpc.orders(…)
server/rpc/orders/create.ts   ← rpc.orders.create(…)
```

`Colisión de procedimientos RPC: server\rpc\orders.ts (orders) y server\rpc\orders\create.ts (orders.create) no pueden ser a la vez rutas invocables del cliente`.

```text good
server/rpc/orders/list.ts     ← rpc.orders.list(…)
server/rpc/orders/create.ts   ← rpc.orders.create(…)
```

## Notas

- **Seguridad.** Con sesión, cada llamada exige el `Origin` permitido y el token CSRF, que el cliente generado envía solo; sin sesión, sólo con `origin: "required"`. El middleware de ruta no protege el RPC: usa `auth`, `authorize` y `locals`.
- **Orden.** `Origin` con `origin: "required"`, `Origin` y CSRF de la sesión, `rateLimit`, `auth`, `authorize`, `input`, `locals`, `handler` y `output`.
- **SSR.** En el servidor, `rpc.*` despacha localmente con la sesión de la petición original, sin salir a la red. `await useRpcQuery(…)` carga los datos en el SSR; sin `await`, la lista sale vacía en el HTML y `meeko check` avisa con `MEEK117` del salto de diseño.
- **Errores.** Escribe los mensajes en el schema de `input`: viajan en `issues` y `useForm` los reparte por campo. Un error que no es `ApiError` nunca expone su mensaje.
- **Nombres.** El nombre del procedimiento sale de la ruta del archivo (`orders/create.ts` es `orders.create`); los schemas deben estar en `shared/` y ser tipos concretos (ni `any` ni `unknown`).
