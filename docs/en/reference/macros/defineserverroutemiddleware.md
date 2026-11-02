---
title: defineServerRouteMiddleware
group: macros
since: 1.6.0
description: Declares route middleware running only on the server, with the request's session, before the page's server code.
symbols:
  - "@meekojs/meeko/framework#defineServerRouteMiddleware"
types:
  - "@meekojs/meeko/framework#ServerRouteMiddlewareContext"
related:
  - "@meekojs/meeko/framework#defineRouteMiddleware"
  - "@meekojs/meeko/framework#defineGroup"
  - "@meekojs/meeko/framework#redirect"
  - "@meekojs/meeko/framework#notFound"
  - "@meekojs/meeko/server#defineServerMiddleware"
  - docs/framework.md#middleware-de-ruta-de-servidor
source-hash: bd5c7fdd7ba0e8703bb93e896aa320d3ee29637e24659264e829e73dd31a70fe
---

`defineServerRouteMiddleware` declares the route middleware exported by default from an `app/middleware/*.server.ts` file. It only runs on the server, with the request's session, and never reaches the browser bundle: it can import `server/`, read secrets and query the database.

Use it to express “this group of pages requires a session” without repeating the check in each `<script server>`. Without options it is global; with `{ global: false }`, it is named middleware (`auth.server.ts` is `"auth"`) requested by routes through `middleware`. It is auto-imported in `*.server.ts` and `server/`.

## Usage

```ts
// app/middleware/auth.server.ts
import { defineServerRouteMiddleware, redirect } from "@meekojs/meeko/framework";

export default defineServerRouteMiddleware(({ session, url }) => {
  if (!session.current) redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
}, { global: false });
```

```ts
// app/pages/(dashboard)/+group.ts
import { defineGroup } from "@meekojs/meeko/framework";

export default defineGroup({ layout: "dashboard", middleware: ["auth"] });
```

Each `(dashboard)` page redirects to `/login` without a session, on document load and every browser navigation.

## Parameters

| Parameter    | Type                                                                                       | Default  | Description                                                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `middleware` | `(context: ServerRouteMiddlewareContext) => void \| Response \| Promise<void \| Response>` | required | The function. Receives the `usePage()` context (`url`, `params`, `search`, `request`, `signal`, `context`) and direct access to `session`, `services`, `platform`, `requestId` and `match`. |
| `options`    | `{ global?: boolean }`                                                                     | global   | `{ global: false }` makes it named. **Must be an object literal.**                                                                                                                          |

`params` and `search` come from the URL, not yet validated by page schemas. `defineServerRouteMiddleware<Services>` types `services`; since `1.7`, without a type argument, `services` uses the type Meeko infers from `server/runtime.ts`.

## Return value

The same middleware, for default export. Short-circuits the route like `<script server>`:

- `redirect(url, status?)` or `notFound()`, which throw;
- returning a `Response`;
- throwing an error (an `ApiError` with its status, or any other as `500`).

Returning `undefined` continues.

## Examples

### A role, with application services

```ts
// app/middleware/admin.server.ts
import { defineServerRouteMiddleware, notFound } from "@meekojs/meeko/framework";

interface Services { readonly roles: { of(userId: string): Promise<string[]> } }

export default defineServerRouteMiddleware<Services>(async ({ session, services }) => {
  const userId = (session.current?.data as { userId?: string } | undefined)?.userId;
  if (!userId || !(await services.roles.of(userId)).includes("admin")) notFound();
}, { global: false });
```

Responding with `404` instead of `403` does not reveal that the page exists.

### Global: log every page

Without options, it runs on all routes with server data:

```ts
// app/middleware/10-audit.server.ts
import { defineServerRouteMiddleware } from "@meekojs/meeko/framework";

export default defineServerRouteMiddleware(({ requestId, url, context }) => {
  console.info(`[${requestId}] ${url.pathname} desde ${context.clientAddress ?? "desconocida"}`);
});
```

