---
title: SqlSessionStore
group: server
since: 1.0.0
description: Store de sesiones persistente sobre cualquier base de datos SQL, con las sentencias de un driver de la aplicación y, desde 1.7, contadores de rateLimit en la base de datos.
symbols:
  - "@meekojs/meeko/server#SqlSessionStore"
types:
  - "@meekojs/meeko/server#SqlSessionDriver"
  - "@meekojs/meeko/server#SqlSessionRow"
  - "@meekojs/meeko/server#SqlRateLimitRow"
  - "@meekojs/meeko/server#SqlSessionStoreOptions"
related:
  - "@meekojs/meeko/server#SessionManager"
  - "@meekojs/meeko/cloudflare#D1SessionDriver"
  - "@meekojs/meeko/server#RedisSessionStore"
  - docs/framework.md#sesiones-y-seguridad
  - docs/framework.md#rate-limit-en-sql
  - docs/framework.md#límite-de-peticiones-ratelimit
---

`SqlSessionStore` guarda las sesiones en una tabla SQL sin depender de ninguna librería ni motor: la aplicación aporta un `SqlSessionDriver` con sus sentencias y Meeko se ocupa del resto (serializar los datos, comprobar la caducidad, deducir la duración propia de cada sesión como `expiresAt - createdAt`). `replace` y `revokeFamily` deben ser atómicos; el constructor rechaza un driver sin ellos.

Desde `1.7`, si el driver implementa `rateLimit(key, windowMs, now)`, los contadores de `rateLimit` de API y RPC viven en la base de datos y los comparten todas las instancias. `D1SessionDriver` de `@meekojs/meeko/cloudflare` es un driver listo para D1.

## Uso

<!-- no-check -->
```ts
// server/runtime.ts
import { defineServerRuntime, SessionManager, SqlSessionStore } from "@meekojs/meeko/server";
import { pool, sessionDriver } from "./utils/database";

export default defineServerRuntime(({ production, prerendering }) => ({
  sessions: new SessionManager({ store: new SqlSessionStore(sessionDriver(pool)), production: production && !prerendering }),
  close: () => pool.end(),
}));
```

## Parámetros

`new SqlSessionStore(driver, options?)`:

| Parámetro | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `driver.read(id)` | `Promise<SqlSessionRow \| undefined>` | obligatorio | La fila con ese ID. |
| `driver.write(row)` | `Promise<void>` | obligatorio | Inserta o actualiza por ID; debe imponer un único ID activo por familia (índice único en `family_id`). |
| `driver.remove(id)` | `Promise<void>` | obligatorio | Borra la fila. |
| `driver.replace(previousId, row, now)` | `Promise<boolean>` | obligatorio | En una transacción, sustituye una fila no caducada (`expires_at > now`) de la misma familia; `false` si no existe. |
| `driver.revokeFamily(familyId)` | `Promise<void>` | obligatorio | Borra la fila activa de la familia en una operación atómica. |
| `driver.rateLimit(key, windowMs, now)` | `Promise<SqlRateLimitRow>` | ninguno | Desde `1.7`. Cuenta una petición en la ventana fija de `key` con una sola sentencia atómica y devuelve `{ count, windowEndsAt }`. |
| `driver.close()` | `Promise<void>` | ninguno | Cierra la conexión; sólo se llama con `closeDriver`. |
| `options.closeDriver` | `boolean` | `false` | Cierra el driver al cerrar el store. |

Una fila (`SqlSessionRow`) tiene `id`, `familyId`, `csrfToken`, `dataJson`, `createdAt` y `expiresAt` (milisegundos desde la época).

## Valor devuelto

Un `SessionStore` persistente (`persistent: true`) con `replace` y `revokeFamily`, y `rateLimit` sólo si el driver lo implementa. No tiene `subscribeRevocations`: SQL no notifica revocaciones a otras instancias.

## Ejemplos

### Un driver con node-postgres

```sql
-- Migración, una vez.
CREATE TABLE IF NOT EXISTS meeko_sessions (
  id text PRIMARY KEY,
  family_id text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  data_json text NOT NULL,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS meeko_sessions_expires_at ON meeko_sessions (expires_at);
```

<!-- no-check -->
```ts
// server/utils/database.ts
import pg from "pg";
import type { SqlSessionDriver, SqlSessionRow } from "@meekojs/meeko/server";

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const row = (r: Record<string, string>): SqlSessionRow => ({
  id: r.id!, familyId: r.family_id!, csrfToken: r.csrf_token!, dataJson: r.data_json!,
  createdAt: Number(r.created_at), expiresAt: Number(r.expires_at),
});

export const sessionDriver = (db: pg.Pool): SqlSessionDriver => ({
  async read(id) {
    const { rows } = await db.query("SELECT * FROM meeko_sessions WHERE id = $1", [id]);
    return rows[0] ? row(rows[0]) : undefined;
  },
  async write(r) {
    await db.query(
      `INSERT INTO meeko_sessions VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (id) DO UPDATE SET csrf_token = $3, data_json = $4, expires_at = $6 WHERE meeko_sessions.family_id = $2`,
      [r.id, r.familyId, r.csrfToken, r.dataJson, r.createdAt, r.expiresAt],
    );
  },
  async remove(id) { await db.query("DELETE FROM meeko_sessions WHERE id = $1", [id]); },
  async replace(previousId, r, now) {
    const { rowCount } = await db.query(
      `UPDATE meeko_sessions SET id = $1, csrf_token = $2, data_json = $3, created_at = $4, expires_at = $5
       WHERE id = $6 AND family_id = $7 AND expires_at > $8`,
      [r.id, r.csrfToken, r.dataJson, r.createdAt, r.expiresAt, previousId, r.familyId, now],
    );
    return rowCount === 1;
  },
  async revokeFamily(familyId) { await db.query("DELETE FROM meeko_sessions WHERE family_id = $1", [familyId]); },
});
```

