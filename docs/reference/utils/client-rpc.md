---
title: rpc
group: utils
since: 1.0.0
description: Cliente generado de los procedimientos de server/rpc, tipado por sus schemas de entrada y salida, que funciona igual en el navegador y en el servidor.
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
---

`rpc` es el cliente que Meeko genera a partir de los procedimientos de `server/rpc`: `server/rpc/orders/create.ts` es `rpc.orders.create(input)`. La entrada y el resultado tienen los tipos de los schemas `input` y `output` del procedimiento.

Se autoimporta en el código de la aplicación y del servidor. En el navegador hace un `POST /_meeko/rpc/<ruta>` del mismo origen con el token CSRF; en el servidor despacha localmente, con la sesión de la petición.

## Uso

```html
<!-- app/components/QuickOrder.meeko -->
<script lang="ts">
const status = signal<string | null>(null);
async function order(): Promise<void> {
  const created = await rpc.orders.create({ item: "té", qty: 1 });
  status.value = `Pedido ${created.id}`;
}
</script>

<template>
  <button type="button" on:click="order">Pedir té</button>
  <p if:when="status.value" role="status">{status.value}</p>
</template>
```

## Parámetros

| Parámetro | Tipo | Descripción |
| --- | --- | --- |
| `input` | la entrada del schema `input` | Obligatorio: los datos del procedimiento. |
| `options.signal` | `AbortSignal` | Cancela la llamada. |

## Valor devuelto

Una promesa con la salida del schema `output`. Un error rechaza con un `ClientError`: `400 INVALID_INPUT` con `issues` por campo, el código y el estado de un `ApiError`, o `INTERNAL_ERROR` para cualquier otro fallo.

## Ejemplos

### Mostrar los errores de validación por campo

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

Con `submitLogin(() => rpc.auth.login({ email, password }), errors)`. Para formularios, `useForm` hace este reparto por ti.

### Llamar desde el código de servidor de una página

```html
<!-- app/pages/orders.meeko -->
<script server lang="ts">
export const open = await rpc.orders.list({ status: "open" });
</script>

<template>
  <ul><li each:of="open" each:as="order" each:key="order.id">{order.item} × {order.qty}</li></ul>
</template>
```

### En un componente, con estado de carga

Para datos que se muestran, `useRpcQuery` añade SSR, hidratación y recarga; para mutaciones, `useRpcMutation` añade `pending` y `error`:

```html
<script lang="ts">
const orders = await useRpcQuery("orders.list", { status: "open" });
const create = useRpcMutation("orders.create");
</script>

<template>
  <ul><li each:of="orders.data.value" each:as="order" each:key="order.id">{order.item}</li></ul>
  <button type="button" bind:disabled="create.pending.value" on:click="() => create.mutate({ item: 'té', qty: 1 })">Pedir</button>
</template>
```

## Errores comunes

### Una entrada incompleta

```ts bad
await rpc.orders.create({ item: "té" });
```

`meeko check` da `TS2741: Property 'qty' is missing in type '{ item: string; }' but required in type '{ item: string; qty: number; }'.` Si la entrada llega sin tipos y no supera el schema, el servidor responde `400 INVALID_INPUT` con `issues`.

<!-- no-check -->
```ts good
await rpc.orders.create({ item: "té", qty: 1 });
```

### Un procedimiento que no existe

```ts bad
await rpc.orders.remove({ id: "1" });
```

`meeko check` da `TS2339: Property 'remove' does not exist on type '{ create: …; } & { list: …; }'.` Un archivo nuevo de `server/rpc` necesita `meeko check`, `meeko dev` o `meeko routes` para aparecer en el cliente.

<!-- no-check -->
```ts good
// server/rpc/orders/remove.ts existe
await rpc.orders.remove({ id: "1" });
```

### `await rpc.*` en el nivel superior del script

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

## Notas

- **Seguridad.** Con sesión, cada llamada lleva el `Origin` y el token CSRF, que el cliente lee de la meta `meeko-csrf-token`. Las guardas del procedimiento (`auth`, `authorize`) se aplican siempre, también en el despacho local del SSR.
- **SSR.** En el servidor, `rpc.*` reutiliza la petición en curso; fuera de una (un script, un temporizador) falla con un error claro.
- **Nombres.** El nombre sale de la ruta del archivo: `server/rpc/orders/create.ts` es `orders.create`, tanto en `rpc.orders.create` como en `useRpcQuery("orders.create")`.
- **Clientes externos.** Para llamar a otro servicio Meeko, `createRpcClient(manifest, { baseUrl })` crea un cliente explícito con el mismo tipo.
