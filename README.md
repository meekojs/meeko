# Meeko

**Meeko** es un motor experimental de componentes para TypeScript. Los archivos `.meeko` combinan lógica tipada, plantilla y estilos; el compilador produce HTML para SSR y conecta la reactividad al HTML existente durante la hidratación.

El proyecto está en etapa temprana. Ya funciona el recorrido completo de un contador renderizado en servidor, hidratado en navegador y actualizado por señales. La sintaxis y las API públicas pueden cambiar antes de la primera versión estable.

- [Arquitectura y contratos](docs/architecture.md)
- [API y límites de compatibilidad](docs/api.md)
- [Plan de desarrollo y criterios de aceptación](docs/roadmap.md)
- [Comparativa reproducible con Vue](docs/benchmarks.md)
- [Guía para contribuir](CONTRIBUTING.md)

## Requisitos

- Node.js 24 o superior, gestionado localmente con `mise`.
- `pnpm`.
- TypeScript **7.0.2 estable** para compilar y comprobar los tipos. `@typescript/typescript6` se usa únicamente como analizador sintáctico del formato `.meeko`, porque TypeScript 7.0 todavía no ofrece una API programática estable para lenguajes incrustados.

## Estructura

| Ruta | Responsabilidad |
| --- | --- |
| `src/reactivity.ts` | `signal`, `computed`, `effect`, `batch` y liberación de efectos por instancia. |
| `src/compiler/sfc.ts` | Analiza secciones `.meeko` y conserva posiciones para diagnósticos. |
| `src/compiler.ts` | Genera un módulo TypeScript con SSR, hidratación y mapeos al archivo fuente. |
| `src/check.ts` | Comprueba tipos con TypeScript 7 y ubica diagnósticos en `.meeko`. |
| `src/types.ts` | Genera declaraciones para imports `.meeko` en proyectos TypeScript. |
| `src/server.ts` | Escapado de contenido dinámico para HTML. |
| `src/cli.ts` | Comandos `meeko check` y `meeko compile`. |
| `src/vite.ts` | Plugin de Vite para transformar `.meeko` en cliente y SSR. |
| `examples/counter` | Componente de referencia tipado. |
| `examples/vite` | Aplicación Vite sin generación manual de componentes. |
| `examples/nested` | Composición de componentes con rangos de hidratación y props tipadas. |
| `editors/vscode` | Extensión local con resaltado, diagnósticos y operaciones semánticas. |
| `benchmarks` | Comparativa repetible de Meeko y Vue en SSR y Chrome. |
| `tests` | Pruebas de SSR, hidratación y reactividad. |

## Desarrollo

```powershell
pnpm install
pnpm run verify
pnpm run e2e
pnpm run example:serve
```

`e2e` usa Chrome instalado localmente; `MEEKO_CHROME_PATH` permite indicar otro ejecutable compatible. Prueba Vite en desarrollo y producción, además de una página SSR con navegación. La última orden sirve el ejemplo en `http://127.0.0.1:4173`. El servidor envía HTML y las props iniciales como JSON escapado; el navegador hidrata el botón sin reemplazarlo.

Para probar la compilación automática con Vite:

```powershell
pnpm run build
pnpm run vite:dev
pnpm run vite:types
pnpm run vite:build
```

El plugin `meeko/vite` transforma imports de `.meeko` en cliente y SSR y procesa el CSS del componente. En desarrollo, HMR sustituye las instancias hidratadas sin recargar la página, conserva las señales editables que mantienen su nombre y aplica cambios de CSS. Un cambio en el runtime del motor provoca una recarga completa.

`vite:types` genera declaraciones `.d.meeko.ts` para los imports de la aplicación y comprueba el consumidor con TypeScript 7 y `allowArbitraryExtensions`. Las declaraciones del ejemplo se regeneran; no se versionan.

Para compilar otro componente:

```powershell
pnpm run build
node dist/cli.js check ruta/Componente.meeko
node dist/cli.js check ruta/Componente.meeko --json
node dist/cli.js compile ruta/Componente.meeko ruta/Componente.generated.ts
node dist/cli.js types ruta/Componente.meeko
```

`check` devuelve errores de sintaxis y tipos con línea y columna del `.meeko`; `--json` entrega diagnósticos estructurados para editores. `compile` ejecuta la misma comprobación y no escribe el módulo si encuentra errores. `types` genera declaraciones del componente y sus imports `.meeko` para que TypeScript compruebe las props del consumidor. La verificación usa TypeScript 7 y resuelve imports desde el directorio del componente.

La aplicación debe pasar **las mismas props** al render y a `hydrate`. `renderWithState(props)` entrega HTML y señales editables serializables; el ejemplo SSR transfiere ambos junto con las props mediante `serializeJson` y llama `hydrate(root, props, state)`. Meeko comprueba que el texto existente coincida durante la hidratación y devuelve una función que desconecta eventos y observadores. El HTML dinámico se escapa en el servidor.

## Sintaxis inicial

Un archivo tiene `<script lang="ts">`, `<template>` y un `<style>` opcional; `scoped` limita las reglas CSS al componente. `defineProps<Props>()` declara las props. La plantilla acepta expresiones de texto `{expression}`, eventos `on:click="handler"` y atributos dinámicos `bind:title="expression"`. Los atributos booleanos, como `bind:disabled`, se agregan o eliminan según el valor.

`if:when="expression"` muestra u oculta un elemento. Una lista usa `each:of="items"`, `each:as="item"` y `each:key="item.id"`; `each:index="position"` permite nombrar el índice, que se llama `index` por defecto. Las claves deben ser cadenas o números finitos y no pueden repetirse. Meeko conserva los nodos de las claves existentes al reordenar la lista. [Regions.meeko](examples/regions/Regions.meeko) muestra condiciones, listas anidadas, eventos y atributos dinámicos.

Un componente importado en el script se inserta con `<component is="Child" bind:label="expression"></component>`. Las props se comprueban con TypeScript y cada hijo se hidrata dentro de un rango de comentarios, sin un elemento envolvente. El cierre explícito es obligatorio; la sintaxis autocerrada de HTML no se admite para `<component>`. [Parent.meeko](examples/nested/Parent.meeko) muestra hijos y nietos dentro de condiciones y listas.

Los errores de sintaxis de script, plantilla y CSS, así como los errores de tipos en declaraciones y expresiones, tienen ubicación en `.meeko`. Los errores atribuibles sólo al código auxiliar generado se identifican explícitamente.

Los nombres e identificadores de código se escriben en inglés. La API pública y sus contratos llevan JSDoc en español.

La [extensión local de VS Code](editors/vscode/README.md) comparte los diagnósticos del CLI y ofrece completado, navegación, hover, renombrado y formato en script y plantilla. El VSIX se validó en un host VS Code aislado con un proyecto consumidor externo; su README explica cómo repetir la prueba y las limitaciones actuales.

## Alcance actual

Esta base todavía no implementa `:global` en CSS, un servidor de lenguaje independiente ni streaming. El compilador rechaza varias construcciones no soportadas. Estas capacidades necesitan conservar el mismo contrato de SSR e hidratación antes de añadirse.
