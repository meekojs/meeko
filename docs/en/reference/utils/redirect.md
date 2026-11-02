---
title: redirect
group: utils
since: 1.1.0
description: Stops page server code or server route middleware and responds with a redirect, which client navigation follows in the same way.
symbols:
  - "@meekojs/meeko/framework#redirect"
related:
  - "@meekojs/meeko/framework#notFound"
  - "@meekojs/meeko/framework#usePage"
  - "@meekojs/meeko/framework#href"
  - "@meekojs/meeko/framework#defineServerRouteMiddleware"
  - "syntax:script-server"
  - docs/framework.md#código-de-nivel-superior-y-datos-exportados
  - docs/framework.md#middleware-de-ruta-de-servidor
source-hash: 3a5439344af59175fd56c7afa991301e181b16a3760e5a4ac2b389d16310018c
---

`redirect(url, status?)` stops the top-level code in a page's `<script server>` and responds with a redirect. Since `1.6`, it also stops server route middleware (`app/middleware/*.server.ts`). In SSR it is a `302` response (by default) with `Location`; during client navigation, the browser follows it just like a loader's redirect.

It works by throwing: code after `redirect()` does not run, and its return type is `never`, so TypeScript narrows types after the call. Inside `<script server>`, use it without an import.

## Usage

```html
<!-- app/pages/account.meeko -->
<script server lang="ts">
const { context, url } = usePage();
const session = context.session.current;
if (!session) redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
export const account = { id: session.id };
</script>

<template><h1>Cuenta {account.id}</h1></template>
```

After the `if`, `session` is no longer `undefined`.

## Parameters

| Parameter | Type                              | Default  | Description                                                                                                                                         |
| --------- | --------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `url`     | `string \| URL`                   | required | The destination: a path (`"/login"`) or an absolute URL.                                                                                            |
| `status`  | `301 \| 302 \| 303 \| 307 \| 308` | `302`    | The HTTP status. `301` and `308` are permanent (browsers and caches remember them); `303` changes the method to `GET`; `307` and `308` preserve it. |

## Return value

It never returns (`never`): it throws a response with `Location` and `cache-control: no-store`, which the server sends as is. It throws other errors in two cases:

- outside its supported location, `Error: MEEK073: redirect() sólo está disponible mientras se ejecuta el código de nivel superior del <script server> de una página o, desde 1.6, un middleware de ruta de servidor`;
- with another status, `RangeError: redirect status must be 301, 302, 303, 307 or 308, not 404`.

## Examples

### An old URL with a permanent redirect

```html
<!-- app/pages/blog/[slug].meeko -->
<script server lang="ts">
const renamed: Record<string, string> = { "hola-mundo": "hola-meeko" };
const { params } = usePage();
const target = renamed[params.slug];
if (target) redirect(href("/blog/[slug]", { params: { slug: target } }), 301);
export const post = { slug: params.slug };
</script>

<template><h1>{post.slug}</h1></template>
```

### From server route middleware

In `app/middleware/*.server.ts`, import `redirect`:

```ts
// app/middleware/auth.server.ts
import { defineServerRouteMiddleware, redirect } from "@meekojs/meeko/framework";

export default defineServerRouteMiddleware(({ session, url }) => {
  if (!session.current) redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
}, { global: false });
```

### From a loader, returning a `Response`

`redirect()` does not work inside `load`, which is a route option. Return a `Response` there:

<!-- no-check -->

```ts
// app/pages/legacy.route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  load: ({ url }) => Response.redirect(new URL("/nuevo", url), 301),
});
```

## Common mistakes

### Calling it in the component's `<script>`

```html bad
<script lang="ts">
const go = () => redirect("/login");
</script>
```

`MEEK073: redirect() sólo funciona en el código de nivel superior del <script server> de una página: el <script> y la plantilla de un componente también se ejecutan en el navegador`. In the component, navigate with a link or `location.assign`.

```html good
<script server lang="ts">
const { context } = usePage();
if (!context.session.current) redirect("/login");
export const ok = true;
</script>
```

### Calling it inside `load` or another route option

```ts bad
export const route = definePage({ load: ({ params }) => { if (!params.id) redirect("/"); return { id: params.id }; } });
```

`MEEK073: redirect() sólo funciona en el código de nivel superior de <script server>, que se ejecuta en cada petición; llámala fuera de cualquier función y fuera de las opciones de ruta`.

<!-- no-check -->

```ts good
export const route = definePage({ load: ({ params, url }) => params.id ? { id: params.id } : Response.redirect(new URL("/", url)) });
```

### A nonredirect status

```ts bad
redirect("/login", 404);
```

The project's `meeko check` reports `TS2345: Argument of type '404' is not assignable to parameter of type '301 | 302 | 303 | 307 | 308 | undefined'.` At runtime, `RangeError: redirect status must be 301, 302, 303, 307 or 308, not 404`. For a `404`, use `notFound()`.

<!-- no-check -->

```ts good
redirect("/login", 303);
```

### Wrapping it in `try`

`redirect` works by throwing: a `catch` that does not rethrow swallows the redirect, without any error.

```ts bad
try {
  if (!session) redirect("/login");
  data = await load();
} catch {
  data = null;
}
```

<!-- no-check -->

```ts good
if (!session) redirect("/login");
try {
  data = await load();
} catch {
  data = null;
}
```

## Notes

- **Security.** Do not redirect to a URL received in the request without checking it (`?next=https://otro.example`): this is an open redirect. Check that it starts with `/` and not `//`, or construct the destination with `href`.
- **Cache.** The response carries `cache-control: no-store`: a session-dependent redirect is never stored in a shared cache.
- **Navigation.** In the browser, the page data request receives the redirect and navigation follows it without reloading, just like a loader's redirect.
- **`render: "client"` and `"prerender"`.** These pages have no top-level server code; use isomorphic route middleware, which returns `Response.redirect(…)`.
