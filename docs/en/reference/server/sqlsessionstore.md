---
title: SqlSessionStore
group: server
since: 1.0.0
description: Persistent session store over any SQL database, using statements from an application driver and, since 1.7, rateLimit counters in the database.
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
source-hash: 71f5fdd602393efafcc2f4bc2d9d8142515bcba370dc8ecc19c38956d3bbe771
---

`SqlSessionStore` stores sessions in a SQL table without depending on any library or engine: the application supplies a `SqlSessionDriver` with its statements and Meeko handles the rest (serializing data, checking expiration, deriving each session's own lifetime as `expiresAt - createdAt`). `replace` and `revokeFamily` must be atomic; the constructor rejects a driver without them.

Since `1.7`, if the driver implements `rateLimit(key, windowMs, now)`, API and RPC `rateLimit` counters live in the database and are shared by all instances. `D1SessionDriver` from `@meekojs/meeko/cloudflare` is a ready-made driver for D1.

## Usage

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

## Parameters

`new SqlSessionStore(driver, options?)`:

| Parameter                              | Type                                  | Default  | Description                                                                                                                    |
| -------------------------------------- | ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `driver.read(id)`                      | `Promise<SqlSessionRow \| undefined>` | required | The row with that ID.                                                                                                          |
| `driver.write(row)`                    | `Promise<void>`                       | required | Inserts or updates by ID; must enforce a single active ID per family (unique index on `family_id`).                            |
| `driver.remove(id)`                    | `Promise<void>`                       | required | Deletes the row.                                                                                                               |
| `driver.replace(previousId, row, now)` | `Promise<boolean>`                    | required | In a transaction, replaces a nonexpired row (`expires_at > now`) from the same family; `false` if it does not exist.           |
| `driver.revokeFamily(familyId)`        | `Promise<void>`                       | required | Deletes the family's active row in one atomic operation.                                                                       |
| `driver.rateLimit(key, windowMs, now)` | `Promise<SqlRateLimitRow>`            | none     | Since `1.7`. Counts one request in the fixed window for `key` with one atomic statement and returns `{ count, windowEndsAt }`. |
| `driver.close()`                       | `Promise<void>`                       | none     | Closes the connection; only called with `closeDriver`.                                                                         |
| `options.closeDriver`                  | `boolean`                             | `false`  | Closes the driver when the store closes.                                                                                       |

A row (`SqlSessionRow`) has `id`, `familyId`, `csrfToken`, `dataJson`, `createdAt` and `expiresAt` (milliseconds since the epoch).

## Return value

A persistent `SessionStore` (`persistent: true`) with `replace` and `revokeFamily`, and `rateLimit` only if the driver implements it. It has no `subscribeRevocations`: SQL does not notify other instances of revocations.

## Examples

### A driver with node-postgres

```sql
-- Migration, once.
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

A single `UPDATE … WHERE id AND family_id AND expires_at > now` is already atomic: it does not need an explicit transaction.

### `rateLimit` counters in PostgreSQL (since 1.7)

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
    return { count: rows[0]!.count, windowEndsAt: Number(rows[0]!.window_ends_at) }; // bigint is returned as text
  },
};
```

`key` is the 32-byte SHA-256 of the counter key: the table never stores an IP. Delete ended windows with a periodic task: `DELETE FROM meeko_rate_limits WHERE window_ends_at <= $1`.

### Limit login with those counters

<!-- no-check -->

```ts
// server/api/auth/login.post.ts
export default defineApiRoute({
  body: loginInput,
  response: okResult,
  origin: "required",
  rateLimit: { limit: 5, window: "5m" }, // 5 attempts per IP and window, across all instances
  handler: async ({ body, context }) => { /* … */ },
});
```

## Common mistakes

### A driver without `replace` or `revokeFamily`

```ts bad
new SqlSessionStore({ read, write, remove });
```

`TypeError: SQL session driver requires atomic replace and family revocation`. A driver predating family revocation must migrate its schema: add `family_id`, populate it with `family_id = id`, create a unique index and add both operations.

<!-- no-check -->

```ts good
new SqlSessionStore({ read, write, remove, replace, revokeFamily });
```

### A row without `family_id`

```ts bad
read: async (id) => db.get("SELECT id, csrf_token, data_json, created_at, expires_at FROM sessions WHERE id = ?", id),
```

Every session read fails with `Error: Session SQL schema requires a nonempty family_id column` and the request returns `500`.

<!-- no-check -->

```ts good
read: async (id) => toRow(await db.get("SELECT * FROM sessions WHERE id = ?", id)),
```

### `rateLimit` returning unconverted columns

```ts bad
async rateLimit(key, windowMs, now) {
  const { rows } = await pool.query(rateLimitSql, [Buffer.from(key), now, windowMs]);
  return rows[0]; // { count, window_ends_at }
},
```

The rate-limited request returns `500`: Meeko expects `{ count, windowEndsAt }` and rejects with `TypeError: SqlSessionDriver.rateLimit must resolve { count, windowEndsAt }` (_fail closed_).

<!-- no-check -->

```ts good
async rateLimit(key, windowMs, now) {
  const { rows } = await pool.query(rateLimitSql, [Buffer.from(key), now, windowMs]);
  return { count: rows[0].count, windowEndsAt: Number(rows[0].window_ends_at) };
},
```

### Multiple instances without `rateLimit` in the driver

```text bad
SqlSessionStore without driver.rateLimit across 3 replicas: rateLimit { limit: 5, window: "5m" }
```

Each replica counts in its memory: the actual limit is 15. In production Meeko warns once: `[meeko] El store de sesiones no implementa rateLimit: los límites de rateLimit se cuentan en la memoria de cada instancia. Con SqlSessionStore, implemente SqlSessionDriver.rateLimit para compartirlos.`

```text good
driver.rateLimit with INSERT … ON CONFLICT DO UPDATE … RETURNING (since 1.7)
```

## Notes

- **Atomicity.** `replace` and `revokeFamily` must be atomic across concurrent requests from all instances: this way a logout from an earlier handle invalidates the active ID even if another request has already rotated it.
- **Cross-instance revocation.** There is no notification: a request in progress on another instance continues until it rereads the session. Call `session.verify()` before an irreversible effect.
- **Expiration.** Expired rows are deleted when read; delete the rest with a periodic task (`DELETE … WHERE expires_at <= now`).
- **Per-session lifetime.** No `ttlMs` column is needed: it is derived from `expires_at - created_at`, including in rows from before `1.2`.
- **Fail closed.** A driver error propagates the error and never grants access; a `rateLimit` error rejects the rate-limited request.