Un único `UPDATE … WHERE id AND family_id AND expires_at > now` ya es atómico: no necesita una transacción explícita.

### Contadores de `rateLimit` en PostgreSQL (desde 1.7)

```sql
CREATE UNLOGGED TABLE IF NOT EXISTS meeko_rate_limits (
  key bytea PRIMARY KEY,
  window_ends_at bigint NOT NULL,
  count integer NOT NULL
);
CREATE INDEX IF NOT EXISTS meeko_rate_limits_window_ends_at ON meeko_rate_limits (window_ends_at);
```

<!-- no-check -->
```ts
const rateLimitSql = `INSERT INTO meeko_rate_limits AS r (key, window_ends_at, count) VALUES ($1, $2::bigint + $3::bigint, 1)
ON CONFLICT (key) DO UPDATE SET
  count = CASE WHEN r.window_ends_at <= $2 THEN 1 ELSE r.count + 1 END,
  window_ends_at = CASE WHEN r.window_ends_at <= $2 THEN EXCLUDED.window_ends_at ELSE r.window_ends_at END
RETURNING count, window_ends_at`;

const driver: SqlSessionDriver = {
  ...sessionDriver(pool),
  async rateLimit(key, windowMs, now) {
    const { rows } = await pool.query<{ count: number; window_ends_at: string }>(rateLimitSql, [Buffer.from(key), now, windowMs]);
    return { count: rows[0]!.count, windowEndsAt: Number(rows[0]!.window_ends_at) }; // bigint llega como texto
  },
};
```

`key` son los 32 bytes del SHA-256 de la clave del contador: la tabla nunca guarda una IP. Borre las ventanas terminadas con una tarea periódica: `DELETE FROM meeko_rate_limits WHERE window_ends_at <= $1`.

### Limitar el inicio de sesión con esos contadores

<!-- no-check -->
```ts
// server/api/auth/login.post.ts
export default defineApiRoute({
  body: loginInput,
  response: okResult,
  origin: "required",
  rateLimit: { limit: 5, window: "5m" }, // 5 intentos por IP y ventana, en todas las instancias
  handler: async ({ body, context }) => { /* … */ },
});
```

## Errores comunes

### Un driver sin `replace` o `revokeFamily`

```ts bad
new SqlSessionStore({ read, write, remove });
```

`TypeError: SQL session driver requires atomic replace and family revocation`. Un driver anterior a la revocación por familia debe migrar su esquema: añada `family_id`, rellénelo con `family_id = id`, cree un índice único y añada las dos operaciones.

<!-- no-check -->
```ts good
new SqlSessionStore({ read, write, remove, replace, revokeFamily });
```

### Una fila sin `family_id`

```ts bad
read: async (id) => db.get("SELECT id, csrf_token, data_json, created_at, expires_at FROM sessions WHERE id = ?", id),
```

Cada lectura de una sesión falla con `Error: Session SQL schema requires a nonempty family_id column` y la petición responde `500`.

<!-- no-check -->
```ts good
read: async (id) => toRow(await db.get("SELECT * FROM sessions WHERE id = ?", id)),
```

### `rateLimit` que devuelve las columnas sin convertir

```ts bad
async rateLimit(key, windowMs, now) {
  const { rows } = await pool.query(rateLimitSql, [Buffer.from(key), now, windowMs]);
  return rows[0]; // { count, window_ends_at }
},
```

La petición limitada responde `500`: Meeko espera `{ count, windowEndsAt }` y rechaza con `TypeError: SqlSessionDriver.rateLimit must resolve { count, windowEndsAt }` (*fail closed*).

<!-- no-check -->
```ts good
async rateLimit(key, windowMs, now) {
  const { rows } = await pool.query(rateLimitSql, [Buffer.from(key), now, windowMs]);
  return { count: rows[0].count, windowEndsAt: Number(rows[0].window_ends_at) };
},
```

### Varias instancias sin `rateLimit` en el driver

```text bad
SqlSessionStore sin driver.rateLimit en 3 réplicas: rateLimit { limit: 5, window: "5m" }
```

Cada réplica cuenta en su memoria: el límite real es 15. En producción Meeko lo avisa una vez: `[meeko] El store de sesiones no implementa rateLimit: los límites de rateLimit se cuentan en la memoria de cada instancia. Con SqlSessionStore, implemente SqlSessionDriver.rateLimit para compartirlos.`

```text good
driver.rateLimit con INSERT … ON CONFLICT DO UPDATE … RETURNING (desde 1.7)
```

## Notas

- **Atomicidad.** `replace` y `revokeFamily` deben serlo frente a peticiones concurrentes de todas las instancias: así un logout desde un handle anterior invalida el ID activo aunque otra petición ya lo rotara.
- **Revocación entre instancias.** No hay notificación: una petición en curso en otra instancia sigue hasta que relee la sesión. Llame a `session.verify()` antes de un efecto irreversible.
- **Caducidad.** Las filas caducadas se borran al leerlas; borre el resto con una tarea periódica (`DELETE … WHERE expires_at <= now`).
- **Duración por sesión.** No hace falta una columna para `ttlMs`: se deduce de `expires_at - created_at`, también en las filas anteriores a `1.2`.
- **Fail closed.** Un error del driver propaga el error y nunca concede acceso; un error de `rateLimit` rechaza la petición limitada.
