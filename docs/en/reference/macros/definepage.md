---
title: definePage
group: macros
since: 1.0.0
description: Declares a page's route options (params and search schemas, rendering mode, loader, head, layout, middleware, cache and sitemap) with types flowing between them.
symbols:
  - "@meekojs/meeko/framework#definePage"
signature: first
types:
  - "@meekojs/meeko/framework#PageDefinition"
  - "@meekojs/meeko/framework#ClientPageDefinition"
  - "@meekojs/meeko/framework#PageLoadContext"
  - "@meekojs/meeko/framework#PageRender"
  - "@meekojs/meeko/framework#PageCache"
  - "@meekojs/meeko/framework#SitemapEntry"
related:
  - docs/como-elegir.md
  - "syntax:script-server"
  - "@meekojs/meeko/framework#usePage"
  - "@meekojs/meeko/framework#defineGroup"
  - "@meekojs/meeko/framework#defer"
  - "@meekojs/meeko/framework#notFound"
  - "@meekojs/meeko/framework#redirect"
  - docs/framework.md#opciones-de-ruta-con-definepage
  - docs/framework.md#modos-de-render
  - docs/framework.md#caché-de-páginas-ssr
  - docs/framework.md#rutas-dinámicas-en-el-sitemap-sitemapentries
  - docs/framework.md#dónde-se-usa-cada-api
source-hash: e6b365daf159cf789e26450cbcf53e87603c90c236735169bcebe7e516f72518
---

`definePage` declares route options for an `app/pages` page: schemas validating `params` and `search`, how it reaches the browser (`render`), prerendered URLs, the loader, `<head>`, named layout and its props, named middleware and, since `1.7`, page HTTP cache (`cache`) and URLs in `sitemap.xml` (`sitemapEntries`). It returns the same definition with types flowing through it: `params` comes from the schema, `load` receives it and `head` receives what `load` returns.

Export it as `route` from the page's `<script server>` block or a neighboring `*.route.ts` sidecar. `meeko build` reads `render`, `layout` and `middleware` without executing the file, and `meeko check` compares data with page props.

## Usage

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
import * as v from "valibot";

export const route = definePage({
  params: v.object({ id: v.pipe(v.string(), v.regex(/^\d+$/)) }),
  head: () => ({ title: "Perfil" }),
});

const { params } = usePage();               // params.id: string, ya validado
const user = await db.users.find(params.id);
if (!user) notFound();
export const profile = { id: user.id, name: user.name };
</script>

