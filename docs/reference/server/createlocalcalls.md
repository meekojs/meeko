---
title: createLocalCalls
group: server
since: 1.0.0
description: Llama a la API y al RPC de la aplicación dentro del proceso, con las credenciales de la petición en curso y las mismas guardas, validaciones y límites que por HTTP.
symbols:
  - "@meekojs/meeko/server#createLocalCalls"
types:
  - "@meekojs/meeko/server#LocalCallOptions"
  - "@meekojs/meeko/server#LocalApiInput"
related:
  - "@meekojs/meeko/server#createLocalServerFetch"
  - "@meekojs/meeko/server#createServerDispatcher"
  - "@meekojs/meeko/server#errorResponse"
  - "autoimport:api"
  - "autoimport:rpc"
  - docs/framework.md#api-y-rpc
  - docs/framework.md#límite-de-peticiones-ratelimit
---

`createLocalCalls(options)` devuelve dos funciones, `api` y `rpc`, que atienden un endpoint o un procedimiento de la aplicación sin salir del proceso: construyen un `Request` en memoria con las cabeceras de credenciales de la petición original (`cookie`, `origin`, `x-meeko-csrf` y `authorization`) y lo pasan por `dispatchApiRoute` o `dispatchRpc`. La respuesta es la misma que por HTTP: Origin, CSRF, `rateLimit`, `auth`, `authorize`, schemas, `locals` y la normalización de errores.

En una aplicación del framework no hace falta: los clientes `api.*` y `rpc.*` ya despachan en local durante el SSR. Es para un host propio, una tarea o una prueba que tiene un `RequestContext` y quiere reutilizar un endpoint sin red.

## Uso

<!-- no-check -->
```ts
import { pathToFileURL } from "node:url";
import { createLocalCalls } from "@meekojs/meeko/server";

const calls = createLocalCalls({ manifest, context, sessions, load: (file) => import(pathToFileURL(file).href) });
const user = await (await calls.api("users.byId", "GET", { params: { id: "123" } })).json();
const result = await (await calls.rpc("users.get", { id: "123" })).json();
```

## Parámetros

`createLocalCalls(options)` recibe un objeto `LocalCallOptions<S>`:

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `manifest` | `ServerManifest` | obligatorio | Los endpoints de `server/api` y `server/rpc`. |
| `context` | `RequestContext<S>` | obligatorio | El contexto de la petición original: sus credenciales, su sesión, sus servicios, su señal, su IP y su `requestId`. |
| `sessions` | `SessionManager` | obligatorio | El gestor que comprueba Origin y CSRF. |
| `load` | `(file: string) => Promise<unknown>` | obligatorio | Carga el módulo de cada archivo del manifiesto. |
| `onError` | `(error, requestId) => void` | ninguno | Observador de los fallos `5xx`. |

## Valor devuelto

`{ api, rpc }`:

| Función | Descripción |
| --- | --- |
| `api(clientKey, method, input?)` | Atiende el endpoint con esa clave del cliente (`"users.byId"`, la de `api.users.byId`) y ese método. `input` es `{ params?, query?, body? }`; `body` se serializa en JSON y no se admite en `GET`. |
| `rpc(id, input)` | Atiende el procedimiento `id` (`"users.get"`) con `input` como cuerpo. |

Ambas devuelven `Promise<Response>` y **nunca rechazan**: un endpoint que no existe es `404 NOT_FOUND`, unos `params` que no forman la ruta son `400 INVALID_PARAMS` y un fallo del handler es la respuesta de error de siempre, con el `requestId` de la petición original.

## Ejemplos

### Un handler de módulo que reutiliza un endpoint

<!-- no-check -->
```ts
// Un handler propio que ya tiene el contexto de la petición.
const calls = createLocalCalls({ manifest: app.manifest.server, context, sessions, load });
const response = await calls.api("orders", "POST", { body: { productId: "p_1", quantity: 2 } });
if (response.status === 429) return new Response("Demasiados pedidos", { status: 429, headers: { "retry-after": response.headers.get("retry-after") ?? "60" } });
return Response.json(await response.json(), { status: response.status });
```

### Query string con listas

<!-- no-check -->
```ts
await calls.api("products", "GET", { query: { tag: ["oferta", "nuevo"], page: 2, draft: undefined } });
// GET /api/products?tag=oferta&tag=nuevo&page=2 (null y undefined se omiten)
```

### Una prueba de un endpoint protegido

<!-- no-check -->
```ts
const context = createRequestContext(new Request("http://localhost/", { headers: { cookie, origin: "http://localhost", "x-meeko-csrf": csrf } }), services, await sessions.load(request));
const response = await createLocalCalls({ manifest, context, sessions, load }).api("profile", "PUT", { body: { name: "Ada" } });
assert.equal(response.status, 200);
```

## Errores comunes

### Esperar que rechace

```ts bad
try {
  const user = await (await calls.api("users.byId", "GET", { params: { id } })).json();
} catch {
  // nunca llega aquí con un 404
}
```

`api` y `rpc` resuelven siempre con un `Response`. Un `404 {"code":"NOT_FOUND"}` llega como respuesta, y `.json()` lo devuelve como si fuera el usuario.

<!-- no-check -->
```ts good
const response = await calls.api("users.byId", "GET", { params: { id } });
if (!response.ok) throw new Error(`users.byId ${response.status}`);
const user = await response.json();
```

### Un cuerpo en `GET`

```ts bad
await calls.api("search", "GET", { body: { q: "zapatillas" } });
```

Responde `400 INVALID_BODY`. Use `query`.

<!-- no-check -->
```ts good
await calls.api("search", "GET", { query: { q: "zapatillas" } });
```

### Sin `load`

```ts bad
createLocalCalls({ manifest, context, sessions });
```

`TypeError: Local calls require a module loader`, al crearlo.

<!-- no-check -->
```ts good
createLocalCalls({ manifest, context, sessions, load: (file) => import(pathToFileURL(file).href) });
```

## Notas

- **Mismas guardas.** Una llamada local no es una puerta trasera: pasa por Origin y CSRF con las cabeceras de la petición original, y por `auth`, `authorize` y los schemas.
- **`rateLimit`.** Usa el contador de la ruta del despachador HTTP y la IP de `context`, así que una llamada local no esquiva el límite.
- **Cancelación.** El `Request` interno lleva `context.signal`: si el cliente se va o la sesión se revoca, la llamada se aborta.
- **Cookies.** La respuesta trae su `Set-Cookie` si el endpoint cambia la sesión; un host propio debe reenviarla si quiere que llegue al navegador.
