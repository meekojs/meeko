# API de Meeko

Esta página describe el contrato público del motor de componentes, que ejercitan los ejemplos y las pruebas. La [política de estabilidad](stability.md) indica qué cubre SemVer en la serie 1.x.

Esta guía cubre el motor de componentes independiente. Las convenciones de `app/`, rutas, middleware, API, RPC, Socket y sesiones están en la [guía del framework](framework.md).

## Componentes `.meeko`

Un componente contiene un `<template>` (sin él, `MEEK007`) y, normalmente, un `<script lang="ts">`; `<style scoped>` es opcional. Desde `1.1` el `<script lang="ts">` también es opcional: un componente con sólo `<template>`, o una página con `<script server>` y `<template>`, compila con un setup vacío y props `Record<string, never>`. `MEEK005`, que exigía el script, ya no se emite. Una página de `app/pages` puede añadir un `<script server lang="ts">` con su código de servidor y sus opciones de ruta, que nunca forma parte del componente; desde `1.1`, sus `export const` llegan al `<script>` y a la plantilla como datos tipados (véase [framework](framework.md#código-de-servidor-de-la-página)).

El nivel superior del `<script>` es el setup del componente y sólo admite estas sentencias:

- `import` y `export type`, `interface` y `type`;
- `const`/`let` con **una** variable y un nombre simple por sentencia (`MEEK014`). Desestructurar, como `const { a, b } = useX()`, no está permitido (`MEEK015`): guarde el resultado en una variable y lea sus campos (`const x = useX();` y después `x.a`), o devuelva señales individuales desde el composable;
- declaraciones `function` con nombre;
- llamadas como sentencia, por ejemplo `onCleanup(...)`, `onMounted(...)` o `effect(...)`;
- `await` sobre los composables que lo admiten, como sentencia completa o inicializador completo (véase [Composables de nivel superior y `await`](#composables-de-nivel-superior-y-await)).

Cualquier otra sentencia de nivel superior (`if`, `for`, `try`, clases, `export const`…) da `MEEK018`. Póngala dentro de una función, de un `effect` o de un composable de `app/composables`. En el script se admiten imports, tipos, declaraciones de variables y funciones, y llamadas de expresión para registrar hooks durante el setup. `defineProps<Props>()` es una macro de compilación: declara las props que reciben `renderToString` e `hydrate`; no necesita una implementación en tiempo de ejecución. `defineEmits`, `defineExpose`, `defineModel`, `defineSnippets` y `useElementRef` también son macros de compilación y no se importan.

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

La plantilla acepta texto `{expression}`, eventos `on:event="handler"`, atributos dinámicos `bind:name="expression"`, condiciones `if:when="expression"`, referencias `ref:name`, modelos `model="signal"` (véase [Controles de formulario con `model`](#controles-de-formulario-con-model)), HTML sin escapar `html="expression"` (véase [HTML sin escapar con `html`](#html-sin-escapar-con-html)) y listas con `each:of`, `each:as` y, opcionalmente, `each:key`. `each:index` nombra el índice y su valor predeterminado es `index`. Las claves son cadenas o números finitos y deben ser únicas entre hermanos. Los atributos booleanos se agregan o eliminan según el valor de la expresión. En los controles de formulario, `bind:value` (en `input`, `textarea` y `select`), `bind:checked` (en `input`) y `bind:selected` (en `option`) actualizan también la propiedad del elemento, porque el navegador deja de leer el atributo en cuanto el usuario edita el control. El control refleja siempre el signal, así que el manejador de `input` debe guardar el texto tal cual (`value.value = event.currentTarget.value`) y convertirlo donde se use. Un `select multiple` no se sincroniza con `bind:value`.

Una expresión de texto puede contener llaves propias de JavaScript: objetos literales (`{ { total: count.value }.total }`), plantillas literales con `${...}`, cadenas que incluyen `{` o `}`, comentarios y expresiones regulares. La expresión termina en la llave que equilibra la de apertura; si no existe, el compilador informa `MEEK010` en la llave de apertura. Los valores de directivas pueden escribirse sin comillas cuando HTML lo permite, por ejemplo `on:click=increment` o `each:of=items`; CLI y VS Code los ubican igual que los valores entre comillas.

### Controles de formulario con `model`

Desde `1.1`, `model="signal"` enlaza un control de formulario con una señal en los dos sentidos: el control muestra el valor de la señal y cada edición del usuario lo escribe en ella.

```html
<script lang="ts">
const name = signal("");
const accepted = signal(false);
const plan = signal<string | null>("free");
const tags = signal<string[]>([]);
</script>
<template>
    <input model="name">
    <input type="checkbox" model="accepted">
    <input type="radio" value="free" model="plan"> <input type="radio" value="pro" model="plan">
    <select multiple model="tags"><option value="a">A</option><option value="b">B</option></select>
</template>
```

| Control | Propiedad y evento | Tipo de la señal |
| --- | --- | --- |
| `<input>` de texto (cualquier `type` salvo los siguientes) y `<textarea>` | `value`, en `input` | `string` |
| `<input type="checkbox">` | `checked`, en `change` | `boolean` |
| `<input type="radio">` | marcado si la señal vale su `value`; `change` escribe ese valor | `string \| null \| undefined` |
| `<select>` | `value`, en `change` | `string` |
| `<select multiple>` | las opciones seleccionadas, en `change` | `string[]` |

- **Números.** Un `<input type="number">` también entrega texto: guarde un `string` y conviértalo donde se use.
- **Señal escribible.** La expresión debe ser una señal escribible del tipo de la tabla. Un `computed`, una señal de sólo lectura o un valor normal es un error de tipos, y en ejecución lanza un `TypeError`.
- **Sincronización.** Asignar la señal desde código actualiza la propiedad viva del control, como `bind:value` desde `1.0.1`. En SSR, el HTML lleva el valor de la señal (`value`, `checked`, el contenido del `<textarea>` o el `selected` de cada `<option>`). Si el usuario edita el control antes de que la página se hidrate (o el navegador restaura su valor), se conserva lo que escribió y se copia a la señal al terminar la hidratación, antes de los `onMounted`: las regiones `if:`, `each:`, `<render>` y los padres que leen la señal se hidratan primero con el valor del SSR y después reaccionan al valor restaurado.
- **Radio.** Necesita `value="..."` o `bind:value="expression"`.

`MEEK065` señala los usos no admitidos: `model` en un elemento que no es `<input>`, `<textarea>` o `<select>`; en `<input type="file">`, `submit`, `reset`, `button` o `image`; con `bind:type` o `bind:multiple` en lugar de valores estáticos; con contenido en `<textarea model>`; junto a `value`, `bind:value` u `on:input` en un control de texto (o `checked`, `bind:checked` u `on:change` en uno marcable, y `value`, `bind:value` u `on:change` en un `<select>`); un segundo `model` o `model:nombre`, que es sólo para componentes. Los demás eventos `on:` se admiten.

### HTML sin escapar con `html`

Desde `1.1`, `html="expression"` en un elemento lo llena con el HTML de la expresión, **sin escapar**. La expresión es un `string`; `null` y `undefined` dejan el elemento vacío.

```html
<script lang="ts">
const article = signal("<p>Contenido <strong>generado</strong> en el servidor.</p>");
</script>
<template><article class="prose" html="article.value"></article></template>
```

- **SSR.** El HTML de la expresión se normaliza para el elemento antes de escribirlo, de modo que al analizar el documento ningún nodo salga de él (ni pueda imitar marcadores de Meeko fuera de él): se cierran las etiquetas, comentarios y elementos de texto (`<style>`, `<textarea>`…) que quedaron abiertos (`"<b>Hola"` da `<b>Hola</b>`), se descartan los cierres que no corresponden a nada abierto en el valor (un `</div>` no cierra el elemento), y los cierres implícitos se escriben explícitos. El texto y los atributos se escriben tal cual. Si el navegador sacaría parte del contenido del elemento, el SSR deja el elemento vacío y el navegador lo llena al hidratar con `innerHTML`, que lo mantiene dentro; sin JavaScript ese contenido no se ve. Pasa con un `<div>` u otro bloque dentro de un `<p>` o de un elemento en línea (`<span>`, `<a>`, `<em>`, `<label>`…, que podrían estar dentro de un `<p>`), un `<li>` suelto, un título dentro de otro, celdas o filas fuera de su tabla, texto suelto en un `<table>`, `<tbody>` o `<tr>`, contenido distinto de `<option>` en un `<select>`, un bloque HTML dentro de `<svg>` y los elementos `<noscript>` y `<plaintext>`. Use un elemento que admita el contenido (`<div html>`, `<ul html>` para una lista de `<li>`, `<tbody html>` para filas). La normalización no conoce los antepasados del elemento: no anide enlaces, botones ni formularios entre la plantilla y el contenido.
- **Hidratación.** Si el contenido del elemento coincide con el HTML de la expresión (analizado en el contexto del elemento, así que `<br/>` y `<br>` coinciden), no se toca el DOM; si difiere, se sustituye `innerHTML`.
- **Reactividad.** Cada cambio del valor sustituye `innerHTML`. El contenido insertado no es parte de la plantilla: no tiene directivas, y la hidratación nunca busca marcadores de Meeko dentro de él.
- **Eventos.** Para reaccionar a clics dentro del HTML insertado, escuche en el propio elemento (`on:click`) y use `event.target.closest(...)`.

**Es inseguro con contenido no confiable.** Un HTML que venga de usuarios o de terceros puede ejecutar scripts en la página (XSS): sanéelo antes de insertarlo o use `{expression}`, que escapa el texto. Meeko nunca ejecuta los `<script>` del contenido cuando lo inserta en el navegador, igual que `innerHTML`: ni al hidratar un contenido distinto, ni al cambiar el valor, ni en una región que se monta después (`if:`, `each:`, un componente) ni al navegar a otra página. Los que lleva el HTML del documento inicial sí se ejecutan, porque los analiza el navegador como cualquier script de la página. `html` no es un mecanismo para cargar scripts.

El elemento no admite hijos, ni siquiera comentarios o `{expression}`; sólo espacios. `MEEK095` señala también `html` en un elemento vacío (`<img>`, `<input>`…), en uno de texto (`<textarea>`, `<title>`, `<script>`, `<style>`…), en `<template>`, junto a `model` o con un valor vacío. En una etiqueta de componente, `html` no es una prop (`MEEK032`). `bind:html` sigue siendo un atributo HTML llamado `html`.

**Elementos personalizados.** `html` y `model` son directivas sólo en los elementos HTML estándar, donde no son atributos HTML válidos. En un elemento personalizado (una etiqueta con guion, como `<x-markdown html="intro">` o `<my-input model="query">`) siguen siendo atributos HTML literales, como en `1.0`, y el elemento admite hijos.

### Listas con y sin `each:key`

Desde `1.1`, `each:key` es opcional (antes, una lista sin clave daba `MEEK023`, que se retira). Sin clave, la clave de cada fila es su índice: la fila `i` conserva sus nodos y recibe el elemento `i`, y las filas sólo se añaden o se quitan al final. Al insertar, borrar o reordenar en medio de la lista, cada fila muestra el elemento que ahora ocupa su posición.

```html
<li each:of="tags.value" each:as="tag">{tag}</li>
<li each:of="todos.value" each:as="todo" each:key="todo.id"><TodoItem bind:todo="todo" /></li>
```

Use `each:key` cuando la lista cambia de orden o recibe elementos en medio y cada fila tiene estado propio que debe acompañar a su elemento: un componente hijo con señales, un control de formulario que el usuario está editando, el foco o una animación. Con la clave, Meeko mueve las filas existentes en lugar de reasignarlas. Para listas que sólo se muestran o sólo crecen al final, el índice basta.

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

Dentro del script de un componente, `provideErrorHandler((error, source) => { ... })` registra un observador para sus eventos y los de sus hijos, y también para los rechazos de un `effect` u `onCleanup` que devolvió por error una promesa. Se autoimporta como una función ESM real; `error` tiene tipo `unknown`, por lo que debe refinarse antes de leer sus propiedades, y `source` es un `ErrorSource` (`"event"`, `"effect"`, `"cleanup"`, `"mounted"`, `"navigation"` o `"socket"`). `"mounted"` (desde `1.1`) identifica los fallos de un callback de `onMounted` y de la continuación en el navegador de un setup con `await` (véase [Ciclo de vida](#ciclo-de-vida)). Un componente descendiente puede registrar otro observador para su propia rama. El contexto está aislado por raíz; un observador asíncrono que rechace se registra junto al error original. En una aplicación montada, la navegación y los canales Socket creados dentro de la aplicación también utilizan el observador activo; sus opciones explícitas `onNavigationError` y `onError` tienen prioridad. El servidor usa su propio observador con `requestId`.

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

Para componer componentes, importa el módulo hijo en el script y usa `<component is="Child" bind:label="expression"></component>`. `is` acepta una expresión de módulo y cada `bind:` define una prop tipada (véanse también las [props estáticas](#props-estáticas)). CLI y VS Code comprueban las props requeridas, los nombres y los tipos de los valores contra las props que declara el hijo; el editor ofrece completado y ubica el diagnóstico en la expresión original. Desde `1.1` los nombres se comprueban también cuando la etiqueta pasa otras props válidas: antes, una prop desconocida junto a una conocida no daba error. Una prop obligatoria que falta se señala en la etiqueta. `<component>` requiere cierre explícito y no admite contenido interno. El HTML SSR marca un rango de comentarios para hidratar el hijo sin elemento envolvente; los hijos pueden aparecer en condiciones y listas.

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

El padre puede usar `<component is="Card" bind:content="Content" bind:label="'Hola'"></component>`, donde `Content` es un módulo `.meeko` importado. Si la expresión `is` cambia reactivamente, Meeko libera la instancia anterior y renderiza e hidrata la nueva dentro de los mismos marcadores. El contenido se crea como componente independiente, con su propio estado y limpieza. Para pasar contenido inline, use una etiqueta de componente con snippets (véase [Snippets](#snippets-con-definesnippets)); `<component is>` sigue sin admitir contenido (`MEEK031`).

`<component is>` exige `Component<Props>`: su función `renderWithState` es obligatoria para transferir el estado SSR del hijo. `ComponentModule<Props>` conserva esa función como opcional para usos de bajo nivel que renderizan sin transferencia. El outlet de `app/app.meeko` y de los layouts también se declara como `Component<Record<string, unknown>>`. CLI y VS Code diagnostican un módulo que no satisface este contrato.

Si falla la hidratación de un reemplazo reactivo, Meeko restaura el contenido previo y vuelve a hidratarlo. Si también falla la restauración, entrega ambas causas en `AggregateError` y detiene esa vinculación. Las listas preparan las filas nuevas antes de retirar las anteriores: un fallo de render, hidratación o movimiento intenta restablecer el orden y las instancias anteriores. Los errores de limpieza se conservan junto al fallo original.

Los scripts aceptan `import type`, `export interface`, `export type` y reexportaciones de tipos. Por ejemplo, `import type { ComputedRef } from "./contract.js"; export interface CardProps { label: string }; const props = defineProps<CardProps & ComputedRef<string>>();` conserva la intersección en `ComponentProps` y en la declaración `.d.meeko.ts`. El consumidor debe proporcionar todos sus campos; el nombre `ComputedRef` por sí mismo no convierte una prop en señal reactiva.

### Etiquetas de componente (`<AppButton />`)

Desde `1.1`, una etiqueta cuyo nombre empieza por mayúscula es un componente: `<AppButton bind:label="'Guardar'" />` equivale a `<component is="AppButton" bind:label="'Guardar'"></component>`. El nombre es un identificador del script, ya sea un import (`import * as AppButton from "./AppButton.meeko"`) o un autoimport de `app/components`. Admite las mismas props `bind:` y estáticas, eventos `on:`, modelos `model:` y `ref:` que `<component>`, se comprueba igual en CLI y VS Code y puede ir dentro de `if:when` y `each:of`.

- Puede cerrarse sola (`<AppButton />`) o con su etiqueta de cierre (`<AppButton></AppButton>`). Los nodos que siguen a una etiqueta autocerrada son sus hermanos, no su contenido.
- Su contenido son snippets del hijo (véase [Snippets](#snippets-con-definesnippets)). Pasar contenido a un componente sin `defineSnippets` es un error de tipos. `MEEK049`, que rechazaba cualquier contenido, ya no se emite.
- Un cierre `</AppButton>` sin apertura da `MEEK008`, y una etiqueta de componente fuera de `<template>`, `<script>` y `<style>` da `MEEK002`.
- Los nombres en mayúscula no se confunden con elementos HTML: `<Table>`, `<Input>` o `<Title>` son componentes.

Use `<component is="expression">` cuando el componente se elige con una expresión, como `props.outlet` o `props.content`; para un componente fijo, la etiqueta es más corta. El editor completa los nombres tras `<` y lleva de la etiqueta al archivo `.meeko`.

### Props estáticas

Desde `1.1`, un atributo sin prefijo en una etiqueta de componente o en `<component is>` pasa una prop estática, como en un elemento HTML:

```html
<AppButton variant="primary" disabled bind:label="title.value" />
```

- **Valor.** El texto del atributo llega como un literal de texto (`"primary"`, con su tipo literal) y un atributo sin valor llega como `true`. Ambos se comprueban con tipos contra las props del hijo, igual que `bind:`: `variant="tertiary"` frente a `variant: "primary" | "secondary"` es un error en el atributo.
- **Nombres reservados.** `is`, `ref` y `html` no son props estáticas, y tampoco los nombres con guiones (`data-label`, `aria-label`) ni los que llevan `:` sin ser una directiva (`bind:`, `on:`, `model:`, `ref:`, `if:when`, `each:*`): todos dan `MEEK032`. Para pasar una prop llamada `ref` use `bind:ref`.
- **Conflictos.** La misma prop como texto estático y con `bind:` u `on:` (`variant="primary" bind:variant="x"`) da `MEEK090`. `on:save` junto a `bind:onSave` sigue siendo `MEEK048`.

### Eventos de componente: `defineEmits` y `on:`

Un componente declara sus eventos con la macro `defineEmits<T>()`, donde cada clave de `T` es un evento y su valor es la tupla de argumentos. Devuelve una función `emit(evento, ...argumentos)` tipada:

```html
<!-- TodoItem.meeko -->
<script lang="ts">
const props = defineProps<{ id: number; title: string }>();
const emit = defineEmits<{ save: [id: number]; close: [] }>();
</script>
<template>
    <p>{props.title}</p>
    <button on:click="() => emit('save', props.id)">Guardar</button>
    <button on:click="() => emit('close')">Cerrar</button>
</template>
```

El padre escucha con `on:evento` en la etiqueta del hijo, igual en `<TodoItem>` que en `<component is>`:

```html
<TodoItem bind:id="todo.id" bind:title="todo.title" on:save="save" on:close="() => open.value = false" />
```

No hay un canal de eventos aparte: cada evento `save` es la prop de callback opcional `onSave` del hijo, y `emit("save", id)` llama a la que pasa el padre en ese momento. Por eso `on:save="save"` equivale a `bind:onSave="save"`, que sigue funcionando como en `1.0`, y un `emit` sin listener no hace nada. TypeScript comprueba los argumentos de `emit` en el hijo y la firma del handler en el padre; un evento que el hijo no declara es un error de tipos.

- `defineEmits` debe aparecer una sola vez, en su propia declaración `const` de nivel superior con un nombre simple (`MEEK045`), con un argumento de tipo (`MEEK046`) y sin argumentos en tiempo de ejecución (`MEEK047`).
- Las props que declara `defineEmits` (`onSave`) no pueden declararse también en `defineProps`: es un error de tipos.
- En un componente, el nombre del evento es un identificador (`on:save`, `on:saveDraft`); `on:save-draft` da `MEEK011`. Escribir `on:save` y `bind:onSave` en la misma etiqueta da `MEEK048`.
- En un elemento HTML, `on:click` sigue siendo un listener del DOM.

Un callback declarado directamente en `defineProps` (`onSave: (id: number) => void`, que el hijo llama con `props.onSave(id)`) sigue siendo válido; `defineEmits` evita declararlo a mano y lo hace opcional.

### Modelos de componente: `defineModel` y `model`

Desde `1.1`, un componente declara con la macro `defineModel<T>()` un valor que el padre comparte con él en los dos sentidos. Devuelve una `Signal<T>` escribible:

```html
<!-- AppInput.meeko -->
<script lang="ts">
const value = defineModel<string>();                                  // modelo por defecto
const open = defineModel<boolean>("open", { default: false });       // modelo con nombre, opcional
</script>
<template>
    <input model="value">
    <button on:click="() => open.value = !open.value">Opciones</button>
</template>
```

El padre pasa sus señales con `model` (el modelo por defecto) y `model:nombre`, igual en una etiqueta de componente que en `<component is>`:

```html
<AppInput model="name" model:open="settingsOpen" />
```

- **La señal del padre.** Si el padre pasa una señal, `defineModel` devuelve esa misma señal: leer y escribir en el hijo lee y escribe la del padre. El padre es su dueño, así que la señal no forma parte del estado que el hijo transfiere en SSR ni del que conserva en HMR.
- **Obligatorio u opcional.** Un modelo sin `default` es obligatorio: omitirlo en el padre es un error de tipos y, en ejecución, lanza un `TypeError`. Con `{ default: valor }` es opcional; si el padre no lo pasa, el hijo usa una señal local con ese valor inicial.
- **Señal escribible.** La expresión del padre debe ser una `Signal<T>` escribible. Un `computed`, una señal de sólo lectura o un valor normal es un error de tipos y, en ejecución, un `TypeError`.
- **No son props.** Los modelos no aparecen en `ComponentProps`; el módulo compilado exporta su tipo en `ComponentModels`. El SSR lee el valor de la señal y la hidratación conecta la misma señal.

`defineModel` va en su propia declaración `const` de nivel superior, con un nombre simple, y cada nombre de modelo aparece una vez (`MEEK063`). Recibe un argumento de tipo, un nombre opcional como literal de texto y unas opciones que sólo admiten `default` (`MEEK064`). En el padre, un nombre de modelo que no es un identificador, el mismo modelo dos veces, un `model` sin valor o `model:x` junto a `bind:x` dan `MEEK066`.

### Snippets con `defineSnippets`

Desde `1.1`, un componente recibe contenido del padre en snippets con nombre, que declara con la macro `defineSnippets<T>()`. Cada clave de `T` es un snippet, su valor es la tupla de parámetros y `?` lo hace opcional:

```html
<!-- AppDialog.meeko -->
<script lang="ts">
const snippets = defineSnippets<{ default: []; title?: []; actions?: [close: () => void] }>();
const open = signal(true);
function close(): void {
    open.value = false;
}
</script>
<template>
    <section if:when="open.value">
        <h2 if:when="snippets.title"><render snippet="snippets.title" /></h2>
        <render snippet="snippets.default" />
        <footer><render snippet="snippets.actions" args="close" /></footer>
    </section>
</template>
```

```html
<AppDialog>
    <p>{message.value}</p>
    <snippet name="title">Confirmar</snippet>
    <snippet name="actions" params="close"><button on:click="close">Cerrar</button></snippet>
</AppDialog>
```

- **En el padre.** El contenido suelto de la etiqueta llena `default`. `<snippet name="x" params="a, b">` llena el snippet `x`; `params` nombra sus parámetros, separados por comas, con los tipos de la tupla del hijo. El contenido usa el ámbito del padre (sus señales y funciones) y sigue siendo reactivo, también ante cambios de los argumentos.
- **En el hijo.** `<render snippet="expresión" args="a, b" />` pinta un snippet con esos argumentos; `args` es una lista de expresiones. `if:when="snippets.title"` comprueba si el padre pasó un snippet opcional, y un `<render>` de un snippet opcional ausente no pinta nada.
- **Tipos.** No pasar un snippet obligatorio, pasar uno que el hijo no declara o usar parámetros que no coinciden con su tupla son errores de tipos en el padre. Los snippets no son props: no aparecen en `ComponentProps`, y el módulo compilado exporta su tipo en `ComponentSnippets`. Cada snippet es un `Snippet<Args>`, tipo que exporta `@meekojs/meeko`.
- **SSR e hidratación.** El snippet se pinta dentro del DOM del hijo, entre marcadores de comentario, pero pertenece al ámbito reactivo del padre: se libera cuando se libera el padre o el hijo.
- **Reenvío.** Un componente puede pasar a otro un snippet que recibió: `<Inner><snippet name="x" params="a"><render snippet="snippets.x" args="a" /></snippet></Inner>`.

`defineSnippets` aparece una sola vez, en su propia declaración `const` de nivel superior con un nombre simple (`MEEK059`), con un argumento de tipo y sin argumentos en tiempo de ejecución (`MEEK060`). `MEEK061` señala un `<snippet>` que no es hijo directo de una etiqueta de componente, sin `name` o con un nombre o parámetros que no son identificadores, repetido, con atributos distintos de `name` y `params`, o un `<snippet name="default">` junto a contenido suelto. `MEEK062` señala un `<render>` sin `snippet`, con contenido o con atributos distintos de `snippet` y `args`. Una `ref:` dentro del contenido de un `<snippet>` da `MEEK052`, porque el hijo puede pintarlo varias veces. `<snippet>` y `<render>` pueden cerrarse solos.

### Exponer valores: `defineExpose`

`defineExpose(value)` publica un valor del hijo para el padre que lo nombra con `ref:` (véase la sección siguiente). Es una sentencia de nivel superior que aparece una sola vez (`MEEK050`) y recibe un argumento y, como mucho, un argumento de tipo (`MEEK051`):

```html
<!-- SearchBox.meeko -->
<script lang="ts">
const query = signal("");
function clear(): void {
    query.value = "";
}
defineExpose({ query, clear });
</script>
<template><input bind:value="query.value" on:input="(event) => query.value = event.currentTarget.value"></template>
```

El padre recibe ese valor con su tipo; un componente sin `defineExpose` expone `null`. El módulo compilado exporta el tipo `ComponentExposed`, y la función que devuelve `hydrateScope` lleva el valor en `exposed`. El valor expuesto no forma parte del estado que se transfiere del servidor al navegador.

Las declaraciones `.d.meeko.ts` que genera `meeko types` pierden precisión en un componente con `defineExpose`: TypeScript no puede inferir allí todo el tipo del valor expuesto y escribe `any` en lo que no infiere. `meeko check` y el servidor de lenguaje compilan el componente y tienen el tipo exacto.

### Referencias a elementos: `ref:` y `useElementRef`

La directiva `ref:nombre`, sin valor, nombra un elemento o un componente de la plantilla. `useElementRef("nombre")` lo lee desde el script:

```html
<script lang="ts">
const title = useElementRef("title");
const box = useElementRef("box");
onMounted(() => {
    title.value?.scrollIntoView();
});
function reset(): void {
    box.value?.clear();
}
</script>
<template>
    <h2 ref:title>Buscar</h2>
    <SearchBox ref:box />
    <button on:click="reset">Limpiar</button>
</template>
```

- **Tipo.** Sale de la plantilla: en un elemento HTML o SVG, su tipo de `HTMLElementTagNameMap` o `SVGElementTagNameMap` (`HTMLHeadingElement` para `<h2>`); en un componente, el tipo de su `defineExpose`.
- **Sin `await`.** `useElementRef` devuelve una señal de sólo lectura que vale `null` en SSR, antes de hidratar, mientras un `if:` oculta el destino y después de liberarlo. Cuando se ejecuta `onMounted`, cada ref visible ya tiene su valor.
- **Con `await`.** `const title = await useElementRef("title")` devuelve el elemento, nunca `null`, y espera a que exista, también si está bajo un `if:` que todavía es falso. El resto del setup continúa sólo en el navegador (véase la sección siguiente).
- **Listas.** Dentro de `each:of`, una sola directiva nombra todas las filas y `useElementRef` devuelve una señal con un array de sólo lectura, en orden de documento. Una ref de lista no se puede esperar con `await` (`MEEK056`).

`useElementRef` recibe un literal de texto con el nombre de una `ref:` de la plantilla; otro argumento o un nombre inexistente da `MEEK056`. Una `ref:` con valor, con un nombre que no es un identificador, en `<template>` o repetida en el mismo elemento da `MEEK052`; el mismo nombre en dos lugares de la plantilla da `MEEK053`. El editor completa los nombres dentro de `useElementRef("…")`.

`ref="x"` y `bind:ref` no son directivas: se comportan como en `1.0`, como un atributo HTML en un elemento y, en un componente, `ref="x"` da `MEEK032` y `bind:ref` pasa una prop `ref`.

### Componentes genéricos (`generic`)

Desde `1.1`, el atributo `generic` del `<script lang="ts">` declara parámetros de tipo del componente. Su valor es una lista de parámetros de tipo de TypeScript, con restricciones (`extends`), valores por defecto y parámetros que dependen de otros (`generic="T extends object, K extends keyof T"`):

```html
<!-- DataTable.meeko -->
<script lang="ts" generic="T extends { id: string }">
const props = defineProps<{ rows: T[] }>();
const emit = defineEmits<{ select: [row: T] }>();
const snippets = defineSnippets<{ row: [row: T] }>();
const current = defineModel<T | null>("current", { default: null });
defineExpose({ first: (): T | undefined => props.rows[0] });
</script>
<template>
    <ul>
        <li each:of="props.rows" each:as="row" each:key="row.id" on:click="() => emit('select', row)">
            <render snippet="snippets.row" args="row" />
        </li>
    </ul>
</template>
```

**Ámbito.** Los parámetros existen en todo el `<script>`: en los argumentos de tipo de `defineProps`, `defineEmits`, `defineModel` y `defineSnippets`, en el valor de `defineExpose` y en las anotaciones de variables y funciones. Las declaraciones `interface` y `type` del script, en cambio, se declaran a nivel de módulo, donde los parámetros no existen: una que usa `T` da `MEEK100`. Escriba el tipo en el argumento de la macro (`defineProps<{ rows: T[] }>()`) o declárelo genérico y pásele el parámetro (`type Rows<T> = T[]` y `defineProps<{ rows: Rows<T> }>()`).

**Inferencia en el padre.** El padre no escribe los argumentos de tipo: cada etiqueta los infiere una vez a partir de sus props.

```html
<DataTable bind:rows="users.value" on:select="(user) => open(user.email)" model:current="selected">
    <snippet name="row" params="user"><span>{user.email}</span></snippet>
</DataTable>
```

Con `users` de tipo `Signal<User[]>`, `T` es `User`. Con ese `T` se comprueban el resto de la etiqueta y lo que el padre recibe: el manejador de `on:select` recibe un `User`, `model:current` debe ser una `Signal<User | null>`, el parámetro `user` del snippet es un `User` y `useElementRef` de una `ref:` en la etiqueta devuelve el valor expuesto con `T = User`. Las props deben cumplir la restricción: filas sin `id` son un error de tipos en `bind:rows`. Los manejadores `on:` también son props (`onSelect`), así que uno con parámetros anotados participa en la inferencia; uno sin anotar recibe el `T` inferido. Una prop estática conserva su literal: con `generic="T extends string"`, `<Chip value="draft" />` infiere `T = "draft"`.

**Tipos.** El módulo compilado exporta `ComponentProps<T>`, `ComponentModels<T>`, `ComponentSnippets<T>` y `ComponentExposed<T>` con los mismos parámetros, restricciones y valores por defecto, y sus funciones `renderWithState`, `renderToString`, `hydrate` y `hydrateScope` son genéricas. Desde TypeScript, `ComponentProps<User>` da las props de una tabla de usuarios. Las declaraciones `.d.meeko.ts` de `meeko types` conservan los parámetros de tipo.

**Límites.**

- `T` sólo se infiere de las props. Los modelos, los snippets y las refs no participan: se comprueban con el `T` que dan las props, y si ninguna prop lo determina, TypeScript usa la restricción (o `unknown`).
- Una `ref:` en una etiqueta dentro de `each:of` tipa el valor expuesto de cada fila con la restricción de `T`, no con el `T` inferido.
- `<component is>` no admite contenido (`MEEK031`), así que un componente con snippets obligatorios, genérico o no, sólo puede usarse con su etiqueta: con `<component is>`, el snippet que falta es un error de tipos.
- Las páginas, los layouts, `app/app.meeko` y `app/error.meeko` no pueden ser genéricos, porque Meeko les pasa sus props (véase [framework](framework.md#routing-layouts-y-ssr)). Tampoco un `<script server>` lleva `generic`.

`MEEK100` señala un `generic` vacío o que no es una lista de parámetros de tipo válida (también si cierra la lista antes de tiempo, como `generic="T> = string; type X<U"`), un parámetro con modificadores (`const`, `in`, `out`), con un nombre que empieza por `__` o repetido, `generic` en `<script server>` o en una página, un layout, `app.meeko` o `error.meeko`, y una declaración de tipo del script que usa un parámetro.

### Composables de nivel superior y `await`

`useElementRef`, `useApi`, `useRpcQuery` y `useRpcMutation` sólo se llaman en el nivel superior del `<script>`; dentro de una función, un handler, un `effect` o `onMounted` dan `MEEK054`. `useState`, `useSocket`, `useSocketClient` y `useNavigation` mantienen su comportamiento de `1.0` y pueden llamarse también desde código anidado. `useApi`, `useRpcQuery` y `useRpcMutation` pertenecen al framework y se describen en [framework.md](framework.md#datos-en-componentes-useapi-userpcquery-y-userpcmutation).

El setup sigue siendo síncrono, con una excepción: admite `await` de nivel superior sólo sobre estos composables, y de dos clases.

| `await` | Dónde se resuelve | Resultado |
| --- | --- | --- |
| `await useApi(...)`, `await useRpcQuery(...)` | En el render del framework: SSR, hidratación y navegación | Los datos cargados, con `data` no nulo |
| `await useElementRef(...)`, `await useSocket(...)`, `await useSocketClient(...)` | Sólo en el navegador, tras montar | El elemento, o el socket una vez abierto |

El `await` debe ser la sentencia completa o el inicializador completo de una declaración (`const notes = await useApi(...)`), con uno por sentencia. Cualquier otro `await` de nivel superior, `await useRpcMutation(...)`, `for await` y `await using` dan `MEEK055`; lleve ese trabajo a una función o a `onMounted`.

El primer `await` de navegador divide el setup:

- Las sentencias anteriores son el setup normal, que se ejecuta en SSR y al hidratar. La plantilla sólo puede usar nombres declarados ahí: un nombre declarado después da `MEEK057`.
- Desde ese `await`, el resto es una continuación que sólo se ejecuta en el navegador, una vez montado el componente y listo lo que espera. Pertenece al componente: sus `effect`, `onCleanup` y composables se liberan al desmontarlo, y si se desmonta mientras espera, la continuación no se reanuda. Un fallo llega al observador de errores con la fuente `"mounted"`.
- `defineProps`, `defineEmits`, `defineExpose`, `defineModel` y `defineSnippets` deben ir antes de ese `await` (`MEEK058`).
- Un `await useApi(...)` o `await useRpcQuery(...)` posterior se ejecuta también sólo en el navegador, como una petición normal.
- La continuación es una función asíncrona, así que admite más sentencias que el setup: además de declaraciones `const`/`let` simples y funciones, cualquier sentencia de expresión (asignaciones como `count.value = 1`, no sólo llamadas), `if`, `for`, `for...of`, `for...in`, `while`, `do...while`, `try`, `switch` y bloques. `useElementRef`, `useApi`, `useRpcQuery` y `useRpcMutation` dentro de una de esas sentencias de control se ejecutarían de forma condicional o repetida y dan `MEEK054`. Cualquier otra sentencia (una clase, `export const`…) da `MEEK018`.

`await useElementRef("x")` espera el valor del `defineExpose` del componente que nombra `ref:x`. Si ese componente no tiene `defineExpose`, no hay nada que esperar: `meeko check` lo marca con `MEEK080` (el editor lo muestra como un error de tipos de `await`) y, en ejecución, la promesa rechaza con un error `MEEK080` cuando el componente se hidrata. Añada `defineExpose` al componente o lea `useElementRef("x").value` sin `await`.

```html
<script lang="ts">
const messages = signal<string[]>([]);
const chat = await useSocket("chat", { roomId: "general" });
// Desde aquí, sólo en el navegador y con el socket abierto.
chat.on("message", (message) => {
    messages.value = [...messages.value, message.text];
});
</script>
<template><p each:of="messages.value" each:as="text">{text}</p></template>
```

## Módulo generado

Cada `.meeko` exporta `ComponentProps`, `ComponentExposed` (desde `1.1`; `null` sin `defineExpose`), los tipos `ComponentModels` y `ComponentSnippets` (desde `1.1`; `null` sin `defineModel` o sin `defineSnippets`), `css`, `renderWithState(props)`, `renderToString(props)`, `hydrate(root, props, state?)` y `hydrateScope(scope, props, state?)`; en un componente con `generic`, esos tipos y funciones llevan sus parámetros de tipo (véase [Componentes genéricos](#componentes-genéricos-generic)). Con `defineEmits`, `ComponentProps` incluye las props de callback opcionales de cada evento (`onSave`). La aplicación entrega las mismas props serializables al servidor y al navegador. `renderWithState` devuelve HTML y una captura de señales editables validada como JSON; `hydrate` restaura esos valores antes de reclamar el HTML existente. Los hijos transportan su propio estado dentro de sus marcadores de comentarios. `hydrateScope` lo usa el compilador para esos hijos. La función de limpieza libera observadores y eventos. Una diferencia en el HTML inicial produce un error de hidratación.

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

Para transferir props o estado en una etiqueta `<script>`, usa `serializeJson(value)`; comprueba que el dato pueda representarse fielmente en JSON y escapa caracteres que podrían cerrar la etiqueta. `renderToString` sigue disponible cuando el estado inicial se deriva de forma determinista de las props y no se necesita una captura explícita. `renderToString` y `renderWithState` son síncronos: fuera del render del framework no pueden esperar un `await useApi(...)` o `await useRpcQuery(...)`, y un componente que lo necesita lanza un error con el código `MEEKO_SUSPENDED`. Use el componente desde una página del framework o use el composable sin `await`. Dentro del framework, un componente que se monta en el navegador después de la página espera sus datos con la zona vacía en lugar de lanzar ese error (véase [Componentes que se montan más tarde](framework.md#componentes-que-se-montan-más-tarde)). Los módulos compilados exportan además `hasDataAwait` y `__meekoChildren`, marcas que el framework lee para saltarse la carga previa de una navegación, y `__meekoChannels` y `__meekoTag`, que sólo tipan las etiquetas del padre; ninguna forma parte del contrato. Al cambiar props reactivas de un hijo, Meeko conserva sus señales editables por nombre mientras reconstruye ese rango.

## Reactividad

`signal(initial)` crea un valor editable con `.value`. `computed(() => expression)` crea un valor derivado de solo lectura. `effect(() => ...)` observa las señales leídas y devuelve una función que cancela el observador. `batch(() => ...)` agrupa actualizaciones; `untrack(() => ...)` lee sin suscribir el observador actual. `createRoot(dispose => ...)` agrupa efectos para liberarlos al desmontar una instancia. Si un observador falla, Meeko continúa los demás observadores pendientes y propaga los errores; varios fallos se entregan en un `AggregateError`. Si también falla el callback de `batch`, se conservan ambas causas.

El callback de `effect` debe ser síncrono: las lecturas posteriores a un `await` no pueden registrarse como dependencias de esa ejecución. TypeScript rechaza un callback que devuelve una promesa y el runtime rechaza el mismo caso en JavaScript; si esa promesa también rechaza, Meeko informa el rechazo para que no quede sin manejar. Inicie trabajo asíncrono desde un efecto síncrono y gestione explícitamente su cancelación y su error.

`onCleanup(() => ...)` registra la liberación de un recurso en la raíz activa y también exige un callback síncrono. TypeScript rechaza funciones que puedan devolver `PromiseLike`; el runtime protege JavaScript y callbacks que cambien de comportamiento, observa cualquier rechazo y entrega un `TypeError` durante la liberación. Todas las limpiezas continúan ejecutándose y los fallos simultáneos se agrupan. Para cerrar un recurso asíncrono, inicie y observe explícitamente esa operación antes del desmontaje o use un host que pueda esperar su propio ciclo de cierre.

Si el render o la hidratación falla, Meeko libera todos los efectos y recursos ya registrados. Cuando el trabajo y alguna limpieza fallan a la vez, entrega un `AggregateError` que conserva ambas causas.

### Ciclo de vida

`onMounted(fn)` (desde `1.1`) ejecuta `fn` una vez en el navegador, después de que el componente se hidrata o se monta y sus bindings y refs ya existen. Nunca se ejecuta en SSR. Llámelo mientras se ejecuta el script del componente; fuera de él lanza un error. Se exporta desde la raíz y se autoimporta en las aplicaciones del framework.

```html
<script lang="ts">
const width = signal(0);
onMounted(() => {
    const update = (): void => { width.value = window.innerWidth; };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
});
</script>
<template><p>{width.value}px</p></template>
```

- **Orden.** Los callbacks se ejecutan al final de la hidratación o del montaje en curso, cuando ya existe todo lo que esa operación creó: el componente, sus hermanos posteriores y los bindings de su padre. Dentro de ella, los hijos ejecutan su `onMounted` antes que el padre. Un componente que se monta después (bajo un `if:`, en una fila nueva de `each:` o al confirmar una navegación) sigue la misma regla dentro de su propio montaje. Varios callbacks de un componente se ejecutan en el orden en que se registraron, sin suscribirse a las señales que leen. Si la hidratación o el montaje fallan, sus callbacks no se ejecutan, y tampoco los de un componente que se libera antes de que termine.
- **Limpieza.** Si `fn` devuelve una función, Meeko la registra como `onCleanup` y la ejecuta al desmontar el componente.
- **Asíncrono.** `fn` puede ser `async`, pero entonces no puede devolver una limpieza: llame `onCleanup` antes de su primer `await`.
- **Errores.** Un fallo síncrono o una promesa rechazada llega al observador más cercano con la fuente `"mounted"`, no detiene los demás callbacks y no deshace la hidratación.

No hay `onUpdated`: para reaccionar a cambios, use `effect`.

| Fase | Cuándo se ejecuta | Dónde |
| --- | --- | --- |
| Setup (nivel superior del `<script>`) | Al renderizar y al hidratar o montar | Servidor y navegador |
| `effect` | Durante el setup y cada vez que cambia una señal que leyó | Servidor (sólo la primera ejecución) y navegador |
| `onMounted` | Una vez, tras hidratar o montar | Sólo navegador |
| `onCleanup` (y la limpieza que devuelve `onMounted`) | Al desmontar o liberar el componente | Donde se registró |

`createContext<T>()` crea una clave única tipada. `provide(key, value)` publica un valor en la instancia activa; `inject(key)` busca el proveedor más cercano y falla explícitamente si falta. Las raíces independientes no comparten valores. Si el valor es una señal, los descendientes pueden leerla reactivamente.

Los observadores creados durante `hydrate` pertenecen a esa instancia. Durante HMR de Vite se conservan por nombre las señales editables del script; los valores derivados se calculan otra vez. Este estado en memoria de HMR es independiente de la transferencia JSON entre servidor y navegador.

La raíz `@meekojs/meeko` exporta exactamente `signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot`, `onCleanup`, `onMounted`, `createContext`, `provide`, `inject`, `provideErrorHandler` y `serializeJson`, más los tipos de señales, contexto, componentes, `HotState` y DevTools. Este motor documenta además `@meekojs/meeko/vite` y `@meekojs/meeko/devtools-ui`. Las subrutas del framework y de los adaptadores (`/framework`, `/server`, `/node`, `/bun`, `/deno`, `/cloudflare` y `/build`) se describen en la [guía del framework](framework.md). El compilador importa sus funciones de DOM, HMR y registro de DevTools desde `@meekojs/meeko/internal`. Esa ruta es un contrato entre el compilador y su runtime de la **misma versión exacta**, y no está destinada a imports manuales. Un módulo generado debe compilarse con la misma versión del paquete que lo ejecuta, así que hay que volver a compilarlo al actualizar Meeko.

## Herramientas

`meeko check archivo.meeko` comprueba sintaxis y tipos; `--json` entrega diagnósticos estructurados. `meeko compile entrada.meeko salida.ts` genera el módulo tipado y no escribe un archivo si hay errores. `meeko types archivo.meeko` emite declaraciones `Archivo.d.meeko.ts` para ese componente y los hijos importados bajo `.meeko/types/`, reflejando su ruta relativa al proyecto; no escribe declaraciones junto a las fuentes. En una aplicación de framework, la generación registra sus salidas en `.meeko/manifests/component-types.json` y elimina únicamente declaraciones administradas cuyo componente ya no existe. La primera ejecución tras actualizar reconoce mediante AST únicamente declaraciones generadas huérfanas de versiones anteriores, mientras conserva archivos ajenos y regenera los componentes vigentes. Para resolver esos imports con props precisas, TypeScript necesita `allowArbitraryExtensions` y `rootDirs` que superponga el árbol fuente con `.meeko/types/`. `meeko init` escribe esa configuración; un consumidor configurado a mano debe incorporarla. El plugin `@meekojs/meeko/vite` compila los imports `.meeko` en cliente y SSR y añade HMR y CSS durante desarrollo. `meeko lsp --stdio` (también disponible como bin `meeko-language-server`) arranca el servidor de lenguaje que usan la [extensión de VS Code](../editors/vscode/README.md) y [otros editores](editors.md) para ofrecer las mismas comprobaciones en el editor.

`@meekojs/meeko/prettier` es el plugin de Prettier para `.meeko`. Con `{ "plugins": ["@meekojs/meeko/prettier"] }` en la configuración de Prettier, `prettier --write "**/*.meeko"` formatea script, `<script server>`, plantilla y estilo; la opción `meekoIndentSections` (por defecto `false`) indenta un nivel el contenido de todas las secciones. El servidor de lenguaje usa el mismo plugin, así que el editor y la CI coinciden (véase [editores](editors.md#formato-con-prettier)).

## Compatibilidad y límites

- Node.js 24 o posterior y TypeScript 7.0.2 para la CLI, el build, Vite y el servidor de lenguaje. Los entornos de ejecución y navegadores admitidos se listan en la [política de estabilidad](stability.md#entornos-soportados).
- La API pública sigue SemVer durante la serie 1.x: los cambios incompatibles requieren una versión major y las deprecaciones se anuncian en un minor (véase la [política de estabilidad](stability.md)). El paquete se distribuye como `@meekojs/meeko` bajo licencia MIT.
- El parser acepta el subconjunto de TypeScript y HTML descrito arriba; informa las construcciones no soportadas mediante diagnósticos.
- La hidratación requiere que el servidor y el navegador obtengan los mismos valores iniciales y el mismo orden de listas.
- No se ofrecen garantías de compatibilidad con plugins de Vue. El streaming SSR (`render: "stream"` con `defer` de `@meekojs/meeko/framework`) se describe en [framework.md](framework.md).

## Verificación del paquete

`pnpm run package:smoke` instala el tarball en un consumidor fuera del monorepo y comprueba CLI, SSR, tipos y Vite. `tests/package-boundaries.test.ts` fija la lista exacta de exports de la raíz. La extensión de VS Code se empaqueta y prueba en un host aislado con un proyecto consumidor externo. Los pasos de cada publicación están en [releasing.md](releasing.md).
