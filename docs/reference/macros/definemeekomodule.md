---
title: defineMeekoModule
group: macros
since: 1.2.0
description: Declara un módulo de Meeko, que configura el proyecto desde código al cargar la configuración, con sus opciones combinadas y el objeto meeko.
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
---

`defineMeekoModule` declara un módulo: código que configura el proyecto, como los módulos de Nuxt. Su `setup` añade componentes, autoimports, layouts, plugins de aplicación, middleware y handlers de servidor, entradas de `<head>`, archivos públicos y plugins de Vite, y reacciona a los hooks del build. El proyecto lo lista en `modules` de `meeko.config.ts`.

`setup` se ejecuta en Node al cargar la configuración (en `meeko dev`, `meeko build`, `meeko check` y el servidor de lenguaje de un workspace de confianza), una vez por configuración y proceso. Nunca llega al navegador.

## Uso

```ts
// modules/hello/index.ts
import { defineMeekoModule } from "@meekojs/meeko/framework";

export interface HelloOptions { greeting: string }

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

## Parámetros

| Opción | Tipo | Por defecto | Descripción |
| --- | --- | --- | --- |
| `meta.name` | `string` | obligatorio | Nombre único del módulo; dos módulos con el mismo nombre son un error. |
| `meta.configKey` | `string` | ninguno | Clave de `meeko.config.ts` con las opciones del módulo. |
| `meta.compatibility.meeko` | rango de npm | cualquiera | Como `">=1.2"`. La carga falla si la versión de Meeko queda fuera. |
| `defaults` | `Partial<Options>` | `{}` | Valores por defecto de las opciones. |
| `setup` | `(options, meeko) => void \| Promise<void>` | obligatorio | Recibe las opciones combinadas y el objeto `meeko`. Puede ser asíncrona. |

Las opciones se combinan en este orden: `defaults`, después `config[meta.configKey]` y por último las de `[módulo, opciones]` en `modules`. Los objetos planos se combinan en profundidad; los arrays se sustituyen.

## Valor devuelto

Un `MeekoModule<Options>`, para exportarlo por defecto. Sin `meta.name` lanza `TypeError: defineMeekoModule requires meta.name`; sin `setup`, `TypeError: Meeko module <nombre> requires a setup function`.

El objeto `meeko` de `setup`:

| Miembro | Qué hace |
| --- | --- |
| `rootDir`, `dev`, `config` | Carpeta del proyecto, `true` en `meeko dev` y la configuración cargada. |
| `addLayer(dir)` | Añade un layer. |
| `addComponentsDir(dir, { prefix })` | Autoimporta los `.meeko` de la carpeta con un prefijo. |
| `addLayout(name, file)` | Desde `1.5`, un layout con nombre. |
| `addAutoImports(entries)` / `addAutoImportsDir(dir, { scope })` | Autoimports de un paquete, un archivo o una carpeta, con su ámbito (`"app"`, `"client"`, `"server"`, `"shared"`). |
| `addPlugin({ src, mode?, options? })` | Un plugin de aplicación (`definePlugin`). |
| `addServerMiddleware(file)` / `addServerHandler({ route, handler })` | Middleware de servidor (antes que el del proyecto) y un handler para una ruta exacta. |
| `addPublicFile(path, contents)` | Un archivo público. |
| `addHead(input)` | Entradas de `document.head`. |
| `addVitePlugin(plugin)` / `extendViteConfig(fn)` | Plugins y configuración de Vite en `meeko dev` y `meeko build`. |
| `hooks.hook(name, fn)` | `ready`, `routes:resolved`, `build:before`, `prerender:routes`, `build:done`. |
| `warn(message)` | Un aviso con el nombre del módulo. |

## Ejemplos

### Añadir archivos al build con un hook

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

### Autoimports de servidor

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

### Prerenderizar más URL

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

## Errores comunes

### Un módulo sin `meta.name`

```ts bad
export default defineMeekoModule({ meta: {}, setup() {} });
```

`meeko check`, `meeko dev` y `meeko build` se detienen al cargar la configuración con `No se puede cargar el módulo de Meeko ./modules/hello: defineMeekoModule requires meta.name`.

<!-- no-check -->
```ts good
export default defineMeekoModule({ meta: { name: "hello" }, setup() {} });
```

### Una versión de Meeko fuera de `compatibility`

```ts bad
export default defineMeekoModule({ meta: { name: "hello", compatibility: { meeko: ">=9" } }, setup() {} });
```

La carga de la configuración se detiene con `El módulo de Meeko hello necesita Meeko >=9; este proyecto usa 1.7.0` (con la versión instalada). Declara el rango en el que pruebas el módulo.

<!-- no-check -->
```ts good
export default defineMeekoModule({ meta: { name: "hello", compatibility: { meeko: "^1.2.0" } }, setup() {} });
```

### Secretos en las opciones de un plugin

Las `options` de `addPlugin` viajan en el bundle del navegador si el plugin se ejecuta allí: no hay ningún error que lo impida.

```ts bad
meeko.addPlugin({ src: new URL("./runtime/analytics.ts", import.meta.url), options: { apiKey: process.env.ANALYTICS_SECRET } });
```

<!-- no-check -->
```ts good
meeko.addPlugin({ src: new URL("./runtime/analytics.server.ts", import.meta.url), options: { endpoint: "/api/collect" } });
```

## Notas

- **Dónde se ejecuta.** Sólo en Node, al cargar la configuración. El `setup`, sus plugins `"server"`, su middleware, sus handlers y sus autoimports de servidor nunca llegan al navegador: el plugin de Vite rechaza el build si el grafo del cliente los alcanza, o si un archivo que carga el navegador importa el módulo. Sólo `meeko.config.ts` debe importarlo.
- **Rutas.** Lo que recibe `meeko` puede ser una ruta absoluta, una URL `file:` (`new URL("./x", import.meta.url)`, lo habitual en un paquete) o una ruta relativa a la raíz del proyecto.
- **Hooks.** Se ejecutan en el orden en que se registraron y Meeko espera a cada uno. `hook()` devuelve una función que lo quita.
- **Host propio.** Un host de Vite que sólo usa el plugin `meeko()` recibe los autoimports, componentes, layers y plugins de los módulos, pero no sus `addVitePlugin`, `extendViteConfig`, archivos públicos ni hooks.
- **Desarrollo.** Cambiar un módulo o sus opciones exige reiniciar `meeko dev`, como cualquier cambio de la configuración.
