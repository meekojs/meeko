---
title: mountDevtoolsPanel
group: advanced
since: 1.0.0
description: Mounts the Meeko DevTools panel in the page, isolated in Shadow DOM, with the instance tree, editable signals, timeline and breakpoints.
symbols:
  - "@meekojs/meeko/devtools-ui#mountDevtoolsPanel"
types:
  - "@meekojs/meeko/devtools-ui#DevtoolsPanelOptions"
  - "@meekojs/meeko/devtools-ui#DevtoolsPanel"
  - "@meekojs/meeko/devtools-ui#DevtoolsPanelPosition"
related:
  - "config:devtools"
  - "@meekojs/meeko/vite#meeko"
  - "@meekojs/meeko/framework#definePlugin"
  - docs/devtools.md#panel-dentro-de-la-página
  - docs/devtools.md#editar-señales
  - docs/devtools.md#alcance-y-límites
source-hash: 103129c04196a7327fcfb53459b3ba914dead749dc0fde6f6db6eca8638f35e9
---

`mountDevtoolsPanel` adds the Meeko DevTools panel to the page: a tree of live component instances, details of their props and signals (with an editor to change them), a filterable timeline of reads and writes with their file and line, highlighting of each instance's element in the page and a breakpoint per instance. It lives in a Shadow DOM, so it neither inherits nor changes application styles.

Since `1.8`, in a `meeko dev` application, [`devtools: true`](../config/config-devtools.md) in `meeko.config.ts` is sufficient: the framework mounts it without this code. `mountDevtoolsPanel` remains useful for a custom Vite host or container.

It reads the `window.__MEEKO_DEVTOOLS__` hook, installed by component development code when hydrating with Vite in development. If it does not exist yet, the panel says so and connects automatically as soon as it appears.

## Usage

<!-- no-check -->

```ts
// app/plugins/devtools.client.ts
import { definePlugin } from "@meekojs/meeko/framework";

export default definePlugin(async () => {
  if (!import.meta.env.DEV) return;
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  mountDevtoolsPanel();
});
```

The `.client.ts` plugin only runs in the browser, before hydration; the panel connects to the hook when the first component hydrates. With dynamic `import()` inside `import.meta.env.DEV`, the panel stays out of the production bundle.

## Options

| Option      | Type                                                           | Default          | Description                                                                                |
| ----------- | -------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------------ |
| `container` | `Element`                                                      | `document.body`  | Element receiving the Shadow DOM host.                                                     |
| `position`  | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"` | `"bottom-right"` | Since `1.8`, the window corner where the panel is fixed. Another value throws `TypeError`. |

Since `1.8`, the panel minimizes to a pill with the new event count (its button or `Alt+Shift+M`) and moves to another corner using its handle (by dragging or using arrow keys). It remembers the collapsed state and corner in `localStorage` (`meeko:devtools-panel`); a different `position` in the call overrides the remembered corner. See [Appearance, minimizing and moving](../../devtools.md#appearance-minimizing-and-moving).

## Return value

A `DevtoolsPanel`:

| Member      | Description                                                                                                |
| ----------- | ---------------------------------------------------------------------------------------------------------- |
| `refresh()` | Searches for the hook again and updates data. This is what the “Actualizar” (Refresh) button does.         |
| `unmount()` | Removes the panel and releases its subscriptions, events and highlighting. The close button does the same. |

Throws `Error: Meeko DevTools requires a browser document` if the container does not belong to a document with a window, and `TypeError: Meeko DevTools: position must be one of bottom-right, bottom-left, top-right, top-left` for another `position`.

## Examples

### In a custom Vite host

<!-- no-check -->

```ts
// src/entry-client.ts
import { hydrate } from "./App.meeko";

hydrate(document.getElementById("app")!, props, state);

if (import.meta.env.DEV) {
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  const panel = mountDevtoolsPanel();
  import.meta.hot?.dispose(() => panel.unmount());
}
```

`import.meta.hot.dispose` removes the panel before HMR reruns the entry point, to avoid accumulating panels.

### In a custom container

<!-- no-check -->

```ts
const panel = mountDevtoolsPanel({ container: document.querySelector("#devtools") ?? document.body });
```

### Show it with a keyboard shortcut

<!-- no-check -->

```ts
let panel: { unmount(): void } | undefined;
window.addEventListener("keydown", async (event) => {
  if (!(event.ctrlKey && event.shiftKey && event.key === "M")) return;
  if (panel) { panel.unmount(); panel = undefined; return; }
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  panel = mountDevtoolsPanel();
});
```

## Common mistakes

### Mount it in production

```ts bad
import { mountDevtoolsPanel } from "@meekojs/meeko/devtools-ui";
mountDevtoolsPanel();
```

In production the compiler does not install the hook: the panel only shows `Hook no disponible. Abre una página Meeko con Vite en desarrollo y pulsa Actualizar.`, and a static import puts its code in the production bundle.

<!-- no-check -->

```ts good
if (import.meta.env.DEV) {
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  mountDevtoolsPanel();
}
```

### Call it on the server

```ts bad
// app/plugins/devtools.ts (without .client), which also runs during SSR
export default definePlugin(async () => {
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  mountDevtoolsPanel();
});
```

There is no `document` on the server: the call throws `ReferenceError: document is not defined` and the request fails.

<!-- no-check -->

```ts good
// app/plugins/devtools.client.ts
export default definePlugin(async () => {
  if (!import.meta.env.DEV) return;
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  mountDevtoolsPanel();
});
```

### Mount it twice with HMR

```ts bad
// src/entry-client.ts
if (import.meta.env.DEV) mountDevtoolsPanel();
```

Each time HMR reruns the entry point, another panel is added on top of the previous one.

<!-- no-check -->

```ts good
if (import.meta.env.DEV) {
  const panel = mountDevtoolsPanel();
  import.meta.hot?.dispose(() => panel.unmount());
}
```

## Notes

- **Development only.** The hook only exists with components compiled by Vite in development mode; `meeko build` does not include it.
- **Version.** The panel checks the hook protocol version: with another `@meekojs/meeko` on the page, it shows `Versión de protocolo DevTools no compatible` and asks you to use the same package for the panel and application.
- **Security.** The panel can read and change page signals: do not mount it where an end user can see it.
- **Styles.** The panel is isolated in its Shadow DOM, with `all: initial` on its host and, since `1.8`, Meeko's light or dark colors (from the system or `<html>`'s `data-theme`), and renders above everything (maximum `z-index`). Each call creates a new panel: there is no check for an existing mount (the `devtools` option does respect a panel already mounted by the application).
- **Chrome.** The Meeko DevTools extension offers the same panel inside Chrome DevTools, without changing application code.
