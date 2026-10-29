---
title: D1SessionDriver
group: adapters
since: 1.0.0
description: Driver de SqlSessionStore para Cloudflare D1, con rotación y revocación atómicas, limpieza de filas caducadas y, desde 1.7, contadores de rateLimit compartidos entre aislados.
symbols:
  - "@meekojs/meeko/cloudflare#D1SessionDriver"
types:
  - "@meekojs/meeko/cloudflare#D1SessionDriverOptions"
  - "@meekojs/meeko/cloudflare#D1DatabaseLike"
related:
  - "@meekojs/meeko/server#SqlSessionStore"
  - "@meekojs/meeko/server#SessionManager"
  - "@meekojs/meeko/cloudflare#createWorker"
  - docs/framework.md#sesiones-en-d1
  - docs/framework.md#rate-limit-en-sql
  - docs/framework.md#cloudflare-workers
---

`D1SessionDriver(db, options)` implementa `SqlSessionDriver` sobre un binding de D1, para usarlo con `SqlSessionStore`. Cada operación es una sola sentencia: `replace` es un `UPDATE … WHERE id = ? AND family_id = ? AND expires_at > ?` que exige cambiar exactamente una fila, `revokeFamily` un `DELETE … WHERE family_id = ?`, y `UNIQUE(family_id)` impide un segundo ID activo en una familia.

Desde `1.7`, con `rateLimitTable`, implementa también `rateLimit` con un único `INSERT … ON CONFLICT(key) DO UPDATE … RETURNING`, y los contadores de `rateLimit` de API y RPC se comparten entre todos los aislados en lugar de vivir en la memoria de cada uno.

## Uso

```ts
// server/runtime.ts
import { D1SessionDriver } from "@meekojs/meeko/cloudflare";
import type { D1DatabaseLike } from "@meekojs/meeko/cloudflare";
import { defineServerRuntime, MemorySessionStore, SessionManager, SqlSessionStore } from "@meekojs/meeko/server";

interface Env { readonly DB?: D1DatabaseLike }

export default defineServerRuntime<Env>(({ env, production, prerendering }) => {
  const store = prerendering || !env.DB
    ? new MemorySessionStore()
    : new SqlSessionStore(new D1SessionDriver(env.DB, { rateLimitTable: "meeko_rate_limits" }));
  return { sessions: new SessionManager({ store, production: production && !prerendering }) };
});
```

## Parámetros

`new D1SessionDriver(db, options?)`:

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `db` | `D1DatabaseLike` | obligatorio | El binding de D1 (`env.DB`). |
| `options.table` | `string` | `"meeko_sessions"` | La tabla de las sesiones, creada con `D1SessionDriver.schema(table)`. |
| `options.rateLimitTable` | `string` | ninguna | Desde `1.7`. La tabla de los contadores, creada con `D1SessionDriver.rateLimitSchema(table)`. Sin ella, el driver no tiene `rateLimit`. |

Los nombres de tabla son identificadores SQL: letra o `_` seguidos de letras, dígitos o `_`, hasta 63 caracteres.

## Valor devuelto

Un `SqlSessionDriver` con `read`, `write`, `remove`, `replace`, `revokeFamily`, `rateLimit` (con `rateLimitTable`) y:

| Miembro | Descripción |
| --- | --- |
| `deleteExpired(now?)` | Borra las sesiones caducadas y, desde `1.7`, los contadores cuya ventana terminó; devuelve el total de filas borradas. |
| `D1SessionDriver.schema(table?)` | El `CREATE TABLE` y el índice de las sesiones. |
| `D1SessionDriver.rateLimitSchema(table?)` | Desde `1.7`. El `CREATE TABLE … WITHOUT ROWID` y el índice de los contadores. |

```sql
CREATE TABLE IF NOT EXISTS "meeko_sessions" (
  id TEXT PRIMARY KEY NOT NULL,
  family_id TEXT NOT NULL UNIQUE,
  csrf_token TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS "meeko_sessions_expires_at" ON "meeko_sessions" (expires_at);

CREATE TABLE IF NOT EXISTS "meeko_rate_limits" (
  key TEXT PRIMARY KEY NOT NULL,
  window_ends_at INTEGER NOT NULL,
  count INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS "meeko_rate_limits_window_ends_at" ON "meeko_rate_limits" (window_ends_at);
```

