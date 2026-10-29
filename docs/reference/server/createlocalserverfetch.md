---
title: createLocalServerFetch
group: server
since: 1.0.0
description: El despacho local que usan los clientes api y rpc durante el SSR, que atiende la llamada por el pipeline HTTP sin salir del proceso y sólo con el origen y las credenciales de la petición en curso.
symbols:
  - "@meekojs/meeko/server#createLocalServerFetch"
types:
  - "@meekojs/meeko/server#ServerFetch"
related:
  - "@meekojs/meeko/server#createLocalCalls"
  - "@meekojs/meeko/server#createServerDispatcher"
  - "@meekojs/meeko/server#createServerClientOptions"
  - "autoimport:api"
  - docs/framework.md#api-y-rpc
---

`createLocalServerFetch(options)` crea una `ServerFetch`: una función `(request, context) => Promise<Response>` que atiende una petición a `/api` o `/_meeko/rpc` con el pipeline de la aplicación, dentro del proceso, reutilizando la sesión, los servicios, el estado y el `requestId` de la petición en curso. Es lo que hay debajo de `api.*` y `rpc.*` mientras el servidor renderiza una página: la página llama a su propia API sin red y sin una segunda sesión.

Como reutiliza la sesión de `context`, sólo acepta peticiones de su mismo origen y con sus mismas credenciales: cualquier otra responde `403`. Así nadie puede usarla para hablar con la API en nombre de otro usuario.

## Uso

<!-- no-check -->
```ts
import { pathToFileURL } from "node:url";
import { createLocalServerFetch } from "@meekojs/meeko/server";

const serverFetch = createLocalServerFetch({ manifest, sessions, load: (file) => import(pathToFileURL(file).href) });
// Mismo origen y mismas credenciales que la petición original.
const request = new Request(new URL("/api/users", context.request.url), { headers: context.request.headers });
const response = await serverFetch(request, context);
```

## Parámetros

`createLocalServerFetch(options)`:

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `manifest` | `ServerManifest` | obligatorio | Los endpoints de API y RPC. |
| `sessions` | `SessionManager` | obligatorio | El gestor de la aplicación. |
| `load` | `(file: string) => Promise<unknown>` | obligatorio | Carga el módulo de cada archivo del manifiesto. |
| `onError` | `(error, requestId) => void` | ninguno | Observador de los fallos `5xx`. |

## Valor devuelto

Una `ServerFetch`: `(request: Request, context: RequestContext) => Promise<Response>`.

| Petición | Respuesta |
| --- | --- |
| Otro origen que el de `context.request` | `403 INVALID_ORIGIN` |
| `cookie` o `authorization` distintas de las de `context.request` | `403 INVALID_CREDENTIALS` |
| Una ruta de API o RPC | La respuesta del endpoint, con las guardas de siempre y la `Idempotency-Key` de esta petición. |

## Ejemplos

### Medir las llamadas internas de un render

```ts
import type { ServerFetch } from "@meekojs/meeko/server";

export const logged = (inner: ServerFetch): ServerFetch => async (request, context) => {
  const start = performance.now();
  const response = await inner(request, context);
  console.log(context.requestId, request.method, new URL(request.url).pathname, response.status, `${Math.round(performance.now() - start)} ms`);
  return response;
};
```

### Un cliente tipado de servidor a nivel de módulo

<!-- no-check -->
```ts
import { createApiClient } from "@meekojs/meeko/framework";
import { createServerClientOptions } from "@meekojs/meeko/server";

// Cada llamada lee la URL, las credenciales y el despacho local de la petición en curso:
// el cliente nunca retiene las credenciales de otro usuario.
export const api = createApiClient<ApiContract>(manifest, createServerClientOptions());
```

Así son los clientes `api` y `rpc` generados para el SSR. Fuera de una petición de Meeko, cada llamada lanza un error.

## Errores comunes

### Reenviar otra cookie

```ts bad
const request = new Request(new URL("/api/admin/users", context.request.url), { headers: { cookie: adminCookie } });
await serverFetch(request, context);
```

Responde `403 {"code":"INVALID_CREDENTIALS"}`: el despacho local comparte la sesión de `context` y no puede cambiarla. Para actuar como otro usuario, haga una petición HTTP real.

<!-- no-check -->
```ts good
const request = new Request(new URL("/api/admin/users", context.request.url), { headers: context.request.headers });
await serverFetch(request, context);
```

### Llamar a otro host

```ts bad
await serverFetch(new Request("https://api.otro.example/users", { headers: context.request.headers }), context);
```

Responde `403 {"code":"INVALID_ORIGIN"}`. Para un servicio externo, use `fetch` con `context.signal`.

<!-- no-check -->
```ts good
await fetch("https://api.otro.example/users", { signal: context.signal });
```

## Notas

- **Seguridad.** La comparación de origen y credenciales evita que el despacho local se use como proxy con la sesión de otro.
- **`requestId`.** La llamada comparte el de la petición original: los logs y `onError` agrupan el render y sus llamadas.
- **Origin.** Los clientes `api.*` y `rpc.*` del SSR envían el origen de la petición en curso, así que `origin: "required"` funciona también en local.
