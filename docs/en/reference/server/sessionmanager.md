---
title: SessionManager
group: server
since: 1.0.0
description: Application session manager with opaque HttpOnly cookies, family-based rotation and revocation, and Origin and CSRF checks on authenticated mutations.
symbols:
  - "@meekojs/meeko/server#SessionManager"
types:
  - "@meekojs/meeko/server#SessionOptions"
  - "@meekojs/meeko/server#SessionStore"
  - "@meekojs/meeko/server#SessionRecord"
related:
  - "@meekojs/meeko/server#SessionHandle"
  - "@meekojs/meeko/server#MemorySessionStore"
  - "@meekojs/meeko/server#RedisSessionStore"
  - "@meekojs/meeko/server#SqlSessionStore"
  - "@meekojs/meeko/server#SessionSecurityError"
  - "@meekojs/meeko/server#defineServerRuntime"
  - docs/framework.md#sesiones-y-seguridad
  - docs/framework.md#sesiones-sin-configuración
  - docs/framework.md#autenticación
source-hash: f0c25b1ec292d1da953b5cfcab7abfde232e4d53eb3aca33f96c6a1096b075f8
---

`SessionManager` is a Meeko application's session manager. It stores sessions in a `SessionStore` and identifies them through an opaque `HttpOnly`, host-only, `Secure`, `SameSite=Lax` cookie (`__Host-meeko.sid` by default). On each request, `load` reads the cookie and returns the `SessionHandle` passed to pages, API, RPC and Socket as `context.session`; on mutations with a cookie, `assertMutationAllowed` checks `Origin` and the `x-meeko-csrf` token.

