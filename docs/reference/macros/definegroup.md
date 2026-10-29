---
title: defineGroup
group: macros
since: 1.5.0
description: Declara en un +group.ts las opciones de una carpeta de app/pages (layout con nombre, sus props y middleware) que heredan todas sus páginas.
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
---

`defineGroup` declara las opciones de una carpeta de `app/pages` en su archivo `+group.ts`: el layout con nombre, sus props y, desde `1.6`, el middleware con nombre. Las heredan todas las páginas de la carpeta y de sus subcarpetas, así que no hay que repetir `layout` o `middleware` en cada `definePage`.

Se autoimporta. Meeko lee el archivo **sin ejecutarlo**, como `render`: sus valores deben ser literales. Por eso funciona igual en SSR, en el prerender y en el sitio estático.

## Uso

```ts
// app/pages/(dashboard)/+group.ts
import { defineGroup } from "@meekojs/meeko/framework";

export default defineGroup({ layout: "dashboard", layoutProps: { showAlert: false }, middleware: ["auth"] });
```

Todas las páginas de `app/pages/(dashboard)/` se pintan dentro de `app/layouts/dashboard.meeko` con `showAlert: false` y pasan antes por el middleware `"auth"`.

## Opciones

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `layout` | nombre de un layout, o `false` | el del grupo exterior, o `default` | Layout con nombre de `app/layouts/<nombre>.meeko`. `false` quita el layout con nombre y deja `app/app.meeko` y los `+layout.meeko`. **Debe ser un literal.** |
| `layoutProps` | `Props` del layout | ninguno | Props para el layout, tipadas contra el que elige `layout` (o el heredado). Un objeto literal de textos, números, booleanos, `null`, arrays y objetos. Se combinan por clave con las de los grupos exteriores y la página, que gana. |
| `middleware` | nombres de `app/middleware`, o `false` | los heredados | Desde `1.6`. Middleware con nombre que se suman a los de los grupos exteriores, sin repetir. `false` quita los heredados. **Debe ser un array literal.** |

## Valor devuelto

La misma definición, sin cambios en ejecución. Lo que cuenta es el archivo: Meeko lo analiza al descubrir las rutas y guarda el resultado en el manifiesto de cada página.

## Ejemplos

### Un área privada con su layout

```text
app/layouts/dashboard.meeko
app/middleware/auth.server.ts          ← defineServerRouteMiddleware(…, { global: false })
app/pages/(dashboard)/+group.ts        ← defineGroup({ layout: "dashboard", middleware: ["auth"] })
app/pages/(dashboard)/reports.meeko
app/pages/(dashboard)/settings/index.meeko
```

`/reports` y `/settings` usan `dashboard` y exigen sesión. La carpeta `(dashboard)` es un grupo: no forma parte de la URL.

### Grupos anidados

Los `+group.ts` se aplican de fuera hacia dentro y después la página:

```ts
// app/pages/(dashboard)/admin/+group.ts
import { defineGroup } from "@meekojs/meeko/framework";

// Hereda layout "dashboard" y middleware ["auth"]; añade "admin" y cambia una prop.
export default defineGroup({ layoutProps: { showAlert: true }, middleware: ["admin"] });
```

Una página de `admin/` ejecuta `auth` y después `admin`, y su layout recibe `showAlert: true`.

### Una página que sale del grupo

La página gana a sus grupos. Con `layout: false` y `middleware: false` queda sin el layout y sin los middleware heredados:

```html
<!-- app/pages/(dashboard)/login.meeko -->
<script server lang="ts">
export const route = definePage({ layout: false, middleware: false });
</script>

<template><h1>Entrar</h1></template>
```

## Errores comunes

### Un layout que no existe

```ts bad
export default defineGroup({ layout: "dashboard" });
```

Sin `app/layouts/dashboard.meeko`, `meeko check`, `meeko dev` y `meeko build` se detienen con `el layout "dashboard" no existe; crea app/layouts/dashboard.meeko (layouts disponibles: "default")`.

<!-- no-check -->
```ts good
// con app/layouts/dashboard.meeko
export default defineGroup({ layout: "dashboard" });
```

### Un valor calculado

Meeko no ejecuta el archivo.

```ts bad
const name = process.env.ADMIN ? "admin" : "default";
export default defineGroup({ layout: name });
```

`layout debe ser un literal de texto (el nombre de un layout de app/layouts) o false para que Meeko pueda leerlo durante el build`. Lo mismo con un spread o con `middleware` calculado.

<!-- no-check -->
```ts good
export default defineGroup({ layout: "admin" });
```

### Una opción que no existe

```ts bad
export default defineGroup({ layout: "default", sidebar: true });
```

`opción de grupo desconocida "sidebar"; un +group.ts admite layout, layoutProps y middleware`. Las opciones de la página (`render`, `load`, `head`) van en su `definePage`.

<!-- no-check -->
```ts good
export default defineGroup({ layout: "default", layoutProps: { sidebar: true } });
```

### `layoutProps` que el layout no declara

```ts bad
export default defineGroup({ layout: "default", layoutProps: { title: "Panel" } });
```

Si `app/layouts/default.meeko` no declara `title`, `meeko check` da `TS2344: Type '"Las layoutProps de app/pages/(dash)/+group.ts no coinciden con las props del layout default"' does not satisfy the constraint 'true'.`

<!-- no-check -->
```ts good
// app/layouts/default.meeko declara defineProps<{ title?: string }>()
export default defineGroup({ layout: "default", layoutProps: { title: "Panel" } });
```

### Un middleware que no existe, o global

```ts bad
export default defineGroup({ middleware: ["auth", "locale"] });
```

`el middleware "auth" no existe; crea app/middleware/auth.ts con defineRouteMiddleware(..., { global: false }) (middleware con nombre disponibles: ninguno), o app/middleware/auth.server.ts con defineServerRouteMiddleware para uno que sólo se ejecuta en el servidor`. Uno global, como `10-locale.ts` sin opciones, da `el middleware "locale" (…) es global y ya se ejecuta en todas las rutas; quítalo de middleware o decláralo con defineRouteMiddleware(..., { global: false })`.

<!-- no-check -->
```ts good
// con app/middleware/auth.server.ts declarado con { global: false }
export default defineGroup({ middleware: ["auth"] });
```

## Notas

- **Dónde va.** Sólo en `+group.ts`, en cualquier carpeta de `app/pages` (un grupo `(nombre)` o una carpeta normal). Un `+group.ts` fuera de `app/pages` no configura nada y `meeko check` avisa con `MEEK115`.
- **Herencia.** `layout` lo decide la página o el grupo más interior que lo declara. Un grupo o una página que elige otro layout empieza sin las `layoutProps` heredadas, que eran para el anterior.
- **Navegación.** Las páginas que comparten layout lo conservan montado al navegar entre ellas, con su estado y su scroll.
- **Seguridad.** El middleware que pide un grupo protege las páginas, no `server/api` ni el RPC: los endpoints necesitan sus propias guardas. Para comprobar la sesión, usa un middleware de servidor (`*.server.ts`).
- **Desarrollo.** Crear, borrar o cambiar un `+group.ts` hace que `meeko dev` vuelva a descubrir las rutas.