<template><h1>{profile.name}</h1></template>
```

A request to `/users/abc` fails the schema and responds with `400` before running the block.

## Options

| Option             | Type                                                              | Default                        | Description                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------ | ----------------------------------------------------------------- | ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `params`           | `PageSchema` (Standard Schema)                                    | segments as strings            | Validates dynamic segments (`[id]`) before `load` and top-level code. Invalid input responds with `400`. Without a schema, `params` is `Readonly<Record<string, string>>`.                                                                                                                                                                                                                                                                                                                                                       |
| `search`           | `PageSchema`                                                      | keys as strings                | Validates the query string similarly. Without a schema, each key is a string, or a list if repeated.                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `render`           | `"ssr" \| "stream" \| "prerender" \| "client"`                    | `"ssr"`                        | How the page reaches the browser (see [Rendering modes](/en/docs/framework#rendering-modes)). **Must be a literal.**                                                                                                                                                                                                                                                                                                                                                                                                             |
| `prerenderEntries` | `Record<string, string>[]` or `() => Promise<…>`                  | none                           | The `params` of each URL `meeko build` prerenders for a dynamic route with `render: "prerender"`. A static route does not need it; `"ssr"` and `"stream"` ignore it; with `"client"` it is an error.                                                                                                                                                                                                                                                                                                                             |
| `load`             | `(context: PageLoadContext) => D \| Promise<D>`                   | none                           | Loader. Its result reaches the page as `props.data`, which becomes required. Can return a `Response` to redirect and `defer` values. Cannot combine with top-level block code.                                                                                                                                                                                                                                                                                                                                                   |
| `head`             | `(context & { data }) => PageHead`                                | none                           | `title`, `description` and `useHead` tags, with loader data. Takes priority over `useHead` and configuration's `document`.                                                                                                                                                                                                                                                                                                                                                                                                       |
| `layout`           | a layout name, or `false`                                         | from `+group.ts`, or `default` | Since `1.5`. Named layout from `app/layouts/<nombre>.meeko`; `false` leaves only `app/app.meeko`. **Must be a literal.**                                                                                                                                                                                                                                                                                                                                                                                                         |
| `layoutProps`      | layout `Props`, or a function computing them                      | none                           | Since `1.5`. Layout props, typed against the layout selected by `layout`. Travel in the payload: must be JSON-serializable.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `middleware`       | `app/middleware` names, or `false`                                | inherited ones                 | Since `1.6`. Named middleware the page adds to globals and its `+group.ts` middleware; `false` removes inherited ones. **Must be an array literal.**                                                                                                                                                                                                                                                                                                                                                                             |
| `cache`            | `PageCache`: `{ etag?, maxAge?, staleWhileRevalidate?, memory? }` | no cache                       | Since `1.7`. HTTP cache for an `"ssr"` or `"stream"` page. `etag(ctx)` returns the content version before the loader; if it matches `If-None-Match`, the response is `304` without loader or render. `maxAge` and `staleWhileRevalidate` (seconds) write `Cache-Control: public, …`. `memory` (`true` or `{ maxEntries, maxBytes }`, defaulting to 1000 entries and 32 MiB) stores HTML and payload in an LRU per route and process, and requires `etag`. Only in production and without a session. Unavailable with `"client"`. |
| `sitemapEntries`   | `SitemapEntry[]` or `(context) => SitemapEntry[] \| Promise<…>`   | none                           | Since `1.7`. Route URLs in `sitemap.xml`: `{ params, lastmod?, changefreq?, priority? }`. `meeko build` evaluates it once after prerendering with `{ env, prerendering: true }`. With `"prerender"`, only adds fields to prerendered pages. Unavailable with `"client"`.                                                                                                                                                                                                                                                         |

With `render: "client"`, `load` and `head` run in the browser and receive `ClientPageLoadContext` (without `request` or `context`).

## Return value

The same definition, unchanged at runtime, with its mode's type: `PageDefinition<P, S, D, C>` for `"ssr"`, `"stream"` and `"prerender"`, and `ClientPageDefinition<P, S, D>` for `"client"`. If it declares `load`, the type retains it as required, like `data` in page props. This is what the server, `meeko build` and `meeko check` read.

On module loading, `definePage` validates what types alone cannot prevent and throws `TypeError`:

- `render: "client" cannot be prerendered; remove prerenderEntries or use render: "prerender"`;
- since `1.7`, `render: "client" has no server cache; remove cache or render the page on the server`, and `cache` errors prefixed with `definePage:`, such as `cache.memory needs cache.etag, which tells when a stored page changed`, `cache.maxAge must be a whole number of seconds` or `cache has an unknown field ttl`.

## Examples

### A loader with typed page data

```html
<!-- app/pages/products/[slug].meeko -->
<script server lang="ts">
import * as v from "valibot";

export const route = definePage({
  params: v.object({ slug: v.string() }),
  search: v.object({ tab: v.optional(v.picklist(["detalles", "opiniones"]), "detalles") }),
  load: async ({ params, search, signal }) => {
    const product = await catalog.find(params.slug, { signal });
    if (!product) throw new ApiError("NOT_FOUND", 404);
    return { name: product.name, price: product.price, tab: search.tab };
  },
  head: ({ data }) => ({ title: data.name, description: `Precio: ${data.price} €` }),
});
</script>

