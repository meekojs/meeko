---
title: layers
group: config
since: 1.2.0
description: Carpetas del proyecto que aportan páginas, componentes, autoimports, layouts y plugins a la aplicación, en el orden escrito.
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
---

`layers` lista carpetas del proyecto con la misma estructura que la aplicación: su `app/pages`, sus componentes y autoimports (`app/components`, `app/composables`, `app/utils`, `app/stores`, `app/types`, `shared/` y `server/utils`), sus layouts con nombre y sus plugins de `app/plugins`. Meeko las combina con la aplicación en un solo manifiesto: sirve para una base compartida (diseño, páginas comunes) o para dividir una aplicación grande por áreas.

Las páginas de un layer se muestran dentro del shell del proyecto: `app/app.meeko` y el layout raíz de la aplicación envuelven también a las páginas de los layers. Hasta `1.1` la opción se llamaba `extends`, que sigue funcionando.

## Uso

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

## Opciones

| Valor | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `layers` | `readonly string[]` | `[]` | Rutas relativas a la raíz del proyecto, de carpetas con `app/pages`. Se aplican después de la aplicación y de `extends`, en el orden escrito. |

Cada carpeta:

- debe estar dentro del proyecto, también después de resolver los enlaces;
- debe tener `app/pages`;
- se llama como su carpeta, en minúsculas, dígitos y guiones, sin repetirse: ese nombre aparece en los diagnósticos.

## Resultado

El orden de las fuentes es: la aplicación, `extends`, `layers`, las carpetas de layer que quedan en `modules` y los layers que añaden los módulos con `meeko.addLayer`. Con él:

- **Rutas.** Un solo manifiesto; una URL que dos fuentes declaran es un error que nombra los dos archivos.
- **Autoimports.** Un nombre exportado por dos fuentes en el mismo ámbito es un error; nunca se elige por orden.
- **Shell.** Si el proyecto tiene `app/app.meeko` o layout raíz, sustituyen a los del layer; si no, se usan los del layer. Los `+layout.meeko` del layer se anidan dentro.
- **Layouts con nombre (desde `1.5`).** Los de un layer sirven también a las páginas del proyecto; gana el de la primera fuente.
- **Errores.** Una página de layer que falla usa el `+error.meeko` más cercano de su árbol, después el `app/error.meeko` del layer y por último el del proyecto.
- **Aliases (desde `1.5`).** `~/`, `@/`, `#shared/` y `#server/` se buscan en el proyecto y después en cada layer, en este orden.
- **`imports`.** Las carpetas de `imports.appDirs`, `sharedDirs` y `serverDirs` se buscan también dentro de cada layer.

## Ejemplos

### Una base de diseño compartida

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

### Dividir por áreas

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  layers: ["./layers/shop", "./layers/account", "./layers/backoffice"],
  imports: { serverDirs: ["server/services"] }, // también layers/*/server/services
});
```

### Sustituir una página del layer

Las URL no se sobrescriben: una página del proyecto con la misma URL que una del layer es una colisión. Para cambiar una página del layer, quite la del layer o dele otra ruta; para cambiar su envoltorio, el `app/app.meeko` y el layout raíz del proyecto ganan siempre.

## Errores comunes

### Un texto en lugar de una lista

```ts bad
export default defineMeekoConfig({ layers: "./layers/base" as never });
```

`meeko dev`, `meeko build`, `meeko check` y `meeko routes` se detienen con `…/meeko.config.ts: layers debe ser un array de rutas no vacías`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ layers: ["./layers/base"] });
```

### Una carpeta sin `app/pages`

```text bad
layers/ui/app/components/…   (sin app/pages)
```

`layer ./layers/ui no tiene carpeta app/pages: <ruta>`. Un layer necesita `app/pages`, aunque esté vacía.

```text good
layers/ui/app/pages/   (vacía)
layers/ui/app/components/…
```

### Un nombre de carpeta con mayúsculas

```text bad
layers: ["./layers/Base"]
```

`Nombre de fuente de Meeko no válido o repetido Base: <ruta>`. El nombre es el de la carpeta: minúsculas, dígitos y guiones, y distinto de los demás (y de `app`).

```text good
layers: ["./layers/base"]
```

### Una carpeta fuera del proyecto

```ts bad
export default defineMeekoConfig({ layers: ["../shared-ui"] });
```

`layer ../shared-ui sale de la raíz del proyecto <ruta>`. Para compartir código entre proyectos, publique un módulo (véase `modules`) o use un paquete del workspace.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ layers: ["./layers/shared-ui"] });
```

### Una carpeta que no existe

```text bad
layers: ["./layers/base"]   sin layers/base/
```

`layer ./layers/base no existe: <ruta>`.

```text good
mkdir -p layers/base/app/pages
```

## Notas

- **Editor.** En un workspace no confiable, el editor lee `layers` sin ejecutar la configuración: debe ser un array literal de cadenas. Un valor calculado sólo existe para él al confiar en el workspace.
- **Middleware.** Las carpetas `app/middleware` y `server/middleware` de un layer no participan: el descubrimiento de middleware se limita al proyecto raíz.
- **Desarrollo.** Cambiar `meeko.config.ts` exige reiniciar `meeko dev`.
- **Seguridad.** Todo layer forma parte de la aplicación: su `server/` se ejecuta con los mismos permisos y secretos.
