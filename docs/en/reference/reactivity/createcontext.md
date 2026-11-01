---
title: createContext
group: reactivity
since: 1.0.0
description: Creates a unique, typed key for sharing a value with descendants through provide and inject.
symbols:
  - "@meekojs/meeko#createContext"
types:
  - "@meekojs/meeko#ContextKey"
related:
  - "@meekojs/meeko#provide"
  - "@meekojs/meeko#inject"
  - "@meekojs/meeko#createRoot"
  - "@meekojs/meeko/framework#useState"
  - docs/api.md#ciclo-de-vida
source-hash: 7d76a40e227c2d4537a2038ed527a061fce490d171d0f537213e482df7eb1aea
---

`createContext<T>(description?)` creates the key a component uses to provide a value ([`provide`](/en/docs/reference/provide)) and its descendants use to read it ([`inject`](/en/docs/reference/inject)). The key is a new `Symbol`, so two contexts never collide even with the same description, and it carries the value's type `T`: `inject(clave)` returns `T` without conversions.

Create the key once, in a module, and export it alongside the functions that use it. It is exported from `@meekojs/meeko` and auto-imported in framework applications.

## Usage

```ts
// app/composables/theme.ts
import { createContext, inject, provide, signal } from "@meekojs/meeko";
import type { Signal } from "@meekojs/meeko";

type Theme = "light" | "dark";
const themeKey = createContext<Signal<Theme>>("theme");

export function provideTheme(initial: Theme): Signal<Theme> {
  const theme = signal<Theme>(initial);
  provide(themeKey, theme);
  return theme;
}

export const useThemeContext = (): Signal<Theme> => inject(themeKey);
```

A layout calls `provideTheme("light")` in its script; any component inside it calls `useThemeContext()`.

## Parameters

| Parameter     | Type           | Default   | Description                                                                                                          |
| ------------- | -------------- | --------- | -------------------------------------------------------------------------------------------------------------------- |
| `T`           | type parameter | `unknown` | Type of the value provided with the key. Always specify it: it is not inferred from any value.                       |
| `description` | `string`       | none      | Text of the `Symbol`. It appears in the `inject` error when the provider is missing: `Missing Meeko context: theme`. |

## Return value

A `ContextKey<T>`: a `symbol` with a type brand that fixes `T`. The brand exists only in TypeScript.

## Examples

### A context with typed `provide` and `inject`

```ts
// app/composables/toasts.ts
import { createContext, inject, provide, signal } from "@meekojs/meeko";
import type { ReadonlySignal } from "@meekojs/meeko";

interface Toasts {
  readonly items: ReadonlySignal<readonly string[]>;
  show(message: string): void;
}

const toastsKey = createContext<Toasts>("toasts");

export function provideToasts(): Toasts {
  const items = signal<readonly string[]>([]);
  const toasts: Toasts = { items, show: (message) => { items.value = [...items.value, message]; } };
  provide(toastsKey, toasts);
  return toasts;
}

export const useToasts = (): Toasts => inject(toastsKey);
```

### A context with a default value

`inject` fails if nobody provided the key. For an optional context, provide the default value at the application root (`app/app.meeko`), so the entire tree has it:

```html
<!-- app/app.meeko -->
<script lang="ts">
import { provideToasts } from "./composables/toasts";
provideToasts();
</script>

<template><div class="site-root"><MeekoOutlet /></div></template>
```

### A compound component

A `<Tabs>` provides its state and each `<Tab>` reads it, without passing props through every level:

```ts
// app/components/tabs-context.ts
import { createContext } from "@meekojs/meeko";
import type { Signal } from "@meekojs/meeko";

export const tabsKey = createContext<{ active: Signal<string>; select(id: string): void }>("tabs");
```

```html
<!-- app/components/Tab.meeko -->
<script lang="ts">
import { tabsKey } from "./tabs-context";
const props = defineProps<{ id: string; label: string }>();
const tabs = inject(tabsKey);
</script>

<template>
  <button type="button" role="tab" bind:aria-selected="String(tabs.active.value === props.id)" on:click="() => tabs.select(props.id)">{props.label}</button>
</template>
```

## Common mistakes

### Creating the key inside the component

Each script execution would create a different `Symbol`, which descendants never find.

```html bad
<script lang="ts">
const panelKey = createContext<string>("panel");
provide(panelKey, "lateral");
</script>
```

A child that creates its own key with `createContext<string>("panel")` and injects it throws `Error: Missing Meeko context: panel`: the description is the same, but the symbol is not. Create the key once, in a module, and import it on both sides:

```ts good
// app/components/panel-context.ts
import { createContext } from "@meekojs/meeko";
export const panelKey = createContext<string>("panel");
```

### Replacing the key with `Symbol.for`

```ts bad
export const modalKey = Symbol.for("modal") as ContextKey<ModalContext>;
```

`Symbol.for` returns the same symbol throughout the process: two libraries, or a library and the application, that use `"modal"` unknowingly share the key, and one reads the other's value. Use `createContext` and let Meeko ensure the key's module is evaluated only once (see [Notes](#notes)):

<!-- no-check -->

```ts good
export const modalKey = createContext<ModalContext>("modal");
```

### Forgetting the type

```ts bad
const userKey = createContext("user");
const user = inject(userKey);
user.name; // TS18046: 'user' is of type 'unknown'
```

Without a type parameter, the key is `ContextKey<unknown>` and everything `inject` reads is `unknown`. Declare the type on the key:

<!-- no-check -->

```ts good
const userKey = createContext<{ id: string; name: string }>("user");
```

### Providing a value of another type

```ts bad
const localeKey = createContext<string>("locale");
provide(localeKey, 1);
```

`meeko check` reports `TS2345: Argument of type 'number' is not assignable to parameter of type 'string'`.

<!-- no-check -->

```ts good
provide(localeKey, "es");
```

## Notes

- **A single module evaluation.** The key is the value from a specific evaluation of the module that creates it: the provider and consumers connect as long as they import that same evaluation. Meeko guarantees this:
  - with auto-imports and relative imports: `modalKey` auto-imported from `app/utils/modal.ts` and `import { modalKey } from "../utils/modal"` are the same module, on the server and in the browser;
  - in `meeko dev`, with a plugin that provides the key: editing the key's module, the plugin or any module imported by a plugin or `server/runtime.ts` recreates the server app, so the plugin provides the key that pages read. Editing a page or component, and anything only they import, is a hot update that preserves the app; a full reload (editing an `app/utils` file, adding a component) also preserves it, along with the modules imported by its plugins;
  - with a Meeko module installed in `node_modules`: its runtime is reached by package name (its auto-imports) and by file path (`addPlugin`, `addComponentsDir`), and Meeko compiles those packages as source code (`ssr.noExternal` and `optimizeDeps.exclude`), so the module's plugin and pages share the key in `meeko dev` and after `meeko build`.

  Each copy of the module creates its own key: if the key is created inside a component's `<script>` (see [Creating the key inside the component](#creating-the-key-inside-the-component)), or if a library is installed twice, in different versions, and each part of the tree imports one.

- **Server and browser.** The key is a regular module value, the same in both. The value provided with it lives in each component's root: in SSR it is per request and is not shared between users.
- **Description.** Always use it: it is the only thing that names the context in the `inject` error.
- **Context or state.** Context follows the component tree and is not transferred in the payload. For state that must be the same throughout the tree and transferred from server to browser, use [`useState`](/en/docs/reference/usestate).
