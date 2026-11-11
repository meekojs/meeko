---
source-hash: 9d3475f1a95aea648be5c4d5ef61f78c74e530dcd1d7e0a60d7b4d12f9965d35
---

# Route middleware: technical details

Full contracts and edge cases. For common usage, start with the [short guide](routing-middleware.md).

## Named middleware

Declare a guard affecting only part of the application as named middleware, requested by the routes that need it, without comparing `match.route.id` or file paths:

```ts
// app/middleware/auth.ts
export default defineRouteMiddleware(
	({ url, phase, request }) => {
		// A public cookie indicating the session: Meeko's session cookie is HttpOnly.
		const cookies = phase === 'server' ? (request.headers.get('cookie') ?? '') : document.cookie
		if (!cookies.includes('signed-in=1')) {
			const login = new URL('/login', url)
			login.searchParams.set('next', url.pathname)
			return Response.redirect(login)
		}
	},
	{ global: false },
)
```

```ts
// app/pages/(dashboard)/+group.ts: all pages in the group
export default defineGroup({ layout: 'dashboard', middleware: ['auth'] })
```

```html
<!-- app/pages/(dashboard)/admin/users.meeko: the page adds its own -->
<script
	server
	lang="ts"
>
	export const route = definePage({ middleware: ['admin'] })
</script>
<template><h1>Users</h1></template>
```

- **Name.** The file path inside `app/middleware`, without `.ts` or each part's numeric ordering prefix: `auth.ts` and `10-auth.ts` are `"auth"`, and `admin/20-role.ts` is `"admin/role"`. Letters, digits, `-` and `_`, and `/` between folders. Two files producing the same name, if either is named middleware, stop discovery.
- **Inheritance.** `middleware` accumulates from outside inward: outer `+group.ts` files, inner ones and the page, without duplicates (the first occurrence counts). `middleware: false` in a group or page removes inherited middleware; inner groups and the page can add it again. `middleware: []` changes nothing.
- **Order.** First all globals, in their usual order; then the route's middleware in declared order. The first to return a `Response` stops the route, and subsequent middleware does not run. The contract is the same in SSR, browser navigation, `render: "client"`, prerendering and the `static` adapter.
- **Literals.** Like `render` and `layout`, Meeko reads it without executing the file: `{ global: false }` must be an object literal with the literal `true` or `false`, and `middleware` a literal array of strings or `false`. A computed value produces `las opciones de defineRouteMiddleware deben ser un objeto literal…` or `middleware debe ser un array literal…`, with the file. A spread in page options that may contain `middleware` (an imported object, or a file-local constant containing it) requires declaring `middleware` after the last spread: `definePage({ ...protegida, render: "ssr", middleware: ["auth"] })`, or `middleware: []` if adding none. Otherwise discovery stops with `el spread protegida puede llevar middleware…`, because the route would be served without it. If a page declares middleware absent from its manifest (an old build), the request fails with `500` before the loader, as with `layout`.
- **Errors.** They stop `meeko dev`, `meeko build` and `meeko check`, with the file declaring the name: `el middleware "nowhere" no existe; crea app/middleware/nowhere.ts con defineRouteMiddleware(..., { global: false }) (middleware con nombre disponibles: "admin", "auth"), o app/middleware/nowhere.server.ts…` and, for a global, `el middleware "locale" (…/10-locale.ts) es global y ya se ejecuta en todas las rutas`.
- **Types and editor.** `middleware` is typed with the union of named middleware (`RouteMiddlewareName`, declared by `.meeko/types/routes.d.ts`), with editor completion. In an application without named middleware, the union is empty (`never`), so `middleware: ["typo"]` is already a type error. Hovering over a name in `definePage` shows its file and pages, and Ctrl+click opens it.
- **Bundle.** Globals travel with the browser entry point. Each named middleware used by a route is a separate chunk, loaded by the browser the first time it navigates to one of its routes; middleware used by no route never reaches the browser. Hydration does not run them: the server already did.
- **Manifest.** Each route stores its resolved named middleware in `RouteRecord.middleware` (files, in execution order); `AppManifest.routeMiddleware` still lists only globals. A custom host using `createFrameworkHandler` or `mountClientApp` with routes declaring them passes `loadNamedMiddleware(file)`; without it, those routes fail instead of skipping their guards. `discoverRouteMiddleware` from `@meekojs/meeko/build` separates globals from named middleware.
- **Development.** Creating, deleting or renaming middleware, changing its `{ global }` or the `middleware` of a page or `+group.ts` makes `meeko dev` rediscover routes and recreate the application.
- **Layers and modules.** As before, only the project's `app/middleware` counts: layer pages choose from the project's named middleware, and modules do not add route middleware.

