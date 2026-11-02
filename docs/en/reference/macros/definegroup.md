---
title: defineGroup
group: macros
since: 1.5.0
description: Declares options in a +group.ts for an app/pages directory (named layout, its props and middleware) inherited by all its pages.
symbols:
  - "@meekojs/meeko/framework#defineGroup"
types:
  - "@meekojs/meeko/framework#GroupDefinition"
related:
  - "@meekojs/meeko/framework#definePage"
  - "@meekojs/meeko/framework#defineRouteMiddleware"
  - "@meekojs/meeko/framework#defineServerRouteMiddleware"
  - "@meekojs/meeko/framework#useLayout"
  - docs/framework.md#opciones-por-carpeta-groupts
  - docs/framework.md#layouts-con-nombre
  - docs/framework.md#middleware-con-nombre
source-hash: 02ec54fb58895c946260b844a59d1fc93a54b3678dd13759bda51067c9c79bd3
---

`defineGroup` declares an `app/pages` directory's options in its `+group.ts` file: the named layout, its props and, since `1.6`, named middleware. All pages in the directory and its subdirectories inherit them, so you do not have to repeat `layout` or `middleware` in each `definePage`.

It is auto-imported. Meeko reads the file **without executing it**, like `render`: its values must be literals. This makes it work the same in SSR, prerendering and static sites.

## Usage

```ts
// app/pages/(dashboard)/+group.ts
import { defineGroup } from "@meekojs/meeko/framework";

export default defineGroup({ layout: "dashboard", layoutProps: { showAlert: false }, middleware: ["auth"] });
```

All pages in `app/pages/(dashboard)/` render inside `app/layouts/dashboard.meeko` with `showAlert: false` and first run the `"auth"` middleware.

## Options

| Option        | Type                                    | Default                            | Description                                                                                                                                                                                                                                   |
| ------------- | --------------------------------------- | ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `layout`      | layout name, or `false`                 | outer group's layout, or `default` | Named layout from `app/layouts/<nombre>.meeko`. `false` removes the named layout and keeps `app/app.meeko` and `+layout.meeko` files. **Must be a literal.**                                                                                  |
| `layoutProps` | layout `Props`                          | none                               | Props for the layout, typed against the one selected by `layout` (or the inherited layout). A literal object of strings, numbers, booleans, `null`, arrays and objects. Merged by key with outer groups and the page, which takes precedence. |
| `middleware`  | names from `app/middleware`, or `false` | inherited middleware               | Since `1.6`. Named middleware added to those from outer groups without duplicates. `false` removes inherited middleware. **Must be a literal array.**                                                                                         |

## Return value

The same definition, unchanged at runtime. What matters is the file: Meeko analyzes it when discovering routes and stores the result in each page's manifest.

## Examples

### A private area with its own layout

```text
app/layouts/dashboard.meeko
app/middleware/auth.server.ts          ← defineServerRouteMiddleware(…, { global: false })
app/pages/(dashboard)/+group.ts        ← defineGroup({ layout: "dashboard", middleware: ["auth"] })
app/pages/(dashboard)/reports.meeko
app/pages/(dashboard)/settings/index.meeko
```

`/reports` and `/settings` use `dashboard` and require a session. The `(dashboard)` directory is a group: it is not part of the URL.

### Nested groups

`+group.ts` files apply from the outside in, followed by the page:

```ts
// app/pages/(dashboard)/admin/+group.ts
import { defineGroup } from "@meekojs/meeko/framework";

// Hereda layout "dashboard" y middleware ["auth"]; añade "admin" y cambia una prop.
export default defineGroup({ layoutProps: { showAlert: true }, middleware: ["admin"] });
```

A page in `admin/` runs `auth` and then `admin`, and its layout receives `showAlert: true`.

### A page that opts out of the group

The page takes precedence over its groups. With `layout: false` and `middleware: false`, it has neither the layout nor inherited middleware:

```html
<!-- app/pages/(dashboard)/login.meeko -->
<script server lang="ts">
export const route = definePage({ layout: false, middleware: false });
</script>

<template><h1>Entrar</h1></template>
```

## Common mistakes

### A layout that does not exist

```ts bad
export default defineGroup({ layout: "dashboard" });
```

Without `app/layouts/dashboard.meeko`, `meeko check`, `meeko dev` and `meeko build` stop with `el layout "dashboard" no existe; crea app/layouts/dashboard.meeko (layouts disponibles: "default")`.

<!-- no-check -->

```ts good
// con app/layouts/dashboard.meeko
export default defineGroup({ layout: "dashboard" });
```

### A computed value

Meeko does not execute the file.

```ts bad
const name = process.env.ADMIN ? "admin" : "default";
export default defineGroup({ layout: name });
```

`layout debe ser un literal de texto (el nombre de un layout de app/layouts) o false para que Meeko pueda leerlo durante el build`. The same applies to a spread or computed `middleware`.

<!-- no-check -->

```ts good
export default defineGroup({ layout: "admin" });
```

### An option that does not exist

```ts bad
export default defineGroup({ layout: "default", sidebar: true });
```

`opción de grupo desconocida "sidebar"; un +group.ts admite layout, layoutProps y middleware`. Page options (`render`, `load`, `head`) belong in its `definePage`.

<!-- no-check -->

```ts good
export default defineGroup({ layout: "default", layoutProps: { sidebar: true } });
```

### `layoutProps` not declared by the layout

```ts bad
export default defineGroup({ layout: "default", layoutProps: { title: "Panel" } });
```

If `app/layouts/default.meeko` does not declare `title`, `meeko check` reports `TS2344: Type '"Las layoutProps de app/pages/(dash)/+group.ts no coinciden con las props del layout default"' does not satisfy the constraint 'true'.`

<!-- no-check -->

```ts good
// app/layouts/default.meeko declara defineProps<{ title?: string }>()
export default defineGroup({ layout: "default", layoutProps: { title: "Panel" } });
```

### A missing or global middleware

```ts bad
export default defineGroup({ middleware: ["auth", "locale"] });
```

`el middleware "auth" no existe; crea app/middleware/auth.ts con defineRouteMiddleware(..., { global: false }) (middleware con nombre disponibles: ninguno), o app/middleware/auth.server.ts con defineServerRouteMiddleware para uno que sólo se ejecuta en el servidor`. A global one, such as `10-locale.ts` without options, reports `el middleware "locale" (…) es global y ya se ejecuta en todas las rutas; quítalo de middleware o decláralo con defineRouteMiddleware(..., { global: false })`.

<!-- no-check -->

```ts good
// con app/middleware/auth.server.ts declarado con { global: false }
export default defineGroup({ middleware: ["auth"] });
```

## Notes

- **Placement.** Only in `+group.ts`, in any directory under `app/pages` (a `(nombre)` group or an ordinary directory). A `+group.ts` outside `app/pages` configures nothing and `meeko check` warns with `MEEK115`.
- **Inheritance.** `layout` is decided by the page or the innermost group that declares it. A group or page selecting another layout starts without inherited `layoutProps`, which belonged to the previous one.
- **Navigation.** Pages sharing a layout keep it mounted when navigating between them, with its state and scroll position.
- **Security.** Middleware requested by a group protects pages, not `server/api` or RPC: endpoints need their own guards. To check the session, use server middleware (`*.server.ts`).
- **Development.** Creating, deleting or changing a `+group.ts` makes `meeko dev` rediscover routes.
