# API de Meeko

Meeko está en la serie experimental `0.x`. Esta página describe el contrato que ejercitan los ejemplos y las pruebas actuales; la sintaxis puede cambiar antes de una versión estable.

Esta guía cubre el motor de componentes independiente. Las convenciones de `app/`, rutas, middleware, API, RPC, Socket y sesiones están en la [guía del framework](framework.md).

## Componentes `.meeko`

Un componente contiene un `<script lang="ts">` y un `<template>`; `<style scoped>` es opcional. En el script se admiten imports, tipos, declaraciones de variables y funciones, y llamadas de expresión para registrar hooks durante el setup. `defineProps<Props>()` es una macro de compilación: declara las props que reciben `renderToString` e `hydrate`; no necesita una implementación en tiempo de ejecución.

```html
<script lang="ts">
    import { signal } from '@meekojs/meeko'

    interface Props {
        initial: number
    }
    const props = defineProps<Props>()
    const count = signal(props.initial)
    function increment(): void {
        count.value++
    }
</script>

<template>
    <button
        on:click="increment"
        bind:title="String(count.value)"
    >
        {count.value}
    </button>
</template>
```

### Valores por defecto en `defineProps`

Los defaults están integrados en la misma macro; no se necesita `withDefaults`:

```html
<script lang="ts">
interface Props {
  title: string;
  count: number;
  tags?: string[];
}

const props = defineProps<Props>({ count: 0, tags: [] });
</script>

<template><p>{props.title}: {props.count} ({props.tags.length})</p></template>
```

Para quien usa el componente, `count` y `tags` pasan a ser opcionales en `ComponentProps`; `title` sigue siendo obligatorio. Dentro del componente, los tres valores tienen sus tipos definidos. Una prop explícita prevalece sobre su default; si llega como `undefined`, se aplica el default. El objeto literal se evalúa para cada render o hidratación: valores creados dentro, como `tags: []`, son nuevos por instancia; un objeto importado como default conserva la identidad compartida del módulo. SSR e hidratación deben obtener el mismo valor inicial: evite defaults no deterministas como `Date.now()` o `Math.random()` salvo que pase el valor como prop explícita.

El argumento debe ser un **objeto literal con propiedades nombradas**. Los valores pueden usar literales o símbolos importados, pero no variables locales del setup. Meeko comprueba que cada clave exista en `Props` y que su valor tenga el tipo declarado; rechaza claves duplicadas, spreads, nombres calculados, un default `undefined` y claves que no estén presentes en todas las variantes de una unión de props. `ComponentProps` conserva modificadores `readonly` y los campos específicos de cada variante. `defineProps<Props>()` permanece válido y conserva todas las props tal como se declararon.

La plantilla acepta texto `{expression}`, eventos `on:event="handler"`, atributos dinámicos `bind:name="expression"`, condiciones `if:when="expression"` y listas con `each:of`, `each:as` y `each:key`. `each:index` nombra el índice y su valor predeterminado es `index`. Las claves son cadenas o números finitos y deben ser únicas entre hermanos. Los atributos booleanos se agregan o eliminan según el valor de la expresión.

Una expresión de texto puede contener llaves propias de JavaScript: objetos literales (`{ { total: count.value }.total }`), plantillas literales con `${...}`, cadenas que incluyen `{` o `}`, comentarios y expresiones regulares. La expresión termina en la llave que equilibra la de apertura; si no existe, el compilador informa `MEEK010` en la llave de apertura. Los valores de directivas pueden escribirse sin comillas cuando HTML lo permite, por ejemplo `on:click=increment` o `each:of=items`; CLI y VS Code los ubican igual que los valores entre comillas.

### Estilos con ámbito y `:global(...)`

`<style scoped>` añade el atributo `data-meeko-s-<hash>` al último compuesto de cada selector, antes de un pseudoelemento si lo hay (`.card::before` se convierte en `.card[data-meeko-s-…]::before`). `:global(<selector>)` emite el selector interno sin el atributo de ámbito:

| Fuente | Resultado |
| --- | --- |
| `.card :global(.icon)` | `.card[data-meeko-s-…] .icon` |
| `:global(body) .card` | `body .card[data-meeko-s-…]` |
| `:global(html.dark)` | `html.dark`, sin atributo de ámbito |

