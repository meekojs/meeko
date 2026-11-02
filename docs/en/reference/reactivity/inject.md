---
title: inject
group: reactivity
since: 1.0.0
description: Reads the value provided with provide by the nearest ancestor and fails if none provided it.
symbols:
  - "@meekojs/meeko#inject"
types:
  - "@meekojs/meeko#ContextKey"
related:
  - "@meekojs/meeko#createContext"
  - "@meekojs/meeko#provide"
  - "@meekojs/meeko#createRoot"
  - docs/api.md#ciclo-de-vida
source-hash: 36401ae24d5480da99567934ec270b7234ab6a755de3d2bb1af9394bfb2d3516
---

`inject(key)` walks up the active component's roots (the component itself, its parent, its parent's parent…) and returns the value from the first one that provided `key` with [`provide`](/en/docs/reference/provide). If none did, it throws an error with the key's description instead of returning `undefined`: a missing context is a structural failure, not a case the template should handle.

It is exported from `@meekojs/meeko` and auto-imported in framework applications.

## Usage

```html
<!-- app/components/ThemeBadge.meeko -->
<script lang="ts">
import { themeKey } from "../composables/theme";
const theme = inject(themeKey); // Signal<"light" | "dark">
</script>

<template><span class="badge" bind:data-theme="theme.value">Tema {theme.value}</span></template>
```

Because the layout provided a signal, the badge updates when the theme changes.

## Parameters

| Parameter | Type            | Default  | Description                                                                                                                                       |
| --------- | --------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `key`     | `ContextKey<T>` | required | Key created with [`createContext`](/en/docs/reference/createcontext). The same instance used by `provide`, not another with the same description. |

## Return value

The value `T` from the nearest provider. If no ancestor provided the key, it throws `Error: Missing Meeko context: <descripción>` (without a description, `Missing Meeko context`).

## Examples

### A composable that wraps `inject`

Export a named function instead of the key: its users do not need to know there is a context.

```ts
// app/composables/session.ts
import { createContext, inject } from "@meekojs/meeko";
import type { ReadonlySignal } from "@meekojs/meeko";

export const sessionKey = createContext<ReadonlySignal<{ name: string } | null>>("session");
export const useSessionUser = (): ReadonlySignal<{ name: string } | null> => inject(sessionKey);
```

```html
<script lang="ts">
const user = useSessionUser();
</script>

<template><p if:when="user.value">Hola, {user.value.name}</p></template>
```

### The nearest provider wins

```ts
import { createContext, createRoot, inject, provide } from "@meekojs/meeko";

const sizeKey = createContext<"sm" | "md">("size");
const size = createRoot(() => {
  provide(sizeKey, "md");
  return createRoot(() => {
    provide(sizeKey, "sm");
    return createRoot(() => inject(sizeKey));
  });
});
// size === "sm"
```

### An optional context

`inject` has no default value. If a component must work with and without a provider, provide the default value in `app/app.meeko` or handle the case with `try`:

```ts
import { inject } from "@meekojs/meeko";
import type { ContextKey } from "@meekojs/meeko";

export function injectOr<T>(key: ContextKey<T>, fallback: T): T {
  try { return inject(key); }
  catch { return fallback; }
}
```

## Common mistakes

### A component outside the provider

```html bad
<!-- app/pages/index.meeko: el layout no llama a provide(themeKey, …) -->
<ThemeBadge />
```

Rendering fails with `Error: Missing Meeko context: theme`. Provide the value in an ancestor of all its readers, such as the layout or `app/app.meeko`:

```html good
<!-- app/layouts/default.meeko -->
<script lang="ts">
import { themeKey } from "../composables/theme";
provide(themeKey, signal<"light" | "dark">("light"));
</script>
```

### Calling it in a handler or after an `await`

`inject` searches from the active root, which only exists while the component script runs.

```ts bad
async function save(): Promise<void> {
  await persist();
  inject(toastsKey).show("Guardado");
}
```

Outside the script there is no active root, and it throws `Missing Meeko context: toasts`. Call `inject` at the top level of the script and keep the value:

<!-- no-check -->

```ts good
const toasts = inject(toastsKey);
async function save(): Promise<void> {
  await persist();
  toasts.show("Guardado");
}
```

### Reading the value instead of the signal

```ts bad
const theme = inject(themeKey).value;
```

`theme` is the text at that moment: the template does not update when the theme changes. Keep the signal and read `.value` where you use it:

<!-- no-check -->

```ts good
const theme = inject(themeKey);
// <span>{theme.value}</span>
```

## Notes

- **Server and browser.** It works the same in both, with values provided by ancestors in that same execution.
- **Where to call it.** At the top level of the script or in a composable it calls. The content of a snippet or a `<MeekoTeleport>` sees the contexts of the component that declares it.
- **Siblings.** Only ancestors are searched: a sibling that provided the key does not count.
- **Meeko context.** `useState`, `useRoute`, `useNavigation` and other framework composables rely on this same mechanism. That is why `useState` outside an application throws `Missing Meeko context: Meeko framework state`.
