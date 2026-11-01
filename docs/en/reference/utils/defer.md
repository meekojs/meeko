---
title: defer
group: utils
since: 1.0.0
description: Marks loader or page server code data that can arrive after the first byte with render stream, with reactive state.
symbols:
  - "@meekojs/meeko/framework#defer"
types:
  - "@meekojs/meeko/framework#Deferred"
  - "@meekojs/meeko/framework#DeferOptions"
  - "@meekojs/meeko/framework#DeferredError"
related:
  - "@meekojs/meeko/framework#definePage"
  - "syntax:script-server"
  - "syntax:meekoawait"
  - docs/framework.md#streaming-ssr-render-stream
  - docs/framework.md#modos-de-render
source-hash: 652caca48bb1b905a565903bf5c7e0530ebb67077259137ce3282d73f31f161d
---

`defer(fábrica)` or `defer(promesa)` marks slow page data. With `render: "stream"`, the server sends HTML before the value resolves and the value arrives later in the same response; the page reads it with reactive `status`, `value` and `error`. With `"ssr"` or `"prerender"`, the server awaits it before rendering, so HTML always contains it.

Use it for data that should not delay the first render: comments, recommendations, statistics. Critical data (the title, main content) goes without `defer`.

## Usage

```html
<!-- app/pages/posts/[id].meeko -->
<script server lang="ts">
import { defer } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "stream",
  load: ({ params }) => ({
    post: { id: params.id ?? "", title: `Entrada ${params.id ?? ""}` },
    comments: defer(async (signal) => {
      const response = await fetch(`https://api.example.com/posts/${params.id ?? ""}/comments`, { signal });
      return (await response.json()) as { id: string; text: string }[];
    }, { timeoutMs: 5_000 }),
  }),
});
</script>

<script lang="ts">
import type { Deferred } from "@meekojs/meeko/framework";

interface Comment { id: string; text: string }
export interface Props {
  params: { id: string };
  search: Record<string, string | string[]>;
  data: { post: { id: string; title: string }; comments: Deferred<Comment[]> };
}
const props = defineProps<Props>();
</script>

<template>
  <h1>{props.data.post.title}</h1>
  <p if:when="props.data.comments.status === 'pending'">Cargando comentarios…</p>
  <p if:when="props.data.comments.status === 'rejected'" role="alert">No se pudieron cargar ({props.data.comments.error?.code}).</p>
  <ul if:when="props.data.comments.status === 'resolved'">
    <li each:of="props.data.comments.value ?? []" each:as="comment" each:key="comment.id">{comment.text}</li>
  </ul>
</template>
```

The title arrives in the first byte; comments arrive when the API responds or after 5 seconds. Since `1.7`, `defer` is auto-imported in `<script server>` (including route options), `*.route.ts` sidecars and `server/`; previously you had to import it from `@meekojs/meeko/framework`, and explicit imports still work.

## Parameters

| Parameter           | Type                                                         | Default  | Description                                                                                                                                                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `source`            | `(signal: AbortSignal) => T \| PromiseLike<T>`, or a promise | required | A factory Meeko calls when the loader or block finishes, or an already started promise. The factory receives an `AbortSignal` aborted when the value is no longer awaited: timeout, client disconnect, session revocation, canceled stream, `HEAD` request or, in the browser, leaving the route. |
| `options.timeoutMs` | `number`                                                     | `10000`  | Timeout in milliseconds, from when the loader returns. Must be finite and positive (otherwise, `RangeError`).                                                                                                                                                                                     |

Prefer the factory: an already started promise cannot be canceled, only no longer awaited.

## Return value

A `Deferred<T>`:

| Property | Type                                    | Description                                                                                                                                                      |
| -------- | --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `status` | `"pending" \| "resolved" \| "rejected"` | The state. May gain members in a minor release: an exhaustive `switch` needs a default branch.                                                                   |
| `value`  | `T \| undefined`                        | The resolved value, or `undefined` until resolved.                                                                                                               |
| `error`  | `{ code, status } \| undefined`         | Public failure if rejected: an `ApiError` retains its code and status; any other error arrives as `INTERNAL_ERROR`/`500`; a timeout as `DEFERRED_TIMEOUT`/`504`. |

Reading `status`, `value` or `error` in a template, `computed` or `effect` subscribes to the result.

## Examples

### With a loader

```ts
// app/pages/dashboard.route.ts
import { defer, definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  render: "stream",
  load: async () => ({
    user: { name: "Ana" },
    stats: defer(async (signal) => {
      const response = await fetch("https://api.example.com/stats", { signal });
      return (await response.json()) as { visits: number };
    }),
  }),
});
```

The page receives `props.data.stats` as `Deferred<{ visits: number }>`.

### In top-level code

An `export const` with `defer` in `<script server>` reaches the template under the same name:

```html
<!-- app/pages/home.meeko -->
<script server lang="ts">
export const route = definePage({ render: "stream" });

