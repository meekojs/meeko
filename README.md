# Meeko

**Meeko** es un motor experimental de componentes para TypeScript. Los archivos `.meeko` combinan lógica tipada, plantilla y estilos; el compilador produce HTML para SSR y conecta la reactividad al HTML existente durante la hidratación.

El proyecto está en etapa temprana. Ya funciona el recorrido completo de un contador renderizado en servidor, hidratado en navegador y actualizado por señales. La sintaxis y las API públicas pueden cambiar antes de la primera versión estable.

- [Arquitectura y contratos](docs/architecture.md)
- [Plan de desarrollo y criterios de aceptación](docs/roadmap.md)
- [Guía para contribuir](CONTRIBUTING.md)

## Requisitos

- Node.js 24 o superior, gestionado localmente con `mise`.
- `pnpm`.
- TypeScript **7.0.2 estable** para compilar y comprobar los tipos. `@typescript/typescript6` se usa únicamente como analizador sintáctico del formato `.meeko`, porque TypeScript 7.0 todavía no ofrece una API programática estable para lenguajes incrustados.

## Estructura

| Ruta | Responsabilidad |
| --- | --- |
| `src/reactivity.ts` | `signal`, `computed`, `effect`, `batch` y liberación de efectos por instancia. |
| `src/compiler.ts` | Analiza `.meeko` y genera un módulo TypeScript con SSR e hidratación. |
| `src/server.ts` | Escapado de contenido dinámico para HTML. |
| `src/cli.ts` | Comando `meeko compile`. |
| `examples/counter` | Componente de referencia tipado. |
| `editors/vscode` | Asociación de `.meeko` y resaltado básico de script, plantilla y CSS. |
| `tests` | Pruebas de SSR, hidratación y reactividad. |

## Desarrollo

```powershell
pnpm install
pnpm run verify
pnpm run example:serve
```

La segunda orden sirve el ejemplo en `http://127.0.0.1:4173`. El servidor envía HTML y las props iniciales como JSON escapado; el navegador hidrata el botón sin reemplazarlo.

Para compilar otro componente:

```powershell
pnpm run build
node dist/cli.js compile ruta/Componente.meeko ruta/Componente.generated.ts
```

La aplicación debe pasar **las mismas props** a `renderToString(props)` y `hydrate(root, props)`. Meeko comprueba que el texto existente coincida durante la hidratación y devuelve una función que desconecta eventos y observadores. El HTML dinámico se escapa en el servidor.

## Sintaxis inicial

Un archivo tiene `<script lang="ts">`, `<template>` y un `<style>` opcional; `scoped` limita las reglas CSS al componente. `defineProps<Props>()` declara las props. La plantilla acepta expresiones de texto `{expression}` y eventos `on:click="handler"`. El código generado se comprueba con TypeScript 7; los errores de tipos en la plantilla aparecen en el archivo generado por ahora.

Los nombres e identificadores de código se escriben en inglés. La API pública y sus contratos llevan JSDoc en español.

## Alcance actual

Esta base todavía no implementa condiciones, listas, atributos dinámicos, `:global` en CSS, mapas de origen de diagnósticos, servidor de lenguaje ni streaming. El compilador rechaza varias construcciones no soportadas en vez de simular que funcionan. Esas capacidades necesitan conservar el mismo contrato de SSR e hidratación antes de añadirse.
