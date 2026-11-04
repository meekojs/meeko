---
title: useState
group: composables
since: 1.0.0
description: Returns the application's shared state signal for a key, created on first access, scoped per request in SSR and transferred to the browser.
symbols:
  - "@meekojs/meeko/framework#useState"
types:
  - "@meekojs/meeko/framework#StateStore"
related:
  - "@meekojs/meeko#signal"
  - "@meekojs/meeko/framework#useStorage"
  - "@meekojs/meeko#provide"
  - "@meekojs/meeko#serializeJson"
  - docs/framework.md#autoimports-y-typescript
  - docs/framework.md#estado-persistente-usestorage
source-hash: 7440434610600f32715dc865579b034fcf8fce700bb1dcd55751455def8bef57
---

A [`signal`](/en/docs/reference/signal) created in a component belongs to it: another component cannot see it. `useState(key, factory)` gives you an **application** signal, one per key: the first component requesting `"cart:items"` creates it with `factory()`, and all others requesting the same key receive the same signal. It is the basis of stores in `app/stores`.

In SSR, there is one store per request, so two users never share state; its content is transferred in the payload, and the browser restores it before hydration. In the browser, there is one per mounted application, surviving navigations. It is auto-imported in applications.

## Usage

```ts
// app/stores/cart.ts
import { useState } from "@meekojs/meeko/framework";

export function useCart() {
  const items = useState("cart:items", (): string[] => []);
  const add = (id: string): void => { items.value = [...items.value, id]; };
  return { items, add };
}
```

```html
<!-- app/components/CartBadge.meeko -->
<script lang="ts">
const { items } = useCart();
</script>

<template><span class="badge">{items.value.length}</span></template>
```

Any component calling `useCart()` reads and writes the same list.

## Parameters

| Parameter | Type      | Default  | Description                                                                                                                                      |
| --------- | --------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `key`     | `string`  | required | Unique application key, such as `"cart:items"`. Must not be empty or `__proto__`, `constructor` or `prototype` (`TypeError: Invalid state key`). |
| `factory` | `() => T` | required | Creates the initial value the first time the key is requested. Must return something JSON represents faithfully.                                 |

## Return value

The shared `Signal<T>` for that key. Outside a Meeko application, it throws `Error: Missing Meeko context: Meeko framework state`.

## Examples

### A store with computed state

```ts
// app/stores/session.ts
import { computed } from "@meekojs/meeko";
import { useState } from "@meekojs/meeko/framework";

export function useSessionStore() {
  const user = useState<{ id: string; name: string } | null>("session:user", () => null);
  const signedIn = computed(() => user.value !== null);
  return { user, signedIn, signOut: () => { user.value = null; } };
}
```

### Server-seeded state

The server fills state during rendering; the browser receives it in the payload and does not repeat the work:

```html
<!-- app/app.meeko -->
<script lang="ts">
const visits = useState("app:renderedAt", () => new Date().toISOString());
</script>

<template>
  <div class="site-root"><MeekoOutlet /></div>
  <footer>Rendered: {visits.value}</footer>
</template>
```

`factory` runs on the server; during hydration, the browser already has the key and does not call it again, so the text matches.

### Sharing between pages

In the browser, the store lives as long as the application is mounted: a filter selected on a page is still there when you return.

```ts
// app/stores/filters.ts
import { useState } from "@meekojs/meeko/framework";

export const useFilters = () => useState("products:filters", () => ({ category: "todas", sort: "precio" }));
```

## Common mistakes

### A value JSON cannot represent

```ts bad
const when = useState("agenda:when", () => new Date());
```

State is transferred as JSON: serializing the payload fails the response with `TypeError: Non-plain object at $.when`. Store the text and derive the object:

<!-- no-check -->

```ts good
const when = useState("agenda:when", () => new Date().toISOString());
const date = computed(() => new Date(when.value));
```

### Passing the value instead of the function

```ts bad
const count = useState<number>("cart:count", 0);
```

`meeko check` reports `TS2345: Argument of type 'number' is not assignable to parameter of type '() => number'`.

<!-- no-check -->

```ts good
const count = useState("cart:count", () => 0);
```

### Mutating the array or object

```ts bad
items.value.push(id);
```

There is no error, but the signal does not notify: neither the template nor other components notice. Assign a new value:

<!-- no-check -->

```ts good
items.value = [...items.value, id];
```

### Writing state after the page has been sent

On the server, the store is sealed after rendering: the payload has already been written.

```ts bad
// In a component script: an unawaited promise that writes after rendering.
const stats = useState<Stats | null>("stats", () => null);
fetchStats().then((value) => { stats.value = value; });
```

In SSR, the late write throws `STATE_SEALED: Meeko state "stats" cannot change after the page was rendered; the browser already received it` and, without a `catch`, is an unhandled rejection. Load data before rendering, in `<script server>`, `load` or with `await useApi`:

<!-- no-check -->

```ts good
const stats = await useRpcQuery("stats.summary");
```

## Notes

- **Per request.** On the server, each request has its own store: never keep application state in a module variable, which is shared between users.
- **Hydration.** The browser restores payload state before hydration, so `factory` does not run again for keys the server already created.
- **Navigation.** During client navigation, new keys created by the server are added without replacing existing ones. A `render: "client"` route loader writes to provisional state applied when the route is committed.
- **Persistence.** State lives in memory: reloading creates it again. To survive reloads or share between tabs, use [`useStorage`](/en/docs/reference/usestorage).
- **Security.** Everything you store is transferred in the page HTML: do not put secrets or other users' data there.
- **Where to call it.** In a component's script, or in a composable or store it calls while running. The compiler does not limit it to the top level (it does not report `MEEK054`), but it looks for the store in the active root: there is none in an event handler, so it throws `Missing Meeko context`. Get the signal in the script and use it in the handler.
