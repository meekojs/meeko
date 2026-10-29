---
title: composeServerMiddleware
group: server
since: 1.0.0
description: Compone una lista de middleware de servidor alrededor de un handler Fetch, de fuera hacia dentro, como hace Meeko con los archivos de server/middleware.
symbols:
  - "@meekojs/meeko/server#composeServerMiddleware"
types:
  - "@meekojs/meeko/server#ServerMiddleware"
related:
  - "@meekojs/meeko/server#defineServerMiddleware"
  - "@meekojs/meeko/server#clientAddress"
  - "@meekojs/meeko/server#createServerApp"
  - docs/framework.md#middleware-de-servidor
  - docs/framework.md#middleware-de-rutas-y-servidor
---

`composeServerMiddleware(middlewares, handler)` encadena funciones `(request, next) => Response` alrededor de un handler final y devuelve un handler `(request) => Promise<Response>`. Es lo que hace `createServerApp` con los archivos de `server/middleware/` (por nombre de archivo) y con los que añaden los módulos: cada middleware puede continuar con `next()`, cambiar la petición o la respuesta, o cortocircuitar devolviendo su propio `Response`.

La composición es estricta: `next()` sólo se puede llamar una vez, cada middleware debe devolver un `Response` y, si un middleware olvida esperar `next()`, el tramo siguiente se espera igual y sus errores no se pierden.

## Uso

```ts
import { composeServerMiddleware } from "@meekojs/meeko/server";
import type { ServerMiddleware } from "@meekojs/meeko/server";

const timing: ServerMiddleware = async (request, next) => {
  const start = performance.now();
  const response = await next();
  console.log(request.method, new URL(request.url).pathname, response.status, `${Math.round(performance.now() - start)} ms`);
  return response;
};

const handle = composeServerMiddleware([timing], async () => new Response("hola"));
const response = await handle(new Request("http://localhost/"));
```

## Parámetros

| Parámetro | Tipo | Descripción |
| --- | --- | --- |
| `middlewares` | `readonly ServerMiddleware[]` | En orden de ejecución: el primero es el más externo. |
| `handler` | `(request: Request) => Promise<Response>` | El handler final, como `app.fetch`. |

Un `ServerMiddleware` es `(request, next) => Response | Promise<Response>`; `next(request?)` continúa con la misma petición o con otra.

## Valor devuelto

Un handler `(request: Request) => Promise<Response>`. Rechaza si un middleware o el handler lanzan; si fallan los dos, con un `AggregateError` (`Server middleware and downstream failed`) que conserva ambos errores.

## Ejemplos

### En `server/middleware/`, sin componer a mano

```ts
// server/middleware/20-maintenance.ts
import { defineServerMiddleware } from "@meekojs/meeko/server";

export default defineServerMiddleware(async (request, next) => {
  if (process.env.MAINTENANCE === "1" && !new URL(request.url).pathname.startsWith("/_meeko/")) {
    return new Response("En mantenimiento", { status: 503, headers: { "retry-after": "120" } });
  }
  return next();
});
```

Meeko ordena los archivos por nombre (`10-…`, `20-…`) y los compone con esta misma función, alrededor de páginas, `/api` y `/_meeko/rpc`.

### Un registro de acceso con la IP real (desde 1.7)

```ts
// server/middleware/10-access-log.ts
import { clientAddress, defineServerMiddleware } from "@meekojs/meeko/server";

export default defineServerMiddleware(async (request, next) => {
  const ip = clientAddress(request) ?? "desconocida"; // aplica MEEKO_TRUST_PROXY
  const response = await next();
  console.log(`${request.method} ${new URL(request.url).pathname} ${response.status} ${ip}`);
  return response;
});
```

### Cambiar la petición que sigue

```ts
import type { ServerMiddleware } from "@meekojs/meeko/server";

export const tagRequests: ServerMiddleware = (request, next) => {
  const headers = new Headers(request.headers);
  headers.set("x-request-start", String(Date.now()));
  return next(new Request(request, { headers })); // conserva la IP de la conexión
};
```

### Un host propio que envuelve la aplicación

<!-- no-check -->
```ts
import { createServer } from "node:http";
import { composeServerMiddleware } from "@meekojs/meeko/server";
import { toNodeListener } from "@meekojs/meeko/node";

const guarded = composeServerMiddleware([timing, tagRequests], (request) => app.fetch(request));
createServer(toNodeListener(guarded, { publicOrigin: "https://example.com" })).listen(3000);
```

## Errores comunes

### Llamar a `next()` dos veces

```ts bad
const retry: ServerMiddleware = async (request, next) => {
  const response = await next();
  return response.status >= 500 ? next() : response;
};
```

La segunda llamada lanza `Error: Server middleware called next() more than once` y la petición responde `500`. El cuerpo de la petición ya se consumió: un reintento necesita un `Request` nuevo y otra composición.

<!-- no-check -->
```ts good
const retry: ServerMiddleware = async (request, next) => next(request);
```

### No devolver la respuesta

```ts bad
const log: ServerMiddleware = async (request, next) => {
  const response = await next();
  console.log(response.status);
};
```

`TypeError: Server middleware must return a Response` en ejecución; `meeko check` ya lo marca como error de tipos.

<!-- no-check -->
```ts good
const log: ServerMiddleware = async (request, next) => {
  const response = await next();
  console.log(response.status);
  return response;
};
```

### Leer `X-Forwarded-For` a mano

```ts bad
const ip = request.headers.get("x-forwarded-for")?.split(",")[0];
```

Cualquier cliente puede enviar esa cabecera: la IP es falsificable. `clientAddress(request)` sólo la lee con `MEEKO_TRUST_PROXY` y toma la entrada del proxy de confianza.

```ts good
import { clientAddress } from "@meekojs/meeko/server";
export const ipOf = (request: Request) => clientAddress(request);
```

## Notas

- **Antes del contexto.** El middleware de servidor se ejecuta antes de crear la sesión y el `RequestContext`; las guardas de API y RPC (Origin, CSRF, `auth`) siguen dentro del handler.
- **Qué envuelve.** Páginas (también las prerenderizadas), `/api` y `/_meeko/rpc`. Los archivos públicos del build se sirven antes, y los upgrades de Socket tienen su propio handler.
- **Respuestas inmutables.** Un `Response` de `fetch` o de `Response.redirect` tiene cabeceras inmutables: cree uno nuevo con `new Response(response.body, response)` antes de cambiarlas.
- **IP.** Un `next(new Request(request, …))` conserva la IP de la conexión, así que `rateLimit` y `clientAddress` siguen contando por cliente.
