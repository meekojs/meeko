---
title: modules
group: config
since: 1.0.0
description: Nombres de los módulos creados con defineMeekoModule que configuran el proyecto desde código; las opciones de cada uno van en su clave (meta.configKey).
symbols:
  - "config:modules"
types:
  - "@meekojs/meeko/framework#MeekoModuleEntry"
  - "@meekojs/meeko/framework#MeekoModuleName"
  - "@meekojs/meeko/framework#MeekoModuleNames"
related:
  - "@meekojs/meeko/framework#defineMeekoModule"
  - "config:layers"
  - "@meekojs/meeko/framework#definePlugin"
  - docs/framework.md#módulos
  - docs/framework.md#escribir-un-módulo
  - docs/framework.md#carpetas-en-modules-deprecado
---

`modules` lista por su nombre los módulos de Meeko del proyecto, aplicados en orden. Un módulo se crea con `defineMeekoModule` y, al cargar la configuración, añade componentes, autoimports, plugins, middleware y handlers de servidor, entradas de `<head>`, archivos públicos y plugins de Vite, y reacciona a los hooks del build, como los módulos de Nuxt. Sus opciones van en su propia clave de `meeko.config.ts`, la de su `meta.configKey`, tipada sin importar nada.

Desde `1.8` es la única forma documentada; las anteriores siguen funcionando en `1.x` con el aviso `MEEK126` (véase [Actualizar de 1.7 a 1.8](../../migration-1.8.md#módulos-por-su-nombre)). Desde `1.2` `modules` es sólo para módulos: las carpetas con `app/pages` que listaba hasta `1.1` siguen funcionando como layers durante `1.x`, con un aviso.

## Uso

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  modules: ["@meekojs/i18n", "@meekojs/ui"],
  i18n: { defaultLocale: "es", catalogs: { es: "app/locales/es.json", en: "app/locales/en.json" } },
  ui: { defaults: { button: { shape: "pill" } } },
});
```

## Opciones

| Valor | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `modules` | `readonly MeekoModuleEntry[]` | `[]` | El nombre de un paquete instalado (con o sin subruta) o una ruta relativa al proyecto. |
| `<configKey>` | lo que declare el módulo | ninguno | Las opciones de cada módulo, en la clave que declara su `meta.configKey` (`i18n`, `ui`). |

- **Un paquete** se resuelve desde el proyecto. Si exporta el subpath `./module` (como `@meekojs/i18n`, cuya raíz es su runtime), el módulo es el export por defecto de `<paquete>/module`; si no, el de su raíz (como `@meekojs/ui`).
- **Una ruta** es un archivo o una carpeta con `package.json` (su export `import`/`default`) o con `index.ts`, `index.mts`, `index.js` o `index.mjs`.

Su export por defecto debe ser el resultado de `defineMeekoModule`.

## Resultado

Para cada módulo, en el orden de `modules`, Meeko combina sus opciones y ejecuta su `setup` en Node, uno tras otro, una vez por configuración y proceso (en `meeko dev`, `meeko build`, `meeko check` y el servidor de lenguaje de un workspace de confianza); después llama al hook `ready`:

1. `defaults` del módulo;
2. `config[meta.configKey]`, la clave del módulo en `meeko.config.ts`;

Los objetos planos se combinan en profundidad y los arrays se sustituyen. El `setup` nunca llega al navegador.

**Tipos.** Meeko escribe `.meeko/types/config.d.ts`, que importa los tipos de cada módulo de `modules`; así se carga sola la ampliación de `MeekoConfig` de cada módulo y su clave queda tipada. El editor lo lee con `.meeko/tsconfig.config.json` (referenciado por el `tsconfig.json` de `meeko init`; en un proyecto anterior, añada `{ "path": "./.meeko/tsconfig.config.json" }` a `references`), y `meeko check` comprueba con él `meeko.config.ts`. `MeekoModuleNames` recoge los módulos instalados (dependencias con la palabra clave `meeko-module` en su `package.json`), que el editor completa dentro de `modules: ['…']`.

## Ejemplos

### Un módulo del proyecto con su clave

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  modules: ["./modules/accent"],
  accent: { initial: "violet" }, // meta.configKey: "accent", tipada por el módulo
});
```

