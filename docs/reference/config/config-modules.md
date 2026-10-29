---
title: modules
group: config
since: 1.0.0
description: Módulos creados con defineMeekoModule que configuran el proyecto desde código, como un módulo importado, un paquete, una ruta o un par con sus opciones.
symbols:
  - "config:modules"
types:
  - "@meekojs/meeko/framework#MeekoModuleEntry"
related:
  - "@meekojs/meeko/framework#defineMeekoModule"
  - "config:layers"
  - "@meekojs/meeko/framework#definePlugin"
  - docs/framework.md#módulos
  - docs/framework.md#escribir-un-módulo
  - docs/framework.md#carpetas-en-modules-deprecado
---

`modules` lista los módulos de Meeko del proyecto, aplicados en orden. Un módulo se crea con `defineMeekoModule` y, al cargar la configuración, añade componentes, autoimports, plugins, middleware y handlers de servidor, entradas de `<head>`, archivos públicos y plugins de Vite, y reacciona a los hooks del build, como los módulos de Nuxt.

Desde `1.2` `modules` es sólo para módulos. Hasta `1.1` listaba carpetas con `app/pages`; esas carpetas siguen funcionando como layers durante `1.x`, con un aviso.

## Uso

<!-- no-check -->
```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";
import hello from "./modules/hello/index.ts";

export default defineMeekoConfig({
  modules: [
    hello,                                     // un módulo importado
    "@acme/meeko-seo",                         // un paquete, resuelto desde el proyecto
    ["./modules/accent", { initial: "teal" }], // una ruta con opciones en línea
  ],
});
```

## Opciones

| Valor | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `modules` | `readonly MeekoModuleEntry[]` | `[]` | Cada entrada es un módulo importado, un nombre de paquete (con o sin subruta), una ruta relativa al proyecto, o `[entrada, opciones]`. |

Una ruta puede ser un archivo o una carpeta con `package.json` (su export `import`/`default`) o con `index.ts`, `index.mts`, `index.js` o `index.mjs`. Su export por defecto debe ser el resultado de `defineMeekoModule`.

## Resultado

Para cada módulo, en orden, Meeko combina sus opciones y ejecuta su `setup` en Node, una vez por configuración y proceso (en `meeko dev`, `meeko build`, `meeko check` y el servidor de lenguaje de un workspace de confianza):

1. `defaults` del módulo;
2. `config[meta.configKey]`, la clave del módulo en `meeko.config.ts`;
3. las opciones de `[módulo, opciones]`.

Los objetos planos se combinan en profundidad y los arrays se sustituyen. El `setup` nunca llega al navegador.

## Ejemplos

### Opciones en la clave del módulo

<!-- no-check -->
```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";
import accent from "./modules/accent/index.ts";

export default defineMeekoConfig({
  modules: [accent],
  accent: { initial: "violet" }, // meta.configKey: "accent", tipada por el módulo
});
```

El módulo declara la clave con una aumentación de `MeekoConfig`:

<!-- no-check -->
```ts
// modules/accent/index.ts
declare module "@meekojs/meeko/framework" {
  interface MeekoConfig { readonly accent?: Partial<AccentOptions> }
}
```

### Un módulo mínimo

```ts
// modules/hello/index.ts
import { defineMeekoModule } from "@meekojs/meeko/framework";

export default defineMeekoModule<{ greeting: string }>({
  meta: { name: "@acme/meeko-hello", configKey: "hello", compatibility: { meeko: ">=1.2" } },
  defaults: { greeting: "Hola" },
  setup(options, meeko) {
    meeko.addHead({ meta: [{ name: "x-greeting", content: options.greeting }] });
  },
});
```

### Migrar una carpeta de `modules` a `layers`

```ts
// Antes (1.1): una carpeta con app/pages en modules
// export default defineMeekoConfig({ modules: ["./modules/auth"] });

import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ layers: ["./modules/auth"] });
```

Mientras siga en `modules`, `meeko dev`, `meeko build` y `meeko check` escriben una vez por proceso: `[meeko] Aviso: "./modules/auth" en modules de meeko.config.ts es una carpeta de layer (tiene app/pages y no es un módulo). Muévela a layers: ["./modules/auth"]; las carpetas en modules dejarán de funcionar en Meeko 2.0.`

## Errores comunes

### Un objeto que no es un módulo

```ts bad
export default defineMeekoConfig({ modules: [{ name: "seo" }] as never });
```

`…/meeko.config.ts: modules debe ser un array de módulos creados con defineMeekoModule, nombres de paquete o rutas, o [módulo, opciones]`.

```ts good
import { defineMeekoConfig, defineMeekoModule } from "@meekojs/meeko/framework";
const seo = defineMeekoModule({ meta: { name: "seo" }, setup() {} });
export default defineMeekoConfig({ modules: [seo] });
```

### Una ruta o un paquete que no existen

```text bad
modules: ["./modules/missing", "@acme/no-existe"]
```

`No se encuentra el módulo de Meeko ./modules/missing: modules\missing` y `No se encuentra el módulo de Meeko @acme/no-existe: @acme/no-existe`. Instale el paquete en el proyecto o corrija la ruta.

```text good
npm install @acme/meeko-seo   y   modules: ["@acme/meeko-seo"]
```

### Opciones para una carpeta de layer

```ts bad
export default defineMeekoConfig({ modules: [["./modules/auth", { strict: true }]] });
```

`La entrada ./modules/auth de modules es una carpeta de layer, que no admite opciones; muévala a layers`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ layers: ["./modules/auth"] });
```

## Notas

- **Seguridad.** Un módulo ejecuta código en Node al cargar la configuración, también en el editor de un workspace de confianza: instale sólo módulos de confianza. En un workspace no confiable, el editor sólo lee las cadenas literales que son carpetas de layer.
- **Nombres.** Dos módulos con el mismo `meta.name` son un error. Con `meta.compatibility.meeko`, la carga falla si la versión de Meeko queda fuera del rango.
- **Desarrollo.** Cambiar `meeko.config.ts` o el código de `setup` exige reiniciar `meeko dev`; los archivos de runtime de un módulo (plugins, componentes) se recargan como los del proyecto.
- **`sitemap` y `robots`.** Un módulo que añade `sitemap.xml` o `robots.txt` con `meeko.addPublicFile` choca con las opciones del mismo nombre: el build falla.
