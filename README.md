# Meeko

<p align="center">
  <img src="https://raw.githubusercontent.com/meekojs/meeko/main/assets/brand/meeko-logo.png" alt="Carita de Meeko, una gatita de ojos azules, orejas oscuras y pelaje crema" width="200" />
</p>

Este proyecto está dedicado a mi gatita Meeko. Su carita inspira el logo que lo acompaña.

**Meeko** es un motor experimental de componentes para TypeScript. Los archivos `.meeko` combinan lógica tipada, plantilla y estilos; el compilador produce HTML para SSR y conecta la reactividad al HTML existente durante la hidratación.

El código se distribuye bajo la [licencia MIT](https://github.com/meekojs/meeko/blob/main/LICENSE). El paquete público se llama `@meekojs/meeko`; la CLI se invoca como `meeko` y el plugin de Vite se importa desde `@meekojs/meeko/vite`.

El proyecto está en etapa temprana. Ya funciona el recorrido completo de un contador renderizado en servidor, hidratado en navegador y actualizado por señales. La sintaxis y las API públicas pueden cambiar antes de la primera versión estable.

- [Arquitectura y contratos](https://github.com/meekojs/meeko/blob/main/docs/architecture.md)
- [API y límites de compatibilidad](https://github.com/meekojs/meeko/blob/main/docs/api.md)
- [Aplicaciones full-stack con Meeko](https://github.com/meekojs/meeko/blob/main/docs/framework.md)
- [Plan de desarrollo y criterios de aceptación](https://github.com/meekojs/meeko/blob/main/docs/roadmap.md)
- [Comparativa reproducible con Vue](https://github.com/meekojs/meeko/blob/main/docs/benchmarks.md)
- [DevTools para depurar componentes](https://github.com/meekojs/meeko/blob/main/docs/devtools.md)
- [Aplicación piloto SSR](https://github.com/meekojs/meeko/blob/main/examples/pilot/README.md)
- [Publicación y verificaciones](https://github.com/meekojs/meeko/blob/main/docs/releasing.md)
- [Historial de cambios](https://github.com/meekojs/meeko/blob/main/CHANGELOG.md)
- [Guía para contribuir](https://github.com/meekojs/meeko/blob/main/CONTRIBUTING.md)

## Requisitos

- Node.js 24 o superior, gestionado localmente con `mise`.
- `pnpm`.
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

Desde `0.0.3`, si ya ejecutaste `pnpm add @meekojs/meeko` en una carpeta sin código, puedes inicializarla directamente con `pnpm exec meeko init .`. Se conservan el manifiesto, los lockfiles, el workspace y `node_modules`; la CLI rechaza archivos de aplicación o scripts que entrarían en conflicto. Después ejecuta `pnpm install` y `pnpm run dev`. Para actualizar desde `0.0.2`, usa `pnpm add @meekojs/meeko@0.0.3` antes de `init .`.

### Crear una aplicación full-stack

Meeko Engine permite usar componentes `.meeko` de forma independiente. Meeko Framework añade rutas por archivos, layouts, middleware de `app/` y `server/`, SSR, estado por petición, API, RPC, sesiones y WebSocket con el mismo compilador y runtime. En este checkout, crea una aplicación con:

```powershell
pnpm exec meeko init-framework my-app
cd my-app
npm install
npm run dev
npm run check
npm run build
npm start
```

`check` genera contratos y comprueba tipos; `build` produce en `.meeko/output/node/` el cliente, el servidor Node y las páginas prerenderizadas, ejecutables sin las fuentes de la aplicación. `start` sirve SSR de producción con Node 24 y requiere configurar sesiones persistentes en `server/runtime.ts`. La [guía del framework](https://github.com/meekojs/meeko/blob/main/docs/framework.md) explica configuración, autoimports, rutas, middleware, despliegue y seguridad. Los comandos simplificados del proyecto están disponibles desde `0.1.0`.

## Estructura

| Ruta | Responsabilidad |
| --- | --- |
| `src/reactivity.ts` | `signal`, `computed`, `effect`, `batch` y liberación de efectos por instancia. |
| `src/compiler/sfc.ts` | Analiza secciones `.meeko` y conserva posiciones para diagnósticos. |
| `src/compiler.ts` | Genera un módulo TypeScript con SSR, hidratación y mapeos al archivo fuente. |
| `src/check.ts` | Comprueba tipos con TypeScript 7 y ubica diagnósticos en `.meeko`. |
| `src/types.ts` | Genera declaraciones para imports `.meeko` en proyectos TypeScript. |
| `src/server.ts` | Escapado de contenido dinámico para HTML. |
| `src/cli.ts` | CLI `meeko`: comandos de proyecto (`dev`, `check`, `build --adapter`, `start`, `preview`), de componente (`compile`, `types`), de generación (`routes`, `prerender`), starters (`init`, `init-framework`), servidor de lenguaje (`lsp`), `--help` y `--version`. |
| `src/language-server` | Servidor de lenguaje (`meeko lsp --stdio`, bin `meeko-language-server`) para VS Code y cualquier editor LSP. |
| `src/vite.ts` | Plugin de Vite para transformar `.meeko` en cliente y SSR. |
| `src/devtools.ts` | Instrumentación de instancias y señales sólo durante desarrollo. |
| `src/devtools-ui` | Panel de inspección dentro de la página. |
| `examples/counter` | Componente de referencia tipado. |
| `examples/vite` | Aplicación Vite sin generación manual de componentes. |
| `examples/nested` | Composición de componentes con rangos de hidratación y props tipadas. |
| `editors/vscode` | Extensión de VS Code: resaltado y cliente del servidor de lenguaje. |
| `benchmarks` | Comparativa repetible de Meeko y Vue en SSR y Chrome. |
| `tests` | Pruebas de SSR, hidratación y reactividad. |
| `tools/devtools-extension` | Panel local de Chrome DevTools. |

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

El ejemplo Vite muestra [Meeko DevTools](https://github.com/meekojs/meeko/blob/main/docs/devtools.md) durante el desarrollo: permite seleccionar cada instancia, revisar props y señales, seguir eventos y activar un punto de parada cuando cambia una señal. También hay un panel local para Chrome DevTools. La funcionalidad se incorpora al paquete a partir de `0.0.2`.

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

`if:when="expression"` muestra u oculta un elemento. Una lista usa `each:of="items"`, `each:as="item"` y `each:key="item.id"`; `each:index="position"` permite nombrar el índice, que se llama `index` por defecto. Las claves deben ser cadenas o números finitos y no pueden repetirse. Meeko conserva los nodos de las claves existentes al reordenar la lista. [Regions.meeko](https://github.com/meekojs/meeko/blob/main/examples/regions/Regions.meeko) muestra condiciones, listas anidadas, eventos y atributos dinámicos.

Un componente importado en el script se inserta con `<component is="Child" bind:label="expression"></component>`. Las props se comprueban con TypeScript y cada hijo se hidrata dentro de un rango de comentarios, sin un elemento envolvente. `is` también acepta un componente recibido como prop tipada `Component<Props>`; así se puede insertar contenido reutilizable y cambiarlo reactivamente. La comunicación hacia el padre usa callbacks tipados en las props, y `createContext<T>()` permite compartir valores con descendientes. El cierre explícito es obligatorio; la sintaxis autocerrada de HTML no se admite para `<component>`. [Parent.meeko](https://github.com/meekojs/meeko/blob/main/examples/nested/Parent.meeko) muestra hijos y nietos dentro de condiciones y listas.

Los errores de sintaxis de script, plantilla y CSS, así como los errores de tipos en declaraciones y expresiones, tienen ubicación en `.meeko`. Los errores atribuibles sólo al código auxiliar generado se identifican explícitamente.

Los nombres e identificadores de código se escriben en inglés. La API pública y sus contratos llevan JSDoc en español.

El servidor de lenguaje de Meeko (`meeko lsp --stdio` o `meeko-language-server --stdio`) comparte los diagnósticos del CLI y ofrece completado, navegación, referencias, hover, renombrado entre archivos, ayuda de firma, símbolos, plegado, formato y acciones rápidas en script y plantilla. La [extensión de VS Code](https://github.com/meekojs/meeko/blob/main/editors/vscode/README.md) es un cliente de ese servidor y usa el del proyecto cuando está instalado; [docs/editors.md](https://github.com/meekojs/meeko/blob/main/docs/editors.md) explica cómo configurarlo en Neovim, Helix, Zed, JetBrains y Sublime Text. El VSIX se validó en un host VS Code aislado con un proyecto consumidor externo; su README explica cómo repetir la prueba y las limitaciones actuales.

## Alcance actual

Las páginas pueden renderizarse con `render: "ssr"`, `"stream"` (streaming SSR con valores `defer`), `"prerender"` o `"client"`; véase [docs/framework.md](https://github.com/meekojs/meeko/blob/main/docs/framework.md). El compilador rechaza varias construcciones no soportadas. Estas capacidades necesitan conservar el mismo contrato de SSR e hidratación antes de añadirse.
