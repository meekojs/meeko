---
title: meeko (Vite)
group: advanced
since: 1.0.0
description: Meeko's Vite plugin, compiling .meeko imports for the client and SSR, adding HMR and CSS in development, applying auto-imports and generating framework virtual modules.
symbols:
  - "@meekojs/meeko/vite#meeko"
related:
  - "cli:init"
  - "cli:dev"
  - "cli:compile"
  - "@meekojs/meeko/framework#defineMeekoModule"
  - "@meekojs/meeko/postcss#meekoUtilities"
  - docs/framework.md#escribir-un-módulo
  - docs/api.md#herramientas
source-hash: 1191415279212ca19d47d61201e1be79db8bdcd85bd10214de391f4e52fb952e
---

`meeko()` is the Vite plugin that understands `.meeko` components. When you import a `.meeko` (in the browser or SSR), it compiles it to a module with its render, hydration and CSS; in development it adds HMR, which replaces hydrated instances while preserving their signals, and DevTools code. It applies Meeko auto-imports to the project's `.meeko` and `.ts` files and, in a framework application, generates virtual modules for routes, pages, the server and each `<script server>`.

`meeko dev` and `meeko build` configure it automatically, with their own Vite configuration. You only add it manually with a custom Vite host: the [`meeko init`](/en/docs/reference/meeko-init) starter, a component library or a project integrating `.meeko` into another Vite application.

## Usage

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";

export default defineConfig({
  plugins: [meeko()],
});
```

## Parameters

`meeko()` takes no options. It reads what it needs from the project containing each file: `meeko.config.*` (aliases, auto-imports, `css.scopeAttribute` and `theme`) and `tsconfig.json`.

## Return value

A Vite `Plugin`. With it:

| Import                                                        | Result                                                                                                       |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `import { renderWithState, hydrate, css } from "./App.meeko"` | The compiled module, with its named exports: `renderWithState`, `renderToString`, `hydrate`, `css`, `Props`… |
| CSS from `<style>` and `<style scoped>`                       | A CSS module injected by Vite in development and extracted during the build.                                 |
| A `.meeko` or `.ts` file using an auto-import                 | The added import, with its folder's scope (`app/`, `shared/`, `server/`).                                    |
| `virtual:meeko-*`                                             | Only in a framework application: the manifest, pages, server and client.                                     |

## Examples

### SSR and hydration in the `meeko init` starter

<!-- no-check -->

```ts
// src/entry-server.ts
import { serializeJson } from "@meekojs/meeko";
import { css, renderWithState } from "./App.meeko";

export function renderPage(clientSource: string, initial = 1): string {
  const props = { initial };
  const rendered = renderWithState(props);
  return `<style>${css}</style><div id="app">${rendered.html}</div>`
    + `<script id="meeko-payload" type="application/json">${serializeJson({ props, state: rendered.state })}</script>`
    + `<script type="module" src="${clientSource}"></script>`;
}
```

<!-- no-check -->

```ts
// src/entry-client.ts
import { hydrate } from "./App.meeko";

const root = document.getElementById("app")!;
const { props, state } = JSON.parse(document.getElementById("meeko-payload")!.textContent!);
hydrate(root, props, state);
```

The browser must hydrate with the same props as the server; during hydration, Meeko checks that the existing text matches.

### A Vite plugin in a framework application

<!-- no-check -->

```ts
// modules/svg/index.ts
import { defineMeekoModule } from "@meekojs/meeko/framework";
import svgLoader from "vite-svg-loader";

export default defineMeekoModule({
  meta: { name: "svg" },
  setup(_options, meeko) {
    meeko.addVitePlugin(svgLoader());
  },
});
```

In the framework, Vite plugins are added through a module (`addVitePlugin` or `extendViteConfig`), not a `vite.config.ts`. Conversely, a custom Vite host with `meeko()` receives modules' auto-imports, components, layers and application plugins, but not their `addVitePlugin`, `extendViteConfig`, public files or hooks.

## Common mistakes

### Import a `.meeko` without the plugin

```ts bad
// vite.config.ts
import { defineConfig } from "vite";
export default defineConfig({});
```

Vite treats the component as JavaScript and fails to parse it:

```text
[PARSE_ERROR] Unexpected JSX expression
   ╭─[ src/App.meeko:1:1 ]
 1 │ <script lang="ts">
```

```ts good
// vite.config.ts
import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";

export default defineConfig({ plugins: [meeko()] });
```

### A `vite.config.ts` in a framework application

```text bad
tienda/
├── meeko.config.ts
└── vite.config.ts      ← plugins: [meeko(), otroPlugin()]
```

`meeko dev` and `meeko build` create Vite with `configFile: false`: `vite.config.ts` is not read and its plugins are not applied, without any warning.

```text good
tienda/
├── meeko.config.ts     ← modules: ["./modules/otro"]
└── modules/otro/index.ts   ← meeko.addVitePlugin(otroPlugin())
```

## Notes

- **Client and SSR.** The same import compiles two different modules: the browser module (with hydration) and the SSR module (with text rendering).
- **Development.** HMR replaces hydrated instances without reloading and preserves writable signals that retain their name; an engine runtime change reloads the page. DevTools only exists in development.
- **Performance.** Components are compiled on demand; compilation errors appear in the Vite overlay with the file and line.
- **Types.** The plugin does not check types: use `meeko check` or `meeko types` and `tsc`.
