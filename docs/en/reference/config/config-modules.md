---
title: modules
group: config
since: 1.0.0
description: Names of modules created with defineMeekoModule that configure the project through code; each module's options go under its key (meta.configKey).
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
source-hash: af4ba578f76003f71ca05b261ecfd75207f7e4d6d0c02875e35fc75462591302
---

`modules` lists the project's Meeko modules by name, applied in order. A module is created with `defineMeekoModule` and, when configuration loads, adds components, auto-imports, plugins, server middleware and handlers, `<head>` entries, public files and Vite plugins, and responds to build hooks, like Nuxt modules. Its options go under their own key in `meeko.config.ts`, specified by `meta.configKey`, typed without any imports.

Since `1.8`, this is the only documented form; previous forms still work in `1.x` with warning `MEEK126` (see [Updating from 1.7 to 1.8](../../migration-1.8.md#modules-by-name)). Since `1.2`, `modules` is only for modules: folders with `app/pages` listed there through `1.1` continue to work as layers during `1.x`, with a warning.

## Usage

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  modules: ["@meekojs/i18n", "@meekojs/ui"],
  i18n: { defaultLocale: "es", catalogs: { es: "app/locales/es.json", en: "app/locales/en.json" } },
  ui: { defaults: { button: { shape: "pill" } } },
});
```

## Options

| Value         | Type                          | Default | Description                                                                              |
| ------------- | ----------------------------- | ------- | ---------------------------------------------------------------------------------------- |
| `modules`     | `readonly MeekoModuleEntry[]` | `[]`    | The name of an installed package (with or without a subpath) or a project-relative path. |
| `<configKey>` | as declared by the module     | none    | Each module's options, under the key declared by its `meta.configKey` (`i18n`, `ui`).    |

- **A package** is resolved from the project. If it exports the `./module` subpath (like `@meekojs/i18n`, whose root is its runtime), the module is the default export of `<paquete>/module`; otherwise, it is the root's default export (like `@meekojs/ui`).
- **A path** is a file or folder with `package.json` (its `import`/`default` export) or with `index.ts`, `index.mts`, `index.js` or `index.mjs`.

Its default export must be the result of `defineMeekoModule`.

## Result

For each module, in `modules` order, Meeko merges its options and executes its `setup` in Node, sequentially, once per configuration and process (in `meeko dev`, `meeko build`, `meeko check` and the language server of a trusted workspace); it then calls the `ready` hook:

1. The module's `defaults`;
2. `config[meta.configKey]`, the module's key in `meeko.config.ts`;

Plain objects are deeply merged and arrays are replaced. `setup` never reaches the browser.

**Types.** Meeko writes `.meeko/types/config.d.ts`, which imports the types of each module in `modules`; this automatically loads each module's augmentation of `MeekoConfig` and types its key. The editor reads it with `.meeko/tsconfig.config.json` (referenced by the `tsconfig.json` from `meeko init`; in an older project, add `{ "path": "./.meeko/tsconfig.config.json" }` to `references`), and `meeko check` uses it to check `meeko.config.ts`. `MeekoModuleNames` collects installed modules (dependencies with the `meeko-module` keyword in their `package.json`), which the editor completes inside `modules: ['…']`.

## Examples

### A project module with its key

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  modules: ["./modules/accent"],
  accent: { initial: "violet" }, // meta.configKey: "accent", tipada por el módulo
});
```

The module declares its key through a `MeekoConfig` augmentation, which Meeko loads in `.meeko/types/config.d.ts`:

<!-- no-check -->

```ts
// modules/accent/index.ts
declare module "@meekojs/meeko/framework" {
  interface MeekoConfig { readonly accent?: Partial<AccentOptions> }
}
```

### A minimal module

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

### Migrating a folder from `modules` to `layers`

```ts
// Antes (1.1): una carpeta con app/pages en modules
// export default defineMeekoConfig({ modules: ["./modules/auth"] });

import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ layers: ["./modules/auth"] });
```