Un compuesto que contiene `:global(...)` no se limita; el atributo se añade al último compuesto local del selector, y un selector completamente global no lo recibe. `:global` sin paréntesis o vacío, una lista de selectores dentro de `:global(...)` y un `:global(...)` anidado en otra pseudoclase, como `:not(...)`, fallan con `MEEK019` en su posición. Las reglas dentro de `@keyframes` no se modifican.

CLI y VS Code comprueban el tipo del evento que recibe `on:event` y que `each:key` devuelve `string | number`; ambos ubican el diagnóstico en la expresión de la plantilla. Los eventos conocidos usan su tipo de `GlobalEventHandlersEventMap` y los demás reciben `Event`. El documento virtual de VS Code aplica las mismas opciones estrictas de acceso indexado, props opcionales exactas e imports de tipo que `meeko check`.

`each:index` tiene tipo `number` tanto en el componente compilado como en el documento virtual de VS Code; no se infiere como el literal inicial `0`.

Los handlers de `on:event` pueden ser asíncronos. Meeko observa su promesa y entrega los fallos síncronos o rechazos al observador más cercano, sin dejar un rechazo no manejado ni detener otros listeners. La limpieza del componente elimina sus listeners. Si no hay observador, Meeko registra el fallo en consola.

Dentro del script de un componente, `provideErrorHandler((error, source) => { ... })` registra un observador para sus eventos y los de sus hijos, y también para los rechazos de un `effect` u `onCleanup` que devolvió por error una promesa. Se autoimporta como una función ESM real; `error` tiene tipo `unknown`, por lo que debe refinarse antes de leer sus propiedades, y `source` es un `ErrorSource` (`"event"`, `"effect"`, `"cleanup"`, `"navigation"` o `"socket"`). Un componente descendiente puede registrar otro observador para su propia rama. El contexto está aislado por raíz; un observador asíncrono que rechace se registra junto al error original. En una aplicación montada, la navegación y los canales Socket creados dentro de la aplicación también utilizan el observador activo; sus opciones explícitas `onNavigationError` y `onError` tienen prioridad. El servidor usa su propio observador con `requestId`.

```html
<script lang="ts">
provideErrorHandler((error) => {
  console.error("Component failed", error);
});
function save(): void {
  // Handle the action here.
}
</script>
<template><button on:click="save">Save</button></template>
```

Para componer componentes, importa el módulo hijo en el script y usa `<component is="Child" bind:label="expression"></component>`. `is` acepta una expresión de módulo y cada `bind:` define una prop tipada. CLI y VS Code comprueban las props requeridas, los nombres y los tipos de los valores del hijo; el editor ofrece completado y ubica el diagnóstico en la expresión original. `<component>` requiere cierre explícito y no admite contenido interno. El HTML SSR marca un rango de comentarios para hidratar el hijo sin elemento envolvente; los hijos pueden aparecer en condiciones y listas.

`is` también acepta una expresión que devuelva un módulo de componente. Esto permite pasar contenido como una prop `Component<Props>` y renderizarlo dentro de otro componente con props comprobadas por TypeScript:

```html
<!-- Card.meeko -->
<script lang="ts">
    import type { Component } from '@meekojs/meeko'
    const props = defineProps<{ content: Component<{ label: string }>; label: string }>()
</script>
<template>
    <section>
        <component
            is="props.content"
            bind:label="props.label"
        ></component>
    </section>
</template>
```

El padre puede usar `<component is="Card" bind:content="Content" bind:label="'Hola'"></component>`, donde `Content` es un módulo `.meeko` importado. Si la expresión `is` cambia reactivamente, Meeko libera la instancia anterior y renderiza e hidrata la nueva dentro de los mismos marcadores. El contenido se crea como componente independiente, con su propio estado y limpieza. No existe aún una sintaxis de contenido inline dentro de `<component>`.

`<component is>` exige `Component<Props>`: su función `renderWithState` es obligatoria para transferir el estado SSR del hijo. `ComponentModule<Props>` conserva esa función como opcional para usos de bajo nivel que renderizan sin transferencia. El outlet de `app/app.meeko` y de los layouts también se declara como `Component<Record<string, unknown>>`. CLI y VS Code diagnostican un módulo que no satisface este contrato.

