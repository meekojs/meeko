---
title: provide
group: reactivity
since: 1.0.0
description: Provides a value under a context key in the active component and all its descendants.
symbols:
  - "@meekojs/meeko#provide"
types:
  - "@meekojs/meeko#ContextKey"
related:
  - "@meekojs/meeko#createContext"
  - "@meekojs/meeko#inject"
  - "@meekojs/meeko#createRoot"
  - "@meekojs/meeko#provideErrorHandler"
  - docs/api.md#ciclo-de-vida
source-hash: 1a1f2d5e6a5640f1333af62e4cebf9d474facc72e6f5757d90d279a1b941878e
---

`provide(key, value)` stores `value` under `key` in the root of the component whose script is running. Any descendant (its children, their children, its snippet content and `<MeekoTeleport>` content) reads it with [`inject(key)`](/en/docs/reference/inject), which searches upward for the nearest provider. You can share something with a subtree without passing props at every level: a layout's theme, a compound component's state, a service.

It is exported from `@meekojs/meeko` and auto-imported in framework applications.

## Usage

```html
<!-- app/layouts/default.meeko -->
<script lang="ts">
import { themeKey } from "../composables/theme";
const theme = signal<"light" | "dark">("light");
provide(themeKey, theme);
</script>

<template>
  <div bind:class="theme.value"><MeekoOutlet /></div>
</template>
```

All pages rendered by this layout can read `inject(themeKey)` and, because the value is a signal, react to its changes.

## Parameters

| Parameter | Type            | Default  | Description                                                                                                          |
| --------- | --------------- | -------- | -------------------------------------------------------------------------------------------------------------------- |
| `key`     | `ContextKey<T>` | required | Key created with [`createContext`](/en/docs/reference/createcontext).                                                |
| `value`   | `T`             | required | Value received by descendants' `inject` calls. For reactive reads, provide a signal or an object containing signals. |

## Return value

`void`. Without an active component or root, it throws `Error: provide() requires an active component root`.

## Examples

### A service for a subtree

```ts
// app/composables/cart.ts
import { createContext, inject, provide, signal, computed } from "@meekojs/meeko";
import type { ReadonlySignal } from "@meekojs/meeko";

interface Cart { readonly count: ReadonlySignal<number>; add(id: string): void }
const cartKey = createContext<Cart>("cart");

export function provideCart(): Cart {
  const ids = signal<string[]>([]);
  const cart: Cart = { count: computed(() => ids.value.length), add: (id) => { ids.value = [...ids.value, id]; } };
  provide(cartKey, cart);
  return cart;
}

export const useCart = (): Cart => inject(cartKey);
```

### Override a value in one branch

A descendant can provide the same key again: its branch sees the new value and the rest of the tree sees the previous one.

```html
<!-- app/components/DarkSection.meeko -->
<script lang="ts">
import { themeKey } from "../composables/theme";
const snippets = defineSnippets<{ default: [] }>();
provide(themeKey, signal<"light" | "dark">("dark"));
</script>

<template><section class="dark"><render snippet="snippets.default" /></section></template>
```

### Outside a component, in a custom root

In a test or custom host, [`createRoot`](/en/docs/reference/createroot) gives you a root in which to provide values:

```ts
import { createContext, createRoot, inject, provide } from "@meekojs/meeko";

const localeKey = createContext<string>("locale");
const value = createRoot(() => {
  provide(localeKey, "es");
  return createRoot(() => inject(localeKey)); // una raíz hija lo encuentra
});
// value === "es"
```

## Common mistakes

### Call it outside a component's script

```ts bad
// app/utils/setup.ts, evaluado al importar
provide(localeKey, "es");
```

Throws `Error: provide() requires an active component root`. Provide from a component's script (for the entire application, `app/app.meeko`) or inside a composable called by that script:

```html good
<!-- app/app.meeko -->
<script lang="ts">
provide(localeKey, "es");
</script>
```

### Expect a sibling to read it

`provide` only reaches descendants of the component that calls it.

```html bad
<Sidebar />   <!-- llama a provide(panelKey, …) -->
<Content />   <!-- llama a inject(panelKey) -->
```

`<Content>` throws `Error: Missing Meeko context: panel`. Provide in the common ancestor:

```html good
<!-- el componente que contiene a los dos llama a provide(panelKey, …) -->
<Sidebar />
<Content />
```

### Provide a fixed value that should change

```ts bad
const theme = signal("light");
provide(themeKey, theme.value);
```

Descendants receive the text `"light"` and do not learn about changes (it is also a type error if the key is for a `Signal`). Provide the signal:

<!-- no-check -->

```ts good
provide(themeKey, theme);
```

## Notes

- **Server and browser.** Works in both. In SSR, the value lives in that request's component root: two requests never share provided values.
- **Where to call it.** At the top level of the script, before rendering children: descendants look up the value when their own script runs.
- **Not transferred.** Provided values are not part of the payload state. The browser runs `provide` again during hydration; if the value must match the server's, it comes from props, route data or state signals.
- **Independent roots.** Two unrelated roots (two applications mounted on the same page, or two non-nested `createRoot` calls) do not share values.
- **Errors.** [`provideErrorHandler`](/en/docs/reference/provideerrorhandler) uses the same mechanism: an error observer provided in a component applies to its entire branch.
