---
title: defineRouteMiddleware
group: macros
since: 1.0.0
description: Declares global or named route middleware in app/middleware, executed before the page in SSR and on each browser navigation.
symbols:
  - "@meekojs/meeko/framework#defineRouteMiddleware"
types:
  - "@meekojs/meeko/framework#RouteMiddlewareContext"
  - "@meekojs/meeko/framework#RouteMiddlewareOptions"
related:
  - "@meekojs/meeko/framework#defineServerRouteMiddleware"
  - "@meekojs/meeko/framework#defineGroup"
  - "@meekojs/meeko/framework#definePage"
  - "@meekojs/meeko/server#defineServerMiddleware"
  - docs/framework.md#middleware-de-rutas-y-servidor
  - docs/framework.md#middleware-con-nombre
source-hash: 4742909c062b1f588ef2b533540c607010ce76bafaff1671c6013631382a610b
---

`defineRouteMiddleware` declares the route middleware exported by default from a file in `app/middleware/`. It executes before route options and the page loader: on the server during SSR and in the browser on each navigation, with the same code. Returning `undefined` continues; returning a `Response` (usually a redirect) stops the route.

There are two kinds:

- **Global** (without options): runs on every route, in filename order.
- **Named** (since `1.6`, `{ global: false }`): only on routes that request it through `middleware` in `definePage` or a `+group.ts`. The name is the filename without `.ts` or a numeric prefix: `10-auth.ts` is `"auth"`.

It is auto-imported. It is **isomorphic**: it also reaches the browser bundle.

## Usage

```ts
// app/middleware/auth.ts
import { defineRouteMiddleware } from "@meekojs/meeko/framework";

export default defineRouteMiddleware(({ url, phase, request }) => {
  // A public cookie indicating the session: Meeko's session cookie is HttpOnly.
  const cookies = phase === "server" ? request?.headers.get("cookie") ?? "" : document.cookie;
  if (!cookies.includes("signed-in=1")) {
    const login = new URL("/login", url);
    login.searchParams.set("next", url.pathname);
    return Response.redirect(login);
  }
}, { global: false });
```

Pages requesting it with `definePage({ middleware: ["auth"] })` or a `+group.ts` redirect to `/login` without the cookie.

## Parameters

| Parameter    | Type                                                                                 | Default  | Description                                                                                                                                                                                          |
| ------------ | ------------------------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `middleware` | `(context: RouteMiddlewareContext) => void \| Response \| Promise<void \| Response>` | required | The function. Receives `url`, `match` (the route and its `params`), `signal` (aborted if navigation is canceled), `phase` (`"server"` or `"client"`) and `request`, which only exists on the server. |
| `options`    | `{ global?: boolean }`                                                               | global   | Since `1.6`. `{ global: false }` makes it named. **Must be a literal object**: Meeko reads it without executing the file.                                                                            |

## Return value

The same middleware, to export as default. What each result does:

| Result                   | On the server                                 | In the browser                                          |
| ------------------------ | --------------------------------------------- | ------------------------------------------------------- |
| `undefined`              | Continues to the next middleware and the page | Same                                                    |
| `Response.redirect(url)` | Responds with the redirect                    | `location.assign` with the URL: a new page load         |
| Another `Response`       | Returns it as the response                    | Cancels navigation and passes it to `onNavigationError` |
| An error                 | Error page                                    | Cancels navigation                                      |

## Examples

### Global, limited to one route

Global middleware can decide based on the route with `match.route.id`:

```ts
// app/middleware/10-locale.ts
import { defineRouteMiddleware } from "@meekojs/meeko/framework";

export default defineRouteMiddleware(({ url, match }) => {
  if (match.route.id !== "/dashboard") return;
  if (!url.searchParams.has("locale")) {
    const target = new URL(url);
    target.searchParams.set("locale", "es");
    return Response.redirect(target);
  }
});
```

### Request it from a group and a page

```ts
// app/pages/(dashboard)/+group.ts
import { defineGroup } from "@meekojs/meeko/framework";

export default defineGroup({ layout: "dashboard", middleware: ["auth"] });
```

