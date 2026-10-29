---
title: createRpcClient
group: advanced
since: 1.0.0
description: Crea un cliente tipado de los procedimientos RPC a partir de su manifiesto público, donde cada llamada es un POST JSON con el token CSRF.
symbols:
  - "@meekojs/meeko/framework#createRpcClient"
types:
  - "@meekojs/meeko/framework#ClientOptions"
  - "@meekojs/meeko/framework#RpcOperation"
related:
  - "autoimport:rpc"
  - "@meekojs/meeko/framework#createApiClient"
  - "@meekojs/meeko/framework#createBrowserClientOptions"
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/server#defineRpc"
  - docs/framework.md#api-y-rpc
---

`createRpcClient` construye un cliente como el autoimport [`rpc`](/docs/reference/client-rpc): un método por procedimiento, anidado según su ID (`"users.get"` → `rpc.users.get(input)`). Cada llamada es un `POST` a su ruta (`/_meeko/rpc/users/get`) con la entrada en JSON y el token CSRF en `x-meeko-csrf`, y devuelve la salida parseada o rechaza con `ClientError`. Sólo necesita la lista pública de procedimientos; nunca importa código del servidor.

## Uso

```ts
import { createRpcClient } from "@meekojs/meeko/framework";
import type { RpcOperation } from "@meekojs/meeko/framework";

type Contract = {
  "math.sum": RpcOperation<{ a: number; b: number }, { total: number }>;
  "users.get": RpcOperation<{ id: string }, { id: string; name: string }>;
};

const rpc = createRpcClient<Contract>(
  {
    rpc: [
      { id: "math.sum", pathname: "/_meeko/rpc/math/sum" },
      { id: "users.get", pathname: "/_meeko/rpc/users/get" },
    ],
  },
  { baseUrl: "https://example.com", csrfToken: () => process.env.CSRF_TOKEN },
);

const { total } = await rpc.math.sum({ a: 1, b: 2 }); // POST https://example.com/_meeko/rpc/math/sum
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `manifest` | `{ rpc: { id, pathname }[] }` | obligatorio | Los procedimientos públicos. El `id` con puntos es el camino del método; `pathname`, su ruta, normalmente `/_meeko/rpc/<carpetas>/<archivo>`. |
| `options` | `ClientOptions` | `{}` | `baseUrl`, `fetch`, `csrfToken` y `headers`, como en `createApiClient`. |

`Contract` describe cada procedimiento con `RpcOperation<Input, Output>`; en una aplicación sale de `.meeko/types/server-contracts.d.ts`.

## Valor devuelto

Un objeto anidado por ID. Cada método recibe la entrada y, opcionalmente, `{ signal, idempotencyKey }`, y devuelve una promesa de la salida:

| Respuesta | Resultado |
| --- | --- |
| `2xx` con JSON | La salida parseada. |
| Un error del servidor `{ code, status, requestId, issues? }` | Rechaza con `ClientError`. |
| Un cuerpo que no es JSON | Rechaza con `ClientError` `INVALID_RESPONSE`. |

Lanza `TypeError` al crearse si dos procedimientos colisionan (`Client key collision: users.get`, por ejemplo con `users` y `users.get`, porque `rpc.users` no puede ser a la vez una función y un objeto) o un ID no es válido.

## Ejemplos

### Cancelar una llamada lenta

```ts
import { createRpcClient } from "@meekojs/meeko/framework";
import type { RpcOperation } from "@meekojs/meeko/framework";

type Contract = { "reports.build": RpcOperation<{ month: string }, { url: string }> };
const rpc = createRpcClient<Contract>({ rpc: [{ id: "reports.build", pathname: "/_meeko/rpc/reports/build" }] }, { baseUrl: "https://example.com" });

const report = await rpc.reports.build({ month: "2026-10" }, { signal: AbortSignal.timeout(5_000) });
console.log(report.url);
```

### Reintentos seguros con una clave de idempotencia

<!-- no-check -->
```ts
const key = crypto.randomUUID();
await retry(() => rpc.orders.create({ items }, { idempotencyKey: key }));
```

El servidor recibe la misma `Idempotency-Key` en cada intento (`context.idempotencyKey`) y puede devolver el resultado guardado en lugar de crear otro pedido. Un valor que no es un UUID rechaza con `TypeError` sin enviar nada.

### En una prueba, contra la aplicación sin red

<!-- no-check -->
```ts
const rpc = createRpcClient<Contract>(manifest, {
  baseUrl: "http://localhost",
  fetch: (input, init) => app.fetch(new Request(input, init)),
});
```

Con `app` de `createServerApp`, el cliente prueba el contrato completo (CSRF, validación, errores) sin abrir un puerto.

## Errores comunes

### Dos IDs que no pueden convivir

```ts bad
createRpcClient({ rpc: [
  { id: "users", pathname: "/_meeko/rpc/users" },
  { id: "users.get", pathname: "/_meeko/rpc/users/get" },
] });
```

`TypeError: Client key collision: users.get`. En una aplicación, el descubrimiento de servidor ya lo rechaza al generar el manifiesto, con los dos archivos.

<!-- no-check -->
```ts good
createRpcClient({ rpc: [
  { id: "users.list", pathname: "/_meeko/rpc/users/list" },
  { id: "users.get", pathname: "/_meeko/rpc/users/get" },
] });
```

### Usarlo en Node sin `baseUrl`

```ts bad
await createRpcClient<Contract>(manifest).math.sum({ a: 1, b: 2 });
```

`TypeError: Failed to parse URL from /_meeko/rpc/math/sum`: en Node, `fetch` no resuelve rutas relativas.

<!-- no-check -->
```ts good
await createRpcClient<Contract>(manifest, { baseUrl: "http://127.0.0.1:4173" }).math.sum({ a: 1, b: 2 });
```

### Una mutación con sesión sin token CSRF

```ts bad
const rpc = createRpcClient<Contract>(manifest, { baseUrl, headers: { cookie } });
await rpc.cart.add({ sku: "A1" });
```

Con una cookie de sesión, el servidor exige `x-meeko-csrf` en cada `POST`: sin él, `ClientError` con estado `403`. El token llega en la cabecera `x-meeko-csrf-token` de las respuestas y en la meta `meeko-csrf-token` del documento.

<!-- no-check -->
```ts good
const rpc = createRpcClient<Contract>(manifest, { baseUrl, headers: { cookie }, csrfToken: () => token });
```

## Notas

- **Siempre `POST`.** Un procedimiento RPC no se puede pedir con `GET`: el servidor responde `405` con `Allow: POST`. Para lecturas cacheables o enlazables, usa un endpoint de API.
- **Servidor y navegador.** Funciona en cualquier runtime con `fetch`. En el navegador, `createBrowserClientOptions()` da `csrfToken` y `fetch` ya conectados al documento.
- **Seguridad.** El manifiesto público no contiene rutas de archivos del servidor. La entrada se valida en el servidor con el schema de `defineRpc`; los tipos del cliente no sustituyen esa validación.
