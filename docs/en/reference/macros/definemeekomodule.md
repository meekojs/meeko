---
title: defineMeekoModule
group: macros
since: 1.2.0
description: Declares a Meeko module that configures the project from code when loading configuration, with merged options and the meeko object.
symbols:
  - "@meekojs/meeko/framework#defineMeekoModule"
types:
  - "@meekojs/meeko/framework#MeekoModuleDefinition"
  - "@meekojs/meeko/framework#MeekoModuleMeta"
  - "@meekojs/meeko/framework#MeekoModuleContext"
related:
  - "@meekojs/meeko/framework#defineMeekoConfig"
  - "@meekojs/meeko/framework#definePlugin"
  - "config:modules"
  - docs/framework.md#módulos
  - docs/framework.md#escribir-un-módulo
  - docs/framework.md#hooks
source-hash: ac1c8d81c10f84e86624757817acc630aee4709bcdbb3723ba886bed5f4a0022
---

`defineMeekoModule` declares a module: code configuring the project, like Nuxt modules. Its `setup` adds components, auto-imports, layouts, application plugins, server middleware and handlers, `<head>` entries, public files and Vite plugins, and responds to build hooks. The project registers it by name in `modules` in `meeko.config.ts` (`modules: ["@acme/hello"]` or `["./modules/hello"]`) and passes options in its `meta.configKey` key. A package default-exports it in its `./module` subpath or root, and declares `"keywords": ["meeko-module"]` in `package.json` so the editor completes its name.

`setup` runs in Node when loading configuration (in `meeko dev`, `meeko build`, `meeko check` and the language server in a trusted workspace), once per configuration and process. It never reaches the browser.

## Usage

```ts
// modules/hello/index.ts
import { defineMeekoModule } from "@meekojs/meeko/framework";

export interface HelloOptions { greeting: string }

// Tipa la clave `hello` de meeko.config.ts; Meeko carga esta ampliación sola.
declare module "@meekojs/meeko/framework" {
  interface MeekoConfig { readonly hello?: Partial<HelloOptions> }
}

export default defineMeekoModule<HelloOptions>({
  meta: { name: "hello", configKey: "hello", compatibility: { meeko: ">=1.2" } },
  defaults: { greeting: "Hola" },
  setup(options, meeko) {
    meeko.addComponentsDir(new URL("./components", import.meta.url), { prefix: "Hello" });
    meeko.addPlugin({ src: new URL("./runtime/greeting.ts", import.meta.url), options: { greeting: options.greeting } });
    meeko.addHead({ meta: [{ name: "generator", content: "Meeko" }] });
  },
});
```

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  modules: ["./modules/hello"],
  hello: { greeting: "Buenas" },
});
```

## Parameters

| Option                     | Type                                        | Default  | Description                                                                                                                                              |
| -------------------------- | ------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meta.name`                | `string`                                    | required | Unique module name; two modules with the same name are an error.                                                                                         |
| `meta.configKey`           | `string`                                    | none     | `meeko.config.ts` key containing module options; since `1.8`, the only documented way to pass them. Cannot be a Meeko option or repeated across modules. |
| `meta.compatibility.meeko` | npm range                                   | any      | Such as `">=1.2"`. Loading fails if the Meeko version is outside the range.                                                                              |
| `defaults`                 | `Partial<Options>`                          | `{}`     | Default option values.                                                                                                                                   |
| `setup`                    | `(options, meeko) => void \| Promise<void>` | required | Receives merged options and the `meeko` object. Can be asynchronous.                                                                                     |

Options merge in this order: `defaults`, then `config[meta.configKey]`. Plain objects merge deeply; arrays are replaced.

**Key types.** For `meeko.config.ts` to type the key without importing the module, the module augments `MeekoConfig` (`declare module "@meekojs/meeko/framework" { interface MeekoConfig { readonly hello?: … } }`) in its default export file or one that file imports. Meeko writes `.meeko/types/config.d.ts`, importing types from each module in `modules`, so augmentation loads automatically in the editor and `meeko check`.

## Return value

A `MeekoModule<Options>`, to default-export. Without `meta.name`, throws `TypeError: defineMeekoModule requires meta.name`; without `setup`, `TypeError: Meeko module <nombre> requires a setup function`.

The `meeko` object in `setup`:

| Member                                                               | What it does                                                                                                                                                                                                                                                                                              |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rootDir`, `dev`, `config`                                           | Project folder, `true` in `meeko dev` and loaded configuration.                                                                                                                                                                                                                                           |
| `addLayer(dir)`                                                      | Adds a layer.                                                                                                                                                                                                                                                                                             |
| `addComponentsDir(dir, { prefix })`                                  | Auto-imports the folder's `.meeko` files with a prefix.                                                                                                                                                                                                                                                   |
| `addLayout(name, file)`                                              | Since `1.5`, a named layout.                                                                                                                                                                                                                                                                              |
| `extendRoutes(fn)`                                                   | Since `1.8`, transforms the route manifest: `fn(routes)` returns the complete list, validated as a manifest.                                                                                                                                                                                              |
| `addAutoImports(entries)` / `addAutoImportsDir(dir, { scope })`      | Auto-imports from a package, file or folder, with their scope (`"app"`, `"client"`, `"server"`, `"shared"`). In `addAutoImports`, `componentOnly: true` restricts an `app` entry to component code and `app/` modules that can also run in the browser; excludes it from `<script server>` and `server/`. |
| `addPlugin({ src, mode?, options? })`                                | An application plugin (`definePlugin`).                                                                                                                                                                                                                                                                   |
| `addServerMiddleware(file)` / `addServerHandler({ route, handler })` | Server middleware (before the project's) and a handler for an exact route.                                                                                                                                                                                                                                |
| `addPublicFile(path, contents)`                                      | A public file.                                                                                                                                                                                                                                                                                            |
| `addTypeTemplate(filename, contents)`                                | A generated `.d.ts` declaration, removed when the module is disabled.                                                                                                                                                                                                                                     |
| `addHead(input)`                                                     | `document.head` entries.                                                                                                                                                                                                                                                                                  |
| `addVitePlugin(plugin)` / `extendViteConfig(fn)`                     | Vite plugins and configuration in `meeko dev` and `meeko build`.                                                                                                                                                                                                                                          |
| `hooks.hook(name, fn)`                                               | `ready`, `routes:resolved`, `build:before`, `prerender:routes`, `sitemap:resolved` (since `1.8`), `build:done`.                                                                                                                                                                                           |
| `warn(message)`                                                      | A warning with the module name.                                                                                                                                                                                                                                                                           |

## Examples

### Add files to the build with a hook

<!-- no-check -->

```ts
// modules/humans/index.ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { defineMeekoModule } from "@meekojs/meeko/framework";

export default defineMeekoModule<{ team: string[] }>({
  meta: { name: "humans", configKey: "humans" },
  defaults: { team: [] },
  setup(options, meeko) {
    meeko.hooks.hook("build:done", async ({ output }) => {
      await writeFile(join(output, "humans.txt"), options.team.join("\n"));
    });
  },
});
```

### Server auto-imports

```ts
// modules/mailer/index.ts
import { defineMeekoModule } from "@meekojs/meeko/framework";

export default defineMeekoModule({
  meta: { name: "mailer" },
  setup(_options, meeko) {
    meeko.addAutoImports([{ name: "sendMail", from: new URL("./runtime/send.server.ts", import.meta.url), scope: "server" }]);
    if (meeko.dev) meeko.warn("los correos se capturan en Mailpit durante el desarrollo");
  },
});
```

### Prerender more URLs

```ts
// modules/archive/index.ts
import { defineMeekoModule } from "@meekojs/meeko/framework";

export default defineMeekoModule({
  meta: { name: "archive" },
  setup(_options, meeko) {
    meeko.hooks.hook("prerender:routes", ({ urls }) => {
      for (const year of ["2025", "2026"]) urls.push(`/archive/${year}`);
    });
  },
});
```

## Common mistakes

### A module without `meta.name`

```ts bad
export default defineMeekoModule({ meta: {}, setup() {} });
```

`meeko check`, `meeko dev` and `meeko build` stop when loading configuration with `No se puede cargar el módulo de Meeko ./modules/hello: defineMeekoModule requires meta.name`.

<!-- no-check -->

```ts good
export default defineMeekoModule({ meta: { name: "hello" }, setup() {} });
```

### A Meeko version outside `compatibility`

```ts bad
export default defineMeekoModule({ meta: { name: "hello", compatibility: { meeko: ">=9" } }, setup() {} });
```

Configuration loading stops with `El módulo de Meeko hello necesita Meeko >=9; este proyecto usa 1.7.0` (with the installed version). Declare the range in which you test the module.

<!-- no-check -->

```ts good
export default defineMeekoModule({ meta: { name: "hello", compatibility: { meeko: "^1.2.0" } }, setup() {} });
```

### Secrets in plugin options

`addPlugin`'s `options` travel in the browser bundle if the plugin runs there: no error prevents this.

```ts bad
meeko.addPlugin({ src: new URL("./runtime/analytics.ts", import.meta.url), options: { apiKey: process.env.ANALYTICS_SECRET } });
```

<!-- no-check -->

```ts good
meeko.addPlugin({ src: new URL("./runtime/analytics.server.ts", import.meta.url), options: { endpoint: "/api/collect" } });
```

## Notes

- **Where it runs.** Only in Node when loading configuration. `setup`, its `"server"` plugins, middleware, handlers and server auto-imports never reach the browser: the Vite plugin rejects the build if the client graph reaches them, or if a browser-loaded file imports the module. Only `meeko.config.ts` should import it.
- **Paths.** Values received by `meeko` can be an absolute path, a `file:` URL (`new URL("./x", import.meta.url)`, typical in a package) or a project-root-relative path.
- **Hooks.** Run in registration order and Meeko awaits each one. `hook()` returns a function to remove it.
- **Custom host.** A Vite host using only the `meeko()` plugin receives modules' auto-imports, components, layers and plugins, but not their `addVitePlugin`, `extendViteConfig`, public files or hooks.
- **Development.** Changing a module or its options requires restarting `meeko dev`, like any configuration change.
