---
title: createRequestContext
group: advanced
since: 1.0.0
description: Crea el RequestContext de una petición (sesión, servicios, plataforma, requestId y signal) para un host propio o para probar un endpoint sin servidor.
symbols:
  - "@meekojs/meeko/server#createRequestContext"
types:
  - "@meekojs/meeko/server#RequestContext"
related:
  - "@meekojs/meeko/server#createServerDispatcher"
  - "@meekojs/meeko/server#dispatchApiRoute"
  - "@meekojs/meeko/server#SessionManager"
  - "@meekojs/meeko/server#useRequestState"
  - docs/framework.md#revocación-durante-una-petición
  - docs/framework.md#tipos-de-los-servicios
---

`createRequestContext` construye el contexto que reciben los handlers de API y RPC, los loaders y el `<script server>` como `context`: la petición, un `requestId` nuevo, la sesión ya cargada, los servicios, la plataforma, un `Map` de estado propio de la petición y un `signal` que se aborta cuando el cliente se desconecta o se revoca la sesión.

`createServerApp` y `createServerDispatcher` lo crean solos. Se usa en un host propio que despacha endpoints uno a uno (`dispatchApiRoute`, `dispatchRpc`) y, sobre todo, para probar un endpoint en una prueba unitaria.

## Uso

```ts
import { createRequestContext, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

const sessions = new SessionManager({ store: new MemorySessionStore() });
const request = new Request("http://localhost/api/report");
const context = createRequestContext(request, { db: { name: "test" } }, await sessions.load(request));

console.log(context.requestId);        // un UUID nuevo
console.log(context.platform.name);    // "node"
console.log(context.services.db.name); // "test"
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `request` | `Request` | obligatorio | La petición. Su `signal` se combina con el del contexto. |
| `services` | `TServices` | obligatorio | Los servicios de `context.services`, ya creados. |
| `session` | `SessionHandle` | obligatorio | El resultado de `sessions.load(request)`. |
| `platform` | `ServerPlatform<TEnv>` | `{ name: "node", env: {} }` | Nombre, entorno y `waitUntil` del adaptador. Sin él, el entorno está vacío. |

## Valor devuelto

Un `RequestContext<TServices, TEnv>`:

| Miembro | Descripción |
| --- | --- |
| `request` | La petición original. |
| `requestId` | Un ID nuevo, el que va en `x-request-id` y llega a `onError`. |
| `signal` | Se aborta si el cliente se desconecta o, con `SessionRevokedError`, si se revoca la familia de la sesión. Se combina en el primer acceso. |
| `services` | Los servicios recibidos. Desde `1.7`, sin argumento de tipo es `AppServices`, el tipo que `meeko check` infiere de `server/runtime.ts`. |
| `session` | La sesión: `current`, `create`, `rotate`, `revoke`… |
| `state` | Un `Map` vacío para valores de esta petición (`useRequestState`). |
| `platform` | La plataforma recibida. |
| `idempotencyKey` | La cabecera `Idempotency-Key` si es un UUID, en minúsculas; si no, `undefined`. |
| `clientAddress` | La IP del cliente. `undefined` con un contexto creado a mano: la entregan los adaptadores. |

## Ejemplos

### Probar un endpoint sin servidor

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequestContext, defineApiRoute, dispatchApiRoute, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
import type { Schema } from "@meekojs/meeko/server";

const report: Schema<{ region: string }> = { "~standard": { version: 1, validate: (value) => ({ value: value as { region: string } }) } };
interface Services { readonly region: string }

// En una aplicación, .meeko/types/services.d.ts da el tipo de context.services; aquí se indica a mano.
const route = defineApiRoute<undefined, undefined, undefined, typeof report, Services>({
  response: report,
  handler: ({ context }) => ({ region: context.services.region }),
});

test("el informe usa la región de los servicios", async () => {
  const sessions = new SessionManager({ store: new MemorySessionStore() });
  const request = new Request("http://localhost/api/report");
  const context = createRequestContext(request, { region: "eu" }, await sessions.load(request));
  const response = await dispatchApiRoute(route, context, sessions);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { region: "eu" });
});
```

`dispatchApiRoute` aplica las guardas y la validación de `response` y normaliza los errores, como en la aplicación.

### Con la plataforma y el entorno del host

```ts
import { createRequestContext, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

const sessions = new SessionManager({ store: new MemorySessionStore() });
const request = new Request("http://localhost/");
const context = createRequestContext(request, {}, await sessions.load(request), {
  name: "node",
  env: { FEATURE_FLAGS: "beta" },
  waitUntil: (promise) => { void Promise.resolve(promise).catch(console.error); },
});
console.log(context.platform.env.FEATURE_FLAGS); // "beta"
```

### Cancelar trabajo cuando el cliente se va

<!-- no-check -->
```ts
export default defineApiRoute({
  response: Report,
  handler: async ({ context }) => {
    const upstream = await fetch("https://api.example.com/report", { signal: context.signal });
    return await upstream.json();
  },
});
```

Si el cliente cierra la conexión, o otra petición revoca su sesión, `context.signal` se aborta y el `fetch` se cancela.

## Errores comunes

### Pasar el `SessionManager` en lugar de la sesión

```ts bad
const context = createRequestContext(request, services, sessions);
```

`TS2345`: el tercer argumento es el `SessionHandle` de esta petición, no el gestor. En ejecución, `context.session.current` sería `undefined` y las guardas de sesión fallarían.

<!-- no-check -->
```ts good
const context = createRequestContext(request, services, await sessions.load(request));
```

### Reutilizar un contexto entre peticiones

```ts bad
const shared = createRequestContext(firstRequest, services, session);
await dispatchApiRoute(route, shared, sessions);
await dispatchApiRoute(otherRoute, shared, sessions); // otra petición
```

El contexto es de una petición: `context.request` (con su cuerpo), el `requestId`, el `signal`, la sesión y el `state` son los de la primera. El segundo endpoint no ve su propia petición, y los dos comparten el `requestId` en los logs.

<!-- no-check -->
```ts good
for (const request of requests) {
  const context = createRequestContext(request, services, await sessions.load(request));
  await dispatchApiRoute(route, context, sessions);
}
```

## Notas

- **Servidor.** Es una función síncrona y portable; la sesión se carga antes, con `await sessions.load(request)`.
- **Tipos.** `createRequestContext<TServices, TEnv>` infiere los dos tipos de sus argumentos. Desde `1.7`, un `RequestContext` escrito sin argumentos tiene `services: AppServices`; con `.meeko/types/services.d.ts` generado, es el tipo de `server/runtime.ts`. El contexto de un test con servicios falsos (`{ db: falso }`) se sigue aceptando en el handler de una ruta sin tipo de servicios, como en `1.6`: `RequestContext` compara por su tipo de servicios.
- **IP.** Un contexto creado a mano no tiene `clientAddress`, así que `rateLimit` sin `key` cuenta a todos los clientes juntos. Fuera de un contexto, `clientAddress(request)` (desde `1.7`) da la IP con la misma política.
- **Seguridad.** `signal` se aborta con `SessionRevokedError` cuando la sesión se revoca a mitad de la petición: úsalo en las operaciones largas para no terminar trabajo de una sesión que ya no es válida.