<script lang="ts">
export interface Props {
  params: { slug: string };
  search: { tab: "detalles" | "opiniones" };
  data: { name: string; price: number; tab: "detalles" | "opiniones" };
}
const props = defineProps<Props>();
</script>

<template><h1>{props.data.name}</h1></template>
```

`meeko check` checks that `Props` matches schemas and the result of `load`. An `ApiError` with status `404` displays the nearest error page with `{ status: 404, message: "NOT_FOUND" }`.

### Prerender a dynamic route in a sidecar

```ts
// app/pages/blog/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "prerender",
  prerenderEntries: async () => [{ slug: "hola-meeko" }, { slug: "senales" }],
  load: ({ params }) => ({ slug: params.slug ?? "" }),
  head: ({ data }) => ({ title: data.slug }),
});
```

`meeko build` writes `/blog/hola-meeko/index.html` and `/blog/senales/index.html` with their navigation payloads. Any other route URL, or one with a query string, is rendered with SSR.

### A page rendered in the browser

```html
<!-- app/pages/notes/index.meeko -->
<script server lang="ts">
export const route = definePage({
  render: "client",
  load: async ({ signal }) => api.notes.list({ signal }),
  head: ({ data }) => ({ title: `${data.length} notas` }),
});
</script>
```

With `"client"`, the block is public: included in the browser bundle and unable to import `server/` or use server auto-imports. The server only sends layouts with an empty outlet. Use it for views without SEO requirements.

### Named layout, props and middleware

```html
<!-- app/pages/admin/reports.meeko -->
<script server lang="ts">
export const route = definePage({
  layout: "dashboard",
  layoutProps: { title: "Informes", showAlert: true },
  middleware: ["auth"],
});
</script>
```

`layoutProps` is checked against `app/layouts/dashboard.meeko`'s `Props`, and `middleware` against named middleware in `app/middleware`.

### Revalidate with `ETag` and cache in memory

Since `1.7`, an SSR page whose content changes infrequently revalidates without running the loader. `etag` must be cheap (a modification date or counter, not the document):

```ts
// app/pages/docs/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

const updatedAt = new Map<string, string>([["inicio", "2026-10-01T12:00:00Z"]]);

export const route = definePage({
  cache: {
    etag: ({ params }) => updatedAt.get(params.slug ?? ""),
    maxAge: 60,
    staleWhileRevalidate: 600,
    memory: { maxEntries: 500 },
  },
  load: ({ params }) => ({ slug: params.slug ?? "" }),
});
```

The first request renders the page and responds with `ETag: W/"…"` and `Cache-Control: public, max-age=60, stale-while-revalidate=600`. A request with that `If-None-Match` receives `304` without loader or render; with `memory`, a request without it receives the stored copy while `etag` returns the same value. The `ETag` combines your value with the theme, build and response type (document or navigation payload), so a new `meeko build` invalidates all copies.

### Dynamic route URLs in the sitemap

Since `1.7`, an SSR `/docs/[slug]` route appears in `sitemap.xml` if it declares its URLs. The function runs once in `meeko build`, with `sitemap` enabled in `meeko.config.ts`:

```ts
// app/pages/docs/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";

const docs = [
  { slug: "inicio", updatedAt: new Date("2026-10-01"), draft: false },
  { slug: "borrador", updatedAt: new Date("2026-10-20"), draft: true },
];

