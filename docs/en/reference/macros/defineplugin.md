---
title: definePlugin
group: macros
since: 1.2.0
description: Declares an application plugin in app/plugins, run at startup in the browser, on the server or both, and provides values to all components.
symbols:
  - "@meekojs/meeko/framework#definePlugin"
types:
  - "@meekojs/meeko/framework#PluginApp"
related:
  - "@meekojs/meeko/framework#defineMeekoModule"
  - "@meekojs/meeko#createContext"
  - "@meekojs/meeko#inject"
  - "@meekojs/meeko#provideErrorHandler"
  - "@meekojs/meeko/framework#useRoute"
  - docs/framework.md#plugins-de-aplicación
source-hash: ebf69f1813f3817da1a2e4ed4f504149417381ff1261af402df4148e4cafcb7b
---

`definePlugin(setup)` declares an application plugin: a file in `app/plugins` that default-exports it and runs at application startup, before rendering the page. The filename suffix determines where:

| File                      | Where and when                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------- |
| `app/plugins/x.client.ts` | Only in the browser, once, before hydration.                                            |
| `app/plugins/x.server.ts` | Only on the server, once per page request, before rendering (also during prerendering). |
| `app/plugins/x.ts`        | Both.                                                                                   |

`setup` receives the application: provide values to all components with `app.provide`, register error observers with `app.onError` and read the route with `app.route`. It is auto-imported.

## Usage

```ts
// app/plugins/theme.ts
import { createContext, signal } from "@meekojs/meeko";
import type { Signal } from "@meekojs/meeko";
import { definePlugin } from "@meekojs/meeko/framework";

export const accentKey = createContext<Signal<"teal" | "violet">>("accent");

export default definePlugin((app) => {
  app.provide(accentKey, signal<"teal" | "violet">("teal"));
});
```

```html
<!-- app/components/AccentBadge.meeko -->
<script lang="ts">
import { accentKey } from "../plugins/theme";

const accent = inject(accentKey);
</script>

<template><span bind:data-accent="accent.value">Acento</span></template>
```

## Parameters

| Parameter | Type                                                          | Default  | Description                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `setup`   | `(app: PluginApp, options: Options) => void \| Promise<void>` | required | The plugin function. Can be asynchronous: Meeko awaits each plugin before the next. `options` are passed by a module through `meeko.addPlugin({ src, options })`; in `app/plugins`, `undefined`. |

`PluginApp`:

| Member                | Description                                                                                                                                                                                 |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `side`                | `"client"` or `"server"`.                                                                                                                                                                   |
| `route`               | The route, like `useRoute()`. In the browser it tracks the committed route: an `effect` reading it reruns on navigation.                                                                    |
| `request`             | The request on the server; `undefined` in the browser.                                                                                                                                      |
| `provide(key, value)` | Provides a value to all components, read with `inject(key)`. `key` comes from `createContext`.                                                                                              |
| `onError(handler)`    | In the browser, receives the same as `mountClientApp({ onError })`, with `{ side: "client", source }`; on the server, that request's render failures, with `{ side: "server", requestId }`. |

## Return value

A `MeekoPlugin<Options>`, to default-export. `definePlugin` without a function throws `TypeError: definePlugin requires a setup function`.

## Examples

### Browser analytics

A `.client.ts` plugin does not run on the server, so it can use `navigator` and `window`:

```ts
// app/plugins/analytics.client.ts
import { effect } from "@meekojs/meeko";
import { definePlugin } from "@meekojs/meeko/framework";

export default definePlugin((app) => {
  effect(() => navigator.sendBeacon("/api/visits", app.route.path.value));
  app.onError((error, info) => console.error("[app]", info.side, error));
});
```

### A per-request service on the server

A `.server.ts` plugin runs on each page request, with the request:

```ts
// app/plugins/locale.server.ts
import { createContext } from "@meekojs/meeko";
import { definePlugin } from "@meekojs/meeko/framework";

export const localeKey = createContext<string>("locale");

export default definePlugin((app) => {
  const header = app.request?.headers.get("accept-language") ?? "es";
  app.provide(localeKey, header.split(",")[0] ?? "es");
});
```

A component that reads `localeKey` and hydrates must receive the same value in the browser: if it renders it, also provide it from a universal plugin or pass it in page data.

### A plugin with options, from a module

```ts
// modules/greeting/runtime/greeting.ts
import { createContext } from "@meekojs/meeko";
import { definePlugin } from "@meekojs/meeko/framework";

export const greetingKey = createContext<string>("greeting");

export default definePlugin<{ greeting: string }>((app, options) => {
  app.provide(greetingKey, options.greeting);
});
```

The module adds it with `meeko.addPlugin({ src: new URL("./runtime/greeting.ts", import.meta.url), options: { greeting: "Hola" } })`. Options must be JSON and, if the plugin reaches the browser, travel in its bundle.

## Common mistakes

### A string key in `provide`

```ts bad
export default definePlugin((app) => {
  app.provide("theme", "dark");
});
```

`meeko check` reports `TS2345: Argument of type 'string' is not assignable to parameter of type 'ContextKey<…>'.` with `Type 'string' is not assignable to type 'symbol'.` The key comes from `createContext`, which also types the value.

<!-- no-check -->

```ts good
export const themeKey = createContext<string>("theme");
export default definePlugin((app) => {
  app.provide(themeKey, "dark");
});
```

### Export the function without `definePlugin`

```ts bad
// app/plugins/theme.ts
export default (app: unknown) => {};
```

`meeko check` does not detect this. On startup, the application fails with `TypeError: <plugin> must default-export definePlugin(...)`, including the plugin name.

<!-- no-check -->

```ts good
export default definePlugin((app) => {});
```

### Mutable state shared between requests

On the server, a universal or `.server.ts` plugin runs on each request: a value created outside `setup` is shared by all visitors, without any error.

```ts bad
const cart = signal<string[]>([]);
export default definePlugin((app) => {
  app.provide(cartKey, cart);
});
```

<!-- no-check -->

```ts good
export default definePlugin((app) => {
  app.provide(cartKey, signal<string[]>([]));
});
```

## Notes

- **Order.** Module plugins first, in the order they are added; then each layer's and the application's plugins, by filename. Only files directly in `app/plugins` count; subfolders can hold helpers. `*.test.ts`, `*.spec.ts` and `*.d.ts` are excluded.
- **Failures.** A plugin throwing on the server fails the request, which displays the error page. In the browser, hydration never starts and the page retains server HTML.
- **SSR and hydration.** What a component renders from a provided value must match on server and browser; rendered values usually come from a universal plugin.
- **Scope.** Plugins do not run for already prerendered pages served by the server, or in API, RPC or handlers. With `cache.memory` in `definePage` (since `1.7`), they also do not run for a request served from the cached copy.
- **Security.** A universal or `.client.ts` plugin goes in the browser bundle: do not import `server/` or secrets into it.