`app/middleware/*.ts` is also bundled for the browser, including named middleware: do not import `server/`, secrets or authorization logic that must be enforced on the server there. An isomorphic route guard, global or named, improves navigation but never replaces session validation and authorization in the loader, API or RPC; to protect a page with the session, use [server route middleware](#server-route-middleware). `*.test.ts`, `*.spec.ts`, `*.d.ts` and `*.client.ts` files are excluded from route middleware discovery; since `1.6`, `*.server.ts` files are server route middleware.

## Server route middleware

Since `1.6`, an `app/middleware/*.server.ts` file is **server-only** route middleware: declare it with `defineServerRouteMiddleware` (from `@meekojs/meeko/framework`; automatically imported in `*.server.ts` and throughout `server/`, like other server definitions), and it receives the request's session and never reaches the browser bundle. It expresses “this group requires a session” without repeating the check in every page's `<script server>`:

```ts
// app/middleware/auth.server.ts
import { redirect } from '@meekojs/meeko/framework'

export default defineServerRouteMiddleware(
	({ session, url }) => {
		if (!session.current) redirect(`/login?next=${encodeURIComponent(url.pathname)}`)
	},
	{ global: false },
)
```

```ts
// app/pages/(dashboard)/+group.ts: all pages in the group require a session
export default defineGroup({ layout: 'dashboard', middleware: ['auth'] })
```

- **Global or named.** The same rule as isomorphic middleware: without options it is global and runs on every route; with `{ global: false }` (read without executing the file), it is named middleware, and `auth.server.ts` (or `10-auth.server.ts`) is `"auth"`. `middleware: ["auth"]` in `definePage` or a `+group.ts` resolves to `auth.ts` or `auth.server.ts`, with the same inheritance and `middleware: false`; if both exist and either is named, the name is duplicated and discovery stops. The default export of a `*.server.ts` must be a call to `defineServerRouteMiddleware(...)`, directly or through a file-local constant (including `as const`), an aliased import or `export { auth as default }`. Until `1.5`, those files were ignored, so a helper living there without a default export or with another one (`export default function parseCookies…`) stops discovery with `un middleware de ruta de servidor debe exportar por defecto defineServerRouteMiddleware(...)… mueve los helpers a server/utils` instead of running on each request as global middleware. Each file kind uses its own definition: `defineRouteMiddleware` in a `*.server.ts`, or `defineServerRouteMiddleware` in a `*.ts`, is an error identifying the file.
- **Context.** The same as `usePage()` in `<script server>`: `url`, `params`, `search`, `request`, `signal` and `context` (the `RequestContext`), with `session`, `services`, `platform` and `requestId` readily available, plus `match`. The client IP, behind the proxy if `MEEKO_TRUST_PROXY` allows it, is `context.clientAddress`. `params` and `search` come from the URL and are not yet validated with page schemas, because middleware runs before its `<script server>` or `load`. `defineServerRouteMiddleware<Services>` types `services`, and `session` follows `MeekoSession`. With `createFrameworkHandler` without `createContext`, reading `context` or `session` throws an error.
- **How it stops execution.** Like `<script server>`: `redirect()`, `notFound()` or an error, and also returning a `Response`. Returning `undefined` continues.
- **When it runs.** On the document request (SSR), and during browser navigation within the page data request, the same one that executes `<script server>`: a redirect or error reaches the browser just like one from a `<script server>` `redirect()`, and navigation follows it. In `render: "stream"`, before the first byte, like the critical loader.
- **Order.** Always the same: first isomorphic middleware (globals, then named middleware in declared order), then server middleware (globals, then named middleware in declared order). During navigation, the browser runs isomorphic middleware and the data request runs it again on the server before server middleware, as before. The first to stop execution stops the route.
- **`render: "client"` and `render: "prerender"`.** A `render: "client"` page does not request its data from the server during navigation, and a prerendered page renders at build time, without each visitor's request or session. Requesting named server middleware on either (including inherited middleware from a `+group.ts`) stops discovery: `el middleware de servidor "auth" (…) necesita una página con datos del servidor, pero … usa render: "client"…`; remove it from that page with `middleware: false` or use `render: "ssr"` or `"stream"`. Global server middleware does not run on these pages, even on their first load, so behavior does not depend on how you reached them. The `static` adapter, which only supports prerendered pages, warns that it does not run them.
- **Security boundary.** The Vite plugin rejects any `*.server.*` reaching the browser graph, and the client middleware virtual module never includes these files; the browser manifest does not carry their paths either. They can import `server/` and `#server/…` without `MEEK108`, and `meeko check` checks them with server types.
- **Types and editor.** `RouteMiddlewareName` includes their names, except in the `middleware` of a `render: "client"` page, which only accepts isomorphic middleware; hovering over a name in `definePage` or `defineGroup` shows the file, marks it as “server-only” and shows its pages. A nonexistent or global name produces the same errors in `meeko dev`, `meeko build` and `meeko check`.
- **Manifest and custom host.** Each route stores its complete server chain in `RouteRecord.serverMiddleware`, in execution order: globals, then named middleware (`render: "client"` and `"prerender"` routes do not have it). A custom host using `createFrameworkHandler` passes `loadServerMiddleware(file)`, which loads each listed file; without it, a route listing any, even just a global, fails instead of skipping it. Routes from a programmatic `composeFrameworkRoutes` module also receive the project's globals.
- **Development.** Creating or deleting one, or changing its `{ global }`, makes `meeko dev` rediscover routes.

When to use each kind:

- **Isomorphic middleware (`*.ts`) improves navigation**: it decides in the browser, without a request, and redirects before requesting anything. It cannot read the session (its cookie is HttpOnly) or import server code.
- **Server middleware (`*.server.ts`) protects the page**: it checks the session before the server renders or sends its data.
- **Neither protects `server/api` or RPC.** Route middleware only runs for pages: API endpoints and RPC procedures need their own guards (`auth: "required"`, handler checks or server middleware), even if only protected pages call them.
