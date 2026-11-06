---
source-hash: 7f14300bfb05b93be4719b0c03393bbc2b3080eb0580e97aa719eafd74db5e54
---

# Route middleware

Route middleware runs before page data loads. It differs from HTTP middleware in `server/middleware`, which also wraps API and RPC. [See HTTP middleware](framework.md#server-middleware).

| File                         | Runs                | Common use                                    |
| ---------------------------- | ------------------- | --------------------------------------------- |
| `app/middleware/*.ts`        | Server and browser. | Improve navigation or redirect early.         |
| `app/middleware/*.server.ts` | Server only.        | Check session and access before sending data. |

Both kinds can be global or selected per route. A page guard does not automatically authorize its API or RPC endpoints.

## Named middleware

Declare `defineRouteMiddleware(fn, { global: false })` in `app/middleware/auth.ts` and select `middleware: ['auth']` in `definePage` or `+group.ts`. Without `{ global: false }`, it runs globally on every route.

Globals run first, followed by named middleware inherited or declared by the page. `middleware: false` removes inherited ones, not globals. [See order, inheritance and errors](routing-middleware-reference.md#named-middleware).

## Server route middleware

To read the session, use `defineServerRouteMiddleware` in `app/middleware/auth.server.ts`. It does not enter the browser bundle; it runs before the page's server code or `load`.

```ts
// app/middleware/auth.server.ts
import { redirect } from '@meekojs/meeko/framework'

export default defineServerRouteMiddleware(
	({ session }) => {
		if (!session.current) redirect('/login')
	},
	{ global: false },
)
```

Select `middleware: ['auth']` in protected pages or groups. Also validate each API or RPC the page uses. [See context, rendering modes and custom hosts](routing-middleware-reference.md#server-route-middleware).
