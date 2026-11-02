---
title: layers
group: config
since: 1.2.0
description: Project folders that contribute pages, components, auto-imports, layouts and plugins to the application, in the listed order.
symbols:
  - "config:layers"
related:
  - "config:extends"
  - "config:modules"
  - "config:alias"
  - "@meekojs/meeko/framework#defineMeekoConfig"
  - docs/framework.md#layers
  - docs/framework.md#layouts-de-layers-y-módulos
  - docs/framework.md#aliases-en-los-layers
source-hash: 9c7a54dd6704d17ece51c6e8d9ec33bdd139ff579e5e74ec1397df567fc1e36d
---

`layers` lists project folders with the same structure as the application: their `app/pages`, components and auto-imports (`app/components`, `app/composables`, `app/utils`, `app/stores`, `app/types`, `shared/` and `server/utils`), named layouts and `app/plugins` plugins. Meeko combines them with the application into a single manifest: use them for a shared base (design, common pages) or to divide a large application by area.

A layer's pages appear inside the project's shell: `app/app.meeko` and the application's root layout also wrap layer pages. Until `1.1`, the option was called `extends`, which still works.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  layers: ["./layers/base", "./layers/admin"],
});
```

```text
layers/base/app/pages/about.meeko     → /about
layers/admin/app/pages/admin/index.meeko → /admin
```

## Options

| Value    | Type                | Default | Description                                                                                                                        |
| -------- | ------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `layers` | `readonly string[]` | `[]`    | Paths relative to the project root, to folders with `app/pages`. Applied after the application and `extends`, in the listed order. |

Each folder:

- must be inside the project, including after resolving links;
- must have `app/pages`;
- is named after its folder, using lowercase letters, digits and hyphens, without duplicates: this name appears in diagnostics.

## Result

Source order is: the application, `extends`, `layers`, layer folders remaining in `modules` and layers added by modules with `meeko.addLayer`. With this order:

- **Routes.** A single manifest; a URL declared by two sources is an error naming both files.
- **Auto-imports.** A name exported by two sources in the same scope is an error; order never determines the choice.
- **Shell.** If the project has `app/app.meeko` or a root layout, they replace the layer's; otherwise, the layer's are used. The layer's `+layout.meeko` files nest inside.
- **Named layouts (since `1.5`).** A layer's layouts also serve project pages; the first source wins.
- **Errors.** A failing layer page uses the nearest `+error.meeko` in its tree, then the layer's `app/error.meeko` and finally the project's.
- **Aliases (since `1.5`).** `~/`, `@/`, `#shared/` and `#server/` are looked up in the project and then in each layer, in this order.
- **`imports`.** Folders in `imports.appDirs`, `sharedDirs` and `serverDirs` are also searched within each layer.

## Examples

### A shared design base

```text
layers/base/
  app/components/AppButton.meeko
  app/layouts/docs.meeko
  app/pages/legal/privacy.meeko
  app/utils/format.ts
```

```html
<!-- app/pages/index.meeko del proyecto: AppButton y formatPrice llegan del layer, sin import -->
<template><AppButton>{formatPrice(19.9)}</AppButton></template>
```

### Divide by area

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  layers: ["./layers/shop", "./layers/account", "./layers/backoffice"],
  imports: { serverDirs: ["server/services"] }, // también layers/*/server/services
});
```

### Replace a layer page

URLs are not overwritten: a project page with the same URL as a layer page is a collision. To change a layer page, remove it from the layer or give it another route; to change its wrapper, the project's `app/app.meeko` and root layout always win.

## Common mistakes

### A string instead of a list

```ts bad
export default defineMeekoConfig({ layers: "./layers/base" as never });
```

`meeko dev`, `meeko build`, `meeko check` and `meeko routes` stop with `…/meeko.config.ts: layers debe ser un array de rutas no vacías`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ layers: ["./layers/base"] });
```

### A folder without `app/pages`

```text bad
layers/ui/app/components/…   (sin app/pages)
```

`layer ./layers/ui no tiene carpeta app/pages: <ruta>`. A layer needs `app/pages`, even if it is empty.

```text good
layers/ui/app/pages/   (vacía)
layers/ui/app/components/…
```

### A folder name with uppercase letters

```text bad
layers: ["./layers/Base"]
```

`Nombre de fuente de Meeko no válido o repetido Base: <ruta>`. The name is the folder's name: lowercase letters, digits and hyphens, distinct from the others (and from `app`).

```text good
layers: ["./layers/base"]
```

### A folder outside the project

```ts bad
export default defineMeekoConfig({ layers: ["../shared-ui"] });
```

`layer ../shared-ui sale de la raíz del proyecto <ruta>`. To share code across projects, publish a module (see `modules`) or use a workspace package.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ layers: ["./layers/shared-ui"] });
```

### A nonexistent folder

```text bad
layers: ["./layers/base"]   sin layers/base/
```

`layer ./layers/base no existe: <ruta>`.

```text good
mkdir -p layers/base/app/pages
```

## Notes

- **Editor.** In an untrusted workspace, the editor reads `layers` without executing the configuration: it must be a literal array of strings. A computed value only becomes available to it once you trust the workspace.
- **Middleware.** A layer's `app/middleware` and `server/middleware` folders do not participate: middleware discovery is limited to the root project.
- **Development.** Changing `meeko.config.ts` requires restarting `meeko dev`.
- **Security.** Every layer is part of the application: its `server/` runs with the same permissions and secrets.