```html
<!-- app/pages/(dashboard)/admin/users.meeko -->
<script server lang="ts">
export const route = definePage({ middleware: ["admin"] });
</script>
<template><h1>Users</h1></template>
```

`/admin/users` runs global middleware, then `auth` (from the group), then `admin` (from the page). `middleware: false` removes inherited middleware.

### Scheduled maintenance

Global middleware can stop all routes except one:

```ts
// app/middleware/00-maintenance.ts
import { defineRouteMiddleware } from "@meekojs/meeko/framework";

const until = Date.parse("2026-11-01T06:00:00Z");

export default defineRouteMiddleware(({ url, match }) => {
  if (Date.now() < until && match.route.id !== "/maintenance") return Response.redirect(new URL("/maintenance", url));
});
```

## Common mistakes

### Requesting middleware that does not exist

```ts bad
export const route = definePage({ middleware: ["auth", "admn"] });
```

`meeko check`, `meeko dev` and `meeko build` stop with `el middleware "admn" no existe; crea app/middleware/admn.ts con defineRouteMiddleware(..., { global: false }) (middleware con nombre disponibles: "admin", "auth"), o app/middleware/admn.server.ts con defineServerRouteMiddleware para uno que sólo se ejecuta en el servidor`.

<!-- no-check -->

```ts good
export const route = definePage({ middleware: ["auth", "admin"] });
```

### Requesting global middleware by name

```ts bad
// app/middleware/10-locale.ts, without options
export default defineRouteMiddleware(() => {});
// app/pages/(dashboard)/+group.ts
export default defineGroup({ middleware: ["locale"] });
```

`el middleware "locale" (…/10-locale.ts) es global y ya se ejecuta en todas las rutas; quítalo de middleware o decláralo con defineRouteMiddleware(..., { global: false })`.

<!-- no-check -->

```ts good
export default defineRouteMiddleware(() => {}, { global: false });
```

### Using it in a `*.server.ts`

```ts bad
// app/middleware/auth.server.ts
export default defineRouteMiddleware(() => {}, { global: false });
```

`un archivo *.server.ts de app/middleware es middleware de ruta de servidor; decláralo con defineServerRouteMiddleware en lugar de defineRouteMiddleware`.

<!-- no-check -->

```ts good
// app/middleware/auth.server.ts
import { redirect } from "@meekojs/meeko/framework";

export default defineServerRouteMiddleware(({ session }) => {
  if (!session.current) redirect("/login");
}, { global: false });
```

### Trusting it as authorization

Isomorphic route middleware travels to the browser and does not read the session (its cookie is HttpOnly). A user can bypass it by requesting data from the API: no error points this out.

```ts bad
// app/middleware/admin.ts: the only role check
export default defineRouteMiddleware(({ url }) => {
  if (!document.cookie.includes("role=admin")) return Response.redirect(new URL("/", url));
}, { global: false });
```

<!-- no-check -->

```ts good
// app/middleware/admin.server.ts: on the server, with the session
export default defineServerRouteMiddleware(({ session, url }) => {
  if ((session.current?.data as { role?: string } | undefined)?.role !== "admin") return Response.redirect(new URL("/", url));
}, { global: false });
```

And in the API, `auth: "required"` and a role check in the handler.

## Notes

- **Server and browser.** The same file executes in SSR (`phase: "server"`, with `request`) and client navigation (`phase: "client"`, without `request`). Do not import `server/` or secrets: they travel in the bundle. Hydration does not execute it: the server already did.
- **Order.** Global middleware first, in filename order; then the route's named middleware, in declared order (groups from the outside in, then the page); then server middleware (`*.server.ts`). The first to return a `Response` stops the route.
- **Bundle.** Global middleware ships with the browser entry point; each named middleware is a chunk loaded the first time you navigate to one of its routes.
- **Security.** Improves navigation (redirects without requesting anything), but never replaces authorization in the loader, API or RPC. To protect a page with the session, use `defineServerRouteMiddleware`.
- **Exclusions.** `*.test.ts`, `*.spec.ts`, `*.d.ts` and `*.client.ts` files in `app/middleware` are not middleware. Only the project's `app/middleware` counts, not that of layers.
