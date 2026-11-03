---
title: <script server>
group: syntax
since: 1.0.0
description: A page's server code inside its .meeko file, with route options and typed JSON data exported to the template.
symbols:
  - "syntax:script-server"
related:
  - docs/como-elegir.md
  - "@meekojs/meeko/framework#definePage"
  - "@meekojs/meeko/framework#usePage"
  - "@meekojs/meeko/framework#redirect"
  - "@meekojs/meeko/framework#notFound"
  - "@meekojs/meeko/framework#defer"
  - "@meekojs/meeko/framework#useHead"
  - docs/framework.md#código-de-servidor-de-la-página
  - docs/framework.md#reglas-comunes
  - docs/framework.md#dónde-se-usa-cada-api
source-hash: a40de7461157d0a74c351f2ce19bd9903f09f2b0415e16d91b9774f2df91d0af
---

`<script server lang="ts">` is an `app/pages` page's server code, in its `.meeko` file. It never forms part of the component or reaches the browser (except with `render: "client"`): it runs on the server, with `server/utils` auto-imports, and can import `server/`, `*.server.*` modules and secrets.

The block supports two forms, which can coexist except for `load` alongside top-level code:

- **Top-level code** (since `1.1`). Runs on each request: reads the request with `usePage()`, queries the database, redirects or responds with `404`. Each `export const` is typed page data available in `<script>` and the template.
- **Route options.** `export const route = definePage({ … })`: schemas, rendering mode, loader, `<head>`, layout, middleware, cache and sitemap. The same form as a `*.route.ts` sidecar.

## Usage

```html
<!-- app/pages/users/[id].meeko -->
<script server lang="ts">
export const route = definePage({ head: () => ({ title: "Profile" }) });

const { params } = usePage();
const row = await findUser(params.id);
if (!row) notFound();
export const user = { id: row.id, name: row.name };
</script>

<script lang="ts">
const name = signal(user.name);
</script>

<template>
  <h1>{user.name}</h1>
  <input model="name" aria-label="Name">
</template>
```

`findUser` is an auto-imported function from `server/utils`. `row` never leaves the server; only the export, `user`, travels in the payload.

## Attributes

| Attribute | Type     | Default  | Description                                                                         |
| --------- | -------- | -------- | ----------------------------------------------------------------------------------- |
| `server`  | no value | required | Marks the block as server code. With a value (`server="true"`), produces `MEEK043`. |
| `lang`    | `"ts"`   | required | The block is TypeScript. Omitting it produces `MEEK006`.                            |

A page has at most one `<script server>` (`MEEK004`), alongside its `<script lang="ts">` and `<template>`.

## Result