Declare it in `sessions` in `server/runtime.ts`. Since `1.2` it is optional: without it, Meeko creates one in memory during development and in Redis with `MEEKO_REDIS_URL` in production (see [Zero-configuration sessions](/en/docs/framework#sessions-without-configuration)). Your own `SessionManager` always takes precedence.

## Usage

<!-- no-check -->

```ts
// server/runtime.ts
import { createClient } from "redis";
import { defineServerRuntime, RedisSessionStore, SessionManager } from "@meekojs/meeko/server";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  const redis = createClient({ url: env.MEEKO_REDIS_URL });
  await redis.connect();
  return {
    sessions: new SessionManager({
      store: new RedisSessionStore(redis, { prefix: "tienda:prod:session:" }),
      production: production && !prerendering,
    }),
    close: async () => { await redis.quit(); },
  };
});
```

`production && !prerendering`: the factory also executes during `meeko build` prerendering, without client traffic, and no persistent store is needed there.

## Parameters

`new SessionManager(options)` takes a `SessionOptions<T>` object:

| Option           | Type                          | Default                                                 | Description                                                                                                                                                  |
| ---------------- | ----------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `store`          | `SessionStore<T>`             | required                                                | Where sessions live: `MemorySessionStore`, `RedisSessionStore`, `SqlSessionStore` or your own store.                                                         |
| `production`     | `boolean`                     | `false`                                                 | Requires a store with `persistent: true`, `replace` and `revokeFamily`; otherwise, the constructor throws. Also disables development warnings.               |
| `ttlMs`          | `number`                      | `604800000` (7 days)                                    | Default lifetime for each session, a positive integer in milliseconds. `session.create(data, { ttlMs })` overrides it for one session.                       |
| `secure`         | `boolean`                     | `true`                                                  | The cookie's `Secure` attribute. Without it, the default name becomes `meeko.sid`.                                                                           |
| `sameSite`       | `"Lax" \| "Strict" \| "None"` | `"Lax"`                                                 | The `SameSite` attribute. `"None"` requires `secure`.                                                                                                        |
| `cookieName`     | `string`                      | `"__Host-meeko.sid"`, or `"meeko.sid"` without `secure` | Cookie name: letters, digits, `_`, `.` and `-`. A `__Host-…` name requires `secure`.                                                                         |
| `allowedOrigins` | `readonly string[]`           | `[]`                                                    | Origins, in addition to the application's own, accepted in API and RPC mutations (since `1.8`, also without a session), native forms and `session.create()`. |

## Return value

An instance with these members:

| Member                                               | Type                        | Description                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store`                                              | `SessionStore<T>`           | The store from the options.                                                                                                                                                                                                                                                                     |
| `ttlMs`                                              | `number`                    | The default lifetime.                                                                                                                                                                                                                                                                           |
| `cookieName`                                         | `string`                    | The cookie name.                                                                                                                                                                                                                                                                                |
| `allowedOrigins`                                     | `readonly string[]`         | Additional origins.                                                                                                                                                                                                                                                                             |
| `load(request)`                                      | `Promise<SessionHandle<T>>` | Reads the request cookie and returns its handle, without a session if absent, invalid or expired. The first call subscribes to store revocations and waits for confirmation; if it fails, it rejects and the next call retries.                                                                 |
| `assertMutationAllowed(request, session, mutating?)` | `void`                      | On a mutation with a session, checks that `Origin` is the application's own or one of `allowedOrigins` and that `x-meeko-csrf` is the session token. Throws `SessionSecurityError` with `INVALID_ORIGIN` or `INVALID_CSRF`. Without a session, or on `GET`, `HEAD` and `OPTIONS`, does nothing. |
| `serializeCookie(value, ttlMs)`                      | `string`                    | The `Set-Cookie` header with the manager's policy; `ttlMs` `0` deletes it.                                                                                                                                                                                                                      |
| `rateLimit(key, windowMs)`                           | `Promise<RateLimitHit>`     | Since `1.2`. Counts one request in the fixed window `key` with `store.rateLimit`, or in the instance's memory if the store lacks it.                                                                                                                                                            |
| `close()`                                            | `Promise<void>`             | Cancels the revocation subscription and closes the store; does not close external clients such as Redis.                                                                                                                                                                                        |

With default options, the cookie is `__Host-meeko.sid=<id>; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800; Secure`.

## Examples

### SQL sessions with a custom lifetime and origins

<!-- no-check -->

```ts
// server/runtime.ts
import { defineServerRuntime, SessionManager, SqlSessionStore } from "@meekojs/meeko/server";
import { createPool, sessionDriver } from "./utils/database";

export default defineServerRuntime(async ({ env, production, prerendering }) => {
  const pool = await createPool(env.DATABASE_URL);
  return {
    sessions: new SessionManager({
      store: new SqlSessionStore(sessionDriver(pool)),
      production: production && !prerendering,
      ttlMs: 12 * 60 * 60 * 1000,                  // 12 horas
      sameSite: "Strict",
      allowedOrigins: ["https://admin.example.com"], // el panel, en otro subdominio
    }),
    close: () => pool.end(),
  };
});
```

### One session type for the entire application

`SessionManager<T>` accepts session data as a type parameter, but `context.session` follows `MeekoSession`. Declare it once to type data in pages, API, RPC and Socket:

```ts
// server/types/session.d.ts
import type {} from "@meekojs/meeko/server";
declare module "@meekojs/meeko/server" {
  interface MeekoSession { userId: string; role: "owner" | "staff" }
}
```

### Check Origin and CSRF on your own host

`createServerApp` already does this in API and RPC. A host serving its own routes with Meeko's session does it manually:

```ts
import { MemorySessionStore, SessionManager, SessionSecurityError } from "@meekojs/meeko/server";

const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false });

export async function handle(request: Request): Promise<Response> {
  const session = await sessions.load(request);
  try {
    sessions.assertMutationAllowed(request, session);
  } catch (error) {
    if (error instanceof SessionSecurityError) return Response.json({ code: error.code }, { status: 403 });
    throw error;
  }
  const headers = new Headers();
  if (session.cookieHeader) headers.append("set-cookie", session.cookieHeader);
  return new Response(session.current ? "con sesión" : "anónimo", { headers });
}
```

### Deployment behind an HTTPS proxy

```sh
MEEKO_PUBLIC_ORIGIN=https://tienda.example.com   # el origen que ve el navegador
MEEKO_REDIS_URL=rediss://default:…@redis.example.com:6380
MEEKO_TRUST_PROXY=1                              # Traefik, Caddy o nginx delante
# MEEKO_TRUST_PROXY=cloudflare                   # desde 1.8, tras Cloudflare Tunnel: CF-Connecting-IP
```

The browser sends `Origin: https://tienda.example.com`; `createServerApp` constructs the request URL with `MEEKO_PUBLIC_ORIGIN`, so `assertMutationAllowed` accepts it even if the proxy talks HTTP to the application.