Si falla la hidratación de un reemplazo reactivo, Meeko restaura el contenido previo y vuelve a hidratarlo. Si también falla la restauración, entrega ambas causas en `AggregateError` y detiene esa vinculación. Las listas preparan las filas nuevas antes de retirar las anteriores: un fallo de render, hidratación o movimiento intenta restablecer el orden y las instancias anteriores. Los errores de limpieza se conservan junto al fallo original.

Para comunicar un hijo con su padre, declara un callback tipado en las props: `onSave: (id: number) => void`. El hijo llama `props.onSave(id)` y el padre pasa `bind:onSave="save"`. TypeScript comprueba tanto los argumentos emitidos por el hijo como la firma entregada por el padre. Esta comunicación explícita evita un canal de eventos sin contrato.

Los scripts aceptan `import type`, `export interface`, `export type` y reexportaciones de tipos. Por ejemplo, `import type { ComputedRef } from "./contract.js"; export interface CardProps { label: string }; const props = defineProps<CardProps & ComputedRef<string>>();` conserva la intersección en `ComponentProps` y en la declaración `.d.meeko.ts`. El consumidor debe proporcionar todos sus campos; el nombre `ComputedRef` por sí mismo no convierte una prop en señal reactiva.

## Módulo generado

Cada `.meeko` exporta `ComponentProps`, `css`, `renderWithState(props)`, `renderToString(props)`, `hydrate(root, props, state?)` y `hydrateScope(scope, props, state?)`. La aplicación entrega las mismas props serializables al servidor y al navegador. `renderWithState` devuelve HTML y una captura de señales editables validada como JSON; `hydrate` restaura esos valores antes de reclamar el HTML existente. Los hijos transportan su propio estado dentro de sus marcadores de comentarios. `hydrateScope` lo usa el compilador para esos hijos. La función de limpieza libera observadores y eventos. Una diferencia en el HTML inicial produce un error de hidratación.

```ts
import { hydrate, renderWithState } from './Counter.meeko'
import { serializeJson } from '@meekojs/meeko'

const props = { initial: 1 }
const { html, state } = renderWithState(props)
const payload = serializeJson({ props, state })
// El servidor inserta html en la raíz y payload en un script JSON seguro.
const release = hydrate(document.querySelector('#counter')!, props, state)
// Llamar release() cuando la raíz deje de usarse.
```

Para transferir props o estado en una etiqueta `<script>`, usa `serializeJson(value)`; comprueba que el dato pueda representarse fielmente en JSON y escapa caracteres que podrían cerrar la etiqueta. `renderToString` sigue disponible cuando el estado inicial se deriva de forma determinista de las props y no se necesita una captura explícita. Al cambiar props reactivas de un hijo, Meeko conserva sus señales editables por nombre mientras reconstruye ese rango.

## Reactividad

`signal(initial)` crea un valor editable con `.value`. `computed(() => expression)` crea un valor derivado de solo lectura. `effect(() => ...)` observa las señales leídas y devuelve una función que cancela el observador. `batch(() => ...)` agrupa actualizaciones; `untrack(() => ...)` lee sin suscribir el observador actual. `createRoot(dispose => ...)` agrupa efectos para liberarlos al desmontar una instancia. Si un observador falla, Meeko continúa los demás observadores pendientes y propaga los errores; varios fallos se entregan en un `AggregateError`. Si también falla el callback de `batch`, se conservan ambas causas.

El callback de `effect` debe ser síncrono: las lecturas posteriores a un `await` no pueden registrarse como dependencias de esa ejecución. TypeScript rechaza un callback que devuelve una promesa y el runtime rechaza el mismo caso en JavaScript; si esa promesa también rechaza, Meeko informa el rechazo para que no quede sin manejar. Inicie trabajo asíncrono desde un efecto síncrono y gestione explícitamente su cancelación y su error.

`onCleanup(() => ...)` registra la liberación de un recurso en la raíz activa y también exige un callback síncrono. TypeScript rechaza funciones que puedan devolver `PromiseLike`; el runtime protege JavaScript y callbacks que cambien de comportamiento, observa cualquier rechazo y entrega un `TypeError` durante la liberación. Todas las limpiezas continúan ejecutándose y los fallos simultáneos se agrupan. Para cerrar un recurso asíncrono, inicie y observe explícitamente esa operación antes del desmontaje o use un host que pueda esperar su propio ciclo de cierre.

