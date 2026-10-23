# API de Meeko

Meeko está en la serie experimental `0.x`. Esta página describe el contrato que ejercitan los ejemplos y las pruebas actuales; la sintaxis puede cambiar antes de una versión estable.

## Componentes `.meeko`

Un componente contiene un `<script lang="ts">` y un `<template>`; `<style scoped>` es opcional. En el script se admiten imports, tipos, declaraciones de variables y funciones. `defineProps<Props>()` es una macro de compilación: declara las props que reciben `renderToString` e `hydrate`; no necesita una implementación en tiempo de ejecución.

```html
<script lang="ts">
import { signal } from "@meekojs/meeko";

interface Props { initial: number }
const props = defineProps<Props>();
const count = signal(props.initial);
function increment(): void { count.value++; }
</script>

<template>
  <button on:click="increment" bind:title="String(count.value)">{count.value}</button>
</template>
```

La plantilla acepta texto `{expression}`, eventos `on:event="handler"`, atributos dinámicos `bind:name="expression"`, condiciones `if:when="expression"` y listas con `each:of`, `each:as` y `each:key`. `each:index` nombra el índice y su valor predeterminado es `index`. Las claves son cadenas o números finitos y deben ser únicas entre hermanos. Los atributos booleanos se agregan o eliminan según el valor de la expresión.

Para componer componentes, importa el módulo hijo en el script y usa `<component is="Child" bind:label="expression"></component>`. `is` nombra el import y cada `bind:` define una prop tipada. `<component>` requiere cierre explícito y no admite contenido interno. El HTML SSR marca un rango de comentarios para hidratar el hijo sin elemento envolvente; los hijos pueden aparecer en condiciones y listas.

## Módulo generado

Cada `.meeko` exporta `ComponentProps`, `css`, `renderWithState(props)`, `renderToString(props)`, `hydrate(root, props, state?)` y `hydrateScope(scope, props, state?)`. La aplicación entrega las mismas props serializables al servidor y al navegador. `renderWithState` devuelve HTML y una captura de señales editables validada como JSON; `hydrate` restaura esos valores antes de reclamar el HTML existente. Los hijos transportan su propio estado dentro de sus marcadores de comentarios. `hydrateScope` lo usa el compilador para esos hijos. La función de limpieza libera observadores y eventos. Una diferencia en el HTML inicial produce un error de hidratación.

```ts
import { hydrate, renderWithState } from "./Counter.meeko";
import { serializeJson } from "@meekojs/meeko";

const props = { initial: 1 };
const { html, state } = renderWithState(props);
const payload = serializeJson({ props, state });
// El servidor inserta html en la raíz y payload en un script JSON seguro.
const release = hydrate(document.querySelector("#counter")!, props, state);
// Llamar release() cuando la raíz deje de usarse.
```

Para transferir props o estado en una etiqueta `<script>`, usa `serializeJson(value)`; comprueba que el dato pueda representarse fielmente en JSON y escapa caracteres que podrían cerrar la etiqueta. `renderToString` sigue disponible cuando el estado inicial se deriva de forma determinista de las props y no se necesita una captura explícita. Al cambiar props reactivas de un hijo, Meeko conserva sus señales editables por nombre mientras reconstruye ese rango.

## Reactividad

`signal(initial)` crea un valor editable con `.value`. `computed(() => expression)` crea un valor derivado de solo lectura. `effect(() => ...)` observa las señales leídas y devuelve una función que cancela el observador. `batch(() => ...)` agrupa actualizaciones; `untrack(() => ...)` lee sin suscribir el observador actual. `createRoot(dispose => ...)` agrupa efectos para liberarlos al desmontar una instancia.

Los observadores creados durante `hydrate` pertenecen a esa instancia. Durante HMR de Vite se conservan por nombre las señales editables del script; los valores derivados se calculan otra vez. Este estado en memoria de HMR es independiente de la transferencia JSON entre servidor y navegador.

La superficie para aplicaciones es `@meekojs/meeko` (`signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot` y `serializeJson`), junto con los submódulos documentados `@meekojs/meeko/vite` y `@meekojs/meeko/devtools-ui`. El compilador importa sus funciones de DOM, HMR y registro de DevTools desde `@meekojs/meeko/internal`. Esta ruta es un contrato entre el compilador y su runtime de la **misma versión**; no está destinada a imports manuales. Los exports internos antiguos permanecen temporalmente en la raíz para no romper módulos generados con `0.0.1`, pero no tienen garantía de estabilidad.

## Herramientas

`meeko check archivo.meeko` comprueba sintaxis y tipos; `--json` entrega diagnósticos estructurados. `meeko compile entrada.meeko salida.ts` genera el módulo tipado y no escribe un archivo si hay errores. `meeko types archivo.meeko` emite declaraciones `Archivo.d.meeko.ts` para ese componente y los hijos importados. El consumidor activa `allowArbitraryExtensions` en TypeScript para resolver los imports `.meeko` con props precisas. El plugin `@meekojs/meeko/vite` compila los imports `.meeko` en cliente y SSR y añade HMR y CSS durante desarrollo. Consulta [la extensión local de VS Code](../editors/vscode/README.md) para usar las mismas comprobaciones en el editor.

## Compatibilidad y límites

- Node.js 24 o posterior y TypeScript 7.0.2 para el flujo de desarrollo actual.
- La API pública aún puede cambiar durante la serie `0.x`; el paquete se prepara como `@meekojs/meeko` bajo licencia MIT.
- El parser acepta el subconjunto de TypeScript y HTML descrito arriba; informa las construcciones no soportadas mediante diagnósticos.
- La hidratación requiere que el servidor y el navegador obtengan los mismos valores iniciales y el mismo orden de listas.
- No se ofrecen todavía streaming SSR, un servidor de lenguaje independiente ni garantías de compatibilidad con plugins de Vue.

## Antes de publicar

La licencia MIT y el nombre `@meekojs/meeko` ya están definidos. `pnpm run package:smoke` instala el tarball en un consumidor fuera del monorepo y comprueba CLI, SSR, tipos y Vite. Antes de declarar estable la API se ampliarán las pruebas de compatibilidad y se decidirá cuándo retirar de la raíz los exports internos heredados. La extensión de VS Code ya se empaquetó y probó en un host aislado con un proyecto consumidor externo.
