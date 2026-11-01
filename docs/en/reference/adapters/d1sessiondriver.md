---
title: D1SessionDriver
group: adapters
since: 1.0.0
description: SqlSessionStore driver for Cloudflare D1, with atomic rotation and revocation, expired-row cleanup and, since 1.7, rateLimit counters shared across isolates.
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
source-hash: ff49fd8f0c0b802770812a3c1a85d8d2751140b4c070eaa0dcc88ec9e23b98d6
---

`D1SessionDriver(db, options)` implements `SqlSessionDriver` over a D1 binding, for use with `SqlSessionStore`. Each operation is a single statement: `replace` is an `UPDATE … WHERE id = ? AND family_id = ? AND expires_at > ?` requiring exactly one changed row, `revokeFamily` is a `DELETE … WHERE family_id = ?`, and `UNIQUE(family_id)` prevents a second active ID in a family.

Since `1.7`, with `rateLimitTable`, it also implements `rateLimit` through a single `INSERT … ON CONFLICT(key) DO UPDATE … RETURNING`, sharing API and RPC `rateLimit` counters across all isolates instead of keeping them in each isolate's memory.

## Usage

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

## Parameters

`new D1SessionDriver(db, options?)`:

| Parameter                | Type             | Default            | Description                                                                                                                   |
| ------------------------ | ---------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| `db`                     | `D1DatabaseLike` | required           | The D1 binding (`env.DB`).                                                                                                    |
| `options.table`          | `string`         | `"meeko_sessions"` | Session table, created with `D1SessionDriver.schema(table)`.                                                                  |
| `options.rateLimitTable` | `string`         | none               | Since `1.7`. Counter table, created with `D1SessionDriver.rateLimitSchema(table)`. Without it, the driver has no `rateLimit`. |

Table names are SQL identifiers: a letter or `_` followed by letters, digits or `_`, up to 63 characters.

## Return value

A `SqlSessionDriver` with `read`, `write`, `remove`, `replace`, `revokeFamily`, `rateLimit` (with `rateLimitTable`) and:

| Member                                    | Description                                                                                                 |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `deleteExpired(now?)`                     | Deletes expired sessions and, since `1.7`, counters whose window has ended; returns the total deleted rows. |
| `D1SessionDriver.schema(table?)`          | The session `CREATE TABLE` and index.                                                                       |
| `D1SessionDriver.rateLimitSchema(table?)` | Since `1.7`. The counter `CREATE TABLE … WITHOUT ROWID` and index.                                          |

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

## Examples

### D1 migrations

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

### Cleanup with a Cron Trigger

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

The Worker generated by `meeko build` only exports `fetch`: a `scheduled` handler needs a custom Worker, with `triggers: { crons: ["17 * * * *"] }` in its `wrangler.jsonc`. Expired sessions are also deleted on read; the task cleans those nobody requests again.

### Rate-limit login in Workers

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

## Common mistakes

### A table name with hyphens

```ts bad
new D1SessionDriver(env.DB, { table: "app-sessions" });
```

`TypeError: Invalid D1 session table name: app-sessions`, when creating the runtime. The same applies to `rateLimitTable`.

<!-- no-check -->

```ts good
new D1SessionDriver(env.DB, { table: "app_sessions" });
```

### No binding (or during prerendering)

```ts bad
new SqlSessionStore(new D1SessionDriver(env.DB!)); // también durante meeko build
```

Prerendering runs in Node without bindings: the factory throws `TypeError: D1SessionDriver requires a D1 database binding` and `meeko build` prerendering fails. In production, also check that `wrangler.jsonc` declares the binding.

<!-- no-check -->

```ts good
const store = prerendering || !env.DB ? new MemorySessionStore() : new SqlSessionStore(new D1SessionDriver(env.DB));
```

### Deploy without applying the migration

```text bad
npx wrangler deploy sin npx wrangler d1 migrations apply --remote
```

Each session read fails with D1's `no such table: meeko_sessions` error and the request responds with `500`: the store never grants access without the table.

```text good
npx wrangler d1 migrations apply mi-app --remote && npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc
```

### Use Workers KV

```text bad
Un SessionStore sobre Workers KV
```

KV has neither atomic comparison operations nor family deletion, and is eventually consistent: it cannot guarantee `replace` or `revokeFamily`, and `SessionManager({ production: true })` rejects a store lacking them (`Persistent session storage with atomic rotation and family revocation is required in production`).

```text good
SqlSessionStore(new D1SessionDriver(env.DB)) o RedisSessionStore sobre la API REST de Upstash
```

## Notes

- **Revocation.** D1 does not notify other isolates: an open connection in another isolate detects revocation when rereading the session on its next event. Use `session.verify()` before irreversible effects.
- **Counters.** The key is the counter key's SHA-256 in base64url (43 characters): the table never stores an IP. With `rateLimitTable`, `deleteExpired()` also removes ended windows.
- **Fail closed.** If D1 fails, the request reading the session or counting a limit responds with `500`.
- **Socket.** A private channel's Durable Object also reads D1 sessions; the `workerd` suite tests it.
