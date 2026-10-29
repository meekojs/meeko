---
title: createApiClient
group: advanced
since: 1.0.0
description: Crea un cliente tipado de los endpoints de API a partir de su manifiesto público, sin importar código del servidor, para clientes explícitos, externos o de pruebas.
symbols:
  - "@meekojs/meeko/framework#createApiClient"
types:
  - "@meekojs/meeko/framework#ClientOptions"
  - "@meekojs/meeko/framework#ApiOperation"
related:
  - "autoimport:api"
  - "@meekojs/meeko/framework#createRpcClient"
  - "@meekojs/meeko/framework#createBrowserClientOptions"
  - "@meekojs/meeko/framework#ClientError"
  - "@meekojs/meeko/server#defineApiRoute"
  - docs/framework.md#api-y-rpc
---

`createApiClient` construye un cliente como el autoimport [`api`](/docs/reference/client-api) de una aplicación: un objeto con un método por endpoint (`api.users.byId.get(…)`) que arma la URL con los parámetros y la query, envía el cuerpo en JSON con el token CSRF en las mutaciones y devuelve la respuesta ya parseada, o lanza un `ClientError` con el código del servidor. Sólo necesita la lista pública de endpoints (clave, ruta y método); nunca importa código del servidor.

El autoimport `api` ya se genera con él. Úsalo para un cliente explícito: un script, una prueba, otra aplicación que consume la API, o un cliente con otra URL base o cabeceras propias.

## Uso

```ts
import { createApiClient } from "@meekojs/meeko/framework";
import type { ApiOperation } from "@meekojs/meeko/framework";

type Contract = {
  users: { get: ApiOperation<undefined, undefined, undefined, { id: string; name: string }[]> };
  "users.byId": { get: ApiOperation<{ id: string }, { tab?: string }, undefined, { id: string; name: string }> };
};

const api = createApiClient<Contract>(
  {
    api: [
      { clientKey: "users", pathname: "/api/users", method: "GET" },
      { clientKey: "users.byId", pathname: "/api/users/[id]", method: "GET" },
    ],
  },
  { baseUrl: "https://example.com" },
);

const users = await api.users.get();
const ada = await api.users.byId.get({ params: { id: "42" }, query: { tab: "perfil" } });
// GET https://example.com/api/users/42?tab=perfil
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `manifest` | `{ api: { clientKey, pathname, method }[] }` | obligatorio | Los endpoints públicos. `clientKey` es el camino del método (`"users.byId"` → `api.users.byId`); `pathname` usa `[param]` para los segmentos dinámicos. En una aplicación, `meeko check` lo escribe en `.meeko/manifests/server.json`. |
| `options.baseUrl` | URL o `() => string` | ninguna | Origen contra el que se resuelven las rutas. Sin él, rutas relativas: valen en el navegador, no en Node. |
| `options.fetch` | `typeof fetch` | el global | Implementación de `fetch`, para pruebas o para añadir lógica. |
| `options.csrfToken` | texto o `() => string \| undefined` | ninguno | Token que se envía en `x-meeko-csrf` en los métodos distintos de `GET` y `HEAD`. |
| `options.headers` | `HeadersInit` o `() => HeadersInit` | ninguno | Cabeceras de cada petición. |

`Contract` (el argumento de tipo) describe cada operación con `ApiOperation<Params, Query, Body, Output>`. En una aplicación sale de `.meeko/types/server-contracts.d.ts`.

## Valor devuelto

Un objeto anidado por `clientKey`, con un método por verbo HTTP en minúsculas (`get`, `post`, `put`, `patch`, `delete`). Cada método recibe `{ params, query, body }` según su operación (lo que el contrato no declara está prohibido; una query cuyos campos son todos opcionales puede omitirse) y, además, `signal` e `idempotencyKey` (desde `1.2`, un UUID para la cabecera `Idempotency-Key`). Devuelve una promesa del `Output`:

| Respuesta | Resultado |
| --- | --- |
| `2xx` con JSON | El valor parseado. |
| `4xx` o `5xx` con `{ code, status, requestId, issues? }` | Rechaza con `ClientError` con esos campos. |
| Un cuerpo que no es JSON | Rechaza con `ClientError` `INVALID_RESPONSE`. |
| Un parámetro con `/` | Rechaza con `TypeError: Invalid route parameter: id`, sin hacer la petición. |
| Un fallo de red | Rechaza con el error de `fetch` (en Node, `TypeError: fetch failed`). |

Lanza `TypeError` al crearse si dos endpoints producen el mismo método (`Duplicate API method: users.get`) o un segmento es a la vez estático y dinámico.

## Ejemplos

### Un script que consume la API de producción

```ts
import { createApiClient } from "@meekojs/meeko/framework";
import type { ApiOperation } from "@meekojs/meeko/framework";

