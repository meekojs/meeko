---
title: usePage
group: composables
since: 1.1.0
description: Returns the page request (url, params, search, request, context and signal) in the top-level code of its script server.
symbols:
  - "@meekojs/meeko/framework#usePage"
types:
  - "@meekojs/meeko/framework#PageRequest"
related:
  - "syntax:script-server"
  - "@meekojs/meeko/framework#definePage"
  - "@meekojs/meeko/framework#redirect"
  - "@meekojs/meeko/framework#notFound"
  - "@meekojs/meeko/framework#useRoute"
  - "@meekojs/meeko/server#useRequestState"
  - docs/framework.md#código-de-nivel-superior-y-datos-exportados
  - docs/framework.md#dónde-se-usa-cada-api
source-hash: 5c60414df65fc01c4fa118bc2c7aa8c63d9a42fe5b6a04f660b75e6161a34791
---

`usePage()` provides access to the current request from top-level code in a page's `<script server>`: the URL, `params` and `search` already validated by [`definePage`](/en/docs/reference/definepage) schemas, the original `Request`, request context (session, services, platform) and a cancellation signal. The block can then read the database, check the session, redirect or respond with `404`, and export data the page receives.

Inside the block, use it without importing it, and its type follows the schemas and route ID. It only exists there: in the component's `<script>` or template, which also run in the browser, it is error `MEEK073`.

## Usage

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
const { params, context } = usePage();
if (!context.session.current) redirect("/login");
const row = await db.users.findById(params.id);
if (!row) notFound();
export const user = { id: row.id, name: row.name };
</script>

<template><h1>{user.name}</h1></template>
```

Without a schema, `params.id` is `string` because the file is `[id].meeko`. `db` is an auto-import from `server/utils`; `row` never leaves the server, only `user` does.

## Parameters

`usePage()` takes no parameters.

## Return value

A `PageRequest`:

| Property  | Type                                                                             | Description                                                                                                                 |
| --------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `url`     | `URL`                                                                            | Full request URL.                                                                                                           |
| `params`  | output of the `params` schema, or `Readonly<Record<string, string>>`             | Dynamic segments, validated before running the block. Without a schema, one key per `[segmento]` in the file.               |
| `search`  | output of the `search` schema, or `Readonly<Record<string, string \| string[]>>` | Validated query string; without a schema, a repeated key is an array.                                                       |
| `request` | `Request`                                                                        | Original HTTP request: headers, cookies, method.                                                                            |
| `context` | `RequestContext`                                                                 | Request context: `session`, `services`, `platform`, `state`, `requestId`, `clientAddress`.                                  |
| `signal`  | `AbortSignal`                                                                    | Aborted if the client disconnects, the session is revoked or the response is canceled. Pass it to `fetch` and long queries. |

Outside the top-level code of a `<script server>` (or, since `1.6`, server route middleware), it throws `Error: MEEK073: usePage() sólo está disponible mientras se ejecuta el código de nivel superior del <script server> de una página…`.

## Examples

### Schema-validated params and search

```html
<!-- app/pages/products/[slug].meeko -->
<script server lang="ts">
import * as v from "valibot";

export const route = definePage({
  params: v.object({ slug: v.pipe(v.string(), v.regex(/^[a-z0-9-]+$/)) }),
  search: v.object({ tab: v.optional(v.picklist(["detalles", "opiniones"]), "detalles") }),
});

const { params, search, signal } = usePage();      // search.tab: "detalles" | "opiniones"
const product = await catalog.find(params.slug, { signal });
if (!product) notFound();
export const page = { name: product.name, tab: search.tab };
export const head = { title: product.name };
</script>

<template><h1>{page.name}</h1></template>
```

A URL that fails the schema responds with `400` before running the block.

### Session and services

```html
<!-- app/pages/account.meeko -->
<script server lang="ts">
const { context, url } = usePage();
const session = context.session.current;
if (!session) redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
export const orders = await context.services.db.orders.forUser(session.data.userId);
</script>

<template><p>{orders.length} orders</p></template>
```

`redirect` stops the block: the following code only runs with a session.

### Request headers

```html
<script server lang="ts">
const { request } = usePage();
export const language = (request.headers.get("accept-language") ?? "es").split(",")[0] ?? "es";
</script>
```

### A helper function that uses it

`usePage` works in any function called by the block **while** its top-level code runs:

```html
<script server lang="ts">
async function currentUser() {
  const { context } = usePage();
  return context.session.current ? context.services.db.users.findById(context.session.current.data.userId) : null;
}
export const me = await currentUser();
</script>
```

## Common mistakes

### Calling it in the component's `<script>`

```html bad
<script lang="ts">
const { params } = usePage();
</script>
```

`meeko check` reports `MEEK073: usePage() sólo funciona en el código de nivel superior del <script server> de una página: el <script> y la plantilla de un componente también se ejecutan en el navegador`. Export what you need from the server block, or read the route with [`useRoute`](/en/docs/reference/useroute):

```html good
<script server lang="ts">
const { params } = usePage();
export const userId = params.id;
</script>
```

### Calling it in route options

`load`, `head` and other options receive their own context; they are evaluated outside the block's top level.

```html bad
<script server lang="ts">
export const route = definePage({ load: () => ({ id: usePage().params.id }) });
</script>
```

`meeko check` reports `MEEK073: usePage() sólo funciona en el código de nivel superior de <script server>, que se ejecuta en cada petición; llámala fuera de cualquier función y fuera de las opciones de ruta`. Use the `load` argument:

```html good
<script server lang="ts">
export const route = definePage({ load: ({ params }) => ({ id: params.id }) });
</script>
```

### Calling it after the block finishes

```html bad
<script server lang="ts">
setTimeout(() => console.log(usePage().url.pathname), 1000);
export const ok = true;
</script>
```

`meeko check` does not detect it, but running the callback throws `Error: MEEK073: usePage() sólo está disponible mientras se ejecuta el código de nivel superior…`. Read the values beforehand and use that copy:

```html good
<script server lang="ts">
const { url } = usePage();
setTimeout(() => console.log(url.pathname), 1000);
export const ok = true;
</script>
```

## Notes

- **Server only.** The block and its imports never reach the browser; only exported names are transferred. It can read secrets and import `server/` and `*.server.*` modules. With `render: "client"`, the block is public and its top-level code is `MEEK074`.
- **When it runs.** On every request: in SSR and the data request for each client navigation, after middleware and validation of `params` and `search`.
- **Top-level code.** Using `usePage`, `redirect` or `notFound` outside a function turns the block into top-level code, which cannot coexist with `route.load` (`MEEK070`).
- **Security.** Without schemas, `params` and `search` are user-supplied text: validate them with `definePage` before using them in a query. The session in `context` is the request's session; a page that redirects without a session must check it on every request, as here.
- **Cancellation.** Pass `signal` to long operations: if the user closes the tab or navigates elsewhere, the server stops doing work for nobody.
