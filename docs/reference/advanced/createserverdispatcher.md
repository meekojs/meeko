---
title: createServerDispatcher
group: advanced
since: 1.0.0
description: Crea un handler HTTP que atiende /api/... y /_meeko/rpc/... de un host propio, con las mismas sesiones, guardas, validaciones y errores que la aplicación.
symbols:
  - "@meekojs/meeko/server#createServerDispatcher"
types:
  - "@meekojs/meeko/server#ServerDispatcherOptions"
  - "@meekojs/meeko/server#ServerManifest"
related:
  - "@meekojs/meeko/server#createServerApp"
  - "@meekojs/meeko/server#createLocalServerFetch"
  - "@meekojs/meeko/server#createFrameworkHandler"
  - "@meekojs/meeko/server#SessionManager"
  - "@meekojs/meeko/server#defineApiRoute"
  - "@meekojs/meeko/server#defineRpc"
  - docs/framework.md#api-y-rpc
---

`createServerDispatcher` despacha los endpoints de `server/api` y los procedimientos de `server/rpc` a partir de su manifiesto: busca el endpoint por ruta y método, carga la sesión, crea el `RequestContext` y ejecuta la definición de `defineApiRoute` o `defineRpc` con todas sus guardas (Origin, CSRF, `rateLimit`, `auth`, `authorize`), su validación de entrada y de respuesta y la normalización de errores a JSON. Devuelve un handler `(request) => Promise<Response>` que nunca rechaza.

Es la parte de API y RPC de [`createServerApp`](/docs/reference/createserverapp), para un host que sirve sus páginas de otra forma o que monta la API dentro de otro servidor.

## Uso

```ts
import { createServerDispatcher, defineApiRoute, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
import type { Schema, ServerManifest } from "@meekojs/meeko/server";

const users: Schema<{ id: string }[]> = { "~standard": { version: 1, validate: (value) => ({ value: value as { id: string }[] }) } };
const modules: Record<string, unknown> = {
  "/server/api/users.get.ts": { default: defineApiRoute({ response: users, handler: () => [{ id: "1" }] }) },
};
const manifest: ServerManifest = {
  api: [{ kind: "api", file: "/server/api/users.get.ts", pathname: "/api/users", method: "GET", clientKey: "users" }],
  rpc: [],
  socket: [],
};

const dispatch = createServerDispatcher({
  manifest,
  sessions: new SessionManager({ store: new MemorySessionStore() }),
  services: {},
  load: async (file) => modules[file],
});
const response = await dispatch(new Request("http://localhost/api/users"));
console.log(response.status, await response.json()); // 200 [ { id: '1' } ]
```

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `manifest` | `ServerManifest` | obligatorio | Los endpoints (`api`), procedimientos (`rpc`) y canales (`socket`), como los escribe `discoverServerManifest`. |
| `sessions` | `SessionManager` | obligatorio | El gestor de sesiones: carga la sesión de cada petición y comprueba Origin y CSRF. |
| `services` | `S` o `(request) => S` | obligatorio | Los servicios de `context.services`, compartidos o creados por petición. |
| `load` | `(file) => Promise<unknown>` | obligatorio | Devuelve el módulo de cada archivo del manifiesto; su `default` es la definición. Sin él, `TypeError: Server dispatch requires a module loader`. |
| `platform` | `ServerPlatform` | `{ name: "node", env: {} }` | Lo que ven los handlers en `context.platform`. |
| `onError` | `(error, requestId) => void` | consola | Fallos internos; el cliente sólo recibe `{ code, status, requestId }`. |

## Valor devuelto

`(request: Request) => Promise<Response>`, que nunca rechaza:

| Petición | Respuesta |
| --- | --- |
| Un endpoint y método que existen | La respuesta del handler, validada contra `response`. |
| Un endpoint con otro método | `405` `{"code":"METHOD_NOT_ALLOWED",…}` con `Allow` y los métodos de esa ruta. |
| Un procedimiento RPC con un método distinto de `POST` | `405` `{"code":"METHOD_NOT_ALLOWED",…}` con `Allow: POST` (desde `1.7`; antes, sin `Allow`). |
| Cualquier otra ruta | `404` `{"code":"NOT_FOUND","status":404,"requestId":"…"}`. |
| Un `ApiError` del handler | Su estado y su código, con `issues` si los tiene. |
| Cualquier otro error | `500` `INTERNAL_ERROR`, y el error a `onError`. |