| What the block declares                                       | When evaluated                                                                                       | Where it goes                                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `import`, types, `export const route`                         | Once, on module loading                                                                              | `route` is read by the server, `meeko build` and `meeko check` |
| Top-level statements                                          | Each request (SSR and each navigation's data), after middleware and `params` and `search` validation | Nowhere: private                                               |
| `export const x` / `export let x` (except `route` and `head`) | Each request                                                                                         | To `<script>` and the template as read-only JSON `x`           |
| `export const head`                                           | Each request                                                                                         | To the document's `<head>`, like `route.head`                  |

An exported promise is awaited before rendering; with `render: "stream"`, an export using `defer` arrives after the first render.

## Examples

### A protected page with a redirect

`usePage().context` gives the request's session; `redirect()` stops the block:

```html
<!-- app/pages/account.meeko -->
<script server lang="ts">
const { context, url } = usePage();
const session = context.session.current;
if (!session) redirect(`/login?next=${encodeURIComponent(url.pathname)}`);
export const account = { id: session.id };
export const head = { title: "Your account", description: "Account settings." };
</script>

<template><h1>Account {account.id}</h1></template>
```

To avoid repeating the guard in every page, server route middleware (`app/middleware/auth.server.ts`) applies it to a group of routes.

### Validate `params` with a schema

Route options are evaluated before top-level code, and their schemas type `usePage()`:

```html
<!-- app/pages/orders/[id].meeko -->
<script server lang="ts">
import * as v from "valibot";

export const route = definePage({
  params: v.object({ id: v.pipe(v.string(), v.regex(/^\d+$/)) }),
  search: v.object({ tab: v.optional(v.picklist(["items", "history"]), "items") }),
});

const { params, search } = usePage();       // params.id: string, search.tab: "items" | "history"
export const order = { id: Number(params.id), tab: search.tab };
</script>

<template><h1>Order {order.id}</h1></template>
```

A URL with `id=abc` responds with `400` before running the block.

### Slow data with streaming

With `render: "stream"`, an export using `defer` does not delay the first byte:

```html
<!-- app/pages/dashboard.meeko -->
<script server lang="ts">
export const route = definePage({ render: "stream" });

export const user = { name: "Ana" };
export const stats = defer(async () => ({ visits: 1200 }));
</script>

<template>
  <h1>Hello, {user.name}</h1>
  <p if:when="stats.status === 'pending'">Loading statistics…</p>
  <p if:when="stats.status === 'resolved'">{stats.value?.visits} visits</p>
</template>
```

### Only route options

A block without top-level code is evaluated once, like a sidecar, and can use a loader:

```html
<!-- app/pages/blog/index.meeko -->
<script server lang="ts">
export const route = definePage({
  render: "prerender",
  load: async () => ({ posts: [{ slug: "hola", title: "Hello, Meeko" }] }),
  head: ({ data }) => ({ title: `Blog (${data.posts.length})` }),
});
</script>

<script lang="ts">
const props = defineProps<{ params: Record<string, string>; search: Record<string, string | string[]>; data: { posts: { slug: string; title: string }[] } }>();
</script>

<template>
  <ul><li each:of="props.data.posts" each:as="post" each:key="post.slug">{post.title}</li></ul>
</template>
```

## Common mistakes

### A `<script server>` in a component or layout

```html bad
<!-- app/components/UserCard.meeko -->
<script server lang="ts">
export const user = await findUser("1");
</script>
```

`meeko check` reports `MEEK044: <script server> declara opciones de ruta y sólo se admite en las páginas de app/pages`. A component requests data with `useApi` or `useRpcQuery`, or receives it in props.

```html good
<!-- app/components/UserCard.meeko -->
<script lang="ts">
const props = defineProps<{ user: { id: string; name: string } }>();
</script>
```

### Export something other than JSON

Exports travel to the browser as JSON.

```html bad
<script server lang="ts">
export const createdAt = new Date();
export const format = (n: number) => n.toFixed(2);
</script>
```

`meeko check` reports `TS2344: Type 'Date' does not satisfy the constraint '{ toString: "not serializable to JSON: functions, undefined, bigint, symbols and class instances cannot reach the client"; … }'` and likewise for the function. An `export function` produces `MEEK071: export function no se admite en un <script server> con código de nivel superior: cada export const o export let es un dato de la página, que debe poder serializarse como JSON; …`.

```html good
<script server lang="ts">
export const createdAt = new Date().toISOString();
</script>
```

Convert dates to strings and move functions to `<script>` or a shared module.

### `usePage()` in the component's `<script>`

```html bad
<script lang="ts">
const { params } = usePage();
</script>
```

`MEEK073: usePage() sólo funciona en el código de nivel superior del <script server> de una página: el <script> y la plantilla de un componente también se ejecutan en el navegador`. The same applies to `redirect` and `notFound`. In the component, `useRoute()` provides the current route.

```html good
<script server lang="ts">
const { params } = usePage();
export const id = params.id;
</script>
```

### Import `server/` from `<script>`

```html bad
<script lang="ts">
import { articleHtml } from "../../server/content/articles";
</script>
```

`MEEK108: ../../server/content/articles es un módulo de servidor (server/ o *.server.*) y no puede llegar al bundle del navegador: …; para sus tipos, usa import type`.

```html good
<script server lang="ts">
import { articleHtml } from "../../server/content/articles";
export const body = articleHtml("<p>Hello</p>");
</script>
```

### The same name in the block and `<script>`

```html bad
<script server lang="ts">
export const total = 1;
</script>
<script lang="ts">
const total = 2;
</script>
```

`MEEK075: total ya lo exporta <script server> y está en el ámbito como dato de la página; cambia el nombre de la declaración o del export`. Exports are read-only: assigning them produces `TS2588: Cannot assign to 'total' because it is a constant.`

```html good
<script server lang="ts">
export const total = 1;
</script>
<script lang="ts">
const count = signal(total);
</script>
```

### Top-level code with `render: "client"`

```html bad
<script server lang="ts">
export const route = definePage({ render: "client" });
export const total = 1;
</script>
```

`MEEK074: Una página render: "client" no puede tener código de servidor de nivel superior: su <script server> se ejecuta en el navegador. Pide los datos con useApi o useRpcQuery, o renderiza en el servidor`.

```html good
<script server lang="ts">
export const route = definePage({ render: "client", load: async () => ({ total: 1 }) });
</script>
```

### Component macros in the block

```html bad
<script server lang="ts">
const props = defineProps<{ title: string }>();
</script>
```

`MEEK108: defineProps sólo existe en el <script> de un componente: <script server> se ejecuta fuera del componente, antes de renderizar la página. Muévelo al <script lang="ts">`.

```html good
<script lang="ts">
const props = defineProps<{ title: string }>();
</script>
```

## Notes

- **Security.** The block, its imports and private variables never reach the browser bundle or payload: only exports do. Export only what the page needs (`{ id, name }`, not the full row with its `passwordHash`).
- **When it runs.** Each request reruns top-level code, including each client navigation's data request. A top-level variable (`const cache = new Map()`) is new each time: anything that must survive between requests belongs in an imported module.
- **Options and code.** Route options are evaluated once before code and cannot read its variables (`MEEK076`). `route.load` and top-level code cannot combine (`MEEK070`); neither can `export const head` and `route.head` (`MEEK072`).
- **Hydration.** Exports travel in the payload and are not signals: the browser receives them already calculated and does not rerun the block. For writable state, create a signal from them.
- **`render: "client"`.** The block is sent to the browser and is public: it cannot contain top-level code or import `server/`.
- **Sidecar or block.** A page cannot declare options in both `<script server>` and `*.route.ts`: route discovery stops with an error naming both.

> [!NOTE]
> The recommended form is `export const route = definePage(…)`. Since `1.7`, `export default definePage(…)` in a block without top-level code also passes `meeko check`, both for the project and the standalone file, as the build and runtime already accepted it; through `1.6`, the project check failed with `has no exported member 'route'`.
