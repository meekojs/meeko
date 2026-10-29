---
title: meeko (Vite)
group: advanced
since: 1.0.0
description: Plugin de Vite de Meeko, que compila los imports .meeko en cliente y SSR, añade HMR y CSS en desarrollo, aplica los autoimports y genera los módulos virtuales del framework.
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
---

`meeko()` es el plugin de Vite que entiende los componentes `.meeko`. Al importar un `.meeko` (en el navegador o en el SSR) lo compila al módulo con su render, su hidratación y su CSS; en desarrollo añade HMR, que sustituye las instancias hidratadas conservando sus señales, y el código de DevTools. Aplica los autoimports de Meeko a los `.meeko` y a los `.ts` del proyecto y, en una aplicación del framework, genera los módulos virtuales de rutas, páginas, servidor y cada `<script server>`.

`meeko dev` y `meeko build` lo configuran solos, con su propia configuración de Vite. Sólo se añade a mano con un host de Vite propio: el starter de [`meeko init`](/docs/reference/meeko-init), una biblioteca de componentes o un proyecto que integra `.meeko` en otra aplicación de Vite.

## Uso

```ts
// vite.config.ts
import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";

export default defineConfig({
  plugins: [meeko()],
});
```

## Parámetros

`meeko()` no recibe opciones. Lee lo que necesita del proyecto que contiene cada archivo: `meeko.config.*` (aliases, autoimports, `css.scopeAttribute` y `theme`) y el `tsconfig.json`.

## Valor devuelto

Un `Plugin` de Vite. Con él:

| Import | Resultado |
| --- | --- |
| `import { renderWithState, hydrate, css } from "./App.meeko"` | El módulo compilado, con sus exports con nombre: `renderWithState`, `renderToString`, `hydrate`, `css`, `Props`… |
| El CSS de `<style>` y `<style scoped>` | Un módulo CSS que Vite inyecta en desarrollo y extrae en el build. |
| Un `.meeko` o `.ts` que usa un autoimport | El import añadido, con el ámbito de su carpeta (`app/`, `shared/`, `server/`). |
| `virtual:meeko-*` | Sólo en una aplicación del framework: el manifiesto, las páginas, el servidor y el cliente. |

## Ejemplos

### El SSR y la hidratación del starter de `meeko init`

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

El navegador debe hidratar con las mismas props que el servidor; Meeko comprueba durante la hidratación que el texto existente coincide.

### Un plugin de Vite en una aplicación del framework

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

En el framework, los plugins de Vite se añaden con un módulo (`addVitePlugin` o `extendViteConfig`), no con un `vite.config.ts`. A la inversa, un host de Vite propio con `meeko()` recibe los autoimports, componentes, layers y plugins de aplicación de los módulos, pero no sus `addVitePlugin`, `extendViteConfig`, archivos públicos ni hooks.

## Errores comunes

### Importar un `.meeko` sin el plugin

```ts bad
// vite.config.ts
import { defineConfig } from "vite";
export default defineConfig({});
```

Vite trata el componente como JavaScript y falla al analizarlo:

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

### Un `vite.config.ts` en una aplicación del framework

```text bad
tienda/
├── meeko.config.ts
└── vite.config.ts      ← plugins: [meeko(), otroPlugin()]
```

`meeko dev` y `meeko build` crean Vite con `configFile: false`: el `vite.config.ts` no se lee y sus plugins no se aplican, sin ningún aviso.

```text good
tienda/
├── meeko.config.ts     ← modules: ["./modules/otro"]
└── modules/otro/index.ts   ← meeko.addVitePlugin(otroPlugin())
```

## Notas

- **Cliente y SSR.** El mismo import compila dos módulos distintos: el del navegador (con hidratación) y el del SSR (con render a texto).
- **Desarrollo.** HMR sustituye las instancias hidratadas sin recargar y conserva las señales editables que mantienen su nombre; un cambio en el runtime del motor recarga la página. DevTools sólo existe en desarrollo.
- **Rendimiento.** Los componentes se compilan al pedirlos; los errores de compilación salen en el overlay de Vite con el archivo y la línea.
- **Tipos.** El plugin no comprueba tipos: usa `meeko check` o `meeko types` y `tsc`.