## Ejemplos

### Dentro de un servidor de Node existente

<!-- no-check -->
```ts
import { createServer } from "node:http";
import { toNodeListener } from "@meekojs/meeko/node";

const api = toNodeListener(dispatch);
createServer((request, response) => {
  if (request.url?.startsWith("/api/") || request.url?.startsWith("/_meeko/rpc/")) return api(request, response);
  legacyApp(request, response);
}).listen(3000);
```

### Un procedimiento RPC con servicios por petición

```ts
import { createServerDispatcher, defineRpc, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
import type { Schema } from "@meekojs/meeko/server";

const sumInput: Schema<{ a: number; b: number }> = { "~standard": { version: 1, validate: (value) => ({ value: value as { a: number; b: number } }) } };
const sumOutput: Schema<{ total: number }> = { "~standard": { version: 1, validate: (value) => ({ value: value as { total: number } }) } };
const sum = defineRpc({ input: sumInput, output: sumOutput, handler: ({ input }) => ({ total: input.a + input.b }) });

const dispatch = createServerDispatcher({
  manifest: { api: [], rpc: [{ kind: "rpc", file: "/server/rpc/math/sum.ts", pathname: "/_meeko/rpc/math/sum", id: "math.sum" }], socket: [] },
  sessions: new SessionManager({ store: new MemorySessionStore() }),
  services: (request: Request) => ({ region: request.headers.get("x-region") ?? "eu" }),
  load: async () => ({ default: sum }),
});

const response = await dispatch(new Request("http://localhost/_meeko/rpc/math/sum", {
  method: "POST",
  headers: { "content-type": "application/json", origin: "http://localhost" },
  body: JSON.stringify({ a: 1, b: 2 }),
}));
console.log(await response.json()); // { total: 3 }
```

## Errores comunes

### Sin `load`

```ts bad
createServerDispatcher({ manifest, sessions, services: {} });
```

`TypeError: Server dispatch requires a module loader`. El despachador nunca importa archivos por su cuenta: así no puede cargar algo que el manifiesto no declara.

<!-- no-check -->
```ts good
createServerDispatcher({ manifest, sessions, services: {}, load: (file) => import(pathToFileURL(file).href) });
```

### Llamar a un RPC con `GET`

```ts bad
await dispatch(new Request("http://localhost/_meeko/rpc/math/sum"));
```

`405` `{"code":"METHOD_NOT_ALLOWED","status":405,…}` con `Allow: POST`: un procedimiento RPC sólo acepta `POST` con JSON. Hasta `1.6`, la respuesta no llevaba `Allow`, aunque el JSDoc lo prometía.

<!-- no-check -->
```ts good
await dispatch(new Request("http://localhost/_meeko/rpc/math/sum", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }));
```

### `MemorySessionStore` en producción

```ts bad
new SessionManager({ store: new MemorySessionStore(), production: true });
```

`Persistent session storage with atomic rotation and family revocation is required in production`. En producción, las sesiones deben sobrevivir a un reinicio y compartirse entre instancias.

<!-- no-check -->
```ts good
new SessionManager({ store: new RedisSessionStore(redis, { prefix: "tienda:prod:session:" }), production: true });
```

## Notas

- **Servidor.** Sólo usa Web APIs; funciona en cualquier runtime. Las respuestas de error son JSON y nunca llevan la traza.
- **Seguridad.** Las mutaciones con sesión exigen Origin y el token CSRF (`x-meeko-csrf`), como en la aplicación. Las guardas se ejecutan en el orden documentado: Origin, CSRF, `rateLimit`, `auth`, `authorize`, entrada, `locals`, handler y respuesta.
- **Rutas.** Sólo responde a lo que declara el manifiesto; todo lo demás es `404` en JSON, así que conviene enrutar antes hacia él sólo `/api/` y `/_meeko/rpc/`.
- **Llamadas locales.** Para que el SSR llame a la API sin red, usa `createLocalServerFetch` con las mismas opciones.
