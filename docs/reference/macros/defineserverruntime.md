---
title: defineServerRuntime
group: macros
since: 1.0.0
description: Declara en server/runtime.ts las sesiones, los servicios, la política de Socket y el cierre de la aplicación, creados una vez por proceso.
symbols:
  - "@meekojs/meeko/server#defineServerRuntime"
types:
  - "@meekojs/meeko/server#ServerRuntime"
related:
  - "@meekojs/meeko/server#SessionManager"
  - "@meekojs/meeko/server#RedisSessionStore"
  - "@meekojs/meeko/server#SqlSessionStore"
  - "@meekojs/meeko/server#RedisSocketPubSub"
  - "@meekojs/meeko/server#createServerApp"
  - docs/framework.md#runtime-de-servidor
  - docs/framework.md#tipos-de-los-servicios
  - docs/framework.md#sesiones-sin-configuración
---

`defineServerRuntime(factory)` es el export por defecto de `server/runtime.ts`: declara los recursos de la aplicación que viven lo que vive el proceso. Meeko llama a la fábrica **una vez por proceso** con `{ env, production, platform, prerendering }` y usa lo que devuelve: las sesiones, los servicios que llegan a cada petición como `context.services`, la política de Socket, el origen público, el observador de errores y el cierre.

Desde `1.7`, el tipo de `services` se infiere de este archivo: `context.services.db` está tipado en páginas, API, RPC, Socket y middleware de servidor sin conversiones.

## Uso

<!-- no-check -->
```ts
// server/runtime.ts
import { defineServerRuntime, SessionManager } from "@meekojs/meeko/server";
import { createDatabase } from "./utils/database";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  const db = await createDatabase(env.DATABASE_URL);
  return {
    sessions: new SessionManager({ store: db.sessionStore(), production: production && !prerendering }),
    services: { db },
    publicOrigin: env.MEEKO_PUBLIC_ORIGIN,
    onError: (error, requestId) => console.error("request failed", requestId, error),
    close: () => db.close(),
  };
});
```

```ts
// server/api/users/[id].get.ts: services tipado, sin `as`
// const user = await context.services.db.users.find(params.id);
```

## Parámetros

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `factory` | `(context) => ServerRuntime \| Promise<ServerRuntime>` | obligatorio | Crea los recursos. Recibe `env` (las variables de entorno), `production`, `platform` (`{ name, env, waitUntil }`) y `prerendering`, `true` cuando `meeko build` prerenderiza sin tráfico de clientes. |

Lo que devuelve la fábrica:

| Campo | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `sessions` | `SessionManager` | en memoria en desarrollo, Redis con `MEEKO_REDIS_URL` en producción | Desde `1.2`, opcional. Las sesiones de la aplicación. Unas explícitas siempre ganan. |
| `services` | objeto, o `(request, { platform }) => objeto` | ninguno | Llegan a cada petición como `RequestContext.services`: un objeto compartido o una función por petición. |
| `socket` | `{ allowedOrigins?, maxMessageBytes?, pubsub?, … }` | ninguno | Política de Socket: orígenes, límites y el broker de broadcast. |
| `publicOrigin` | URL | la dirección del servidor | El origen público tras un proxy, para comprobar `Origin` en HTTP y Socket. `MEEKO_PUBLIC_ORIGIN` lo sustituye. |
| `onError` | `(error, requestId, info?) => void` | registro mínimo | Los fallos internos, con su ID de petición; desde `1.3`, también los del proceso. |
| `processErrors` | política | informar y, ante una excepción, cerrar | Desde `1.3`. Qué hacer con las promesas rechazadas y las excepciones del proceso. |
| `close` | `() => void \| Promise<void>` | ninguno | Se ejecuta al detener el servidor, después de cerrar las sesiones. |

## Valor devuelto

La misma fábrica, para exportarla por defecto. Sin función lanza `TypeError: defineServerRuntime requires a factory function`.

## Ejemplos

### Servicios por petición

Una función crea los servicios de cada petición, con la plataforma (por ejemplo, las variables de un Worker):

