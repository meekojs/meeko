---
title: MemorySessionStore
group: server
since: 1.0.0
description: Store de sesiones en la memoria del proceso, sólo para desarrollo, pruebas y el prerender: no es persistente y SessionManager lo rechaza en producción.
symbols:
  - "@meekojs/meeko/server#MemorySessionStore"
types:
  - "@meekojs/meeko/server#SessionStore"
related:
  - "@meekojs/meeko/server#SessionManager"
  - "@meekojs/meeko/server#RedisSessionStore"
  - "@meekojs/meeko/server#SqlSessionStore"
  - docs/framework.md#sesiones-sin-configuración
  - docs/framework.md#sesiones-y-seguridad
---

`MemorySessionStore` guarda las sesiones en un `Map` del proceso. Implementa todo el contrato de `SessionStore` (`replace` y `revokeFamily` atómicos, `subscribeRevocations` entre los gestores del mismo proceso y `rateLimit` en memoria), pero declara `persistent: false` y `developmentOnly: true`: un reinicio pierde todas las sesiones y dos instancias no las comparten. `SessionManager({ production: true })` lo rechaza.

Es el store que Meeko usa sin configuración en `meeko dev` y en el prerender de `meeko build`.

## Uso

```ts
// server/runtime.ts
import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(({ production, prerendering }) => ({
  sessions: new SessionManager({ store: new MemorySessionStore(), production: production && !prerendering }),
}));
```

Este runtime arranca en `meeko dev` y en el prerender, y falla a propósito en `meeko start`: es el esqueleto que se completa con un store persistente para producción (véase el primer ejemplo).

## Parámetros

`new MemorySessionStore<T>()` no recibe argumentos. `T` es el tipo de los datos de la sesión.

## Valor devuelto

Un `SessionStore<T>` con:

| Miembro | Valor |
| --- | --- |
| `persistent` | `false` |
| `developmentOnly` | `true` |
| `get`, `set`, `delete` | Lectura y escritura en memoria. `get` borra y omite una sesión caducada o que ya no es la activa de su familia. |
| `replace`, `revokeFamily` | Atómicos dentro del proceso. `revokeFamily` avisa a los `SessionManager` del mismo proceso suscritos con `subscribeRevocations`. |
| `rateLimit(key, windowMs)` | Ventana fija en memoria; las ventanas caducadas se liberan solas. |
| `close()` | Vacía sesiones, familias y contadores. |

## Ejemplos

### Memoria en desarrollo, Redis en producción

<!-- no-check -->
```ts
// server/runtime.ts
import { createClient } from "redis";
import { defineServerRuntime, MemorySessionStore, RedisSessionStore, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  if (!production || prerendering) return { sessions: new SessionManager({ store: new MemorySessionStore(), secure: false }) };
  const redis = createClient({ url: env.MEEKO_REDIS_URL });
  await redis.connect();
  return {
    sessions: new SessionManager({ store: new RedisSessionStore(redis, { prefix: "app:prod:session:" }), production: true }),
    close: async () => { await redis.quit(); },
  };
});
```

Si sólo necesita esto, no escriba `server/runtime.ts`: Meeko hace lo mismo con `MEEKO_REDIS_URL`.

### Pruebas de una ruta con sesión

```ts
import { MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
const handle = await sessions.load(new Request("http://localhost/"));
const record = await handle.create({ userId: "u_1" });
const cookie = handle.cookieHeader!.split(";")[0]!; // "meeko.sid=…"
const again = await sessions.load(new Request("http://localhost/", { headers: { cookie } }));
console.log(again.current?.id === record.id); // true
```

### Un store persistente de mentira para una prueba de producción

`SessionManager({ production: true })` sólo pide `persistent: true`, `replace` y `revokeFamily`. La suite de conformidad de Meeko envuelve un `MemorySessionStore` así para probar las salidas de producción de Node, Bun y Deno en un solo proceso:

```ts
import { MemorySessionStore, SessionManager } from "@meekojs/meeko/server";
import type { SessionStore } from "@meekojs/meeko/server";

const memory = new MemorySessionStore();
const store: SessionStore = {
  persistent: true,
  get: (id) => memory.get(id),
  set: (record) => memory.set(record),
  delete: (id) => memory.delete(id),
  replace: (previousId, record) => memory.replace(previousId, record),
  revokeFamily: (familyId) => memory.revokeFamily(familyId),
  close: () => memory.close(),
};
export const sessions = new SessionManager({ store, production: true, secure: false });
```

Sólo vale para pruebas: en un servidor real las sesiones seguirían perdiéndose al reiniciar.

## Errores comunes

### Usarlo en producción

```ts bad
new SessionManager({ store: new MemorySessionStore(), production });
```

Con `production` en `true` (`meeko start`, Bun, Deno, Workers), el constructor lanza `Error: Persistent session storage with atomic rotation and family revocation is required in production` y la aplicación no arranca.

<!-- no-check -->
```ts good
new SessionManager({ store: production && !prerendering ? persistentStore : new MemorySessionStore(), production: production && !prerendering });
```

### Varias instancias con memoria

```text bad
2 réplicas de la aplicación, cada una con su MemorySessionStore (y production: false para que arranque)
```

No hay error: cada réplica sólo conoce las sesiones que creó. Tras el balanceador, el usuario pierde la sesión al cambiar de réplica, un logout no alcanza a la otra y `rateLimit` cuenta por réplica.

```text good
Un store compartido: RedisSessionStore, SqlSessionStore o D1SessionDriver
```

## Notas

- **Desarrollo.** En `meeko dev`, crear o borrar una ruta vuelve a crear la aplicación y con ella el store: las sesiones abiertas se pierden.
- **Memoria.** No limita el número de sesiones: las caducadas se borran al leerlas. No lo exponga a tráfico real.
- **Revocación.** Avisa a los gestores del mismo proceso; no hay otras instancias que avisar.
- **Cookies en desarrollo.** Con `secure: false` el nombre de la cookie es `meeko.sid`; las sesiones de Meeko sin configuración mantienen `__Host-meeko.sid` y `Secure`, que los navegadores aceptan en `localhost`.
