---
title: href
group: utils
since: 1.1.0
description: Builds an application route's URL from its ID, with encoded parameters and the query string, checked by TypeScript.
symbols:
  - "@meekojs/meeko/framework#href"
types:
  - "@meekojs/meeko/framework#RouteId"
related:
  - "syntax:meekolink"
  - "@meekojs/meeko/framework#useRoute"
  - "@meekojs/meeko/framework#redirect"
  - docs/framework.md#configuración
  - docs/framework.md#meekooutlet--y-meekolink
source-hash: 459a112404a14abdd79b88dd5eedcfed80e1e8ea8e3ffe92336805c74faa7546
---

`href(id, { params, search })` builds the URL of an `app/pages` page from its ID, such as `"/users/[id]"`. TypeScript only accepts existing route IDs, requires `params` for a dynamic route (with its exact keys) and forbids it for a static route: a renamed route or forgotten parameter becomes a `meeko check` error, rather than a broken link.

It works on the server (SSR, loaders, `head`, prerendering, API, RPC and server middleware) with the current request's manifest, and in the browser with the mounted application's manifest. It is auto-imported. `<MeekoLink>` uses it internally.

## Usage

```html
<!-- app/components/UserCard.meeko -->
<script lang="ts">
const props = defineProps<{ id: string; name: string }>();
</script>

<template>
  <a bind:href="href('/users/[id]', { params: { id: props.id }, search: { tab: 'perfil' } })">{props.name}</a>
</template>
```

With `id: "42"`, the link is `/users/42?tab=perfil`.

## Parameters

| Parameter        | Type                                                               | Default  | Description                                                                                                                                                |
| ---------------- | ------------------------------------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`             | `RouteId`                                                          | required | The route ID: its file path in `app/pages`, without `(…)` groups, such as `"/"`, `"/about"`, `"/users/[id]"` or `"/docs/[...slug]"`. No query or fragment. |
| `options.params` | `{ [segmento]: string }`                                           | none     | Dynamic segments. Required for a dynamic route and forbidden for a static one. Values are nonempty text; a `[...slug]` accepts `/`.                        |
| `options.search` | `Record<string, string \| number \| boolean \| null \| undefined>` | none     | The query string. Omits keys with `null` or `undefined`.                                                                                                   |

Outside an application (a unit test, a script), the other form takes the manifest: `href(routes, id, options)`.

## Return value

The path as text, with each parameter encoded through `encodeURIComponent` and the query string appended:

```ts
// href("/users/[id]", { params: { id: "a b ñ" }, search: { tab: "perfil", page: 2, empty: null, flag: true } })
// "/users/a%20b%20%C3%B1?tab=perfil&page=2&flag=true"
```

It is a same-origin path, without a scheme or host. For an absolute URL (an email, a sitemap), combine it with the public origin: `new URL(href(…), "https://example.com")`.

## Examples

### Redirect to a typed route

```html
<!-- app/pages/orders/new.meeko -->
<script server lang="ts">
const { context } = usePage();
if (!context.session.current) redirect(href("/login", { search: { next: "/orders/new" } }));
export const ready = true;
</script>

<template><h1>Nuevo pedido</h1></template>
```

### Copy an absolute link

`href` returns a same-origin path; to share it, combine it with the page's origin:

```html
<script lang="ts">
const props = defineProps<{ id: string }>();
async function copyLink(): Promise<void> {
  const url = new URL(href("/users/[id]", { params: { id: props.id } }), location.origin);
  await navigator.clipboard.writeText(url.href);
}
</script>

<template><button type="button" on:click="copyLink">Copiar enlace</button></template>
```

### In a unit test, with the manifest

```ts
import { createRouteManifest, href } from "@meekojs/meeko/framework";

const routes = createRouteManifest([
  { id: "/users/[id]", file: "app/pages/users/[id].meeko", layouts: [] },
  { id: "/docs/[...slug]", file: "app/pages/docs/[...slug].meeko", layouts: [] },
]);

href(routes, "/users/[id]", { params: { id: "42" } }); // "/users/42"
href(routes, "/docs/[...slug]", { params: { slug: "guia/inicio" } }); // "/docs/guia/inicio"
```

## Common mistakes

### A nonexistent route, or a query in the ID

```ts bad
href("/nowhere");
href("/users/[id]?tab=1", { params: { id: "7" } });
```

`meeko check` reports `TS2345: Argument of type '"/nowhere"' is not assignable to parameter of type '"/" | "/users/[id]"'.`, with the application's route list. With a query in the ID, `TS2769: No overload matches this call.`

<!-- no-check -->

```ts good
href("/users/[id]", { params: { id: "7" }, search: { tab: "1" } });
```

### Forget parameters, or pass numbers

```ts bad
href("/users/[id]");
href("/users/[id]", { params: { id: 7 } });
```

`meeko check` reports `TS2554: Expected 2 arguments, but got 1.` and `TS2769: No overload matches this call.` Without types (an ID arriving as `string`), execution throws `Error: Missing route parameter: id`, including with `id: ""`.

<!-- no-check -->

```ts good
href("/users/[id]", { params: { id: String(user.id) } });
```

### A `/` in a simple parameter

An `[id]` segment is a single URL segment: it cannot contain `/`.

```ts bad
href("/users/[id]", { params: { id: "equipo/ana" } });
```

At runtime, `Error: Invalid route parameter: id`. For paths with slashes, use a `[...slug]` segment.

<!-- no-check -->

```ts good
href("/docs/[...slug]", { params: { slug: "equipo/ana" } });
```

### Call it outside an application

```ts bad
// scripts/sitemap.ts, ejecutado con node
const url = href("/users/[id]", { params: { id: "1" } });
```

`Error: href(id) needs a running Meeko application (a server request or a mounted browser app); outside one, pass the manifest: href(routes, id)`.

<!-- no-check -->

```ts good
const url = href(routes, "/users/[id]", { params: { id: "1" } });
```

## Notes

- **Types.** `RouteId` is the union of routes in `.meeko/types/routes.d.ts`, generated by `meeko check`, `meeko dev` and `meeko routes`; without these declarations it is `string` and no checking occurs. A new page needs one of these commands for its ID to become valid.
- **SSR and hydration.** The server and browser build the same URL from the same manifest, so a `bind:href="href(…)"` hydrates without differences.
- **Security.** Parameters are encoded, so a user value cannot change the path or add a query. `search` values are also encoded.
- **Links.** For an `<a>` with `aria-current`, use `<MeekoLink>`, which calls `href` and marks the current page.
