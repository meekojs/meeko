# Meeko server: config, API, RPC, middleware, auth, WebSocket, deploy

Applies to `@meekojs/meeko` 1.9.x. The server half of a Meeko app uses file conventions. Contracts (schemas) are public and live in `shared/`. Handlers are private and live in `server/`. Meeko generates typed `api.*`, `rpc.*` and `socket.*` clients from them.

## Project layout (server side)

```text
meeko.config.ts                 defineMeekoConfig (runs in Node only)
shared/schemas/*.ts             Standard Schema (Valibot recommended): public, browser-safe
server/api/**/<name>.<method>.ts   defineApiRoute  -> /api/...
server/rpc/**/<name>.ts         defineRpc       -> POST /_meeko/rpc/<path>, rpc.<a>.<b>()
server/socket/<channel>.ts      defineSocketChannel -> /_meeko/socket/<channel>
server/middleware/NN-name.ts    defineServerMiddleware (HTTP, runs by file name, before the session exists)
server/runtime.ts               defineServerRuntime (services, sessions, socket, onError, close)
server/utils/*.ts               private helpers (auto-imported, server scope)
server/types/session.d.ts       MeekoSession augmentation
app/middleware/*.server.ts      defineServerRouteMiddleware (page guards that have the session)
app/plugins/*.server.ts         server-only app plugin
```

