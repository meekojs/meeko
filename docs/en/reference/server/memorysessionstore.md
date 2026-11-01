---
title: MemorySessionStore
group: server
since: 1.0.0
description: Session store in process memory, only for development, tests and prerendering; not persistent and rejected by SessionManager in production.
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
source-hash: 2c6f95cb9da990740f8b7c8ed06bf2fd484ab1cc2d3bc6c82edbde79360698ce
---

`MemorySessionStore` stores sessions in a process-local `Map`. It implements the full `SessionStore` contract (atomic `replace` and `revokeFamily`, `subscribeRevocations` between managers in the same process and in-memory `rateLimit`), but declares `persistent: false` and `developmentOnly: true`: restarting loses all sessions and two instances do not share them. `SessionManager({ production: true })` rejects it.

This is the store Meeko uses without configuration in `meeko dev` and during `meeko build` prerendering.

## Usage

```ts
// server/runtime.ts
import { defineServerRuntime, MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(({ production, prerendering }) => ({
  sessions: new SessionManager({ store: new MemorySessionStore(), production: production && !prerendering }),
}));
```

This runtime starts in `meeko dev` and during prerendering, and intentionally fails in `meeko start`: it is the skeleton to complete with a persistent production store (see the first example).

## Parameters

`new MemorySessionStore<T>()` takes no arguments. `T` is the session data type.

## Return value

A `SessionStore<T>` with:

| Member                     | Value                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `persistent`               | `false`                                                                                                                                   |
| `developmentOnly`          | `true`                                                                                                                                    |
| `get`, `set`, `delete`     | In-memory reads and writes. `get` deletes and skips an expired session or one no longer active in its family.                             |
| `replace`, `revokeFamily`  | Atomic within the process. `revokeFamily` notifies `SessionManager` instances in the same process subscribed with `subscribeRevocations`. |
| `rateLimit(key, windowMs)` | In-memory fixed window; expired windows are released automatically.                                                                       |
| `close()`                  | Clears sessions, families and counters.                                                                                                   |

## Examples

### Memory in development, Redis in production

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

If this is all you need, do not write `server/runtime.ts`: Meeko does the same with `MEEKO_REDIS_URL`.

### Test a route with a session

```ts
import { MemorySessionStore, SessionManager } from "@meekojs/meeko/server";

const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });
const handle = await sessions.load(new Request("http://localhost/"));
const record = await handle.create({ userId: "u_1" });
const cookie = handle.cookieHeader!.split(";")[0]!; // "meeko.sid=…"
const again = await sessions.load(new Request("http://localhost/", { headers: { cookie } }));
console.log(again.current?.id === record.id); // true
```

### A fake persistent store for a production test

`SessionManager({ production: true })` only requires `persistent: true`, `replace` and `revokeFamily`. Meeko's conformance suite wraps a `MemorySessionStore` this way to test Node, Bun and Deno production outputs in one process:

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

This is only valid for tests: in a real server, sessions would still be lost on restart.

## Common mistakes

### Use it in production

```ts bad
new SessionManager({ store: new MemorySessionStore(), production });
```

With `production` set to `true` (`meeko start`, Bun, Deno, Workers), the constructor throws `Error: Persistent session storage with atomic rotation and family revocation is required in production` and the application does not start.

<!-- no-check -->

```ts good
new SessionManager({ store: production && !prerendering ? persistentStore : new MemorySessionStore(), production: production && !prerendering });
```

### Multiple instances with memory

```text bad
2 réplicas de la aplicación, cada una con su MemorySessionStore (y production: false para que arranque)
```

There is no error: each replica only knows the sessions it created. Behind the load balancer, users lose their session when switching replicas, logout does not reach the other replica and `rateLimit` counts per replica.

```text good
Un store compartido: RedisSessionStore, SqlSessionStore o D1SessionDriver
```

## Notes

- **Development.** In `meeko dev`, creating or deleting a route recreates the application and its store: open sessions are lost.
- **Memory.** It does not limit the number of sessions: expired sessions are deleted on read. Do not expose it to real traffic.
- **Revocation.** Notifies managers in the same process; there are no other instances to notify.
- **Development cookies.** With `secure: false` the cookie is named `meeko.sid`; Meeko sessions without configuration retain `__Host-meeko.sid` and `Secure`, which browsers accept on `localhost`.
