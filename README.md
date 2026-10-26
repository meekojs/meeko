# Meeko

<p align="center">
  <img src="https://raw.githubusercontent.com/meekojs/meeko/main/assets/brand/meeko-logo.png" alt="Carita de Meeko, una gatita de ojos azules, orejas oscuras y pelaje crema" width="200" />
</p>

Este proyecto está dedicado a mi gatita Meeko. Su carita inspira el logo que lo acompaña.

**Meeko** es un motor de componentes para TypeScript y un framework full-stack. Los archivos `.meeko` combinan lógica tipada, plantilla y estilos. El compilador produce HTML para SSR y, durante la hidratación, conecta la reactividad al HTML existente.

El código se distribuye bajo la [licencia MIT](https://github.com/meekojs/meeko/blob/main/LICENSE). El paquete público se llama `@meekojs/meeko`; la CLI se invoca como `meeko` y el plugin de Vite se importa desde `@meekojs/meeko/vite`.

A partir de 1.0, Meeko sigue SemVer. La [política de estabilidad](https://github.com/meekojs/meeko/blob/main/docs/stability.md) define qué es API pública: subrutas, CLI, convenciones de archivos y formatos de red. También fija cómo se depreca una API y qué entornos se admiten. La [guía de migración](https://github.com/meekojs/meeko/blob/main/docs/migration-1.0.md) explica cómo actualizar desde `0.1.0`, y [Actualizar de 1.0 a 1.1](https://github.com/meekojs/meeko/blob/main/docs/migration-1.1.md) recoge los cambios de comportamiento de `1.1`.

- [Arquitectura y contratos](https://github.com/meekojs/meeko/blob/main/docs/architecture.md)
- [API del motor de componentes](https://github.com/meekojs/meeko/blob/main/docs/api.md)
- [Aplicaciones full-stack con Meeko](https://github.com/meekojs/meeko/blob/main/docs/framework.md)
- [Política de estabilidad 1.x](https://github.com/meekojs/meeko/blob/main/docs/stability.md)
- [Migrar de 0.1.0 a 1.0](https://github.com/meekojs/meeko/blob/main/docs/migration-1.0.md)
- [Actualizar de 1.0 a 1.1](https://github.com/meekojs/meeko/blob/main/docs/migration-1.1.md)
- [Editores y servidor de lenguaje](https://github.com/meekojs/meeko/blob/main/docs/editors.md)
- [Plan de desarrollo](https://github.com/meekojs/meeko/blob/main/docs/roadmap.md)
- [Comparativa reproducible con Vue](https://github.com/meekojs/meeko/blob/main/docs/benchmarks.md)
- [DevTools para depurar componentes](https://github.com/meekojs/meeko/blob/main/docs/devtools.md)
- [Aplicación piloto SSR](https://github.com/meekojs/meeko/blob/main/examples/pilot/README.md)
- [Publicación y verificaciones](https://github.com/meekojs/meeko/blob/main/docs/releasing.md)
- [Historial de cambios](https://github.com/meekojs/meeko/blob/main/CHANGELOG.md)
- [Guía para contribuir](https://github.com/meekojs/meeko/blob/main/CONTRIBUTING.md)

## Requisitos

- Node.js 24 o superior para la CLI, el build, Vite y el servidor de lenguaje. En este repositorio se gestiona con `mise`.
- `pnpm` para desarrollar este repositorio.
- TypeScript **7.0.2 estable** para compilar y comprobar los tipos. `@typescript/typescript6` se usa únicamente como analizador sintáctico del formato `.meeko`, porque TypeScript 7.0 todavía no ofrece una API programática estable para lenguajes incrustados.

## Instalación en una aplicación

```powershell
pnpm add @meekojs/meeko
pnpm add -D vite
```

Si usas Vite, agrega el plugin a `vite.config.ts`:

```ts
import { defineConfig } from "vite";
import { meeko } from "@meekojs/meeko/vite";

export default defineConfig({ plugins: [meeko()] });
```

Las aplicaciones construidas se ejecutan en Node 24, Bun, Deno o Cloudflare Workers; la [política de estabilidad](https://github.com/meekojs/meeko/blob/main/docs/stability.md#entornos-soportados) indica las versiones probadas.

El paquete incluye TypeScript 7 y la CLI `meeko`. Puedes comprobar un componente con `pnpm exec meeko check ruta/Componente.meeko`. Vite es opcional si sólo usas el compilador y SSR.

### Crear una aplicación SSR

Con el paquete instalado, `meeko init` crea un proyecto independiente. El servidor renderiza el componente `.meeko` y transfiere props y señales para que el navegador hidrate el HTML existente.

```powershell
pnpm exec meeko init mi-app
cd mi-app
npm install
npm run dev
```

Abre `http://127.0.0.1:4173`. `npm run check` genera los tipos del componente y ejecuta TypeScript 7. `npm run build` compila cliente y servidor; `npm start` sirve la versión compilada con SSR. La CLI no sobrescribe archivos de aplicación existentes.

Si ya ejecutaste `pnpm add @meekojs/meeko` en una carpeta sin código, puedes inicializarla directamente con `pnpm exec meeko init .`. Se conservan el manifiesto, los lockfiles, el workspace y `node_modules`; la CLI rechaza archivos de aplicación o scripts que entrarían en conflicto. Después ejecuta `pnpm install` y `pnpm run dev`. El proyecto generado fija la versión exacta de `@meekojs/meeko`, porque el código compilado y su runtime deben coincidir.

### Crear una aplicación full-stack

Meeko Engine permite usar componentes `.meeko` de forma independiente. Meeko Framework añade, con el mismo compilador y runtime:

- rutas por archivos, layouts y middleware de `app/` y `server/`;
- SSR, streaming SSR con valores `defer`, prerender y páginas `render: "client"`;
- estado por petición;
- API y RPC tipados;
- sesiones con revocación;
- WebSocket, con broadcast entre instancias mediante Redis o Durable Objects.

Crea una aplicación con:

```powershell
pnpm exec meeko init-framework my-app
cd my-app
npm install
npm run dev
npm run check
npm run build
npm start
```

Cada script tiene su función:

- `check` genera los contratos y comprueba los tipos.
- `build` produce en `.meeko/output/node/` el cliente, el servidor Node y las páginas prerenderizadas, que se ejecutan sin las fuentes de la aplicación.
- `meeko build --adapter bun`, `--adapter deno` o `--adapter cloudflare` generan en su lugar una salida autónoma para Bun, Deno o Cloudflare Workers.
- `start` sirve SSR de producción con Node 24 y requiere configurar sesiones persistentes en `server/runtime.ts`.
- `meeko clean` borra todo lo que genera Meeko (`.meeko/` y la caché de Vite); `meeko clean --all` también borra `node_modules`. `--dry-run` muestra qué borraría sin tocar nada.

La [guía del framework](https://github.com/meekojs/meeko/blob/main/docs/framework.md) explica configuración, autoimports, rutas, middleware, despliegue y seguridad.

## Estructura

| Ruta | Responsabilidad |
| --- | --- |
| `src/reactivity.ts` | `signal`, `computed`, `effect`, `batch` y liberación de efectos por instancia. |
| `src/compiler/sfc.ts` | Analiza secciones `.meeko` y conserva posiciones para diagnósticos. |
| `src/compiler.ts` | Genera un módulo TypeScript con SSR, hidratación y mapeos al archivo fuente. |
| `src/check.ts` | Comprueba tipos con TypeScript 7 y ubica diagnósticos en `.meeko`. |
| `src/types.ts` | Genera declaraciones para imports `.meeko` en proyectos TypeScript. |
| `src/server.ts` | Escapado de contenido dinámico para HTML y `serializeJson`. |
| `src/dom.ts`, `src/hmr.ts` | Runtime de hidratación, regiones, listas y HMR. |
| `src/internal.ts` | Entrada `@meekojs/meeko/internal` que importa el código generado. |
| `src/cli.ts` | CLI `meeko`: comandos de proyecto (`dev`, `check`, `build --adapter`, `start`, `preview`), de componente (`compile`, `types`), de generación (`routes`, `prerender`), limpieza (`clean`), starters (`init`, `init-framework`), servidor de lenguaje (`lsp`), `--help` y `--version`. |
| `src/framework.ts`, `src/framework` | Framework: configuración, rutas, páginas, streaming, navegación, clientes API/RPC/Socket y generación del build. |
| `src/framework-server.ts`, `src/framework-server` | Núcleo de servidor portable (`@meekojs/meeko/server`): aplicación, runtime, contratos, sesiones, middleware y Socket. |
| `src/node.ts`, `src/bun.ts`, `src/deno.ts`, `src/cloudflare.ts` | Adaptadores de Node, Bun, Deno y Cloudflare Workers. |
| `src/build.ts` | Herramientas de build para Node (`@meekojs/meeko/build`). |
| `src/language-server` | Servidor de lenguaje (`meeko lsp --stdio`, bin `meeko-language-server`) para VS Code y cualquier editor LSP. |
| `src/vite.ts` | Plugin de Vite para transformar `.meeko` en cliente y SSR. |
| `src/devtools.ts`, `src/devtools-protocol.ts` | Instrumentación de desarrollo y tipos del protocolo DevTools 1. |
| `src/devtools-ui` | Panel de inspección dentro de la página. |
| `examples/counter` | Componente de referencia tipado. |
| `examples/attributes`, `examples/regions`, `examples/primitives` | Atributos dinámicos, condiciones y listas anidadas, y listas de valores primitivos. |
| `examples/vite` | Aplicación Vite sin generación manual de componentes. |
| `examples/nested` | Composición de componentes con rangos de hidratación y props tipadas. |
| `examples/pilot` | Aplicación piloto SSR. |
| `editors/vscode` | Extensión de VS Code: resaltado y cliente del servidor de lenguaje. |
| `benchmarks` | Comparativa repetible de Meeko y Vue en SSR y Chrome. |
| `tests` | Pruebas unitarias, E2E y de consumidor externo, y la suite de conformidad de adaptadores (`tests/conformance`). |
| `tools/devtools-extension` | Extensión Meeko DevTools para Chrome. |
| `site` | Sitio de documentación, hecho con Meeko a partir de estos Markdown. |

## Desarrollo

```powershell
pnpm install
pnpm run verify
pnpm run e2e
pnpm run pilot:e2e
pnpm run package:smoke
pnpm run example:serve
```

`e2e` usa Chrome instalado localmente; `MEEKO_CHROME_PATH` permite indicar otro ejecutable compatible. Prueba Vite en desarrollo y producción, además de una página SSR con navegación. `pilot:e2e` prueba la aplicación piloto en Chromium, Firefox y WebKit instalados por Playwright, tanto en desarrollo como en producción. `package:smoke` instala el tarball en un proyecto temporal externo y prueba CLI, SSR, tipos, Vite y `meeko init`. La última orden sirve el contador en `http://127.0.0.1:4173`.

Para probar la compilación automática con Vite:

```powershell
pnpm run build
pnpm run vite:dev
pnpm run vite:types
pnpm run vite:build
```

El plugin `@meekojs/meeko/vite` transforma imports de `.meeko` en cliente y SSR y procesa el CSS del componente. En desarrollo, HMR sustituye las instancias hidratadas sin recargar la página, conserva las señales editables que mantienen su nombre y aplica cambios de CSS. Un cambio en el runtime del motor provoca una recarga completa.

El ejemplo Vite muestra [Meeko DevTools](https://github.com/meekojs/meeko/blob/main/docs/devtools.md) durante el desarrollo. Con él puedes:

- seleccionar cada instancia y revisar sus props y señales;
- editar una señal;
- seguir en la línea de tiempo dónde se lee y se escribe cada señal;
- activar un punto de parada cuando cambia una señal.

La extensión Meeko DevTools para Chrome ofrece el mismo panel dentro de Chrome DevTools.

`vite:types` genera declaraciones `.d.meeko.ts` para los imports de la aplicación y comprueba el consumidor con TypeScript 7 y `allowArbitraryExtensions`. Las declaraciones del ejemplo se regeneran; no se versionan.

Para compilar otro componente:

```powershell
pnpm run build
node dist/cli.js check ruta/Componente.meeko
node dist/cli.js check ruta/Componente.meeko --json
node dist/cli.js compile ruta/Componente.meeko ruta/Componente.generated.ts
node dist/cli.js types ruta/Componente.meeko
```

`check` devuelve errores de sintaxis y tipos con línea y columna del `.meeko`; `--json` entrega diagnósticos estructurados para editores. `compile` ejecuta la misma comprobación y no escribe el módulo si encuentra errores. `types` genera declaraciones del componente y sus imports `.meeko` para que TypeScript compruebe las props del consumidor. La verificación usa TypeScript 7 y resuelve imports desde el directorio del componente, incluidos los alias `paths` y `baseUrl` del `tsconfig.json` de la raíz del paquete, como el editor.

La aplicación debe pasar **las mismas props** al render y a `hydrate`. `renderWithState(props)` entrega HTML y señales editables serializables; el ejemplo SSR transfiere ambos junto con las props mediante `serializeJson` y llama `hydrate(root, props, state)`. Meeko comprueba que el texto existente coincida durante la hidratación y devuelve una función que desconecta eventos y observadores. El HTML dinámico se escapa en el servidor.

## Aplicación piloto

[`examples/pilot`](https://github.com/meekojs/meeko/blob/main/examples/pilot/README.md) reúne SSR, hidratación, componentes anidados, listas, formularios, rutas y una API asíncrona. Se ejecuta con `pnpm run pilot:dev`; `pnpm run pilot:build` y `pnpm run pilot:serve` prueban los artefactos de producción sin middleware de Vite. La prueba `pnpm run pilot:e2e` recorre ambos modos en Chromium, Firefox y WebKit. WebKit de Playwright no equivale a una prueba en Safari real.

## Sintaxis inicial

Un archivo tiene `<script lang="ts">`, `<template>` y un `<style>` opcional; `scoped` limita las reglas CSS al componente. `defineProps<Props>()` declara las props. La plantilla acepta expresiones de texto `{expression}`, eventos `on:click="handler"` y atributos dinámicos `bind:title="expression"`. Los atributos booleanos, como `bind:disabled`, se agregan o eliminan según el valor.

`defineProps<Props>({ count: 0 })` declara defaults sin otra macro: `count` será opcional al usar el componente y estará definido dentro de él. Consulta las reglas y límites en la [guía de la API](https://github.com/meekojs/meeko/blob/main/docs/api.md#valores-por-defecto-en-defineprops).

`if:when="expression"` muestra u oculta un elemento. Una lista usa `each:of="items"`, `each:as="item"` y, opcionalmente desde `1.1`, `each:key="item.id"`; `each:index="position"` permite nombrar el índice, que se llama `index` por defecto. Las claves deben ser cadenas o números finitos y no pueden repetirse. Con clave, Meeko conserva los nodos de las claves existentes al reordenar la lista; sin ella, la clave es el índice. [Regions.meeko](https://github.com/meekojs/meeko/blob/main/examples/regions/Regions.meeko) muestra condiciones, listas anidadas, eventos y atributos dinámicos.

Un componente importado en el script se inserta con `<component is="Child" bind:label="expression"></component>`. Las props se comprueban con TypeScript y cada hijo se hidrata dentro de un rango de comentarios, sin un elemento envolvente. `is` también acepta un componente recibido como prop tipada `Component<Props>`; así se puede insertar contenido reutilizable y cambiarlo reactivamente. La comunicación hacia el padre usa callbacks tipados en las props, y `createContext<T>()` permite compartir valores con descendientes. El cierre explícito es obligatorio; la sintaxis autocerrada de HTML no se admite para `<component>`. [Parent.meeko](https://github.com/meekojs/meeko/blob/main/examples/nested/Parent.meeko) muestra hijos y nietos dentro de condiciones y listas.

Desde `1.1`, un componente fijo se escribe como etiqueta (`<AppButton variant="primary" bind:label="x" />`), con props estáticas y `bind:`, eventos con `defineEmits` y `on:`, modelos con `defineModel` y `model`, contenido con `defineSnippets`, `<snippet>` y `<render>`, y un valor público con `defineExpose` que el padre lee con `ref:` y `useElementRef`. Los componentes pueden ser genéricos (`<script lang="ts" generic="T">`), `<script lang="ts">` es opcional, `onMounted` ejecuta código tras montar, `model` enlaza controles de formulario y `html` inserta HTML sin escapar. La [guía de la API](https://github.com/meekojs/meeko/blob/main/docs/api.md) los describe, y el plugin `@meekojs/meeko/prettier` formatea los `.meeko` en la CLI y el editor.

Los errores de sintaxis de script, plantilla y CSS, así como los errores de tipos en declaraciones y expresiones, tienen ubicación en `.meeko`. Los errores atribuibles sólo al código auxiliar generado se identifican explícitamente.

Los nombres e identificadores de código se escriben en inglés. La API pública y sus contratos llevan JSDoc en español.

El servidor de lenguaje de Meeko (`meeko lsp --stdio` o `meeko-language-server --stdio`) comparte los diagnósticos del CLI y ofrece completado, navegación, referencias, hover, renombrado entre archivos, ayuda de firma, símbolos, plegado, formato y acciones rápidas en script y plantilla. La [extensión de VS Code](https://github.com/meekojs/meeko/blob/main/editors/vscode/README.md) es un cliente de ese servidor y usa el del proyecto cuando está instalado; [docs/editors.md](https://github.com/meekojs/meeko/blob/main/docs/editors.md) explica cómo configurarlo en Neovim, Helix, Zed, JetBrains y Sublime Text. El VSIX se validó en un host VS Code aislado con un proyecto consumidor externo; su README explica cómo repetir la prueba y las limitaciones actuales.

## Alcance de 1.0

- **Render.** Las páginas pueden renderizarse con `render: "ssr"`, `"stream"` (streaming SSR con valores `defer`), `"prerender"` o `"client"`.
- **Despliegue.** Los destinos son Node, Bun, Deno y Cloudflare Workers. Una suite de conformidad común comprueba los cuatro.
- **Socket.** Los broadcasts se distribuyen entre instancias con Redis o, en Workers, con Durable Objects.
- **Sesiones.** Revocar una sesión aborta las peticiones en curso y cierra sus sockets.

Lo explica [docs/framework.md](https://github.com/meekojs/meeko/blob/main/docs/framework.md). El compilador rechaza con diagnósticos las construcciones que no soporta. Las ampliaciones previstas después de 1.0 están en el [plan de desarrollo](https://github.com/meekojs/meeko/blob/main/docs/roadmap.md).