Si el render o la hidratación falla, Meeko libera todos los efectos y recursos ya registrados. Cuando el trabajo y alguna limpieza fallan a la vez, entrega un `AggregateError` que conserva ambas causas.

`createContext<T>()` crea una clave única tipada. `provide(key, value)` publica un valor en la instancia activa; `inject(key)` busca el proveedor más cercano y falla explícitamente si falta. Las raíces independientes no comparten valores. Si el valor es una señal, los descendientes pueden leerla reactivamente.

Los observadores creados durante `hydrate` pertenecen a esa instancia. Durante HMR de Vite se conservan por nombre las señales editables del script; los valores derivados se calculan otra vez. Este estado en memoria de HMR es independiente de la transferencia JSON entre servidor y navegador.

La raíz `@meekojs/meeko` exporta exactamente `signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot`, `onCleanup`, `createContext`, `provide`, `inject`, `provideErrorHandler` y `serializeJson`, más los tipos de señales, contexto, componentes, `HotState` y DevTools. Los submódulos documentados son `@meekojs/meeko/vite` y `@meekojs/meeko/devtools-ui`. El compilador importa sus funciones de DOM, HMR y registro de DevTools desde `@meekojs/meeko/internal`. Esta ruta es un contrato entre el compilador y su runtime de la **misma versión**; no está destinada a imports manuales. Los helpers internos ya no se reexportan desde la raíz: un módulo compilado con una versión anterior a `0.0.2` debe volver a compilarse.

## Herramientas

`meeko check archivo.meeko` comprueba sintaxis y tipos; `--json` entrega diagnósticos estructurados. `meeko compile entrada.meeko salida.ts` genera el módulo tipado y no escribe un archivo si hay errores. `meeko types archivo.meeko` emite declaraciones `Archivo.d.meeko.ts` para ese componente y los hijos importados bajo `.meeko/types/`, reflejando su ruta relativa al proyecto; no escribe declaraciones junto a las fuentes. En una aplicación de framework, la generación registra sus salidas en `.meeko/manifests/component-types.json` y elimina únicamente declaraciones administradas cuyo componente ya no existe. La primera ejecución tras actualizar reconoce mediante AST únicamente declaraciones generadas huérfanas de versiones anteriores, mientras conserva archivos ajenos y regenera los componentes vigentes. Para resolver esos imports con props precisas, TypeScript necesita `allowArbitraryExtensions` y `rootDirs` que superponga el árbol fuente con `.meeko/types/`. `meeko init` escribe esa configuración; un consumidor configurado a mano debe incorporarla. El plugin `@meekojs/meeko/vite` compila los imports `.meeko` en cliente y SSR y añade HMR y CSS durante desarrollo. `meeko lsp --stdio` (también disponible como bin `meeko-language-server`) arranca el servidor de lenguaje que usan la [extensión de VS Code](../editors/vscode/README.md) y [otros editores](editors.md) para ofrecer las mismas comprobaciones en el editor.

## Compatibilidad y límites

- Node.js 24 o posterior y TypeScript 7.0.2 para el flujo de desarrollo actual.
- La API pública aún puede cambiar durante la serie `0.x`; el paquete se distribuye como `@meekojs/meeko` bajo licencia MIT.
- El parser acepta el subconjunto de TypeScript y HTML descrito arriba; informa las construcciones no soportadas mediante diagnósticos.
- La hidratación requiere que el servidor y el navegador obtengan los mismos valores iniciales y el mismo orden de listas.
- No se ofrecen todavía streaming SSR ni garantías de compatibilidad con plugins de Vue.

## Antes de publicar

La licencia MIT y el nombre `@meekojs/meeko` ya están definidos. `pnpm run package:smoke` instala el tarball en un consumidor fuera del monorepo y comprueba CLI, SSR, tipos y Vite. `tests/package-boundaries.test.ts` fija la lista exacta de exports de la raíz. La extensión de VS Code ya se empaquetó y probó en un host aislado con un proyecto consumidor externo.
