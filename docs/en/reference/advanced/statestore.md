---
title: StateStore
group: advanced
since: 1.0.0
description: Stores useState state, with one signal per key and JSON-serializable values, created per request on the server and transferred to the browser.
symbols:
  - "@meekojs/meeko/framework#StateStore"
related:
  - "@meekojs/meeko/framework#useState"
  - "@meekojs/meeko/framework#mountClientApp"
  - "@meekojs/meeko/framework#definePage"
  - "@meekojs/meeko#serializeJson"
  - docs/framework.md#streaming-ssr-render-stream
source-hash: 4ddd11c1f772f191fa2525a09f35c18e66fbaf1f38c0b5e3dd842293a939af62
---

`StateStore` holds an application's shared state: one signal per key, created the first time someone requests it. It underlies [`useState`](/en/docs/reference/usestate): on the server there is one store per request, **sealed** once the HTML has been sent and transferred to the browser in the payload; in the browser there is one per mounted application (`ClientApp.state`), which survives navigation.

Page loaders receive it as `state` to seed values before rendering, and a custom host creates it for renders or tests.

## Usage

```ts
import { StateStore } from "@meekojs/meeko/framework";

const state = new StateStore({ theme: "dark" });
const theme = state.get("theme", () => "light"); // conserva "dark"
const count = state.get("count", () => 0);
count.value++;
console.log(state.snapshot()); // { theme: "dark", count: 1 }
```

## Parameters

| Parameter | Type                      | Default | Description                                                                                                                     |
| --------- | ------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `initial` | `Record<string, unknown>` | `{}`    | Initial values by key. Must be serializable with `serializeJson`: plain objects, arrays, strings, numbers, booleans and `null`. |

## Return value

An instance with:

| Member                                                   | Description                                                                                                           |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `get(key, factory)`                                      | The signal for `key`; creates it with `factory()` if absent. This is what `useState(key, factory)` does.              |
| `seed(values)`                                           | Adds values without replacing existing keys. This is how the browser receives state from server navigation.           |
| `snapshot()`                                             | Copies current values by key, checking that they are serializable.                                                    |
| `seal()`                                                 | Freezes the store: new keys, `seed` and writes throw `STATE_SEALED`. The server calls it after synchronous rendering. |
| `sealed`                                                 | `true` once sealed.                                                                                                   |
| `seedForNavigation(values, commit)`, `navigationDraft()` | Apply navigation state only if its DOM change completes successfully; used by `mountClientApp`.                       |

The constructor throws `TypeError` if a value is not serializable (`Non-plain object at $.when`), and `get` does so if the key is empty or is `__proto__`, `constructor` or `prototype` (`Invalid state key`).

## Examples

### Seed state from a page loader

```ts
// app/pages/cart.route.ts
import { definePage } from "@meekojs/meeko/framework";

export const route = definePage({
  load: ({ state }) => {
    state.get("cart.count", () => 3);
    return { title: "Carrito" };
  },
});
```

```html
<!-- app/components/CartBadge.meeko, en el layout -->
<script lang="ts">
const count = useState("cart.count", () => 0);
</script>

<template><span class="badge">{count.value}</span></template>
```

The layout reads `3` during SSR and the browser receives it in the payload: hydration does not change the number.

### Read the mounted application's state

<!-- no-check -->

```ts
const app = await mountClientApp(options);
const theme = app.state.get("theme", () => "light");
theme.value = "dark"; // todos los componentes que usan useState("theme") se actualizan
```

### A custom render with state

```ts
import { StateStore } from "@meekojs/meeko/framework";

const state = new StateStore();
state.get("user", () => ({ name: "Ada" }));
// …render…
state.seal();
const payload = JSON.stringify({ sharedState: state.snapshot() });
console.log(payload); // {"sharedState":{"user":{"name":"Ada"}}}
```

## Common mistakes

### Write state after the page has been sent

```ts bad
export const route = definePage({
  load: ({ state }) => {
    const count = state.get("count", () => 0);
    setTimeout(() => { count.value = 5; }, 1000);
    return {};
  },
});
```

When the timer fires, the store is already sealed: `StateSealedError: STATE_SEALED: Meeko state "count" cannot change after the page was rendered; the browser already received it`. State travels with the HTML, so a later change cannot reach the browser.

<!-- no-check -->

```ts good
export const route = definePage({
  load: async ({ state }) => {
    state.get("count", () => 0).value = await computeCount(); // antes de que termine el load
    return {};
  },
});
```

### A non-JSON value

```ts bad
const state = new StateStore({ when: new Date() });
```

`TypeError: Non-plain object at $.when`. With `get`, the factory value is not checked when creating the key but when serializing it: `state.get("tags", () => new Map())` is accepted and fails later, in `snapshot()` or when sending the payload, with `Non-plain object at $.tags`.

```ts good
import { StateStore } from "@meekojs/meeko/framework";

const state = new StateStore({ when: new Date().toISOString(), tags: ["a", "b"] });
```

### A reserved key

```ts bad
state.get("__proto__", () => ({}));
```

`TypeError: Invalid state key`. Also applies to `""`, `constructor` and `prototype`.

<!-- no-check -->

```ts good
state.get("proto.settings", () => ({}));
```

## Notes

- **Server and browser.** On the server, one store per request: never share state between users in a module variable. In the browser, one per application, retaining keys across navigations; `seed` only adds new ones.
- **Security.** Everything you store travels in the HTML: do not include secrets or other users' data.
- **Reactivity.** Each key is a `signal`: reading it in a template, `computed` or `effect` subscribes to it.
- **Size.** The payload grows with state; store identifiers and small data, and leave large data in page data.
- **Unexported errors.** `StateSealedError` is not exported: compare `error.code === "STATE_SEALED"`.