### Alongside isomorphic middleware

The isomorphic middleware (`app/middleware/signed-in-hint.ts`) redirects in the browser without requesting anything; the server middleware (`auth.server.ts`) protects data. A group can request both; isomorphic middleware always runs first:

```ts
// app/pages/(dashboard)/+group.ts
import { defineGroup } from "@meekojs/meeko/framework";

export default defineGroup({ middleware: ["signed-in-hint", "auth"] });
```

## Common mistakes

### Forget to import `redirect`

`redirect` and `notFound` are available without imports in `<script server>`, but not in `app/middleware/*.server.ts`. This is deliberate: auto-import types are global declarations for the entire TypeScript `server` project, including `server/api`. Declaring them for middleware would also declare them in APIs, where there is no current page and they would fail at runtime with `MEEK073` instead of giving this type error.

```ts bad
// app/middleware/auth.server.ts
export default defineServerRouteMiddleware(({ session }) => {
  if (!session.current) redirect("/login");
}, { global: false });
```

`meeko check` reports `TS2304: Cannot find name 'redirect'.`

<!-- no-check -->

```ts good
// app/middleware/auth.server.ts
import { redirect } from "@meekojs/meeko/framework";

export default defineServerRouteMiddleware(({ session }) => {
  if (!session.current) redirect("/login");
}, { global: false });
```

### Use it in a file without `.server`

```ts bad
// app/middleware/auth.ts
export default defineServerRouteMiddleware(() => {}, { global: false });
```

`defineServerRouteMiddleware sólo se admite en un archivo *.server.ts de app/middleware, que nunca llega al navegador; renombra el archivo a auth.server.ts`.

<!-- no-check -->

```ts good
// app/middleware/auth.server.ts
export default defineServerRouteMiddleware(() => {}, { global: false });
```

### A helper in `app/middleware/*.server.ts`

Since `1.6`, every `*.server.ts` in `app/middleware` is server middleware.

```ts bad
// app/middleware/cookies.server.ts
export function parseCookies(header: string) { return header.split("; "); }
```

`un middleware de ruta de servidor debe exportar por defecto defineServerRouteMiddleware(...); desde 1.6, los archivos *.server.ts de app/middleware son middleware de ruta de servidor, así que mueve los helpers a server/utils`.

```ts good
// server/utils/cookies.ts
export function parseCookies(header: string): string[] { return header.split("; "); }
```

### Request it on a prerendered or `"client"` page

These pages do not request their data from the server on each visit: there is no session to check.

```ts bad
export const route = definePage({ render: "prerender", middleware: ["auth"] });
```

`el middleware de servidor "auth" (…/auth.server.ts) necesita una página con datos del servidor, pero …/reports.meeko usa render: "prerender" y se renderiza al hacer el build, sin la petición ni la sesión de cada visitante. Usa render: "ssr" o "stream", o quítalo de esa página con middleware: false`.

<!-- no-check -->

```ts good
export const route = definePage({ render: "ssr", middleware: ["auth"] });
```

## Notes

- **When it runs.** On the document request and, during navigation, on the page data request, before `<script server>` or `load`; in `render: "stream"`, before the first byte. A redirect reaches the browser like a page's `redirect()`.
- **Order.** First isomorphic middleware (global and named), then server middleware (global and named, in declared order). The first to short-circuit stops the route.
- **Serverless pages.** Does not run in `render: "client"` or `"prerender"`; global server middleware does not either, including on initial load. The `static` adapter warns that it does not run them.
- **Security.** Never reaches the browser: the Vite plugin rejects any `*.server.*` in its graph. But it only protects pages: `server/api` and RPC need their own guards (`auth: "required"`), even if only protected pages call them.
- **Cache.** With `cache` in `definePage` (since `1.7`), middleware always runs before `304` or the in-memory copy.
- **Names.** Named `auth.ts` and `auth.server.ts` together are a duplicate name and stop discovery.