While it remains in `modules`, `meeko dev`, `meeko build` and `meeko check` print once per process: `[meeko] Aviso: "./modules/auth" en modules de meeko.config.ts es una carpeta de layer (tiene app/pages y no es un módulo). Muévela a layers: ["./modules/auth"]; las carpetas en modules dejarán de funcionar en Meeko 2.0.`

## Common mistakes

### A name that does not exist

```text bad
modules: ["@meekojs/i18m", "./modules/missing"]
```

`No se encuentra el módulo de Meeko @meekojs/i18m: no es un paquete instalado ni una ruta del proyecto. ¿Quisiste decir "@meekojs/i18n"?` (without a similar name, it explains how to install it) and `No se encuentra el módulo de Meeko ./modules/missing: …/modules/missing no existe`.

```text good
pnpm add @meekojs/i18n   y   modules: ["@meekojs/i18n"]
```

### A package that is not a module

```text bad
modules: ["left-pad"]
```

`El paquete left-pad no es un módulo de Meeko: …/index.js debe exportar por defecto defineMeekoModule(...), en su subpath ./module o en su raíz`. List only packages that are Meeko modules (their `package.json` has the `meeko-module` keyword); import runtime dependencies in code, not in `modules`.

```text good
modules: ["@meekojs/ui"]
```

### Options for a module not in `modules`

```ts bad
export default defineMeekoConfig({ i18n: { defaultLocale: "es", catalogs: { es: "app/locales/es.json" } } });
```

`[meeko] Aviso MEEK127: meeko.config.ts tiene la clave "i18n", que es la configKey del módulo @meekojs/i18n, pero @meekojs/i18n no está en modules, así que Meeko ignora sus opciones. Añádalo: modules: ["@meekojs/i18n"].` This is a warning during `1.x`; the key is ignored, as it was through `1.7`.

<!-- no-check -->

```ts good
export default defineMeekoConfig({ modules: ["@meekojs/i18n"], i18n: { defaultLocale: "es", catalogs: { es: "app/locales/es.json" } } });
```

### An incorrectly typed option

<!-- no-check -->

```ts bad
export default defineMeekoConfig({ modules: ["@meekojs/i18n"], i18n: { defaultLocale: 1, catalogs: {} } });
```

`meeko check` reports `meeko.config.ts:1:… TS2322: Type 'number' is not assignable to type 'string'.`, and the editor marks it, using types from `.meeko/types/config.d.ts`.

<!-- no-check -->

```ts good
export default defineMeekoConfig({ modules: ["@meekojs/i18n"], i18n: { defaultLocale: "es", catalogs: { es: "app/locales/es.json" } } });
```

### Two modules with the same key

```text bad
modules: ["@meekojs/meeko/i18n", "@meekojs/i18n"]
```

`Los módulos de Meeko @meekojs/meeko/i18n y @meekojs/i18n usan la misma meta.configKey "i18n": quite uno de modules`. Previously the same options were read twice.

```text good
modules: ["@meekojs/i18n"]
```

### Options for a layer folder

```ts bad
export default defineMeekoConfig({ modules: [["./modules/auth", { strict: true }]] });
```

`La entrada ./modules/auth de modules es una carpeta de layer, que no admite opciones; muévala a layers`.

```ts good
import { defineMeekoConfig } from "@meekojs/meeko/framework";
export default defineMeekoConfig({ layers: ["./modules/auth"] });
```

## Notes

- **Security.** A module runs code in Node when configuration loads, including in the editor of a trusted workspace: install only trusted modules. In an untrusted workspace, the editor only reads literal strings from `modules` and writes nothing.
- **Names.** Two modules with the same `meta.name` or `meta.configKey` are an error. With `meta.compatibility.meeko`, loading fails if the Meeko version is outside the range.
- **A module without `configKey`** receives no options: its author must declare one.
- **Development.** Changing `meeko.config.ts` or `setup` code requires restarting `meeko dev`; a module's runtime files (plugins, components) reload like project files.
- **`sitemap` and `robots`.** A module that adds `sitemap.xml` or `robots.txt` with `meeko.addPublicFile` conflicts with the options of the same name: the build fails.
