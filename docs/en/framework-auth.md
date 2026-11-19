---
source-hash: d84bc28703179ec1886dedf652f74c11647a5225c192e4701f5ac919a46d2edb
---

# Authentication and sessions

This guide expands [the framework overview](framework.md).

## Authentication

Since `1.2`, Meeko handles the delicate parts of login: an opaque `HttpOnly`, `Secure`, host-only cookie, Redis sessions across instances with revocation, Origin and CSRF, scrypt passwords, attempt limiting and session types. The application only decides who can log in. A private panel for one account looks like this:

**1. Variables** (`.env` in development, ignored by git; environment variables in production):

```sh
MEEKO_PUBLIC_ORIGIN=https://example.com       # the exact origin behind the HTTPS proxy
MEEKO_REDIS_URL=rediss://default:…@redis.example.com:6380
MEEKO_TRUST_PROXY=1                           # a proxy (Traefik, Caddy, nginx) in front
ADMIN_USERNAME=ada
ADMIN_PASSWORD_HASH=scrypt$131072$8$1$…       # npx meeko auth hash
```

The last two belong to the application, without the reserved `MEEKO_` prefix. Install the Redis client with `npm install redis`; in development sessions live in memory and Redis is unnecessary. There is no `server/runtime.ts`: see [Sessions without configuration](#sessions-without-configuration).

**2. The session type**, defined once for pages, API, RPC and Socket:

```ts
// server/types/session.d.ts
import type {} from '@meekojs/meeko/server'
declare module '@meekojs/meeko/server' {
	interface MeekoSession {
		user: string
		role: 'owner'
	}
}
```

**3. Login and logout:**

```ts
// server/api/auth/login.post.ts
import { verifyPassword } from '@meekojs/meeko/password'
import { loginInput, okResult } from '../../../shared/schemas/auth.js'

export default defineApiRoute({
	body: loginInput,
	response: okResult,
	origin: 'required',
	rateLimit: { limit: 5, window: '5m' },
	handler: async ({ body, context }) => {
		const valid = await verifyPassword(body.password, process.env.ADMIN_PASSWORD_HASH ?? '')
		if (!valid || body.username !== process.env.ADMIN_USERNAME) throw new ApiError('INVALID_CREDENTIALS', 401)
		await context.session.create({ user: body.username, role: 'owner' })
		return { ok: true as const }
	},
})
```

```ts
// server/api/auth/logout.post.ts
export default defineApiRoute({
	auth: 'required',
	status: 204,
	handler: async ({ context }) => {
		await context.session.revoke()
	},
})
```

`verifyPassword` always runs, even for an incorrect username, so the response time does not reveal which of the two failed. `defineApiRoute` and `ApiError` are auto-imported in `server/`. From the browser, `await api.auth.login.post({ body })` and `await api.auth.logout.post()`: the client sends Origin and the CSRF token.

**4. A protected page:**

```html
<!-- app/pages/dashboard.meeko -->
<script
	server
	lang="ts"
>
	const { context } = usePage()
	const session = context.session.current
	if (session?.data.role !== 'owner') redirect('/login')
	export const user = session.data.user
</script>

<template>
	<h1>Hello, {user}</h1>
</template>
```

What Meeko does for you in this example:

- The `__Host-meeko.sid` cookie is opaque, `HttpOnly`, `Secure`, `SameSite=Lax` and host-only; `MEEKO_SESSION_TTL` and `MEEKO_SESSION_SAMESITE` configure it. The ID changes on login and the entire family is revoked on logout, including on other instances.
- The `Origin` check on every mutation (since `1.8`; `origin: "required"` makes it explicit) and `session.create()` itself prevent _login CSRF_ (see [Origin in anonymous mutations](#origin-in-anonymous-mutations)); `auth: "required"` and the CSRF token protect logout.
- `rateLimit` counts attempts per IP in Redis (or, without Redis, in SQL; see [SQL rate limiting](#sql-rate-limiting)), and `MEEKO_TRUST_PROXY` ensures the IP is the client's rather than the proxy's.
- `verifyPassword` compares in constant time and accepts existing hashes with the same format.

### Session types: `MeekoSession`

Without a declaration, `context.session.current.data` is `unknown`, as through `1.1`, and `session.create(data)` accepts any serializable value. Since `1.2`, a module augmentation of the `MeekoSession` interface from `@meekojs/meeko/server` sets the shape throughout the application: `RequestContext.session` becomes `SessionHandle<MeekoSession>`, so `context.session.current?.data` and `create(data)` are typed in pages' `<script server>` (`usePage().context`), in API, RPC and Socket, and in `authorize` and `locals`. The resulting type is called `SessionData`. Declare it in a `.d.ts` file under `server/` (for example, `server/types/session.d.ts`), which `meeko check` and the editor include in all projects, and start with `import type {} from "@meekojs/meeko/server";`: this makes the file a module and ensures TypeScript always loads the module it augments, even if the code reading the session only imports `@meekojs/meeko/framework` (with `export {}`, the augmentation would be lost in those files). The type does not validate at runtime: if you change the shape, previously stored sessions keep the old one until they expire or are recreated.

### Passwords

`@meekojs/meeko/password` (since `1.2`) stores and checks passwords with scrypt:

- `hashPassword(password)` returns `scrypt$<N>$<r>$<p>$<sal>$<hash>`, with N = 2^17, r = 8, p = 1 (128 MiB per calculation), a random 16-byte salt and a 32-byte key, both in base64url. The format describes its own parameters, so a stored hash remains valid even if the defaults change.
- `verifyPassword(password, hash)` recalculates with the hash's parameters and compares in constant time (`timingSafeEqual`). It accepts manually written hashes with the same format, such as `scrypt$131072$8$1$…` with a 32-byte salt and a 64-byte key, without regenerating them. A malformed hash or parameters outside the limits (N a power of two between 2^10 and 2^20, `r` up to 32, `p` up to 16) throws `TypeError`: this is a configuration failure, rather than an incorrect password. An empty password or one larger than 4096 bytes returns `false` without any calculation.
- `needsRehash(hash)` indicates whether the hash uses weaker parameters than the current ones; after a successful login, store `await hashPassword(password)` in its place.

At most two hashes are calculated concurrently per process, to bound memory (256 MiB) and avoid occupying all `libuv` threads; combine login with [`rateLimit`](#rate-limiting-ratelimit). When the user does not exist, still compare against a fixed hash so response time does not reveal which accounts exist.

**Why a separate subpath.** Web Crypto, the only cryptography in `@meekojs/meeko/server`, does not offer memory-hard derivation functions (scrypt, Argon2), and a JavaScript implementation would be dozens of times slower, requiring a lower cost. `node:crypto` implements them natively and exists in Node, Bun and Deno, so `/password` imports it while `/server` remains portable (Web APIs and `node:async_hooks`). It is unsuitable for Cloudflare Workers: although `nodejs_compat` offers scrypt, the 128 MiB of a calculation with these parameters exhaust an isolate's memory; in Workers, delegate verification to an external service.

To obtain a hash without writing code:

```sh
npx meeko auth hash                       # prompts for the password twice, without displaying it
printf '%s' "$PASSWORD" | npx meeko auth hash   # or reads it from stdin
```

The command writes only the hash line to stdout, ready for `.env` (`ADMIN_PASSWORD_HASH=…`); warnings go to stderr.

### Rate limiting: `rateLimit`

Since `1.2`, `defineApiRoute` and `defineRpc` accept `rateLimit: { limit, window, key? }`: at most `limit` requests per fixed `window` (milliseconds or text such as `"30s"`, `"5m"`, `"1h"`). A request exceeding it receives `429 RATE_LIMITED` with `Retry-After` (seconds until the next window), without validating input or running the handler. It is checked after Origin and CSRF and before `auth`, `authorize`, input and `locals`, so it also limits anonymous clients.

```ts
export default defineApiRoute({
	body: loginInput,
	response: okResult,
	origin: 'required',
	rateLimit: { limit: 5, window: '5m' },
	handler: async ({ body, context }) => {
		/* … */
	},
})
```

- **Key.** Without `key`, each client IP has its own counter per route (IPv6 addresses by their /64 network, because a client has an entire /64). The IP is `context.clientAddress`: the connection IP provided by the adapter (Node, Bun, Deno; in Workers, `CF-Connecting-IP`, set by Cloudflare). If Meeko does not know it, all clients share the route's counter. `key: (context) => string` counts by another subject, such as the session user; it runs before input validation, so it receives no body. A dynamic route (`/api/users/[id]`) has a single counter for all its values.
- **Proxies.** `X-Forwarded-For` is never read without `MEEKO_TRUST_PROXY`, because any client can send it. With a number `n`, the IP is the entry added by the outermost trusted proxy, the `n`th from the right: with a single proxy (Traefik in Coolify, Caddy, nginx), use `MEEKO_TRUST_PROXY=1`, and entries forged by the client on the left are ignored. `true` takes the leftmost entry: this is only safe if the entry proxy replaces the header instead of appending itself. An entry with a port, such as one written by Azure Application Gateway (`203.0.113.7:5678` or `[2001:db8::1]:5678`), counts by its IP; if the selected entry is not an IP, the request counts with the connection's IP (the proxy's), never with the shared counter for unknown clients. Without the variable, behind a proxy all clients share the proxy's counter. An invalid value stops startup.
- **Middleware and local calls.** Server middleware passing a new request to `next()` (`next(new Request(request, { headers }))`) retains the connection IP. `createLocalCalls` uses the same route counter as the HTTP dispatcher and the IP of the `context` it receives, so a local call does not bypass the route limit. A custom host creating its `Request` objects without a Meeko adapter (`serveNode`, `toNodeListener`, `createBunServer`, `serveDeno` or `createWorker`) has no connection IP: its clients share the route counter unless it declares `key`.
- **Storage.** Counters live in the session store: in memory with `MemorySessionStore` and, with `RedisSessionStore` (including [Sessions without configuration](#sessions-without-configuration)), in `<prefix>ratelimit:<resumen>`, with a Lua script that performs `INCR` and `PEXPIRE` atomically across all instances. The key stores a SHA-256 digest of the route and subject, never the plaintext IP or key. If Redis fails, the request is rejected with `500` (_fail closed_) and the error reaches `onError`.
- **Custom store.** A `SessionStore` can implement `rateLimit(key, windowMs)`, which counts one request in fixed window `key` and resolves `{ count, resetInMs }` (type `RateLimitHit`); it must be atomic across instances and reject on failure. Since `1.7`, `SqlSessionStore` implements it when its driver provides `rateLimit` (see [SQL rate limiting](#sql-rate-limiting)); without it, counters live in each instance's or isolate's memory, and Meeko warns once in production.
- A `limit` that is not a positive integer, an invalid `window` or an empty `key` responds with `500 INVALID_RATE_LIMIT`.

### SQL rate limiting

Since `1.7`, an application without Redis shares `rateLimit` counters across instances through its database: `SqlSessionDriver.rateLimit(key, windowMs, now)` is optional and, if the driver implements it, `SqlSessionStore` delegates to it. Without it everything works as through `1.6`: counters in each instance's memory and a production warning.

The semantics match Redis and memory: a **fixed window** per key. The first request opens the window (`count = 1`, `window_ends_at = now + windowMs`); subsequent requests add one and retain its end; the first request after the end resets it. A route changing `window` does not shorten or extend an already open window. The driver returns the resulting row, `{ count, windowEndsAt }` (type `SqlRateLimitRow`; `Number()` accepts a `bigint` returned as text); Meeko calculates `resetInMs = windowEndsAt - now` and, above the limit, responds with `429` and `Retry-After` in seconds rounded up (at least 1). `now` is the instance's clock, as in `replace`. If the statement fails, the request is rejected with `500` (_fail closed_).

`key` arrives as the 32 bytes of the SHA-256 of the counter key, which Meeko already calculates as a SHA-256 digest of the route and subject: the table never stores a plaintext IP or key (including those from manually calling `SessionManager.rateLimit`) and the column has fixed width. The statement must be atomic against concurrent requests from all instances; in PostgreSQL, a single `INSERT … ON CONFLICT DO UPDATE … RETURNING` suffices:

```sql
-- Once, in a migration. UNLOGGED: no WAL, faster; after a server crash
-- the table is emptied and counters restart, which is acceptable for a limit.
CREATE UNLOGGED TABLE IF NOT EXISTS meeko_rate_limits (
  key bytea PRIMARY KEY,
  window_ends_at bigint NOT NULL,
  count integer NOT NULL
);
CREATE INDEX IF NOT EXISTS meeko_rate_limits_window_ends_at ON meeko_rate_limits (window_ends_at);

-- Each rate-limited request: $1 = key, $2 = now, $3 = windowMs.
INSERT INTO meeko_rate_limits AS r (key, window_ends_at, count) VALUES ($1, $2::bigint + $3::bigint, 1)
ON CONFLICT (key) DO UPDATE SET
  count = CASE WHEN r.window_ends_at <= $2 THEN 1 ELSE r.count + 1 END,
  window_ends_at = CASE WHEN r.window_ends_at <= $2 THEN EXCLUDED.window_ends_at ELSE r.window_ends_at END
RETURNING count, window_ends_at;

-- Periodic cleanup (cron, pg_cron or an application task): $1 = now.
DELETE FROM meeko_rate_limits WHERE window_ends_at <= $1;
```

Both `UPDATE` assignments read the previous row, so resetting `count` and `window_ends_at` happens together. A driver with `node-postgres`:

```ts
// server/runtime.ts (excerpt)
import pg from 'pg'
import type { SqlSessionDriver } from '@meekojs/meeko/server'

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
const rateLimitSql = `INSERT INTO meeko_rate_limits AS r …` // the statement above

const driver: SqlSessionDriver = {
	// read, write, remove, replace and revokeFamily, as usual.
	...sessionStatements(pool),
	async rateLimit(key, windowMs, now) {
		const { rows } = await pool.query<{ count: number; window_ends_at: string }>(rateLimitSql, [Buffer.from(key), now, windowMs])
		return { count: rows[0]!.count, windowEndsAt: Number(rows[0]!.window_ends_at) }
	},
}
```

In Cloudflare D1, `D1SessionDriver` implements it with the `rateLimitTable` option (see [Sessions in D1](framework-deployment.md#sessions-in-d1)).

### Client IP behind a proxy

The client IP has two access paths, with the same policy as `rateLimit`:

- **`context.clientAddress`**, wherever there is a `RequestContext`: API, RPC, pages' `<script server>`, server route middleware (`context.clientAddress`) and Socket channels.
- **`clientAddress(request, env?)`** from `@meekojs/meeko/server` (since `1.7`), wherever there is only a `Request`: `defineServerMiddleware` and `addServerHandler` handlers.

```ts
// server/middleware/10-access-log.ts
import { clientAddress, defineServerMiddleware } from '@meekojs/meeko/server'

export default defineServerMiddleware(async (request, next) => {
	// Behind Traefik with MEEKO_TRUST_PROXY=1, the visitor's address rather than the proxy's.
	const ip = clientAddress(request) ?? 'unknown'
	const response = await next()
	console.log(`${request.method} ${new URL(request.url).pathname} ${response.status} ${ip}`)
	return response
})
```

The policy is always the same:

- **Without `MEEKO_TRUST_PROXY`**, the IP is the connection IP provided by the adapter: the remote socket in Node (`serveNode`, `toNodeListener`), `server.requestIP()` in Bun, `remoteAddr` in Deno and `CF-Connecting-IP` in Workers, a header set by Cloudflare's edge that replaces the one sent by the client. `X-Forwarded-For` is never read: behind a proxy, all clients have the proxy's IP.
- **With `MEEKO_TRUST_PROXY=n`**, the IP is the `n`th `X-Forwarded-For` entry from the right, added by the outermost trusted proxy, without its port. Anything the client wrote to its left is ignored. With Traefik (Coolify), Caddy or nginx as the only proxy, `MEEKO_TRUST_PROXY=1`; with a CDN in front of Traefik that adds its entry, `2`. `true` takes the leftmost entry and is only safe if the entry proxy replaces the header. If the selected entry is not an IP, the connection IP is used.
- **With `MEEKO_TRUST_PROXY=cloudflare`** (since `1.8`), the IP is from `CF-Connecting-IP` (or, if absent, `True-Client-IP`), but only if the connection and every `X-Forwarded-For` hop come from the networks in `MEEKO_TRUSTED_PROXIES`; see [Cloudflare Tunnel and Traefik](#cloudflare-tunnel-and-traefik). In Workers nothing changes: the connection IP is already `CF-Connecting-IP`.
- The IP is normalized: IPv6 in lowercase without a zone, and IPv4 mapped into IPv6 (`::ffff:192.0.2.1`) as IPv4. It is `undefined` if unknown, as in a custom host creating its `Request` objects without a Meeko adapter.

Without `env`, `clientAddress` applies `MEEKO_TRUST_PROXY` from the environment of the application handling the request (the `platform.env` received by `ServerApp.fetch`), including on a new request passed to `next()` by middleware. With a request not handled by a `ServerApp`, it only uses the connection IP unless given the environment: `clientAddress(request, process.env)`. An invalid `MEEKO_TRUST_PROXY` throws `TypeError` (and stops application startup); with `cloudflare`, so does an invalid `MEEKO_TRUSTED_PROXIES`.

#### Cloudflare Tunnel and Traefik

With Cloudflare Tunnel, the request arrives as follows: Cloudflare → `cloudflared` → a proxy such as Traefik (Coolify) → the server. Traefik without `trustedIPs` replaces `X-Forwarded-For` with its peer's IP, `cloudflared`, so with `MEEKO_TRUST_PROXY=1` all visitors would share `cloudflared`'s IP and per-client `rateLimit` would be global. Cloudflare does send the visitor IP in `CF-Connecting-IP`, replacing it if the client sends it:

```dotenv
MEEKO_TRUST_PROXY=cloudflare
# Optional. Defaults to loopback and private networks:
# MEEKO_TRUSTED_PROXIES=127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, ::1/128, fc00::/7
```

The header is only valid when the request passed exclusively through your own infrastructure:

- **The connection** must come from a network in `MEEKO_TRUSTED_PROXIES`, where `cloudflared` and Traefik live: a comma- or space-separated list of CIDRs or IPs replacing the defaults (RFC 1918 networks, loopback and ULA `fc00::/7`). If it comes from outside, or the adapter does not know it, the header is ignored and the connection IP is used.
- **Every `X-Forwarded-For` hop**, from right to left, must also come from those networks. The first one that does not is the client seen by a trusted proxy: if someone directly reaches Traefik's public entry point with a forged `CF-Connecting-IP`, Traefik writes their IP into `X-Forwarded-For` and Meeko uses it. A hop that is not an IP returns the connection IP.
- **The value** must be a single IPv4 or IPv6 address, without a port or brackets. A list or arbitrary text returns the connection IP; `True-Client-IP` is only read if `CF-Connecting-IP` is absent.

If the server shares a private network with untrusted clients, restrict `MEEKO_TRUSTED_PROXIES` to the IPs or subnets of `cloudflared` and the proxy, such as Coolify's Docker network (`MEEKO_TRUSTED_PROXIES=10.0.1.0/24, 172.17.0.1`). Include the address from which `cloudflared` reaches the proxy, which the proxy writes in `X-Forwarded-For`: if excluded, Meeko treats it as the client and all visitors share an IP again. The default networks exclude CGNAT (`100.64.0.0/10`, used by Tailscale) and link-local: add them if `cloudflared` arrives through them. `MEEKO_TRUSTED_PROXIES` is only read in `cloudflare` mode.

## Sessions and security

Sessions use random opaque IDs in `HttpOnly`, host-only cookies, with `Secure` and `SameSite=Lax` by default. Each new session also receives an opaque `familyId` that stays unchanged when its ID rotates. `SessionHandle` supports creation, rotation and revocation; rotation and revocation of the entire family require atomic store operations. Thus, logout started with an earlier handle invalidates the active ID even if another request already rotated it. Cookie-authenticated mutations verify Origin and `x-meeko-csrf`; since `1.8`, anonymous mutations verify Origin (see [Origin in anonymous mutations](#origin-in-anonymous-mutations)). SSR and API responses deliver the CSRF token through a same-origin meta tag or header. The application must define identity verification and authorization rules; Meeko does not store authentication secrets in the browser.

`MemorySessionStore` is for development only. `SessionManager({ production: true, store })` requires `persistent: true`, atomic `replace` and `revokeFamily`; an application without `MEEKO_REDIS_URL` or its own `sessions` does not start in production. `RedisSessionStore` accepts a client compatible with `get`, `set` with `PX`, `del` and `eval`; it uses a family index with the active session's TTL. Use a dedicated prefix per application and environment. Earlier Redis records without `familyId` remain readable and acquire a family on their first rotation. `SqlSessionStore` accepts a `SqlSessionDriver` with `read`, `write`, `remove`, transactional `replace`, `revokeFamily`, optional `close` and, since `1.7`, optional `rateLimit` (see [SQL rate limiting](#sql-rate-limiting)). The executable example in `tests/fixtures/fullstack-consumer/server/runtime.ts` uses real SQLite; the framework does not depend on a SQL library or a particular database engine. `SessionManager.close()` disposes of the store when the host owns the resource.

Every custom persistent `SessionStore` must store `familyId` and guarantee atomic `replace` and `revokeFamily` against concurrent requests. Before upgrading, migrate existing records and the indexes needed to locate the active session by family. Do not deploy the new runtime over an old store: in production, construction deliberately fails when safe family rotation and revocation cannot be guaranteed. Since `1.2`, a store can also implement `rateLimit(key, windowMs)` for [`rateLimit`](#rate-limiting-ratelimit) counters.

**Migrating existing SQL drivers:** add a family column to the table (for example, `family_id`), populate existing rows with `family_id = id` and create a unique index on it. `read` and `write` must transfer `SqlSessionRow.familyId`; `replace` must check the same family and replace the row in a transaction; `revokeFamily(familyId)` must delete the active row by family. Migrate the schema before starting the new version. An old driver without `revokeFamily` fails when constructing `SqlSessionStore`; it is not silently accepted in production.

Without `server/runtime.ts`, Meeko does all this for you with `MEEKO_REDIS_URL` (see the next section). For a custom client, install `redis` in the application, create the client with `createClient({ url: process.env.MEEKO_REDIS_URL })`, call `connect()` before serving traffic and pass it to `RedisSessionStore` with a dedicated prefix. The host must close its client with `quit()` on shutdown; `SessionManager.close()` closes the store but does not take ownership of external clients. The `tests/redis.integration.ts` integration test uses a random namespace and deletes only its own keys. It runs against real Redis with `MEEKO_REDIS_URL=redis://127.0.0.1:6379 pnpm exec tsx --test tests/redis.integration.ts`; CI has a dedicated Redis service. Local testing requires accessible Redis and does not use other applications' databases.

### Sessions without configuration

Since `1.2`, an application does not need `server/runtime.ts` for secure sessions. If the file does not exist, or its factory does not return `sessions`, `createServerApp` creates them:

- **Development** (`meeko dev`) and `meeko build` prerendering: `MemorySessionStore`.
- **Production** on Node, Bun and Deno: with `MEEKO_REDIS_URL` (`redis://` or `rediss://`), Meeko imports the project's `redis` package, connects a client and dedicated subscriber (`client.duplicate()`) **before serving traffic**, creates a `RedisSessionStore` with cross-instance revocation and closes both connections on shutdown, after the application's `close`. Install the package with `npm install redis`: the build includes it only if installed, and without it startup fails with a message requesting it. If the first connection fails, startup fails; if it disconnects later, the client reconnects and, meanwhile, requests reading the session fail immediately instead of waiting (_fail closed_). Messages never include the URL, which contains the password.
- **Production without `MEEKO_REDIS_URL`**: the application does not start, as before. Workers has no TCP, so `MEEKO_REDIS_URL` also stops startup: declare a `SessionManager` with D1 or Upstash (see [Cloudflare Workers](framework-deployment.md#cloudflare-workers)).

Keys use the prefix from `MEEKO_REDIS_PREFIX` or, by default, `meeko:<name de package.json>:prod:`. `MEEKO_SESSION_TTL` (`30m`, `12h`, `7d`…; 7 days by default) and `MEEKO_SESSION_SAMESITE` (`Lax` by default, or `Strict`) configure these sessions, including during development; an invalid value stops startup. The cookie retains secure values: `__Host-meeko.sid`, `Secure`, `HttpOnly`, `Path=/` and no `Domain` (host-only). With custom `sessions` in `server/runtime.ts`, these variables do not apply and Meeko warns once.

### Session duration

`SessionManager({ ttlMs })` sets the default duration (7 days). Since `1.2`, `context.session.create(data, { ttlMs })` gives a session its own duration, a positive integer in milliseconds; for example, 30 days for owners and 12 hours for staff. An invalid value rejects with `RangeError` without touching the store. This duration sets the cookie's `Max-Age` and store expiration (`expiresAt`, applied by Redis with `PX` and stored by SQL and D1 in `expires_at`), is saved in `SessionRecord.ttlMs` and is retained by `rotate()`: each rotation counts that duration again from the rotation time.

```ts
const ttlMs = user.role === 'staff' ? 12 * 60 * 60 * 1000 : 30 * 24 * 60 * 60 * 1000
await context.session.create({ userId: user.id }, { ttlMs })
```

Sessions created without `ttlMs`, and records written before `1.2`, use the manager's duration on rotation too. `SqlSessionStore` needs no new column: it derives each row's duration as `expiresAt - createdAt`, so an earlier row retains its original duration on rotation. A custom `SessionStore` must preserve the record's `ttlMs` field if the duration is to survive rotation; if lost, the session rotates with the manager's duration.

### Origin in anonymous mutations

Since `1.8`, **every mutation checks `Origin` by default**, with or without a session cookie: `defineApiRoute`'s `POST`, `PUT`, `PATCH` and `DELETE`, all `defineRpc` calls (always `POST`) and native forms. Through `1.7`, a mutation without a session only checked it with `origin: "required"`, so any anonymous route accepting JSON sent as `text/plain`, or a form, was exposed to CSRF; an endpoint creating a session, such as login, was exposed to _login CSRF_: another website could log the victim's browser into an attacker account.

The rule matches authenticated mutations:

- The request origin is accepted, which after `createServerApp` is the configured `publicOrigin` (or `MEEKO_PUBLIC_ORIGIN`), along with origins in `SessionManager({ allowedOrigins })`. `MEEKO_TRUST_PROXY` only decides which `X-Forwarded-For` address is the client's: neither `X-Forwarded-Host` nor `X-Forwarded-Proto` changes the application's own origin. Behind a TLS-terminating proxy, configure `MEEKO_PUBLIC_ORIGIN`.
- An absent, `null` or foreign `Origin` (another scheme, host or port) responds with `403 INVALID_ORIGIN` before reading or validating input, `rateLimit` and the handler. `Sec-Fetch-Site` and `Referer` do not replace `Origin`: browsers send `Origin` on every `POST`, `PUT`, `PATCH` and `DELETE` request, including same-origin ones, so `Sec-Fetch-Site: same-origin` without `Origin` is also `403`, as with a session. Conversely, an origin in `allowedOrigins` passes even if the browser marks it `cross-site`.
- `GET`, `HEAD` and `OPTIONS` are not checked, because navigation has no `Origin`, and an OAuth callback or magic link arrives from another site. These flows must validate their own `state` or one-time token.
- Calls from `api.*` and `rpc.*` clients during SSR send the current request's origin, so local dispatch keeps working. `createLocalCalls` does the same since `1.8`: it sends the application's origin instead of the original request's `Origin`, so a local mutation works even if the page was requested with `GET` (without `Origin`); with a session it still needs the original request's CSRF token.
- A call from outside the browser (a script, test, native app or service) must send an allowed `Origin` header, or the route must declare `origin: "none"`.

`origin: "required"` (since `1.2`) matches the default and remains valid for making it explicit, for example in login:

```ts
// server/rpc/auth/login.ts
export default defineRpc({
	input: loginInput,
	output: loginOutput,
	origin: 'required',
	handler: async ({ input, context }) => {
		/* … */
	},
})
```

**`origin: "none"` disables checking on a route.** It is the escape hatch for webhooks, public APIs and clients that do not send `Origin`. It is **unsafe** against CSRF and _login CSRF_: use it only with another proof that the request does not come from another website, such as a webhook signature, an API token in `authorization` or an app secret the browser does not have. With `"none"`:

- a request without a session cookie is served with any `Origin`, or none, and `session.create()` can create the session;
- a request with a session still requires `Origin` and the CSRF token;
- a native form (`form`) without a session also does not need `Origin`, for webhooks sending `application/x-www-form-urlencoded` (Twilio, Slack…); with a session, it still requires `Origin` and `_csrf`.

```ts
// server/api/webhooks/payments.post.ts
export default defineApiRoute({
	origin: 'none',
	contentType: 'response',
	handler: async ({ context }) => {
		const payload = await context.request.text()
		if (!(await verifySignature(payload, context.request.headers.get('x-signature')))) throw new ApiError('INVALID_SIGNATURE', 401)
		return new Response(null, { status: 204 })
	},
})
```

A webhook sending `application/x-www-form-urlencoded` (Twilio, Slack) works the same: without `form`, the handler with `contentType: "response"` reads the body with `context.request.formData()`; with `form` and `origin: "none"`, submission without a session also needs no `Origin` and the body is validated with `body` (add `contentType: "response"` to use the handler's response rather than a `303`).

A public API called from other origins with `fetch` and CORS needs, besides `origin: "none"`, CORS headers in its middleware or proxy; Meeko does not add them. Without a session cookie (a token in `authorization`), the visitor's browser provides no credentials another website could exploit.

**`session.create()` protects login even outside guards.** Since `1.2`, on a `POST`, `PUT`, `PATCH` or `DELETE` request, `context.session.create()` only creates the session if the request's `Origin` was already checked (by the route guard or in an authenticated mutation that passed Origin and CSRF) or is allowed at that moment; otherwise, it rejects with `403 INVALID_ORIGIN` without touching the store or sending the cookie. Since `1.8`, the route guard rejects these requests earlier, so this check mainly covers a custom host calling `SessionManager.load` without passing through `executeApiRoute` or `executeRpc`; during development, its first rejection logs a warning. A `SessionHandle` not loaded by `SessionManager.load` (constructed manually) does not know its request and creates the session as before.

Both are incompatible changes published in a minor release as security fixes, under the [stability policy](stability.md#approved-exceptions): the `1.2` change for `session.create()` and the `1.8` change for all mutations. The [`1.8` guide](migration-1.8.md#origin-in-all-mutations) explains what to do with webhooks, public APIs and cross-origin clients.

### Revocation during a request

Revoking a family also stops work that already passed authentication:

- **In-flight requests.** `SessionHandle.signal` aborts with `SessionRevokedError` when its session family is revoked, and `RequestContext.signal` combines that signal with the request's (`AbortSignal.any`, created on first access). Both signals abort even if the code only retains the signal rather than the handle or context. Pass `context.signal` to `fetch`, queries and other cancelable operations. `SessionRevokedError` is an `ApiError` with code `SESSION_REVOKED` and status `401`; if it escapes the handler, the response is that `401`. The request calling `revoke()` does not abort, because it must send the empty cookie.
- **Open sockets.** Socket connections whose handshake session belongs to the revoked family close immediately with `1008` ("Session revoked"), without waiting for another event.
- **Other instances.** Within the same instance, `revoke()` always aborts. To reach other instances, the store implements `subscribeRevocations(listener)`, returning or promising an `Unsubscribe`. `RedisSessionStore` provides it when given `subscriber` (a dedicated connection, for example `client.duplicate()`). The `revokeFamily` script publishes `familyId` to `<prefix>revoked` in the same atomic operation that deletes the session. `MemorySessionStore` notifies `SessionManager` instances sharing it within the same process. `SqlSessionStore` has no notification: without it, other instances only detect revocation when rereading the store.
- **Subscription startup.** `SessionManager` subscribes on the first call to `load` and waits for confirmation before authenticating. If subscribing fails, `load` rejects that request and the next one retries. `SessionManager.close()` cancels the subscription.

Notification is asynchronous: between deletion in the store and notification arrival, another instance may keep executing code. Before an irreversible effect (a payment, sending something, deletion), call `await context.session.verify()`. It rereads the store and throws `SessionRevokedError` if the session was revoked, replaced by rotation or expired; without a session, it does nothing.

Known notification limitations:

- **Disconnected Redis subscriber.** Redis pub/sub does not store messages: revocations published while an instance's `subscriber` is disconnected are lost for that instance, even if node-redis restores the subscription on reconnection. Store deletion is atomic, so those sessions become invalid as soon as reread: every new request and every Socket event rereads the session, and broadcast delivery rereads it if more than `sessionRefreshMs` has passed since the last read. What remains undetected is work already authenticated on that instance: an in-flight request does not abort and an idle socket stays open until its next event or delivery. Use `verify()` before irreversible effects and monitor Redis client reconnection events.
- **Recent revocation window.** Each instance remembers revoked families for 60 seconds, up to 4096; with more revocations in that window, it forgets the oldest first. A handle whose record was read before the notification and created after its family leaves this memory does not abort on registration, but `verify()` and the next reread detect revocation, because the record no longer exists.
- **Forgeable notifications.** Anyone with Redis `PUBLISH` permission can publish a `familyId` to `<prefix>revoked`. The notification neither deletes data nor grants access, but it aborts in-flight requests and closes that family's sockets across all instances (denial of service). Restrict who can publish to that channel with Redis ACLs.

A storage outage propagates an error and grants no access. Do not use an in-memory store in production. `Secure` requires HTTPS in deployment; configure the proxy and `MEEKO_PUBLIC_ORIGIN` to match the public origin.