El módulo declara la clave con una ampliación de `MeekoConfig`, que Meeko carga en `.meeko/types/config.d.ts`:

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

### Un nombre que no existe

```text bad
modules: ["@meekojs/i18m", "./modules/missing"]
```

`No se encuentra el módulo de Meeko @meekojs/i18m: no es un paquete instalado ni una ruta del proyecto. ¿Quisiste decir "@meekojs/i18n"?` (sin un nombre parecido, indica cómo instalarlo) y `No se encuentra el módulo de Meeko ./modules/missing: …/modules/missing no existe`.

```text good
pnpm add @meekojs/i18n   y   modules: ["@meekojs/i18n"]
```

### Un paquete que no es un módulo

```text bad
modules: ["left-pad"]
```

`El paquete left-pad no es un módulo de Meeko: …/index.js debe exportar por defecto defineMeekoModule(...), en su subpath ./module o en su raíz`. Liste sólo paquetes que son módulos de Meeko (su `package.json` lleva la palabra clave `meeko-module`); una dependencia de runtime se importa en el código, no en `modules`.

```text good
modules: ["@meekojs/ui"]
```

### Las opciones de un módulo que no está en `modules`

```ts bad
export default defineMeekoConfig({ i18n: { defaultLocale: "es", catalogs: { es: "app/locales/es.json" } } });
```

`[meeko] Aviso MEEK127: meeko.config.ts tiene la clave "i18n", que es la configKey del módulo @meekojs/i18n, pero @meekojs/i18n no está en modules, así que Meeko ignora sus opciones. Añádalo: modules: ["@meekojs/i18n"].` Es un aviso durante `1.x`; la clave se ignora, como hasta `1.7`.

<!-- no-check -->
```ts good
export default defineMeekoConfig({ modules: ["@meekojs/i18n"], i18n: { defaultLocale: "es", catalogs: { es: "app/locales/es.json" } } });
```

### Una opción mal tipada

<!-- no-check -->
```ts bad
export default defineMeekoConfig({ modules: ["@meekojs/i18n"], i18n: { defaultLocale: 1, catalogs: {} } });
```

`meeko check` da `meeko.config.ts:1:… TS2322: Type 'number' is not assignable to type 'string'.`, y el editor lo marca, con los tipos de `.meeko/types/config.d.ts`.

<!-- no-check -->
```ts good
export default defineMeekoConfig({ modules: ["@meekojs/i18n"], i18n: { defaultLocale: "es", catalogs: { es: "app/locales/es.json" } } });
```

### Dos módulos con la misma clave

```text bad
modules: ["@meekojs/meeko/i18n", "@meekojs/i18n"]
```

`Los módulos de Meeko @meekojs/meeko/i18n y @meekojs/i18n usan la misma meta.configKey "i18n": quite uno de modules`. Antes se leían las mismas opciones dos veces.

```text good
modules: ["@meekojs/i18n"]
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

- **Seguridad.** Un módulo ejecuta código en Node al cargar la configuración, también en el editor de un workspace de confianza: instale sólo módulos de confianza. En un workspace no confiable, el editor sólo lee las cadenas literales de `modules` y no escribe nada.
- **Nombres.** Dos módulos con el mismo `meta.name` o la misma `meta.configKey` son un error. Con `meta.compatibility.meeko`, la carga falla si la versión de Meeko queda fuera del rango.
- **Un módulo sin `configKey`** no recibe opciones: su autor debe declarar una.
- **Desarrollo.** Cambiar `meeko.config.ts` o el código de `setup` exige reiniciar `meeko dev`; los archivos de runtime de un módulo (plugins, componentes) se recargan como los del proyecto.
- **`sitemap` y `robots`.** Un módulo que añade `sitemap.xml` o `robots.txt` con `meeko.addPublicFile` choca con las opciones del mismo nombre: el build falla.