<!-- no-check -->
```ts
// server/runtime.ts
import { defineServerRuntime } from "@meekojs/meeko/server";
import { createDatabase } from "./utils/database";

export default defineServerRuntime(async ({ env }) => {
  const db = await createDatabase(env.DATABASE_URL);
  return {
    services: (request, { platform }) => ({ db, region: platform.env.REGION ?? "local", locale: request.headers.get("accept-language") ?? "es" }),
    close: () => db.close(),
  };
});
```

### Sesiones en Redis y Socket entre instancias

<!-- no-check -->
```ts
// server/runtime.ts
import { defineServerRuntime, RedisSessionStore, RedisSocketPubSub, SessionManager } from "@meekojs/meeko/server";
import { createClient } from "redis";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  if (prerendering) return { services: {} };
  const redis = createClient({ url: env.REDIS_URL });
  const subscriber = redis.duplicate();
  await Promise.all([redis.connect(), subscriber.connect()]);
  return {
    sessions: new SessionManager({ store: new RedisSessionStore(redis, { prefix: "app:prod:session:" }), production }),
    socket: { pubsub: new RedisSocketPubSub({ publisher: redis, subscriber, prefix: "app:prod:socket:" }) },
    close: async () => { await Promise.all([redis.quit(), subscriber.quit()]); },
  };
});
```

Con `prerendering`, el build no sirve tráfico: basta un store en memoria, que es el que crea Meeko sin `sessions`.

### Un servicio que usa una página

<!-- no-check -->
```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
const { params, context } = usePage();
const row = await context.services.db.users.find(params.id); // tipado desde server/runtime.ts
if (!row) notFound();
export const user = { id: row.id, name: row.name };
</script>

<template><h1>{user.name}</h1></template>
```

## Errores comunes

### Convertir `context.services` a otro tipo

Desde `1.7`, `context.services` ya tiene el tipo de `server/runtime.ts`. Una conversión a un tipo incompatible es un error.

```ts bad
const cache = context.services as { cache: Map<string, string> };
```

`meeko check` da `TS2352: Conversion of type '{ db: …; region: string; }' to type '{ cache: Map<string, string>; }' may be a mistake because neither type sufficiently overlaps with the other.` Quita la conversión y lee los servicios tal cual.

<!-- no-check -->
```ts good
const user = await context.services.db.users.find(params.id);
```

### Crear recursos por petición dentro de los servicios compartidos

Un objeto de `services` se crea una vez y lo comparten todas las peticiones: guardar ahí datos de un usuario los expone a los demás, sin ningún error.

```ts bad
export default defineServerRuntime(() => ({ services: { currentUser: null as string | null } }));
```

<!-- no-check -->
```ts good
export default defineServerRuntime(() => ({
  services: (request) => ({ locale: request.headers.get("accept-language") ?? "es" }),
}));
```

Los datos del usuario se leen de `context.session` en cada petición.

### Exportar un objeto en lugar de la fábrica

```ts bad
export default defineServerRuntime({ services: {} });
```

`defineServerRuntime` lanza al cargar el módulo `TypeError: defineServerRuntime requires a factory function`.

<!-- no-check -->
```ts good
export default defineServerRuntime(() => ({ services: {} }));
```

## Notas

- **Una vez por proceso.** La fábrica se ejecuta al arrancar (y en `meeko build` con `prerendering: true`); en Workers, una vez por aislamiento. Conecta aquí las bases de datos y los clientes, no en cada petición.
- **Tipos de los servicios (`1.7`).** `meeko check`, `meeko dev` y el editor generan `.meeko/types/services.d.ts` a partir de este archivo; `RequestContext` sin argumento usa ese tipo (`AppServices`). Con el runtime en JavaScript o sin `services`, es `unknown`. Un tipo escrito (`RequestContext<MisServicios>`) sigue ganando.
- **Secretos.** Este archivo nunca llega al navegador: lee aquí las variables de entorno. `meeko dev`, `build`, `start`, `preview` y `check` cargan el `.env` del proyecto.
- **Cierre.** `close` se ejecuta tras cerrar las sesiones, al detener el servidor; `serveNode` espera también las tareas de `platform.waitUntil`.
- **Errores del proceso.** Sin `processErrors`, un rechazo sin manejar se informa y el servidor sigue; una excepción no capturada se informa y el servidor se cierra de forma ordenada con código 1.
