---
source-hash: f675de2bd658bcba77c00b8c2971085d45cdb9cec37e3aa8ad42e9444f4ce8d7
---

# Upgrade from 1.5 to 1.6

`1.6` is a minor release: new features (named route middleware, requested with `middleware` in `definePage` and `+group.ts`, and server route middleware, `app/middleware/*.server.ts` with `defineServerRouteMiddleware`) are optional. Two changes ship as [approved exceptions](stability.md#approved-exceptions) to stability policy: `app/middleware`'s `*.server.ts` files, ignored through `1.5`, become server route middleware, and a spread in page options that may contain `middleware` requires declaring it afterward. Other noticeable upgrade changes include browser global middleware order, the render URL in the payload, `<MeekoThemeToggle>` on pages served at another URL, the `POST /_meeko/theme` redirect, a new auto-imported name and new discovery errors. This guide collects them, what to review and how to adopt each feature. The complete list of additions and fixes is in the [CHANGELOG](../../packages/meeko/CHANGELOG.md); compatibility commitments are in the [stability policy](stability.md).

## Recommended order

1. Update `@meekojs/meeko` to exact version `1.6.0` and recompile or rebuild, including prerendered pages: generated code and runtime must have the same version, and `1.6` documents carry the render URL in the payload (see [The render URL in the payload](#the-render-url-in-the-payload)). If you use the VS Code extension, update to `1.6.0`; Meeko DevTools is unchanged (still `1.0.0`).
2. Look for `*.server.ts` files in `app/middleware` (including subfolders). Move helpers to `server/utils` before starting: discovery stops (see [`app/middleware`'s `.server.ts` files are server middleware](#appmiddlewares-serverts-files-are-server-middleware)).
3. Look for page options with spreads (`definePage({ ...comun, … })`) and declare `middleware` after the last spread whose object comes from an import (see [A spread in page options](#a-spread-in-page-options)).
4. Run `meeko check`. Review [new discovery errors](#new-discovery-errors), which also stop `meeko dev` and `meeko build`.
5. If serving with a custom host over `createFrameworkHandler` and adopting route middleware, pass the new loaders (see [Custom host](#custom-host)).

## Approved exceptions

### `app/middleware`'s `.server.ts` files are server middleware

Through `1.5`, route middleware discovery excluded `app/middleware/*.server.ts`, so some projects stored server code there. Since `1.6`, these are [server route middleware](framework.md#server-route-middleware): their default export must be a `defineServerRouteMiddleware(...)` call, directly or through a file-local constant (including `as const`), an aliased import (`import { defineServerRouteMiddleware as guard } …`) or `export { auth as default }`.

Any other form stops `meeko dev`, `meeko build` and `meeko check` with the file, instead of running on every page request as global server middleware:

```text
app/middleware/cookies.server.ts: un middleware de ruta de servidor debe exportar por defecto defineServerRouteMiddleware(...); desde 1.6, los archivos *.server.ts de app/middleware son middleware de ruta de servidor, así que mueve los helpers a server/utils
```

This affects files without a default export (`export const parse = …`), those with `export default function parseCookies(…)`, `export default class`, `export default parseCookies`, an object or another function call, and `export { default } from "./otro"`. What to change:

- **A server helper**: move it to `server/utils` (auto-imported in server code) or import with `#server/…`.
- **Any other server code** stored there: move it out of `app/middleware`. Do not merely remove the suffix, because `app/middleware/*.ts` is isomorphic middleware, runs on every route and is bundled for the browser.

`app/middleware`'s `*.ts` files do not change: a default export other than `defineRouteMiddleware(...)` remains global middleware, like `1.5`.

### A spread in page options

Meeko reads route options (`render`, `layout` and, since `1.6`, `middleware`) without executing the file. A spread potentially containing `middleware` did not reach the manifest, and the page was served without it even though types accepted it:

```ts
// Antes: protegida trae middleware: ["auth"], pero el build no lo veía
const protegida = { middleware: ["auth"] } as const;
export const route = definePage({ ...protegida, render: "ssr", load });
```

Since `1.6`, if a spread can contain `middleware` (an imported object, a call result or a file-local constant containing it) and `middleware` is not explicitly declared after the last spread, discovery stops:

```text
app/pages/panel.meeko: el spread protegida puede llevar middleware, que Meeko no lee durante el build y la ruta se serviría sin él; declara middleware de forma explícita después del último spread (middleware: ["auth"], o middleware: [] si no añade ninguno)
```

Write `middleware` after the last spread, with names or `middleware: []`:

```ts
import { comun } from "./comun";

export const route = definePage({ ...comun, render: "ssr", middleware: ["auth"] });
```

Spreading a same-file constant without `middleware` remains valid. A `+group.ts` does not accept spreads, as in `1.5`. If a page declares middleware absent from its manifest (for example, an older build), the request fails with `500` before the loader, as already happened with `layout`: rebuild.

## Noticeable upgrade changes

### Global middleware order in the browser

Through `1.5`, the client entry point sorted global `app/middleware` middleware with `localeCompare`, and the server by character code. They differed only for names mixing uppercase letters, `-` or `_`. The browser now uses server order, so browser navigation order may change in those cases. If two global middleware depend on their order, use numeric prefixes (`10-locale.ts`, `20-auth.ts`).

### The render URL in the payload

Document payloads include optional `url`: the path and query rendered (`/?utm=mail`, or the `static` adapter's `404.html` URL). The browser hydrates `useRoute()` with it, then immediately switches to its own URL. A payload without `url`, such as `1.5` payloads, remains valid and hydrates with the browser URL. Rebuild prerendered pages to include it.

### `<MeekoThemeToggle>` on pages served at another URL

The `static` adapter's `404.html`, served at any nonexistent URL by the host, and a prerendered page served with a query string failed hydration with `Hydration mismatch` if anything rendered `useRoute()`: the browser hydrated with its URL rather than the render URL. This affected `<MeekoThemeToggle>`, whose hidden `return` field contains `useRoute().url`, and could affect `<MeekoAwait reserve>` and `<MeekoLink>`'s `aria-current`. With `url` in the payload, they hydrate correctly, and the theme form without JavaScript returns to the visitor's current page. You can remove workarounds (for example, omitting `<MeekoThemeToggle>` on the error page).

### `POST /_meeko/theme` redirect

A `return` with dot segments (`/.//evil.example`, `/a/..//evil.example`) normalized to `//evil.example`, a protocol-relative `Location` pointing elsewhere. It now returns to `/`. The `Origin` check already prevented cross-site use. `<MeekoThemeToggle>` forms are unchanged.

### New auto-imported name

`defineServerRouteMiddleware` is auto-imported in `*.server.ts` and all of `server/`, like server definitions. Your own export with the same name, or a file-local import or declaration, takes priority.

### `middleware` types

With `.meeko/types/routes.d.ts` declarations (`meeko check`, `meeko dev`), `middleware` is typed as the `RouteMiddlewareName` union. In an application without named middleware the union is empty, so any name (`middleware: ["typo"]`) is a type error; `middleware: []` and `middleware: false` remain valid. On a `render: "client"` page, `middleware` does not accept server names.

## Adopt new features

### Named middleware

An `app/middleware` middleware without options remains global. With `{ global: false }`, it is named middleware, running only on routes requesting it. Its name is the file path without `.ts` or the numeric order prefix: `auth.ts` and `10-auth.ts` become `"auth"`, and `admin/20-role.ts` becomes `"admin/role"`.

```ts
// app/middleware/auth.ts
export default defineRouteMiddleware(({ url, phase, request }) => {
  // Una cookie pública que indica la sesión: la cookie de sesión de Meeko es HttpOnly.
  const cookies = phase === "server" ? request?.headers.get("cookie") ?? "" : document.cookie;
  if (!cookies.includes("signed-in=1")) return Response.redirect(new URL("/login", url));
}, { global: false });
```

```ts
// app/pages/(dashboard)/+group.ts: todas las páginas del grupo
export default defineGroup({ layout: "dashboard", middleware: ["auth"] });
```

It accumulates from outer `+group.ts` files to the page without repetition, and `middleware: false` removes inherited middleware. It runs after globals in declared order, in SSR, browser navigation, `render: "client"`, prerendering and the `static` adapter. Each named middleware is a chunk loaded by the browser on first navigation to one of its routes. See [Named middleware](framework.md#named-middleware).

### Server middleware

An `app/middleware/*.server.ts` with `defineServerRouteMiddleware` only runs on the server with the request session and never reaches the browser bundle: it can import `server/` and `#server/…`. Use it to express “this group requires a session” without repeating the check in every page's `<script server>`. This is how diegootayza adopted it for his panel, with a custom `isOwner(context)` check from `server/auth.ts`, reading the `RequestContext` session:

```ts
// app/middleware/auth.server.ts
import { redirect } from "@meekojs/meeko/framework";
import { isOwner } from "#server/auth";

export default defineServerRouteMiddleware(({ context }) => {
  if (!isOwner(context)) redirect("/login");
}, { global: false });
```

```ts
// app/pages/(dashboard)/+group.ts: todas las páginas del grupo exigen sesión
export default defineGroup({ layout: "dashboard", middleware: ["auth"] });
```

Without a session, the document page responds with `302` to `/login`, and on navigation the browser follows the same redirect, received in the page's data request. It runs after all isomorphic middleware and before `<script server>` or `load`; with `render: "stream"`, before the first byte. It stops execution with `redirect()`, `notFound()`, an error or returning a `Response`. Without options, a `*.server.ts` is global. See [Server route middleware](framework.md#server-route-middleware).

### When to use each

- **Isomorphic middleware (`*.ts`) improves navigation**: decides in the browser without a request. It is bundled for the browser, so it cannot read the session (its cookie is HttpOnly) or import server code.
- **Server middleware (`*.server.ts`) protects the page**: checks the session before the server renders or sends data. It does not run on `render: "client"` or `"prerender"` pages, which do not request server data on every request: requesting named server middleware on them stops discovery.
- **Neither protects `server/api` or RPC**: endpoints and procedures need their own guards (`auth: "required"` or handler checks), even if only protected pages call them.

### Custom host

If serving with `createServerApp` (Meeko adapters), nothing is needed. A custom host over `createFrameworkHandler` with routes from `discoverRoutes` or `composeFrameworkRoutes` passes:

- `loadNamedMiddleware(file)`, for `RouteRecord.middleware` files (also in `mountClientApp`);
- `loadServerMiddleware(file)`, for `RouteRecord.serverMiddleware` files, the route's complete server chain: globals then named middleware.

Without these, a route listing middleware, even only global server middleware, fails with `500` instead of skipping it. `discoverRouteMiddleware` from `@meekojs/meeko/build` separates isomorphic globals (`global`), server globals (`serverGlobal`) and named middleware (`named`).

## New discovery errors

Stop `meeko dev`, `meeko build` and `meeko check` with the file:

| Message (excerpt)                                                                                                                                     | Cause                                                                                                                                                                                      |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `el middleware "nowhere" no existe; crea app/middleware/nowhere.ts …`                                                                                 | A `middleware` name not belonging to named middleware. The message lists available names.                                                                                                  |
| `el middleware "locale" (…) es global y ya se ejecuta en todas las rutas`                                                                             | A `middleware` name belonging to global middleware.                                                                                                                                        |
| `"…" no es un nombre de middleware válido`                                                                                                            | A name outside letters, digits, `-`, `_` and `/` between folders.                                                                                                                          |
| `… y … declaran el mismo middleware "auth"`                                                                                                           | Two files producing the same name if one is named, including `auth.ts` and `auth.server.ts`.                                                                                               |
| `las opciones de defineRouteMiddleware deben ser un objeto literal…`, `global debe ser el literal true o false…`, `opción de middleware desconocida…` | Middleware options Meeko cannot read without executing the file.                                                                                                                           |
| `middleware debe ser un array literal de nombres de app/middleware, o false…`                                                                         | Computed `middleware` in `definePage` or `+group.ts`.                                                                                                                                      |
| `el spread … puede llevar middleware…`                                                                                                                | See [A spread in page options](#a-spread-in-page-options).                                                                                                                                 |
| `un middleware de ruta de servidor debe exportar por defecto defineServerRouteMiddleware(...)…`                                                       | See [`app/middleware`'s `.server.ts` files are server middleware](#appmiddlewares-serverts-files-are-server-middleware).                                                                   |
| `un archivo *.server.ts de app/middleware es middleware de ruta de servidor; decláralo con defineServerRouteMiddleware…`                              | `defineRouteMiddleware` in a `*.server.ts`.                                                                                                                                                |
| `defineServerRouteMiddleware sólo se admite en un archivo *.server.ts de app/middleware…`                                                             | `defineServerRouteMiddleware` in a `*.ts`; the message suggests the `*.server.ts` name.                                                                                                    |
| `el middleware de servidor "auth" (…) necesita una página con datos del servidor…`                                                                    | A `render: "client"` or `"prerender"` page requesting named server middleware, including inherited from `+group.ts`. Remove with `middleware: false` or use `render: "ssr"` or `"stream"`. |

## Editor

The VS Code `1.6.0` extension includes Meeko's `1.6` language server: in `definePage` and `defineGroup`, it completes `middleware: [...]` names, hover shows the corresponding `app/middleware` file and its pages (or warns it is global or missing), Ctrl+click opens it, and server middleware is marked “server only”. With `meeko.languageServer.preferWorkspace` (enabled by default), it uses the project's `@meekojs/meeko` server, so new features arrive when upgrading the package to `1.6`. See [Editors](editors.md).
