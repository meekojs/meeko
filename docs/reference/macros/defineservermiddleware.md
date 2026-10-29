---
title: defineServerMiddleware
group: macros
since: 1.0.0
description: Declara un middleware HTTP de server/middleware, que envuelve las páginas, la API y el RPC antes de crear la sesión y puede cortar o modificar la respuesta.
symbols:
  - "@meekojs/meeko/server#defineServerMiddleware"
types:
  - "@meekojs/meeko/server#ServerMiddleware"
related:
  - "@meekojs/meeko/framework#defineServerRouteMiddleware"
  - "@meekojs/meeko/framework#defineRouteMiddleware"
  - "@meekojs/meeko/server#composeServerMiddleware"
  - "@meekojs/meeko/server#contentSecurityPolicy"
  - docs/framework.md#middleware-de-servidor
  - docs/framework.md#ip-del-cliente-tras-un-proxy
---

`defineServerMiddleware` declara el middleware que exporta por defecto un archivo de `server/middleware/`. Recibe la `Request` y `next(request?)`, y devuelve un `Response`: puede continuar, modificar la respuesta del resto de la cadena o cortocircuitar con la suya.

Envuelve las páginas SSR, `/api` y `/_meeko/rpc`, también las páginas prerenderizadas, y se ejecuta **antes** de crear el contexto de sesión: no tiene `RequestContext`. Meeko ejecuta los archivos por nombre, de fuera hacia dentro. Se autoimporta en `server/`.

## Uso

```ts
// server/middleware/10-security-headers.ts
import { defineServerMiddleware } from "@meekojs/meeko/server";

export default defineServerMiddleware(async (request, next) => {
  const response = await next();
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `middleware` | `(request: Request, next: (request?: Request) => Promise<Response>) => Response \| Promise<Response>` | obligatorio | La función. `next()` continúa con el siguiente middleware y el handler; `next(otraRequest)` continúa con otra petición. Sólo se puede llamar una vez. |

## Valor devuelto

El mismo middleware, para exportarlo por defecto. En ejecución, la cadena exige:

- devolver un `Response`: si no, `TypeError: Server middleware must return a Response`;
- llamar a `next()` una vez como mucho: si no, `Error: Server middleware called next() more than once`;
- pasar a `next()` una `Request`: si no, `TypeError: Server middleware next() requires a Request`.

Si el middleware llama a `next()` y no espera la promesa, Meeko la espera igual; si fallan el middleware y el tramo siguiente, los dos errores llegan en un `AggregateError`.

## Ejemplos

### Cortar con una respuesta propia

```ts
// server/middleware/00-maintenance.ts
import { defineServerMiddleware } from "@meekojs/meeko/server";

const maintenanceUntil = Date.parse("2026-11-01T06:00:00Z");

export default defineServerMiddleware((request, next) => {
  if (Date.now() < maintenanceUntil && !new URL(request.url).pathname.startsWith("/api/health")) {
    return new Response("En mantenimiento", { status: 503, headers: { "retry-after": "600" } });
  }
  return next();
});
```

### La IP del cliente, con `clientAddress`

Desde `1.7`, `clientAddress(request)` da la IP con la misma política que `context.clientAddress` y `rateLimit`: la de la conexión o, con `MEEKO_TRUST_PROXY`, la que añadió el proxy de confianza.

```ts
// server/middleware/20-blocklist.ts
import { clientAddress, defineServerMiddleware } from "@meekojs/meeko/server";

const blocked = new Set(["203.0.113.7"]);

export default defineServerMiddleware((request, next) => {
  const ip = clientAddress(request);
  if (ip && blocked.has(ip)) return new Response(null, { status: 403 });
  return next();
});
```

### Medir el tiempo de cada respuesta

```ts
// server/middleware/30-timing.ts
import { defineServerMiddleware } from "@meekojs/meeko/server";

export default defineServerMiddleware(async (request, next) => {
  const start = performance.now();
  const response = await next();
  const headers = new Headers(response.headers);
  headers.append("server-timing", `app;dur=${(performance.now() - start).toFixed(1)}`);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
});
```

## Errores comunes

### No devolver la respuesta

```ts bad
export default defineServerMiddleware(async (request, next) => {
  await next();
});
```

`meeko check` da `TS2345` con `Type 'Promise<void>' is not assignable to type 'Promise<Response> | Response'.` En ejecución, `TypeError: Server middleware must return a Response`.

<!-- no-check -->
```ts good
export default defineServerMiddleware(async (request, next) => {
  const response = await next();
  return response;
});
```

### Llamar a `next()` dos veces

```ts bad
export default defineServerMiddleware(async (request, next) => {
  const first = await next();
  return first.ok ? first : next();
});
```

En ejecución, `Error: Server middleware called next() more than once`. Para reintentar, hazlo en el handler, o construye la respuesta tú.

<!-- no-check -->
```ts good
export default defineServerMiddleware(async (request, next) => {
  const response = await next();
  return response.ok ? response : new Response("Servicio no disponible", { status: 503 });
});
```

### Leer `X-Forwarded-For` a mano

Cualquier cliente puede enviar esa cabecera: confiar en ella permite falsificar la IP, sin ningún error.

```ts bad
const ip = request.headers.get("x-forwarded-for")?.split(",")[0];
```

<!-- no-check -->
```ts good
const ip = clientAddress(request); // aplica MEEKO_TRUST_PROXY
```

## Notas

- **Orden.** Los archivos de `server/middleware` se ejecutan por nombre (usa prefijos numéricos: `10-…`, `20-…`). Los que añaden los módulos con `meeko.addServerMiddleware` van antes que los del proyecto.
- **Qué envuelve.** Las páginas SSR, `/api` y `/_meeko/rpc`. Los archivos públicos del build se sirven antes del middleware; el servidor de Vite en desarrollo y los upgrades WebSocket tienen sus propios handlers.
- **Sin sesión.** Se ejecuta antes de crear el contexto de la petición: no hay `context`, `session` ni `services`. Para comprobar la sesión de una página, usa `defineServerRouteMiddleware`; para la API, `auth` y `authorize`.
- **Seguridad.** Las comprobaciones integradas de API y RPC (autenticación, autorización, contratos y CSRF) siguen dentro del handler: el middleware no las sustituye ni las salta. Para CSP y cabeceras de seguridad, desde `1.7` existen `server.contentSecurityPolicy` y `server.headers` en todos los adaptadores.
- **Desarrollo.** Editar un middleware recarga el navegador; añadir o quitar uno hace que `meeko dev` recree la aplicación sin reiniciar. Sólo cuenta `server/middleware` del proyecto, no el de los layers. Se excluyen `*.test.ts`, `*.spec.ts`, `*.d.ts` y `*.client.ts`.
