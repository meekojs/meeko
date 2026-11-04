---
title: notFound
group: utils
since: 1.1.0
description: Stops the page's server code or server route middleware and displays the nearest error page with status 404.
symbols:
  - "@meekojs/meeko/framework#notFound"
related:
  - "@meekojs/meeko/framework#redirect"
  - "@meekojs/meeko/framework#usePage"
  - "@meekojs/meeko/server#ApiError"
  - "syntax:script-server"
  - docs/framework.md#código-de-nivel-superior-y-datos-exportados
  - docs/framework.md#página-de-error-de-la-aplicación-apperrormeeko
source-hash: 8d7a366f24e854f3048245b2636b63b1ef9880e861746b593230ac9d79eb055f
---

`notFound()` stops the top-level code in a page's `<script server>` and responds with `404` and the nearest error page (the folder's `+error.meeko`, or `app/error.meeko`), which receives `{ status: 404, message: "NOT_FOUND" }`. Since `1.6`, it also stops server route middleware.

It works by throwing and its return type is `never`: after `if (!row) notFound()`, TypeScript knows that `row` exists. Inside `<script server>`, you use it without an import.

## Usage

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
const { params } = usePage();
const row = await findUser(params.id);
if (!row) notFound();
export const user = { id: row.id, name: row.name };
</script>

<template><h1>{user.name}</h1></template>
```

## Parameters

Takes no parameters.

## Return value

Never returns (`never`). Throws an error that the server treats as an `ApiError("NOT_FOUND", 404)`:

- in SSR, the response is `404` with the nearest error page;
- during client navigation, the data request responds with `404` and the browser displays the nearest `+error.meeko`, or `app/error.meeko`, inside the page's layouts.

Outside its supported location, it throws `Error: MEEK073: notFound() sólo está disponible mientras se ejecuta el código de nivel superior del <script server> de una página o, desde 1.6, un middleware de ruta de servidor`.

## Examples

### Hide a page from someone without permission

Responding with `404` instead of `403` does not reveal that the resource exists:

```html
<!-- app/pages/projects/[id].meeko -->
<script server lang="ts">
const { params, context } = usePage();
const project = await findUser(params.id);
if (!project || !context.session.current) notFound();
export const summary = { id: project.id, name: project.name };
</script>

<template><h1>{summary.name}</h1></template>
```

### An error page for a section

```html
<!-- app/pages/users/+error.meeko -->
<script lang="ts">
const props = defineProps<{ status: number; message: string }>();
</script>

<template>
  <h1 if:when="props.status === 404">That user does not exist</h1>
  <h1 if:when="props.status !== 404">Something went wrong ({props.message})</h1>
  <MeekoLink to="/">Back to home</MeekoLink>
</template>
```

### From a loader

`notFound()` does not work inside `load`. Throw an `ApiError` there for the same effect:

<!-- no-check -->

```ts
// app/pages/products/[slug].route.ts
import { definePage } from "@meekojs/meeko/framework";
import { ApiError } from "@meekojs/meeko/server";

export const route = definePage({
  load: async ({ params }) => {
    const product = await catalog.find(params.slug);
    if (!product) throw new ApiError("NOT_FOUND", 404);
    return { name: product.name };
  },
});
```

## Common mistakes

### Call it inside `load`

```ts bad
export const route = definePage({ load: ({ params }) => { if (!params.id) notFound(); return { id: 1 }; } });
```

`MEEK073: notFound() sólo funciona en el código de nivel superior de <script server>, que se ejecuta en cada petición; llámala fuera de cualquier función y fuera de las opciones de ruta`.

<!-- no-check -->

```ts good
export const route = definePage({ load: ({ params }) => { if (!params.id) throw new ApiError("NOT_FOUND", 404); return { id: 1 }; } });
```

### Call it in the component's `<script>`

```html bad
<script lang="ts">
if (!props.user) notFound();
</script>
```

`MEEK073: notFound() sólo funciona en el código de nivel superior del <script server> de una página: el <script> y la plantilla de un componente también se ejecutan en el navegador`. Decide the `404` on the server before rendering.

```html good
<script server lang="ts">
const row = await findUser(usePage().params.id);
if (!row) notFound();
export const user = { id: row.id, name: row.name };
</script>
```

### Return `null` instead of responding with `404`

A page that renders “Not found” with status `200` is a valid page for search engines and caches, without any error.

```html bad
<script server lang="ts">
const row = await findUser(usePage().params.id);
export const user = row ? { id: row.id, name: row.name } : null;
</script>
```

```html good
<script server lang="ts">
const row = await findUser(usePage().params.id);
if (!row) notFound();
export const user = { id: row.id, name: row.name };
</script>
```

## Notes

- **Error page.** The nearest `+error.meeko` to the page is used or, if there is none, `app/error.meeko`. Both receive `status` and `message`; `meeko check` checks that they accept them.
- **SEO.** Status `404` prevents search engines from indexing the URL and caches from storing it as a normal page.
- **`try`.** Like `redirect`, it works by throwing: do not wrap it in a `try` that swallows the error.
- **API and RPC.** In an endpoint, the equivalent is `throw new ApiError("NOT_FOUND", 404)`, which the client receives as a `ClientError` with `status` `404`.