export const route = definePage({
  sitemapEntries: ({ env }) => docs
    .filter((doc) => env.DOCS_DRAFTS === "1" || !doc.draft)
    .map((doc) => ({ params: { slug: doc.slug }, lastmod: doc.updatedAt, changefreq: "weekly" as const })),
});
```

Each entry produces a `<url>` with `<loc>`, built like `href`, and `<lastmod>` (a `Date` is written using `toISOString()`), `<changefreq>` and `<priority>` if declared. `sitemap.exclude` and `noindex` still take priority.

## Common mistakes

### Call it in the component's `<script>`

`<script>` and the template also run in the browser: route options do not belong there.

```html bad
<script lang="ts">
const route = definePage({ render: "prerender" });
</script>
```

`meeko check` warns with `MEEK109: definePage no tiene efecto en el <script> ni en la plantilla de un componente` (an error in `2.0`). With `export const route`, the error is `MEEK018`, because a component script only exports types.

```html good
<script server lang="ts">
export const route = definePage({ render: "prerender" });
</script>
```

### Compute `render`

`meeko build` reads `render` without executing the file: a computed value cannot be read.

```ts bad
const mode = process.env.STATIC ? "prerender" : "ssr";
export const route = definePage({ render: mode });
```

`meeko check` and `meeko build` stop with `render debe ser un literal de texto para que Meeko pueda leerlo durante el build`, including the file. The same applies to `layout` and `middleware`.

<!-- no-check -->

```ts good
export const route = definePage({ render: "prerender" });
```

### Prerender a dynamic route without `prerenderEntries`

```ts bad
// app/pages/blog/[slug].route.ts
export const route = definePage({ render: "prerender" });
```

`meeko check` does not detect this, but `meeko build` stops with `Dynamic prerender route /blog/[slug] requires prerenderEntries`: it does not know which URLs to generate.

<!-- no-check -->

```ts good
export const route = definePage({ render: "prerender", prerenderEntries: async () => (await listPosts()).map((post) => ({ slug: post.slug })) });
```

### `render: "client"` with `prerenderEntries`

A browser-rendered page has no HTML to prerender.

```ts bad
export const route = definePage({ render: "client", prerenderEntries: [{ slug: "a" }] });
```

This is a type error (`prerenderEntries?: never`), `meeko check` rejects it with `una página render: "client" no se puede prerenderizar; quita prerenderEntries o usa render: "prerender"` and, if executed, `definePage` throws `TypeError` with the same message in English.

<!-- no-check -->

```ts good
export const route = definePage({ render: "prerender", prerenderEntries: [{ slug: "a" }] });
```

### Both `load` and top-level code

Block exports are already page data; a loader would be a second source.

```html bad
<script server lang="ts">
export const route = definePage({ load: () => ({ total: 1 }) });
export const greeting = "Hola";
</script>
```

`MEEK070: Un <script server> con código de nivel superior no puede declarar también route.load`. Choose one: exports or loader.

```html good
<script server lang="ts">
export const route = definePage({ render: "ssr" });
export const total = 1;
export const greeting = "Hola";
</script>
```

### `head` in options and an export

```html bad
<script server lang="ts">
export const route = definePage({ head: () => ({ title: "A" }) });
export const head = { title: "B" };
</script>
```

`MEEK072: <script server> exporta head y además declara route.head; deja sólo uno de los dos`.

```html good
<script server lang="ts">
export const head = { title: "B" };
</script>
```

### Options reading top-level code

Route options are evaluated once on module loading; top-level code runs afterward on each request.

```html bad
<script server lang="ts">
const title = "Hola";
export const route = definePage({ head: () => ({ title }) });
export const greeting = title;
</script>
```

`MEEK076: Las opciones de ruta no pueden leer title`. Move the shared value to an imported module, or compute it inside `head`.

```html good
<script server lang="ts">
import { siteTitle } from "../utils/titles";
export const route = definePage({ head: () => ({ title: siteTitle }) });
export const greeting = siteTitle;
</script>
```

### Options in both block and sidecar

```text bad
app/pages/about.meeko      ← <script server> con export const route = definePage(…)
app/pages/about.route.ts   ← export const route = definePage(…)
```

Route discovery stops with `las opciones de ruta están declaradas dos veces; deja <script server> o about.route.ts`.

```text good
app/pages/about.meeko      ← <script server> con export const route = definePage(…)
```

### `cache.memory` without `etag`

The in-memory copy only knows when it expires through `etag`.

```ts bad
export const route = definePage({ cache: { memory: true, maxAge: 60 } });
```

`meeko check` does not detect this: on module loading, `definePage` throws `TypeError: definePage: cache.memory needs cache.etag, which tells when a stored page changed`. The same happens with negative or fractional seconds (`cache.maxAge must be a whole number of seconds`).

<!-- no-check -->

```ts good
export const route = definePage({ cache: { etag: () => contentVersion(), memory: true, maxAge: 60 } });
```

### `cache` or `sitemapEntries` on a `render: "client"` page

A `"client"` page's options reach the browser: there is no server to cache it or build to list its URLs.

```ts bad
export const route = definePage({ render: "client", cache: { maxAge: 60 }, sitemapEntries: [] });
```

`meeko check` reports `TS2769: No overload matches this call` with `Type '{ maxAge: 60; }' is not assignable to type 'never'`. With `sitemapEntries`, route discovery also stops with `una página render: "client" no declara sitemapEntries, porque sus opciones llegan al navegador; quítalo o usa otro modo de render`, and `definePage` throws `TypeError: render: "client" has no server cache; remove cache or render the page on the server` at runtime.

<!-- no-check -->

```ts good
export const route = definePage({ render: "ssr", cache: { etag: () => contentVersion(), maxAge: 60 } });
```

### A nonexistent layout or middleware

```ts bad
export const route = definePage({ layout: "admin", middleware: ["auth"] });
```

`meeko check`, `meeko dev` and `meeko build` stop with `el layout "admin" no existe; crea app/layouts/admin.meeko (layouts disponibles: "default")` or `el middleware "auth" no existe; crea app/middleware/auth.ts con defineRouteMiddleware(..., { global: false })…`.

<!-- no-check -->

```ts good
// con app/layouts/admin.meeko y app/middleware/auth.ts
export const route = definePage({ layout: "admin", middleware: ["auth"] });
```

## Notes

- **Location.** In `export const route` of `<script server>` or a `*.route.ts` sidecar. Auto-imported, and an explicit import from `@meekojs/meeko/framework` also works. `<script server>` only exists in pages: in a component or layout it produces `MEEK044`. Prefer the named `route` export; since `1.7`, `export default definePage(...)` in a block without top-level code also passes `meeko check` (through `1.6`, the project check failed with `has no exported member 'route'`).
- **When it runs.** Options are evaluated once per module. `params` and `search` are validated per request, after middleware and before `load` and top-level code; `load` and `head` run per request (SSR and each client navigation's data request), or once per URL during `meeko build` with `"prerender"`.
- **Server or browser.** Except with `render: "client"`, the block and sidecar never reach the browser: they can import `server/` and `*.server.*` modules and read secrets. With `"client"` they are public and top-level code produces `MEEK074`.
- **Serialization.** The result of `load` travels as JSON. A value rejected by `serializeJson` (functions, `undefined`, `bigint`, class instances such as `Date` or `Map`) is a type error in `meeko check` and a `500` response at runtime.
- **Security.** `params` and `search` schemas validate URL input: do not trust an unvalidated segment. Route middleware protects navigation, but a `"client"` page requests data from the API, which must apply its own guards.
- **Cache (`1.7`).** `cache` applies only in production, to `GET` and `HEAD` requests without the session cookie. A response setting a cookie uses `no-store` and is not copied, and `"stream"` only uses `ETag`. Route middleware always runs before the `304` or in-memory copy, so caching never skips a guard. `etag` must change with everything changing HTML except the theme: if the page reads a header or `search` key, include it.
- **Sitemap (`1.7`).** `sitemapEntries` is evaluated only with `sitemap` in `meeko.config.ts`, at build time without request or session: read data available to the build. Meeko only loads options for routes naming it, so write it in options rather than through a spread.
- **`+group.ts`.** To avoid repeating `layout`, `layoutProps` or `middleware` per page, declare folder options with `defineGroup`; page options take priority.

> [!WARNING]
> Changing a route's `render` requires rerunning `meeko build` or restarting `meeko dev`: the server compares the file's mode with the build manifest and responds with an error if they differ.
