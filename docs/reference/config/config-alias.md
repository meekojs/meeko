---
title: alias
group: config
since: 1.5.0
description: Aliases de ruta propios, o cambios de ~/, @/, #shared/ y #server/, que valen en Vite, en los tsconfig generados, en el editor y en @utilities.
symbols:
  - "config:alias"
related:
  - "config:imports"
  - "config:layers"
  - docs/framework.md#aliases-de-ruta
  - docs/framework.md#aliases-propios-alias
  - docs/framework.md#ámbitos-de-los-aliases
  - docs/framework.md#prioridad-y-conflictos-de-los-aliases
---

Meeko define, sin configuración, cuatro aliases de ruta: `~/` (la raíz del proyecto), `@/` (`app/`), `#shared/` (`shared/`) y `#server/` (`server/`, sólo en el código de servidor). `alias` añade los suyos o cambia esos: cada clave es un prefijo que termina en `/` y cada valor, una carpeta del proyecto o `false` para quitar el alias.

Un alias toma el ámbito de la carpeta a la que apunta, como los autoimports: un alias hacia `server/` sólo existe en el código de servidor.

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  alias: {
    "ui/": "app/components/ui/",
    "db/": "server/db/",
    "#server/": false,
  },
});
```

<!-- no-check -->
```ts
// un .ts de app/
import { Button } from "ui/Button";
```

## Opciones

| Valor | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `alias` | `Record<string, string \| false>` | `{}` (sólo los de Meeko) | Prefijo → carpeta relativa a la raíz del proyecto (también la de un layer), o `false`. |

- **Clave.** Termina en `/`; sin espacios, `*` ni `\`; no empieza por `.` ni `/`; sin `//`.
- **Valor.** Una ruta relativa dentro del proyecto, o `false`. Una carpeta que no existe no es un error: el import falla al resolverse.

## Resultado

| Dónde apunta | Dónde se puede usar |
| --- | --- |
| Dentro de `server/` | Sólo en el código de servidor; en un componente o en `app/`, `MEEK108`. |
| Dentro de `app/` | En `app/` y en el servidor; en `shared/`, `MEEK118`. |
| Otra carpeta (`shared/`, la raíz, `lib/`) | En todo el proyecto. |

Se aplica en Vite (`meeko dev`, `meeko build` y todos los adaptadores), en los `tsconfig` que genera Meeko (los que usan `meeko check` y el editor), en el servidor de lenguaje y en los módulos de `@utilities`. Un alias propio apunta exactamente a su carpeta; no se busca en los layers como los de Meeko. Cambiar uno de Meeko (`"@/": "src/"`) lo convierte en un alias propio, con el ámbito de su carpeta nueva.

## Ejemplos

### Una carpeta de diseño

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ alias: { "ui/": "app/components/ui/" } });
```

```html
<script lang="ts">
import * as Dialog from "ui/Dialog.meeko";
</script>
```

### Liberar `#shared/` para los *subpath imports* de Node

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

// package.json declara "imports": { "#shared/*": "./lib/shared/*.js" }
export default defineMeekoConfig({ alias: { "#shared/": false } });
```

Sin esto, Meeko detecta el conflicto, cede el prefijo a `package.json` y avisa una vez por proceso.

### Un proyecto con `src/`

```ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({ alias: { "@/": "src/" } });
```

Si el `tsconfig.json` ya tenía `"@/*": ["./src/*"]`, declárelo también aquí: Vite no lee los `paths` de TypeScript.

## Errores comunes

### Una clave sin `/` final

```ts bad
export default defineMeekoConfig({ alias: { "@ui": "app/components/ui/" } });
```

`meeko dev`, `meeko build`, `meeko check` y `meeko routes` se detienen con `…/meeko.config.ts: alias "@ui" debe ser un prefijo que termine en / (como "@/", "~/" o "lib/"), sin espacios, * ni \, y que no empiece por . ni /`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ alias: { "@ui/": "app/components/ui/" } });
```

### Una carpeta fuera del proyecto

```ts bad
export default defineMeekoConfig({ alias: { "ui/": "../design-system/src/" } });
```

`…/meeko.config.ts: alias "ui/" debe ser una ruta relativa dentro del proyecto (su carpeta o la de un layer): ../design-system/src/`. Para código de otro repositorio, instálelo como paquete.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ alias: { "ui/": "layers/design/app/components/" } });
```

### Un alias de servidor en un componente

```html bad
<script lang="ts">
import { db } from "db/client"; // "db/": "server/db/"
</script>
```

`meeko check`, el editor y el build del navegador dan `MEEK108`, también con `import type`. Para un tipo del servidor, use `~/server/…`.

```html good
<script server lang="ts">
import { db } from "db/client";
export const total = await db.orders.count();
</script>
```

## Notas

- **`meeko.config.ts`.** Node carga la configuración sin Vite: ni ella ni los módulos que importa pueden usar los aliases.
- **Editor.** En un workspace no confiable, el editor lee `alias` sin ejecutar la configuración sólo si es un objeto literal de cadenas y `false`; si no, usa los aliases por defecto.
- **Prioridad.** Un patrón de `paths` del `tsconfig.json` o un `resolve.alias` de Vite que cubre un prefijo de Meeko lo desactiva, con un aviso; un `#…` de `imports` de `package.json` también gana.
- **Paquetes.** Los módulos de `node_modules` nunca reciben los aliases del proyecto.
