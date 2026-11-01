---
title: devtools
group: config
since: 1.8.0
description: Mounts the Meeko DevTools panel inside the page in meeko dev, without application code, in the chosen corner.
symbols:
  - "config:devtools"
types:
  - "@meekojs/meeko/framework#MeekoDevtoolsConfig"
related:
  - "config:dev"
  - "cli:dev"
  - docs/devtools.md#panel-dentro-de-la-página
  - docs/framework.md#configuración
source-hash: 72c20553d75896004050003d5d90384ed19652d43d86ac131187c6cd960cf44b
---

`devtools` enables Meeko DevTools in `meeko dev`: with `true`, `meeko dev` mounts the panel inside the page in every document, without `import()` or `mountDevtoolsPanel()` in the application. This is the recommended approach since `1.8`, like `devtools: true` in Nuxt. The default is `false`: upgrading within `1.x` does not show the panel until you request it.

The panel never reaches `meeko build`, `meeko start`, `meeko preview` or prerendered pages: only `meeko dev` adds it.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ devtools: true });
```

## Options

`devtools` is a boolean or an object. An object enables DevTools: without `panel`, the panel mounts just as with `true`.

| Option     | Type                                                           | Default          | Description                                      |
| ---------- | -------------------------------------------------------------- | ---------------- | ------------------------------------------------ |
| `panel`    | `boolean`                                                      | `true`           | Mounts the panel inside the page in `meeko dev`. |
| `position` | `"bottom-right" \| "bottom-left" \| "top-right" \| "top-left"` | `"bottom-right"` | Window corner where the panel is fixed.          |

## Result

With the panel enabled, `meeko dev` adds a `<script type="module">` to each document's `<head>` (with the CSP nonce, if any) that loads `@meekojs/meeko/devtools-ui` and calls `mountDevtoolsPanel({ position })`. The panel connects to the `window.__MEEKO_DEVTOOLS__` hook when the page hydrates.

The panel uses Meeko colors, light or dark according to the system or the page's `data-theme`; it minimizes to a pill with the new event count (`Alt+Shift+M`) and moves to another corner by dragging its handle. It remembers both in `localStorage`; changing `position` in the configuration overrides the remembered corner. See [Appearance, minimizing and moving](../../devtools.md#appearance-minimizing-and-moving).

Without `devtools` (or with `false` or `{ panel: false }`), `meeko dev` adds nothing. The hook still exists in development, so the [Chrome extension](../../devtools.md#chrome-devtools-panel) and [editor bridge](../../devtools.md#editor-bridge) work with or without this option.

## Examples

### In another corner

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ devtools: { position: "bottom-left" } });
```

### Only when requested

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ devtools: process.env.MEEKO_DEVTOOLS === "1" });
```

```sh
MEEKO_DEVTOOLS=1 npm run dev
```

## Common mistakes

### A nonexistent corner

```ts bad
export default defineMeekoConfig({ devtools: { position: "middle" } as never });
```

`meeko dev`, `meeko build`, `meeko check` and `meeko routes` stop with `…/meeko.config.ts: devtools.position debe ser "bottom-right", "bottom-left", "top-right" o "top-left"`, and `meeko check` also reports `TS2322` on that line. A value that is neither a boolean nor an object reports `devtools debe ser un booleano o un objeto { panel?: boolean, position?: … }`; an extra field reports `devtools: campo desconocido …`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ devtools: { position: "top-left" } });
```

### Mount it twice

```ts bad
// app/plugins/devtools.client.ts, con devtools: true en meeko.config.ts
if (import.meta.env.DEV) {
  const { mountDevtoolsPanel } = await import("@meekojs/meeko/devtools-ui");
  mountDevtoolsPanel();
}
```

If your custom mount runs first, `meeko dev` respects it and does not add another; if it runs afterwards, there are two panels. Use one approach: `devtools` in the configuration or manual mounting, which still works for a custom container (`container`).

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ devtools: true });
```

## Notes

- **Development only.** Neither the script nor `@meekojs/meeko/devtools-ui` exists in `meeko build`, `meeko start`, `meeko preview` or prerendered pages.
- **Module keys.** `devtools` is a built-in Meeko option since `1.8`: a module with `meta.configKey: "devtools"` no longer loads and must use another key.
- **Development.** Changing `meeko.config.ts` requires restarting `meeko dev`.