export const hero = { title: "Hola" };
export const weather = defer(async () => ({ city: "Lima", celsius: 19 }), { timeoutMs: 2_000 });
</script>

<template>
  <h1>{hero.title}</h1>
  <p if:when="weather.status === 'pending'">Consultando el tiempo…</p>
  <p if:when="weather.status === 'resolved'">{weather.value?.city}: {weather.value?.celsius} °C</p>
</template>
```

Each `defer` arrives when it resolves, in any order.

The template receives `weather` as `Deferred<{ city: string; celsius: number }>`, with its types: list items in `value` have the list's type (`each:of="feed.value ?? []"`). Through `1.6`, `defer` was not auto-imported in `<script server>`, and without an import the export arrived untyped (`value.value` compiled and items were `unknown`).

## Common mistakes

### Read the value as a signal

`Deferred` is not a signal: read `status`, `value` and `error` directly, and `value` may be `undefined`.

```html bad
<p>{props.data.stats.value.value.visits}</p>
```

With `stats: Deferred<{ visits: number }>` in `Props`, `meeko check` reports `TS18048: 'props.data.stats.value' is possibly 'undefined'.` and `TS2339: Property 'value' does not exist on type '{ visits: number; }'.`

```html good
<p if:when="props.data.stats.status === 'resolved'">{props.data.stats.value?.visits} visitas</p>
```

### An invalid `timeoutMs`

```ts bad
const slow = defer(load, { timeoutMs: 0 });
```

At runtime, `defer` throws `RangeError: defer timeoutMs must be a positive finite number of milliseconds`.

<!-- no-check -->

```ts good
const slow = defer(load, { timeoutMs: 5_000 });
```

### Expect `defer` to speed up an `"ssr"` page

With `render: "ssr"` or `"prerender"`, the server awaits all `defer` values before responding: the page does not arrive earlier, without any warning.

```ts bad
export const route = definePage({ load: async () => ({ comments: defer(loadComments) }) });
```

<!-- no-check -->

```ts good
export const route = definePage({ render: "stream", load: async () => ({ comments: defer(loadComments) }) });
```

## Notes

- **Streaming.** With `"stream"`, middleware, validation, the critical loader, `head` and synchronous rendering run before the first byte. A `<script type="application/json" data-meeko-deferred="N">` then arrives for each resolved value, applied by the browser after hydration.
- **Navigation.** When navigating to a `"stream"` route, the browser receives `application/meeko+ndjson`: the payload first and each value afterward. Leaving the route aborts pending factories.
- **Security.** A private error never reaches the browser: only `code` and `status`. `5xx` errors reach the server's `onError` with `requestId`.
- **Prerendering.** With `render: "prerender"`, a rejected `defer` fails the request with `500` and `meeko build` with the route, instead of saving the error in HTML.
- **Cache (`1.7`).** With `cache` in `definePage`, a `"stream"` page only uses `ETag` and `304`: its body is not cached in memory, because that would fix its deferred values.
- **Serialization.** The resolved value travels as JSON, like any page data.