## Ejemplos

### Migraciones de D1

```sh
npx wrangler d1 migrations create mi-app meeko_sessions
# copie D1SessionDriver.schema() y D1SessionDriver.rateLimitSchema() en el archivo creado
npx wrangler d1 migrations apply mi-app --local    # para wrangler dev / meeko preview
npx wrangler d1 migrations apply mi-app --remote   # antes de desplegar
```

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  server: {
    adapter: "cloudflare",
    wrangler: {
      d1_databases: [{ binding: "DB", database_name: "mi-app", database_id: "<id>" }],
    },
  },
});
```

### Limpieza con un Cron Trigger

<!-- no-check -->
```ts
// worker.ts propio, junto a createWorker
export default {
  fetch: worker.fetch,
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const driver = new D1SessionDriver(env.DB, { rateLimitTable: "meeko_rate_limits" });
    ctx.waitUntil(driver.deleteExpired().then((rows) => console.log(`meeko: ${rows} filas caducadas`)));
  },
};
```

El Worker que genera `meeko build` sólo exporta `fetch`: un `scheduled` necesita un Worker propio, con `triggers: { crons: ["17 * * * *"] }` en su `wrangler.jsonc`. Las sesiones caducadas también se borran al leerlas; la tarea limpia las que nadie vuelve a pedir.

### Limitar el inicio de sesión en Workers

<!-- no-check -->
```ts
// server/api/auth/login.post.ts
export default defineApiRoute({
  body: loginInput,
  response: okResult,
  origin: "required",
  rateLimit: { limit: 5, window: "5m" }, // contado en D1, igual en todos los aislados
  handler: async ({ body, context }) => { /* … */ },
});
```

## Errores comunes

### Un nombre de tabla con guiones

```ts bad
new D1SessionDriver(env.DB, { table: "app-sessions" });
```

`TypeError: Invalid D1 session table name: app-sessions`, al crear el runtime. Lo mismo con `rateLimitTable`.

<!-- no-check -->
```ts good
new D1SessionDriver(env.DB, { table: "app_sessions" });
```

### Sin el binding (o en el prerender)

```ts bad
new SqlSessionStore(new D1SessionDriver(env.DB!)); // también durante meeko build
```

El prerender se ejecuta en Node sin bindings: la fábrica lanza `TypeError: D1SessionDriver requires a D1 database binding` y el prerender de `meeko build` falla. En producción, compruebe también que `wrangler.jsonc` declara el binding.

<!-- no-check -->
```ts good
const store = prerendering || !env.DB ? new MemorySessionStore() : new SqlSessionStore(new D1SessionDriver(env.DB));
```

### Desplegar sin aplicar la migración

```text bad
npx wrangler deploy sin npx wrangler d1 migrations apply --remote
```

Cada lectura de sesión falla con el error de D1 `no such table: meeko_sessions` y la petición responde `500`: el store nunca concede acceso sin la tabla.

```text good
npx wrangler d1 migrations apply mi-app --remote && npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc
```

### Usar Workers KV

```text bad
Un SessionStore sobre Workers KV
```

KV no ofrece operaciones atómicas de comparación ni de borrado por familia, y su consistencia es eventual: no puede garantizar `replace` ni `revokeFamily`, y `SessionManager({ production: true })` rechaza un store sin ellas (`Persistent session storage with atomic rotation and family revocation is required in production`).

```text good
SqlSessionStore(new D1SessionDriver(env.DB)) o RedisSessionStore sobre la API REST de Upstash
```

## Notas

- **Revocación.** D1 no notifica a otros aislados: una conexión abierta en otro aislado detecta la revocación al releer la sesión en su siguiente evento. Use `session.verify()` antes de efectos irreversibles.
- **Contadores.** La clave es el SHA-256 de la clave del contador en base64url (43 caracteres): la tabla nunca guarda una IP. Con `rateLimitTable`, `deleteExpired()` también vacía las ventanas terminadas.
- **Fail closed.** Si D1 falla, la petición que lee la sesión o cuenta un límite responde `500`.
- **Socket.** El Durable Object de un canal privado también lee las sesiones de D1; la suite `workerd` lo prueba.