- Method suffixes: `.get`, `.post`, `.put`, `.patch`, `.delete`. Nothing else is accepted.
- `server/api/users/index.get.ts` maps to `GET /api/users`. `server/api/users/[id].get.ts` maps to `GET /api/users/:id`. `[...path]` is a catch-all.
- `server/rpc/users/get.ts` is the procedure `users.get`.
- Aliases: `#shared/` = `shared/`, `#server/` = `server/` (server scope only), `~/` = project root and `@/` = `app/`.
- Auto-imported in `server/`, so no import is needed: `defineApiRoute`, `defineRpc`, `defineServerMiddleware`, `defineSocketChannel`, `defineServerRuntime`, `ApiError`, `defer` and `defineServerRouteMiddleware`. You can still import them explicitly from `@meekojs/meeko/server`. Explicit imports are clearer and always valid.
- Auto-imported generated clients: `api`, `rpc`, `socket`, `useApi`, `useRpcQuery`, `useRpcMutation`, `useApiMutation` and `useSocket`. In app code, `ClientError` and `isClientError` are also auto-imported.
- Validation library: any [Standard Schema](https://standardschema.dev) library works (Valibot, Zod, ArkType). Install it with `npm install valibot`.

## meeko.config.ts

```ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	document: { lang: 'en' },
	site: 'https://example.com', // origin for sitemap/robots/SEO absolute URLs (not Origin checks)
	modules: ['@meekojs/ui', '@meekojs/i18n', './modules/accent'], // names/paths only, never imports
	i18n: { defaultLocale: 'es', catalogs: { es: 'app/locales/es.json', en: 'app/locales/en.json' } },
	ui: { defaults: { button: { shape: 'pill' } } },
	layers: ['./layers/base'], // folders with app/pages, components, server/utils...
	imports: { serverDirs: ['server/services'], sharedDirs: ['shared/validators'], appDirs: ['app/services'] },
	alias: { '#db/': './server/db/' },
	server: {
		adapter: 'node', // 'node' | 'bun' | 'deno' | 'cloudflare' | 'static'
		host: '127.0.0.1', // node only; MEEKO_HOST overrides
		port: 4173, // node only; MEEKO_PORT / PORT override
		contentSecurityPolicy: { 'default-src': ["'self'"], 'script-src': ["'self'"], 'object-src': ["'none'"] },
		headers: { 'X-Content-Type-Options': 'nosniff', '/admin/*': { 'X-Robots-Tag': 'noindex' } },
	},
	dev: { serverLogs: true },
	devtools: false,
})
```

- Each module's options go under that module's own `configKey` (`i18n`, `ui`, ...). A key whose module is missing from `modules` is ignored and produces warning `MEEK127`.
- Modules are created with `defineMeekoModule({ meta: { name, configKey }, defaults, setup(options, meeko) })` from `@meekojs/meeko/framework`. `setup` runs only in Node. Useful hooks: `meeko.addServerMiddleware(file)`, `addServerHandler({ route, handler })`, `addPlugin`, `addAutoImports`, `addComponentsDir`, `addLayer` and `addHead`. Only `meeko.config.ts` may import a module.
- There is no `runtimeConfig`. Read secrets on the server from `env` in `server/runtime.ts` or from `process.env` in server code.
- CSP is added only in production builds: a nonce on SSR pages and hashes on prerendered or cached pages. API and RPC JSON responses always get `default-src 'none'`.

## Schemas in shared/

```ts
// shared/schemas/user.ts
import * as v from 'valibot'
export const userParams = v.object({ id: v.string() })
export const userSchema = v.object({ id: v.string(), name: v.string() })
export const newUser = v.object({ name: v.pipe(v.string(), v.minLength(1, 'Enter a name.')) })
export const listQuery = v.object({ page: v.optional(v.pipe(v.string(), v.toNumber())) })
```

- Contract schemas (`params`, `query`, `body`, `response`, `input`, `output`) must be **imported from `shared/`**. They are read statically, so the handler is never imported into the client. A schema declared in the handler or under `server/` fails with `output debe venir de shared/`.
- Since 1.8, API and RPC contracts may also use a simple composition such as `v.array(userSchema)` or `v.optional(x)`. They may not use functions, `v.transform`, local variables or operators. Socket schemas must be plain exports from `shared/`.
- `any`, `unknown`, `never` and unresolved generics are rejected in public contracts.
- `params` must describe exactly the dynamic segments, as required strings. Static routes have no `params`.
- `query` fields receive `string | string[]`. Convert numbers inside the schema with `v.pipe(v.string(), v.toNumber())`.
- Write your own error messages. Some default Valibot messages echo the received value back to the user.

## API routes: defineApiRoute

```ts
// server/api/users/[id].get.ts
import { ApiError, defineApiRoute } from '@meekojs/meeko/server'
import { userParams, userSchema } from '#shared/schemas/user'

export default defineApiRoute({
	params: userParams,
	response: userSchema,
	handler: async ({ params, context }) => {
		const user = await context.services.db.users.find(params.id, { signal: context.signal })
		if (!user) throw new ApiError('USER_NOT_FOUND', 404)
		return { id: user.id, name: user.name } // validated against `response`; extra/invalid -> 500
	},
})
```

```ts
// server/api/users/index.post.ts
export default defineApiRoute({
	auth: 'required', // 401 UNAUTHENTICATED without a session
	authorize: ({ session }) => session.current?.data.role === 'admin', // false -> 403 FORBIDDEN
	body: newUser,
	response: userSchema,
	status: 201, // literal only: 200 | 201 | 202 | 204
	rateLimit: { limit: 20, window: '1m' }, // 429 RATE_LIMITED + Retry-After; key defaults to client IP
	locals: async ({ session }) => ({ actor: await findUser(session.current!.data.userId) }), // declare BEFORE handler
	handler: ({ body, locals }) => createUser(locals.actor, body),
})
```

```ts
// server/api/users/[id].delete.ts: 204 has no `response`, and the handler returns nothing
export default defineApiRoute({ params: userParams, auth: 'required', status: 204, handler: async ({ params }) => { await deleteUser(params.id) } })
```

```ts
// server/api/export.get.ts: return your own Response (CSV, file, stream, HTML)
export default defineApiRoute({
	contentType: 'response',
	auth: 'required',
	handler: async ({ context }) => new Response(await buildCsv(context), { headers: { 'content-type': 'text/csv' } }),
})
```

Option summary: `params`, `query`, `body` (JSON, 1 MiB), `response` (required unless the route uses `status: 204` or `contentType: 'response'`), `status`, `auth: 'required' | 'optional'`, `authorize(context) => boolean`, `origin: 'required' | 'none'`, `rateLimit: { limit, window, key? }`, `locals(context)`, `contentType: 'json' | 'response'`, `form` (native `<form method="post">`, since 1.7) and `handler({ params, query, body, context, locals })`.

Request pipeline order: Origin check (every mutation) → session Origin + CSRF → `rateLimit` → `auth` → `authorize` → input validation → `locals` → `handler` → `response` validation.

`context` is the `RequestContext`. It has these fields: `request`, `requestId`, `session` (`SessionHandle`), `services` (typed from `server/runtime.ts`), `platform` (`{ name, env, waitUntil }`), `signal` (aborts on client disconnect or session revocation), `state`, `clientAddress` and `idempotencyKey`.

### Webhook / public endpoint (unsafe escape hatch)

```ts
// server/api/webhooks/payments.post.ts
export default defineApiRoute({
	origin: 'none', // disables the Origin check for session-less requests ONLY; require another proof
	contentType: 'response',
	handler: async ({ context }) => {
		const raw = await context.request.text()
		if (!(await verifySignature(raw, context.request.headers.get('x-signature')))) throw new ApiError('INVALID_SIGNATURE', 401)
		return new Response(null, { status: 204 })
	},
})
```

Meeko does not add CORS headers. For a cross-origin public API, add them in server middleware or at your proxy.

## RPC: defineRpc

```ts
// server/rpc/orders/create.ts  -> rpc.orders.create(input), POST /_meeko/rpc/orders/create
import { ApiError, defineRpc } from '@meekojs/meeko/server'
import * as v from 'valibot'
import { newOrder, orderSchema } from '#shared/schemas/order'

export default defineRpc({
	input: newOrder, // 400 INVALID_INPUT with issues
	output: orderSchema, // or v.array(orderSchema)
	auth: 'required',
	rateLimit: { limit: 10, window: '1m' },
	locals: async ({ session }) => {
		const user = await findUser(session.current!.data.userId)
		if (!user) throw new ApiError('UNAUTHENTICATED', 401)
		return { user }
	},
	handler: ({ input, locals, context }) => createOrder(locals.user, input),
})
```

RPC has no `status`, `params`, `query`, `contentType` or `form`. Calls are always `POST` and always return `200` with the output. Use `defineApiRoute` when you need resource URLs, HTTP status codes, non-JSON responses or no-JS forms. Use RPC for actions inside the app.

## Calling API/RPC from the app

```ts
// Anywhere in app code (also <script server>, where it dispatches locally with the same session)
const users = await api.users.get({ query: { page: '2' } })
const user = await api.users({ id }).get() // dynamic segment = call with its param
await api.users({ id }).delete() // 204 -> undefined
await api.orgs({ org }).users({ id }).get()
const order = await rpc.orders.create({ item: 'tea', qty: 2 }, { signal, idempotencyKey: crypto.randomUUID() })
```

```html
<script lang="ts">
	const props = defineProps<{ params: { id: string } }>()
	const user = await useApi('/api/users/[id]', { params: { id: props.params.id } }) // SSR-awaited, data non-null
	const stats = useRpcQuery('stats.summary') // no await: loads in browser, data starts null
	const rename = useRpcMutation('users.rename') // never await at top level (MEEK055)
	const remove = useApiMutation('/api/users/[id]', 'DELETE')
	async function save(name: string) {
		try {
			await rename.mutate({ id: props.params.id, name })
			await user.refresh()
		} catch (error) {
			if (isClientError(error, 'UNAUTHENTICATED')) location.assign('/login')
		}
	}
</script>
<template>
	<h1>{user.data.value.name}</h1>
	<MeekoAwait for="stats"><p>{stats.data.value.total}</p></MeekoAwait>
	<p if:when="rename.error.value">Could not save.</p>
</template>
```

- `useApi(path, options?, { keepPrevious, debounceMs, enabled })` returns `{ data, error, pending, refreshing, refresh }`. Only `GET` routes are allowed, and `path` uses bracket syntax.
- `useRpcQuery(id, input | () => input, opts)` returns the same shape. Signals in the input trigger a refetch.
- `useRpcMutation(id, { retrySafe?, onSuccess?, onError? })` and `useApiMutation(path, 'POST' | 'PUT' | 'PATCH' | 'DELETE')` return `{ mutate, data, error, pending }`. Use `retrySafe: { key }` for payments and similar writes: it sends an `Idempotency-Key` header, and the server deduplicates using `context.idempotencyKey`.
- With `await`, data loads during SSR and is sent in the hydration payload. The input must depend only on props, route data or state. Otherwise hydration fails with `MEEKO_RESOURCE_MISSING`.
- The browser client sends the CSRF token (from the `meeko-csrf-token` meta tag) and the Origin automatically. Do not hand-roll `fetch('/api/...')` for your own endpoints.

## Errors

Server side: throw `ApiError(code, status, message | { message, issues })`.

```ts
throw new ApiError('EMAIL_TAKEN', 409, {
	message: `duplicate ${body.email}`, // internal only, never sent
	issues: [{ path: 'email', message: 'That email already has an account.' }], // public, 4xx only, max 20
})
```

- Response body: `{ code, status, requestId, issues? }` plus an `x-request-id` header.
- Any error that is not an `ApiError` becomes `500 INTERNAL_ERROR` with no message, so server details never leak.
- If a handler result fails `response`/`output` validation, the response is `500`.
- Only `5xx` errors reach the runtime `onError`.
- Built-in codes: `INVALID_PARAMS`, `INVALID_QUERY`, `INVALID_BODY`, `INVALID_INPUT` (400, with `issues: [{ path, message }]`), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `INVALID_ORIGIN` (403), `INVALID_CSRF` (403), `RATE_LIMITED` (429), `UNSUPPORTED_MEDIA_TYPE` (415), `BODY_TOO_LARGE` and `SESSION_REVOKED` (401).

Client side: failures arrive as `ClientError` (`code`, `status`, `requestId`, `issues`). Import it from `@meekojs/meeko/framework`; it is auto-imported in app code.

```ts
import { ClientError, isClientError } from '@meekojs/meeko/framework'
if (isClientError(error, 'RATE_LIMITED')) showRetryLater()
const fieldMsg = error instanceof ClientError ? error.issues?.find((i) => i.path === 'email')?.message : undefined
```

`useForm({ schema, initial, submit: (values) => api.x.post({ body: values }) })` distributes these `issues` to each form field.

## Server middleware (HTTP)

```ts
// server/middleware/10-security-headers.ts  (runs in file-name order; use numeric prefixes)
import { clientAddress, defineServerMiddleware } from '@meekojs/meeko/server'

export default defineServerMiddleware(async (request, next) => {
	if (blocked.has(clientAddress(request) ?? '')) return new Response(null, { status: 403 })
	const response = await next() // call at most once; may pass a new Request
	const headers = new Headers(response.headers)
	headers.set('x-frame-options', 'DENY')
	return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
})
```

- Server middleware wraps SSR pages, `/api` and `/_meeko/rpc`. It does **not** wrap public assets or WebSocket upgrades.
- It runs before the request context exists: there is no `session` or `services`.
- It must always return a `Response`.
- Use `clientAddress(request)` to get the client IP. Never read `X-Forwarded-For` yourself.

Page guards that need the session go in `app/middleware/*.server.ts`:

```ts
// app/middleware/auth.server.ts
import { defineServerRouteMiddleware, redirect } from '@meekojs/meeko/framework' // redirect is NOT auto-imported here

export default defineServerRouteMiddleware(({ session, url }) => {
	if (!session.current) redirect(`/login?next=${encodeURIComponent(url.pathname)}`)
}, { global: false }) // named "auth"; must be an object literal
```

```ts
// app/pages/(dashboard)/+group.ts
export default defineGroup({ middleware: ['auth'] })
```

- Every `*.server.ts` file in `app/middleware` must be middleware. Put helpers in `server/utils`.
- Server route middleware does not run on `render: 'prerender'` or `'client'` pages.
- It **protects pages only**. API and RPC routes still need their own `auth` and `authorize` guards.

## Server runtime: server/runtime.ts

This file is optional. Without it, sessions are created automatically (see below).

```ts
// server/runtime.ts
import { defineServerRuntime, LocalSocketPubSub, SessionManager } from '@meekojs/meeko/server'

export default defineServerRuntime(async ({ env, production, prerendering, platform, root }) => {
	const db = await createDatabase(env.DATABASE_URL)
	return {
		sessions: new SessionManager({ store: db.sessionStore(), production: production && !prerendering, ttlMs: 7 * 864e5, allowedOrigins: [] }),
		services: { db }, // or (request, { platform }) => ({ db, region: platform.env.REGION })
		socket: { pubsub: new LocalSocketPubSub(), maxMessageBytes: 64 * 1024, allowedOrigins: [] },
		publicOrigin: env.MEEKO_PUBLIC_ORIGIN,
		onError: (error, requestId, info) => logger.error({ requestId, kind: info?.kind }, error), // 5xx + process failures
		processErrors: { unhandledRejection: 'report' }, // uncaughtException defaults to 'shutdown'
		close: () => db.close(),
	}
})
```

- The type of `context.services` is inferred from this file (since 1.7), so no casts are needed.
- Use `root` (project root, since 1.8) to read project files. Do not use `import.meta.url` or `process.cwd()` for this.
- Use `context.platform.waitUntil(promise)` for background work after the response.

## Sessions and auth

- **Zero config (since 1.2).** In development, sessions are stored in memory. In production on Node, Bun or Deno, set `MEEKO_REDIS_URL` and install `redis` (`npm install redis`). Production refuses to start without a persistent store.
- **Session cookie.** `__Host-meeko.sid` is opaque, `HttpOnly`, `Secure`, `SameSite=Lax` and host-only.
- **Session environment variables.** `MEEKO_SESSION_TTL` (for example `7d`), `MEEKO_SESSION_SAMESITE` and `MEEKO_REDIS_PREFIX`. They apply only with zero-config sessions, not with a custom `SessionManager`.
- **Stores.** `MemorySessionStore` is for development only. Use `RedisSessionStore(client, { prefix, subscriber })` for cross-instance revocation, `SqlSessionStore(driver)` for SQL, or `D1SessionDriver` on Cloudflare.

Type the session once:

```ts
// server/types/session.d.ts
import type {} from '@meekojs/meeko/server'
declare module '@meekojs/meeko/server' {
	interface MeekoSession {
		userId: string
		role: 'owner' | 'staff'
	}
}
```

Login and logout:

```ts
// server/api/auth/login.post.ts
import { hashPassword, needsRehash, verifyPassword } from '@meekojs/meeko/password' // Node/Bun/Deno only, NOT Workers
import { loginInput, okResult } from '#shared/schemas/auth'

let dummy: Promise<string> | undefined
const dummyHash = () => (dummy ??= hashPassword('timing-dummy')) // compare even when the user does not exist

export default defineApiRoute({
	body: loginInput,
	response: okResult,
	origin: 'required', // default since 1.8; explicit for login
	rateLimit: { limit: 5, window: '5m' },
	handler: async ({ body, context }) => {
		const user = await context.services.db.users.byEmail(body.email)
		const ok = await verifyPassword(body.password, user?.passwordHash ?? (await dummyHash())) // always verify (timing)
		if (!user || !ok) throw new ApiError('INVALID_CREDENTIALS', 401)
		if (needsRehash(user.passwordHash)) await context.services.db.users.setHash(user.id, await hashPassword(body.password))
		await context.session.create({ userId: user.id, role: user.role }, { ttlMs: 12 * 3600e3 }) // rotates ID
		return { ok: true as const }
	},
})
```

```ts
// server/api/auth/logout.post.ts
export default defineApiRoute({ auth: 'required', status: 204, handler: async ({ context }) => { await context.session.revoke() } })
```

- `SessionHandle` provides `current?.data`, `create(data, { ttlMs? })`, `rotate()`, `revoke()` (revokes the whole family, on every instance), `verify()` and `signal`.
- Call `await context.session.verify()` before irreversible effects such as payments or deletes.
- Pass `context.signal` to `fetch` and DB calls so they abort when the session is revoked.
- To generate a password hash for `.env`, run `npx meeko auth hash`. The output looks like `ADMIN_PASSWORD_HASH=scrypt$131072$8$1$...`.
- In a page, read the session from `<script server>` with `const { context } = usePage(); const s = context.session.current; if (!s) redirect('/login')`.
- Behind a proxy, set `MEEKO_PUBLIC_ORIGIN=https://example.com` (it drives the Origin checks). Also set `MEEKO_TRUST_PROXY=1` (number of trusted hops) so `rateLimit` uses the real client IP, or `MEEKO_TRUST_PROXY=cloudflare` behind Cloudflare Tunnel.

## WebSocket channels

```ts
// shared/schemas/chat.ts
export const chatInput = v.object({ text: v.pipe(v.string(), v.maxLength(500)) })
export const chatMessage = v.object({ text: v.string(), from: v.string() })
```

```ts
// server/socket/chat.ts  -> /_meeko/socket/chat?room=<roomId>
import { defineSocketChannel } from '@meekojs/meeko/server'
import { chatInput, chatMessage } from '#shared/schemas/chat'

export default defineSocketChannel({
	clientToServer: { message: chatInput }, // shorthand { chatInput } if the event has the same name
	serverToClient: { message: chatMessage },
	auth: 'required', // rejected -> close 4401, client state 'unauthorized' (no retry)
	authorize: ({ context, roomId }) => canJoin(context.session.current!.data.userId, roomId), // false -> 4403
	authorizeEvent: ({ event, payload, context, roomId }) => true, // per incoming event
	authorizeSend: ({ event, context, roomId }) => true, // per outgoing delivery; false = skip this peer
	handlers: {
		message: async ({ payload, context, roomId, emit }) => {
			await socket.chat.broadcast(roomId ?? '', 'message', { text: payload.text, from: context.session.current!.data.userId })
		},
	},
})
```

Client side (in a component):

```html
<script lang="ts">
	const messages = signal<string[]>([])
	const chat = await useSocket('chat', { roomId: 'general' }) // rest of setup runs in browser, socket open
	chat.on('message', (m) => { messages.value = [...messages.value, m.text] })
	const send = (text: string) => chat.emit('message', { text }) // rejects if not open: no queue, at-most-once
</script>
```

- Without `await`, `useSocket` returns an inert client during SSR (since 1.7). `chat.state` is a signal with values `'connecting' | 'open' | 'closed' | 'unauthorized'`. The connection closes when the component unmounts.
- To broadcast from API or RPC handlers, use `await socket.<channel>.broadcast(roomId, event, payload)`. It is validated against `serverToClient`. It works only inside a request or socket handler. For startup tasks, use `app.socket.hub`.
- Message limit: 64 KiB. Invalid incoming messages close the channel.
- For multiple instances, set `socket: { pubsub: new RedisSocketPubSub({ publisher, subscriber, prefix }) }`. On Cloudflare, Durable Objects are used automatically.
- For external URLs, use `useSocketClient(url, contract)` (bound to the component) or `createSocketClient` from `@meekojs/meeko/framework`.

## Adapters and deployment

```sh
npx meeko dev            # dev server, 127.0.0.1:4173 (MEEKO_PORT/MEEKO_HOST)
npx meeko check          # manifests + client/server/shared type projects (run before build)
npx meeko routes .       # regenerate .meeko/generated clients/contracts
npx meeko build          # adapter from --adapter or server.adapter, default node
npx meeko start          # run .meeko/output/node/index.mjs (or: node .meeko/output/node/index.mjs)
npx meeko preview --adapter <name>
```

| Adapter      | Build                                                            | Run in production                                                                             | Notes                                                                                                                                                 |
| ------------ | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `node`       | `meeko build` → `.meeko/output/node/`                            | `meeko start` / `node .meeko/output/node/index.mjs`                                           | Needs `node_modules` (incl. `@meekojs/meeko`). Custom host: `serveNode(app, { host, port, publicOrigin, handleSignals })` from `@meekojs/meeko/node`. |
| `bun`        | `meeko build --adapter bun` → `.meeko/output/bun/`               | `bun .meeko/output/bun/index.js`                                                              | Self-contained, with no `node_modules`. Custom host: `Bun.serve({ port, ...createBunServer(app) })` from `@meekojs/meeko/bun`.                        |
| `deno`       | `meeko build --adapter deno` → `.meeko/output/deno/`             | `deno run --allow-net --allow-env --allow-read=.meeko/output/deno .meeko/output/deno/main.js` | Self-contained. Custom host: `serveDeno(app, opts)` from `@meekojs/meeko/deno`.                                                                       |
| `cloudflare` | `meeko build --adapter cloudflare` → `.meeko/output/cloudflare/` | `npx wrangler deploy --config .meeko/output/cloudflare/wrangler.jsonc`                        | `wrangler.jsonc` is generated; do not edit it. Configure through `server.wrangler`. No TCP Redis and no `/password`.                                  |
| `static`     | `meeko build --adapter static` → `.meeko/output/static/`         | any static host                                                                               | Every page needs `render: 'prerender'`. No API, RPC, socket, `server/middleware` or SSR (the build fails if any exists).                              |

Production environment variables: `MEEKO_PUBLIC_ORIGIN`, `MEEKO_REDIS_URL`, `MEEKO_HOST=0.0.0.0` (to accept remote traffic), `MEEKO_PORT`/`PORT` and `MEEKO_TRUST_PROXY`. `meeko start` does not compress responses, so put a proxy or CDN in front for Brotli/gzip and TLS.

Cloudflare: in `server/runtime.ts`, `env` holds the Worker bindings. Use D1 for sessions:

```ts
// meeko.config.ts
server: { adapter: 'cloudflare', name: 'my-app', wrangler: { d1_databases: [{ binding: 'DB', database_name: 'my-app', database_id: '<id>' }], vars: { MEEKO_PUBLIC_ORIGIN: 'https://my-app.example' } } }
```

```ts
// server/runtime.ts
import { D1SessionDriver } from '@meekojs/meeko/cloudflare'
import type { D1DatabaseLike } from '@meekojs/meeko/cloudflare'
import { defineServerRuntime, MemorySessionStore, SessionManager, SqlSessionStore } from '@meekojs/meeko/server'

export default defineServerRuntime<{ DB?: D1DatabaseLike }>(({ env, production, prerendering }) => ({
	sessions: new SessionManager({
		production: production && !prerendering,
		store: prerendering || !env.DB ? new MemorySessionStore() : new SqlSessionStore(new D1SessionDriver(env.DB)),
	}),
}))
```

`D1SessionDriver.schema()` returns the session table SQL. Apply it with `wrangler d1 migrations` before you deploy. Do not delete the generated `meeko-socket-v1` Durable Object migration.

## Common mistakes

- **Schema not in `shared/`.** Do not define `v.object(...)` inline in a handler or import it from `server/`. Contract generation fails because the handler's private code would have to reach the client. Export the schema from `shared/` and import it with `#shared/...`.
- **Importing server code into the client.** A value import of `server/**`, `#server/*` or any `*.server.ts` from a component, `app/*.ts` or `shared/` fails the build (`Server-only module reached the client bundle`, `MEEK108`). Call the server through `api`/`rpc` instead. Type-only reads can use `~/server/...`.
- **Secrets in `shared/` or `app/`.** Both are bundled for the browser. Keep DB clients, API keys and `process.env` reads in `server/` or `<script server>`.
- **Missing API guards.** Guarding a page with `app/middleware/*.server.ts` or `<script server>` does not protect the `api`/`rpc` endpoints it calls. Every private endpoint needs `auth: 'required'` and `authorize`, and must check ownership (for example `params.id` against `session.current.data.userId`).
- **Trusting the client.** Never trust IDs or roles sent by the client. Derive the user from `context.session.current` (or `locals`), not from `body.userId`.
- **Misusing `origin: 'none'`.** Do not use it to "fix" a 403 `INVALID_ORIGIN` from a script or test. Have the caller send an allowed `Origin`, or configure `MEEKO_PUBLIC_ORIGIN` or `SessionManager({ allowedOrigins })`. Use `'none'` only with a signature or token check.
- **Leaking error details.** Do not return internal errors in the response (`return { error: e.message }`). Throw `ApiError(code, status)` and put internal detail in the message argument, which is never sent. Use `issues` for public per-field text.
- **Missing `response`.** A JSON route must declare `response`, because the handler result is validated. Leaking extra fields such as `passwordHash` fails validation (500), so map the result to the public shape.
- **Wrong `status` usage.** `status` must be a literal, `204` routes cannot declare `response`, and `status` cannot be combined with `contentType: 'response'`. RPC has no `status`.
- **`locals` after `handler`.** Declare `locals` before `handler`, or TypeScript loses its inferred type in the handler.
- **Broken server middleware.** It must return a `Response` and call `next()` at most once. It has no session; use route middleware or API guards for that.
- **Missing `redirect` import.** Import `redirect`/`notFound` from `@meekojs/meeko/framework` in `app/middleware/*.server.ts`; they are auto-imported only in `<script server>`. Never call them inside API or RPC handlers (`MEEK073`); throw `ApiError` instead.
- **Spoofable client IP.** Do not read `x-forwarded-for` manually. Use `clientAddress(request)` or `context.clientAddress`, and set `MEEKO_TRUST_PROXY` correctly.
- **Production without persistent sessions.** Without `MEEKO_REDIS_URL` or a persistent `SessionManager`, the app refuses to start. Never use `MemorySessionStore` in production.
- **Missing `MEEKO_PUBLIC_ORIGIN` behind a TLS proxy.** Without it, every mutation and socket fails Origin checks.
- **Password hashing on Workers.** `@meekojs/meeko/password` (scrypt, 128 MiB) does not work on Cloudflare Workers. Delegate hashing there. Always run `verifyPassword` even for unknown users, and combine login with `rateLimit`.
- **Sensitive fields in `form.echo`.** Never echo passwords, cards or tokens in `form.echo`.
- **Wrong top-level `await`.** `await useRpcMutation(...)` and `await useApiMutation(...)` at top level are errors (`MEEK055`). Await `mutate()` inside handlers.
- **Unguarded socket channels.** Without `auth` and `authorize`, any visitor can join any room. Validate `roomId` in `authorize`, because the client chooses it.
- **Calling `broadcast` outside a request.** Calling it from a startup timer outside any request throws. Use `app.socket.hub`, or `createServerSocketRegistry(contracts, { hub })`.