type Contract = { orders: { get: ApiOperation<undefined, { since: string }, undefined, { id: string }[]> } };

const api = createApiClient<Contract>(
  { api: [{ clientKey: "orders", pathname: "/api/orders", method: "GET" }] },
  { baseUrl: "https://tienda.example.com", headers: () => ({ authorization: `Bearer ${process.env.API_TOKEN ?? ""}` }) },
);

const orders = await api.orders.get({ query: { since: "2026-10-01" } });
console.log(`${orders.length} pedidos`);
```

### Pruebas con un `fetch` falso

```ts
import { ClientError, createApiClient } from "@meekojs/meeko/framework";
import type { ApiOperation } from "@meekojs/meeko/framework";

type Contract = { users: { get: ApiOperation<undefined, undefined, undefined, { id: string }[]> } };

const api = createApiClient<Contract>(
  { api: [{ clientKey: "users", pathname: "/api/users", method: "GET" }] },
  { fetch: async () => Response.json({ code: "UNAUTHENTICATED", status: 401, requestId: "r1" }, { status: 401 }) },
);

try {
  await api.users.get();
} catch (error) {
  if (error instanceof ClientError) console.log(error.code, error.status, error.requestId); // UNAUTHENTICATED 401 r1
}
```

### En el navegador, con el token CSRF de la página

<!-- no-check -->
```ts
import { createApiClient, createBrowserClientOptions } from "@meekojs/meeko/framework";
import manifest from "./api-manifest.json";

export const api = createApiClient<ApiContract>(manifest, createBrowserClientOptions());
```

`createBrowserClientOptions()` lee el token de la meta `meeko-csrf-token` en cada llamada y lo actualiza con la cabecera `x-meeko-csrf-token` de las respuestas.

## Errores comunes

### Usarlo en Node sin `baseUrl`

```ts bad
const api = createApiClient<Contract>(manifest);
await api.users.get();
```

En Node, `fetch` no resuelve rutas relativas: `TypeError: Failed to parse URL from /api/users`.

<!-- no-check -->
```ts good
const api = createApiClient<Contract>(manifest, { baseUrl: "http://127.0.0.1:4173" });
```

### Dos endpoints con la misma clave y método

```ts bad
createApiClient({ api: [
  { clientKey: "users", pathname: "/api/users", method: "GET" },
  { clientKey: "users", pathname: "/api/people", method: "GET" },
] });
```

`TypeError: Duplicate API method: users.get`, al crear el cliente.

<!-- no-check -->
```ts good
createApiClient({ api: [
  { clientKey: "users", pathname: "/api/users", method: "GET" },
  { clientKey: "people", pathname: "/api/people", method: "GET" },
] });
```

### Poner un `/` en un parámetro

```ts bad
await api.users.byId.get({ params: { id: "equipo/ana" } });
```

`TypeError: Invalid route parameter: id`, sin petición: un parámetro es un único segmento de la URL. Un parámetro que la ruta no declara da `Unknown route parameter: …`.

<!-- no-check -->
```ts good
await api.users.byId.get({ params: { id: "ana" }, query: { team: "equipo" } });
```

### Esperar un `ClientError` cuando falla la red

```ts bad
try { await api.users.get(); }
catch (error) { if (isClientError(error)) showError(error.code); }
```

Sin conexión, o con el servidor caído, no hay respuesta del servidor que convertir: el rechazo es el de `fetch` (`TypeError: fetch failed` en Node, `TypeError: Failed to fetch` en Chrome) y el `catch` de arriba lo traga en silencio.

<!-- no-check -->
```ts good
try { await api.users.get(); }
catch (error) {
  if (isClientError(error)) showError(error.code);
  else showError("SIN_CONEXION");
}
```

## Notas

- **Servidor y navegador.** Funciona en cualquier runtime con `fetch`. En el SSR de una aplicación, el autoimport `api` despacha las llamadas localmente, sin red; un cliente creado a mano siempre usa `fetch`.
- **Seguridad.** El manifiesto público sólo contiene claves, rutas y métodos: nunca rutas de archivos del servidor. Las mutaciones necesitan `csrfToken` cuando hay sesión; sin él, el servidor responde `403`.
- **Codificación.** Los parámetros y la query se codifican (`"a b"` → `a%20b`); las claves de query con `null` o `undefined` se omiten y un array repite la clave.
- **Tipos.** Con `Contract`, los parámetros, la query, el cuerpo y la respuesta se comprueban en compilación: `api.users.post({ body: { invalid: true } })` es un error de tipos si el contrato dice otra cosa.
