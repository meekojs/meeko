---
title: useRequestState
group: composables
since: 1.0.0
description: Stores a value in server request state, creating it on first access, to share it among middleware, loaders and handlers for that request.
symbols:
  - "@meekojs/meeko/server#useRequestState"
types:
  - "@meekojs/meeko/server#RequestContext"
related:
  - "@meekojs/meeko/framework#usePage"
  - "@meekojs/meeko/framework#useState"
  - "@meekojs/meeko/server#defineServerMiddleware"
  - "@meekojs/meeko/server#defineRpc"
  - "@meekojs/meeko/server#defineApiRoute"
  - docs/framework.md#valores-por-petición-locals
  - docs/framework.md#runtime-de-servidor
source-hash: 29c82706137641be5b639256a9408d9d90a70a23137df11ce8ee0554bb231dcd
---

A request passes through several server pieces: route middleware, `<script server>` code or the page's `load`, and the `api.*` and `rpc.*` calls made by SSR, which dispatch locally with the same context. `useRequestState(context, key, factory)` stores a value in `context.state`, that request's `Map`: the first piece to request `key` creates it with `factory()`, and the others receive the same value. Use it for a per-request cache (avoiding querying the same user twice), a batch loader or a counter.

When the request ends, the value disappears with it: it is never shared between users. This is server code: import it from `@meekojs/meeko/server`.

## Usage

<!-- no-check -->

```ts
// server/rpc/users/get.ts
import { defineRpc, useRequestState } from "@meekojs/meeko/server";
import { userParams, userSchema } from "../../../shared/schemas/users.js";

export default defineRpc({
  input: userParams,
  output: userSchema,
  handler: async ({ input, context }) => {
    const cache = useRequestState(context, "users:byId", () => new Map<string, Promise<{ id: string; name: string }>>());
    let user = cache.get(input.id);
    if (!user) {
      user = context.services.db.users.findById(input.id);
      cache.set(input.id, user);
    }
    return user;
  },
});
```

If a page requests the same user in two components during SSR, the database receives only one query.

## Parameters

| Parameter | Type             | Default  | Description                                                                                                      |
| --------- | ---------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `context` | `RequestContext` | required | The request context: `context` from a handler, `load`, middleware or `usePage()`.                                |
| `key`     | `string`         | required | Key for the value within the request. Use your own prefix (`"users:byId"`) to avoid colliding with other pieces. |
| `factory` | `() => T`        | required | Creates the value if the key does not yet exist in this request.                                                 |

## Return value

The value `T` for that key in the request. It is not a signal and is not transferred to the browser.

## Examples

### Sharing middleware calculations with the page

<!-- no-check -->

```ts
// app/middleware/01-tenant.server.ts
import { useRequestState } from "@meekojs/meeko/server";

export default defineServerRouteMiddleware(async ({ context, url }) => {
  const host = url.hostname;
  const tenant = await context.services.db.tenants.byHost(host);
  useRequestState(context, "tenant", () => tenant);
});
```

```html
<!-- app/pages/index.meeko -->
<script server lang="ts">
import { useRequestState } from "@meekojs/meeko/server";
const { context } = usePage();
const tenant = useRequestState(context, "tenant", () => null as { id: string; name: string } | null);
export const brand = tenant?.name ?? "Mi tienda";
</script>

<template><h1>{brand}</h1></template>
```

### A typed helper

Repeating the key and type on every call is fragile. A helper fixes them in one place:

```ts
// server/utils/request-cache.ts
import { useRequestState } from "@meekojs/meeko/server";
import type { RequestContext } from "@meekojs/meeko/server";

export function requestCache<T>(context: RequestContext, name: string): Map<string, T> {
  return useRequestState(context, `cache:${name}`, () => new Map<string, T>());
}
```

### Counting queries in development

```ts
import { useRequestState } from "@meekojs/meeko/server";
import type { RequestContext } from "@meekojs/meeko/server";

export function countQuery(context: RequestContext): number {
  const counter = useRequestState(context, "debug:queries", () => ({ value: 0 }));
  return ++counter.value;
}
```

Because `factory` returns an object, every call receives the same one and can modify it.

## Common mistakes

### Using it in the component's `<script>`

```html bad
<script lang="ts">
import { useRequestState } from "@meekojs/meeko/server";
</script>
```

`meeko check` reports `MEEK108: @meekojs/meeko/server sólo existe en el servidor y no se puede cargar en el navegador: el <script> y la plantilla de un componente también se ejecutan en el navegador. Mueve ese código a <script server> o a server/; para usar sus tipos, impórtalos con import type`. For component state transferred to the browser, use [`useState`](/en/docs/reference/usestate); for server data, export it from `<script server>`:

```html good
<script server lang="ts">
import { useRequestState } from "@meekojs/meeko/server";
const { context } = usePage();
export const tenantName = useRequestState(context, "tenant", () => ({ name: "Mi tienda" })).name;
</script>
```

### A module variable as a cache

```ts bad
// server/utils/users.ts
const cache = new Map<string, User>();
export const findUser = (id: string) => cache.get(id) ?? loadUser(id);
```

There is no error, but the `Map` lives in the process: all requests and users share it, it grows without limit and may return one user's data to another. Store the cache in the request:

<!-- no-check -->

```ts good
export const findUser = (context: RequestContext, id: string) =>
  useRequestState(context, "users", () => new Map<string, Promise<User>>()).get(id) ?? loadUser(id);
```

### The same key with different types

```ts bad
useRequestState(context, "user", () => session.userId);         // string
const user = useRequestState(context, "user", () => loadUser()); // espera un User
```

`useRequestState` does not know the stored type: the second call receives the text stored by the first, typed as `User`, and fails later. Use different keys or a helper with a fixed key and type like the one above.

<!-- no-check -->

```ts good
useRequestState(context, "user:id", () => session.userId);
```

## Notes

- **One request.** State lives in `context.state`, a new `Map` per request. Local `api.*` and `rpc.*` calls during that page's SSR use the same context, so they share state; a later browser HTTP request has its own.
- **Not transferred.** Nothing you store reaches the browser. For page state the browser needs, export data from `<script server>` or use `useState`.
- **Server only.** Import it from `@meekojs/meeko/server`; in a component's `<script>` and template, it is `MEEK108`.
- **Promises.** Store the promise, not the result, if two pieces may request the same value simultaneously: the second waits for the first instead of starting another query.