## Common mistakes

### An in-memory store in production

```ts bad
new SessionManager({ store: new MemorySessionStore(), production: true });
```

The constructor throws `Error: Persistent session storage with atomic rotation and family revocation is required in production` and the application does not start. An in-memory store loses sessions on restart and is not shared between instances.

<!-- no-check -->

```ts good
new SessionManager({ store: new RedisSessionStore(redis, { prefix: "app:prod:session:" }), production: production && !prerendering });
```

### Production without `sessions` or `MEEKO_REDIS_URL`

```text bad
server/runtime.ts sin sessions, y el servidor arranca sin MEEKO_REDIS_URL
```

`meeko start` (and each adapter) stops with `Production requires a persistent session store: set MEEKO_REDIS_URL (with the redis package installed), or return { sessions } with a persistent SessionStore from server/runtime.ts`. On Workers, `MEEKO_REDIS_URL` is not valid either: `MEEKO_REDIS_URL needs TCP connections, which Cloudflare Workers do not offer…`.

```text good
MEEKO_REDIS_URL=rediss://…  y  npm install redis
```

### `SameSite=None` or `__Host-` without `Secure`

```ts bad
new SessionManager({ store, sameSite: "None", secure: false });
```

The constructor throws `Error: SameSite=None requires Secure`. With `cookieName: "__Host-sid"` and `secure: false`, `Error: __Host- cookies require Secure`. Browsers reject those cookies.

<!-- no-check -->

```ts good
new SessionManager({ store, sameSite: "None", secure: true });
```

### A non-integer lifetime

```ts bad
new SessionManager({ store, ttlMs: 1.5 * 24 * 60 * 60 * 1000 + 0.5 });
```

`RangeError: Invalid session TTL`. Use a positive integer in milliseconds.

<!-- no-check -->

```ts good
new SessionManager({ store, ttlMs: 36 * 60 * 60 * 1000 });
```

## Notes

- **Server only.** Imported from `@meekojs/meeko/server` and lives in `server/runtime.ts`; the cookie is `HttpOnly`, so the browser never sees the ID. The CSRF token arrives through the `meeko-csrf-token` meta tag and `x-meeko-csrf-token` header, and the `api.*` and `rpc.*` clients send it automatically.
- **CSRF and Origin.** Mutations (`POST`, `PUT`, `PATCH`, `DELETE`) with a cookie require an allowed `Origin` and `x-meeko-csrf`; failure returns `403 INVALID_ORIGIN` or `403 INVALID_CSRF`. Without a session there is no token to check, but since `1.8` every mutation still requires an allowed `Origin`, except a route with `origin: "none"`; `session.create()` has rejected a foreign `Origin` since `1.2`.
- **Proxies.** The application's own origin comes from `publicOrigin` or `MEEKO_PUBLIC_ORIGIN`, never the `Host` header. If you do not configure it behind a proxy terminating TLS, browser mutations fail with `INVALID_ORIGIN`.
- **Environment variables.** `MEEKO_SESSION_TTL` and `MEEKO_SESSION_SAMESITE` only configure sessions Meeko creates without configuration; with your own `SessionManager`, they do not apply and Meeko warns once.
- **Cross-instance revocation.** With a store implementing `subscribeRevocations` (`RedisSessionStore` with `subscriber`), revoking a family aborts requests and closes that family's sockets on every instance. `SqlSessionStore` and D1 do not notify: other instances detect it when rereading the session.
- **Shutdown.** `close()` releases the store, not the Redis client created by the application: close it in `close` in `server/runtime.ts`, which executes afterward.

> [!IMPORTANT]
> `Secure` requires HTTPS. During HTTP development on `localhost`, browsers accept the `Secure` cookie; on another machine or behind a proxy without TLS, use HTTPS instead of disabling `secure`.
