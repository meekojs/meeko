# API de Meeko

Esta página describe el contrato público del motor de componentes, que ejercitan los ejemplos y las pruebas. La [política de estabilidad](stability.md) indica qué cubre SemVer en la serie 1.x.

Esta guía cubre el motor de componentes independiente. Las convenciones de `app/`, rutas, middleware, API, RPC, Socket y sesiones están en la [guía del framework](framework.md).

## Componentes `.meeko`

Un componente contiene un `<template>` (sin él, `MEEK007`) y, normalmente, un `<script lang="ts">`; `<style scoped>` es opcional. Desde `1.1` el `<script lang="ts">` también es opcional: un componente con sólo `<template>`, o una página con `<script server>` y `<template>`, compila con un setup vacío y props `Record<string, never>`. `MEEK005`, que exigía el script, ya no se emite. Una página de `app/pages` puede añadir un `<script server lang="ts">` con su código de servidor y sus opciones de ruta, que nunca forma parte del componente; desde `1.1`, sus `export const` llegan al `<script>` y a la plantilla como datos tipados (véase [framework](framework.md#código-de-servidor-de-la-página)).

El nivel superior del `<script>` es el setup del componente y sólo admite estas sentencias:

- `import` y `export type`, `interface` y `type`;
- `const`/`let` con **una** declaración por sentencia (`MEEK014`). Desde `1.2` la declaración puede desestructurar un objeto o un array, con valores por defecto, renombres y resto, como `const { toasts, dismiss } = useToasts()` (véase [Desestructuración en el script](#desestructuración-en-el-script));
- declaraciones `function` con nombre;
- cualquier sentencia de expresión: llamadas como `onCleanup(...)`, `onMounted(...)` o `effect(...)` y, desde `1.2`, también asignaciones y otras expresiones, como `count.value = props.initial`, `label ??= "Sin título"`, `items.value.push(item)` o `void Child`;
- desde `1.2`, control de flujo: `if`, `for`, `for...of`, `for...in`, `while`, `do...while`, `try`, `switch`, bloques `{ ... }`, sentencias etiquetadas sobre ellos (`outer: for (...)`) y sentencias vacías (el `;` sobrante tras una función);
- `await` sobre los composables que lo admiten, como sentencia completa o inicializador completo (véase [Composables de nivel superior y `await`](#composables-de-nivel-superior-y-await)).

Las sentencias de expresión y de control se ejecutan en orden, igual que las llamadas: en SSR y otra vez al hidratar, antes de que la plantilla lea los nombres del setup. Una escritura como `count.value = props.initial` no rompe la hidratación, porque el servidor y el navegador la repiten con las mismas props, y el estado transferido (o el que conserva una actualización en caliente) se restaura después del setup. Como cualquier código del nivel superior, se repite en cada pasada de un render que espera datos (véase [Navegación y `render: "client"`](framework.md#navegación-y-render-client)): una escritura externa o una petición van en `onMounted` o en un handler. Las declaraciones dentro de un bloque, de un bucle o de un `case` son locales: la plantilla sólo ve las del nivel superior. `useElementRef`, `useApi`, `useRpcQuery` y `useRpcMutation` dentro de una sentencia de control o de un bloque se ejecutarían de forma condicional o repetida y dan `MEEK054`; `defineProps` fuera de su propia declaración `const` da `MEEK016`.

Cualquier otra sentencia de nivel superior da `MEEK018`, con una indicación de qué escribir en su lugar: `export` de valores (`export const`, `export function`, `export { ... }`, `export default`; el script sólo exporta tipos, y los datos de una página se exportan desde `<script server>`), clases, `enum`, `namespace`, `import x = require(...)`, y `return`, `throw`, `break` o `continue` sueltos (dentro de un `if` o de un bucle sí se admiten). Lleve una clase o un `enum` a un módulo `.ts` e impórtelo. `defineProps<Props>()` es una macro de compilación: declara las props que reciben `renderToString` e `hydrate`; no necesita una implementación en tiempo de ejecución. `defineEmits`, `defineExpose`, `defineModel`, `defineSnippets` y `useElementRef` también son macros de compilación y no se importan.

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

### Desestructuración en el script

Desde `1.2`, una declaración de nivel superior puede desestructurar un objeto o un array. Cada nombre es un enlace del setup como cualquier otro: lo ven la plantilla, `meeko check` y el editor.

```html
<script lang="ts">
    const { toasts, dismiss } = useToasts()
    const { title = 'Sin título', ...rest } = props.options
    let [first, , ...others] = pair()
</script>

<template>
    <p each:of="toasts.value" each:as="toast" each:index="index">
        {toast.text} <button on:click="() => dismiss(index)">×</button>
    </p>
</template>
```

- **Estado.** Una señal desestructurada sigue siendo una señal, pero no entra en la captura de estado del componente: ni en la transferencia de SSR (`renderWithState`) ni en la que conserva HMR. Pertenece al composable o al store que la devolvió, que puede compartirla entre componentes o guardar valores que no son JSON. Si una señal es estado propio del componente, declárela con un nombre simple (`const count = signal(0)`), que sí se captura.
- **Macros y refs.** `defineProps` y `useElementRef` necesitan un nombre simple: `const { title } = defineProps<Props>()` o `const { value } = useElementRef("input")` dan `MEEK015`; lea `props.title` o `input.value`. `defineEmits`, `defineModel` y `defineSnippets` siguen exigiendo su propia declaración `const` con nombre simple (`MEEK045`, `MEEK063`, `MEEK059`).
- **Datos con `await`.** El resultado de `await useApi(...)` o `await useRpcQuery(...)` puede desestructurarse: `const { data, refresh } = await useApi("/api/users")`. `data` sigue siendo la señal del recurso, cuyos datos el framework ya envía en el payload.
- **Tras el primer `await` de navegador.** Los nombres desestructurados después de `await useElementRef(...)` o `await useSocket(...)` sólo existen en el navegador, como los demás; la plantilla no puede leerlos (`MEEK057`).

### Props reactivas

Desde `1.2`, cuando el padre cambia una prop, el hijo sigue montado: Meeko le entrega el valor nuevo y sólo se actualizan los bindings que leen esa prop, como en Vue o Svelte. El DOM del hijo, con el foco, el cursor y la composición (IME) de un `<input>` que el usuario está escribiendo, su estado, los snippets que recibió y sus propios hijos se conservan. Hasta `1.1`, Meeko volvía a renderizar el rango del hijo y sólo conservaba sus señales editables por nombre: el campo en el que se escribía se reemplazaba.

```html
<!-- UiTextField.meeko -->
<script lang="ts">
const props = defineProps<{ label: string; error?: string; hint?: string }>({ hint: "" });
const value = defineModel<string>("value");
const invalid = computed(() => Boolean(props.error));
</script>

<template>
    <label>{props.label} <input model="value" bind:aria-invalid="invalid.value ? 'true' : 'false'"></label>
    <p if:when="props.error">{props.error}</p>
    <small>{props.hint}</small>
</template>
```

```html
<UiTextField model:value="form.fields.name" bind:label="'Nombre'" bind:error="form.errors.value.name" />
```

Si `form.errors.value.name` cambia mientras el usuario escribe, el `<p>` aparece o desaparece y `aria-invalid` cambia, pero el `<input>` es el mismo y conserva el foco y lo tecleado.

- **Qué es reactivo.** `props` es una vista de sólo lectura de las props actuales. Cada lectura de `props.x` en la plantilla, en un `computed`, en un `effect` o en la función de entrada de `useApi` o `useRpcQuery` sigue a la prop, también en los hijos a los que el componente la pasa. `"x" in props`, `Object.keys(props)` y `{ ...props }` ven las props que el padre añade o deja de pasar.
- **Qué no lo es.** El setup se ejecuta una vez por instancia, así que un valor que copia una prop conserva el valor inicial, como en Vue: `const { label } = props`, `const title = props.title.toUpperCase()`, `signal(props.initial)` o `useApi(ruta, { query: { q: props.q } })`. Para seguir la prop, léala donde se usa (`{props.label}`), derive con `computed(() => props.title.toUpperCase())` o pase una función a los composables de datos (`useApi(ruta, () => ({ query: { q: props.q } }))`).
- **Aviso `MEEK101`.** `meeko check`, `meeko build` y el editor avisan de cada lectura de `props` que se ejecuta una sola vez: desestructurar o expandir `props` y leer `props.x` en el nivel superior del setup, o directamente dentro de `onMounted` (que tampoco se repite: léala en un `effect` para seguirla). Es un aviso, no un error: no hace fallar la comprobación. No avisan las lecturas dentro de otras funciones (manejadores, `computed`, `effect`), las llamadas a una prop función (`props.onReady?.()`), `signal(props.x)` y `untrack(() => props.x)`, que declaran que sólo interesa el valor inicial (por ejemplo, una clave que no cambia), ni los componentes con un `await` de datos en el nivel superior, que se vuelven a montar.
- **Valores por defecto.** Se aplican en cada lectura: una prop que pasa a `undefined` vuelve a su default.
- **Sólo lectura.** Asignar, borrar o definir una propiedad de `props` en el navegador lanza `TypeError`. Para cambiar un valor del padre, emita un evento (`defineEmits`) o use un modelo (`defineModel`).
- **Cuándo se vuelve a montar.** El rango se reconstruye, conservando las señales editables por nombre, cuando cambia el componente de `<component is>`, cuando el padre pasa otra señal en un `model`, y en los componentes con un `await` de datos en el nivel superior (`await useApi(...)` o `await useRpcQuery(...)`): sus peticiones se construyeron con las props con las que se renderizaron, así que unas props nuevas los vuelven a montar cuando sus datos están listos (véase [Componentes que se montan más tarde](framework.md#componentes-que-se-montan-más-tarde)). Un snippet que el padre empieza o deja de pasar (`<snippet if:when>`, véase [Snippets condicionales](#snippets-con-definesnippets)) llega al hijo montado como una prop nueva; sólo se reconstruyen los hijos que no reciben props reactivas: los que tienen ese `await` de datos y los compilados antes de `1.2`.
- **Snippets.** El contenido de un snippet pertenece al padre: sigue sus señales y los argumentos (`args`) que le pasa el hijo sin volver a pintarse, y no se reconstruye cuando cambian otras props del hijo.
- **SSR, hidratación y raíz.** No cambian: el servidor renderiza con el objeto de props y la hidratación conecta el mismo HTML. `hydrate(root, props)` y `hydrateScope` de un componente raíz reciben el objeto tal cual; sólo un padre Meeko entrega la vista reactiva a sus hijos.
- **HMR y DevTools.** Una actualización en caliente del hijo sigue leyendo las props que actualiza el padre, y el panel de DevTools muestra las props nuevas.

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

### Condiciones con `if:when` y tipos

Desde `1.2`, `if:when` estrecha los tipos dentro de su elemento, como `v-if` en Vue: sus atributos, sus props, sus eventos y su contenido se comprueban sabiendo que la condición se cumple, en `meeko check` y en VS Code. No hace falta `!`:

```html
<p if:when="user.value">{user.value.name}</p>
<WorkspaceHeader if:when="session.data.value.staff" bind:staff="session.data.value.staff" />
```

- TypeScript estrecha la misma referencia que comprueba la condición: `if:when="user.value"` estrecha `user.value.name`, pero no otra expresión que devuelva el mismo valor.
- Alcanza a las condiciones y listas anidadas y al contenido de una etiqueta de componente (sus snippets). El `if:when` de un `<snippet>` estrecha también su contenido (véase [Snippets condicionales](#snippets-con-definesnippets)). Un `each:as`, un `each:index` o un parámetro de snippet con el mismo nombre que una variable de la condición la oculta, y ahí no se estrecha.
- Dentro de una función flecha escrita en la plantilla, como `on:click="() => save(user.value.id)"`, TypeScript no conserva el estrechamiento de una propiedad; extraiga el manejador a una función del script o compruebe el valor dentro de la función.
- Sólo cambia la comprobación de tipos: en ejecución el contenido nunca se evalúa con la condición falsa.

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
| `<input>` de texto (cualquier `type` salvo los siguientes, o `bind:type`) y `<textarea>` | `value`, en `input` | `string` |
| `<input type="checkbox">` | `checked`, en `change` | `boolean` |
| `<input type="radio">` | marcado si la señal vale su `value`; `change` escribe ese valor | `string \| null \| undefined` |
| `<select>` | `value`, en `change` | `string` |
| `<select multiple>` | las opciones seleccionadas, en `change` | `string[]` |

- **Números.** Un `<input type="number">` también entrega texto: guarde un `string` y conviértalo donde se use.
- **Señal escribible.** La expresión debe ser una señal escribible del tipo de la tabla. Un `computed`, una señal de sólo lectura o un valor normal es un error de tipos, y en ejecución lanza un `TypeError`.
- **Sincronización.** Asignar la señal desde código actualiza la propiedad viva del control, como `bind:value` desde `1.0.1`. En SSR, el HTML lleva el valor de la señal (`value`, `checked`, el contenido del `<textarea>` o el `selected` de cada `<option>`). Si el usuario edita el control antes de que la página se hidrate (o el navegador restaura su valor), se conserva lo que escribió y se copia a la señal al terminar la hidratación, antes de los `onMounted`: las regiones `if:`, `each:`, `<render>` y los padres que leen la señal se hidratan primero con el valor del SSR y después reaccionan al valor restaurado.
- **Radio.** Necesita `value="..."` o `bind:value="expression"`.
- **`type` dinámico.** Desde `1.2`, `model` admite `bind:type` en `<input>` y trata el control siempre como uno de texto: `value`, en `input`, con una señal `string`, también cuando el tipo cambia. Sirve, por ejemplo, para un campo de contraseña que muestra su texto:

  ```html
  <script lang="ts">
  const password = signal("");
  const revealed = signal(false);
  </script>
  <template>
      <input bind:type="revealed.value ? 'text' : 'password'" model="password" autocomplete="current-password">
      <button type="button" on:click="() => revealed.value = !revealed.value">Mostrar</button>
  </template>
  ```

  `bind:type` sólo puede dar tipos de texto (`text`, `password`, `email`, `search`, `number`…). Con `checkbox`, `radio`, `file`, `submit`, `reset`, `button` o `image`, que no tienen un valor de texto, el modelo no cambia ni la señal ni el control: si el control ya tiene ese tipo al hidratarse, la hidratación lanza un `TypeError`; si lo toma después, cada lectura o escritura del modelo entrega un `TypeError` al observador de errores más cercano (véase `provideErrorHandler`). Para un checkbox o un radio, use otro `<input>` con su `type` estático.

`MEEK065` señala los usos no admitidos: `model` en un elemento que no es `<input>`, `<textarea>` o `<select>`; en `<input type="file">`, `submit`, `reset`, `button` o `image`; con `bind:type` y además `type="..."` en el mismo `<input>`; con `bind:multiple` en lugar de `multiple` estático; con contenido en `<textarea model>`; junto a `value`, `bind:value` u `on:input` en un control de texto (o `checked`, `bind:checked` u `on:change` en uno marcable, y `value`, `bind:value` u `on:change` en un `<select>`); un segundo `model` o `model:nombre`, que es sólo para componentes. Los demás eventos `on:` se admiten.

### HTML sin escapar con `html`

Desde `1.1`, `html="expression"` en un elemento lo llena con el HTML de la expresión, **sin escapar**. La expresión es un `string`; `null` y `undefined` dejan el elemento vacío. Desde `1.3`, ese `string` debe estar marcado como de confianza con `trustHtml` (tipo `TrustedHtml`) o `meeko check` avisa con `MEEK107`; véase [HTML de confianza](#html-de-confianza-trustedhtml-y-trusthtml).

```html
<script lang="ts">
import { trustHtml } from "@meekojs/meeko";
const article = signal(trustHtml("<p>Contenido <strong>generado</strong> en el servidor.</p>"));
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

#### HTML de confianza: `TrustedHtml` y `trustHtml`

Desde `1.3`, el tipo de la expresión de `html` declara de dónde viene el HTML. `TrustedHtml` es un `string` con una marca que sólo existe en los tipos, y `trustHtml(html)` la pone: en ejecución devuelve el mismo `string`, sin copiarlo ni comprobarlo. Ambos se importan de `@meekojs/meeko`; no son autoimports, para que la declaración de confianza sea siempre un import visible y funcione igual fuera del framework.

**`trustHtml` no sanea: sólo declara.** Úselo donde nace el HTML, no justo antes de la plantilla:

```ts
// server/content/articles.ts
import DOMPurify from "isomorphic-dompurify";
import { trustHtml } from "@meekojs/meeko";
import type { TrustedHtml } from "@meekojs/meeko";

// HTML de usuarios o de terceros: se sanea primero y después se declara de confianza.
export function commentHtml(input: string): TrustedHtml {
  return trustHtml(DOMPurify.sanitize(input));
}

// HTML propio, como el Markdown del repositorio renderizado en el build: basta con declararlo.
export function articleHtml(markdownDeConfianza: string): TrustedHtml {
  return trustHtml(markdownDeConfianza);
}
```

Para HTML de usuarios se recomienda [DOMPurify](https://github.com/cure53/DOMPurify) (en SSR, `isomorphic-dompurify`, que lo ejecuta sobre jsdom). Para mostrar texto, `{expression}` escapa y no necesita nada de esto.

`meeko check`, `meeko build` y el editor avisan con **`MEEK107`** cuando el tipo de la expresión no es asignable a `TrustedHtml | null | undefined`:

- **Avisan** `string`, `string | undefined`, una concatenación o plantilla con un `string` (`'<b>' + name + '</b>'`, cuyo tipo es `string` o un patrón como `` `<b>${string}</b>` ``) y `any`, que no dice nada del origen (por ejemplo, el resultado de `JSON.parse` o de `response.json()`).
- **No avisan** `TrustedHtml` (también con `null` o `undefined`), los tipos literales de texto y sus uniones, que el autor escribió en el código (`html="'<br>'"`, `html="open.value ? '<b>sí</b>' : '<i>no</i>'"` o una variable con tipo literal declarado), y `null` o `undefined`.
- `unknown`, `number` y los demás tipos que no son texto siguen siendo un error de tipos (`TS2345`), no además un aviso.
- Una constante del `<script>` sin anotación, como `const icon = "<svg>…</svg>"`, llega a la plantilla como `string`, porque el setup entrega sus bindings en un objeto y TypeScript ensancha el literal: escriba `as const` (`const icon = "<svg>…</svg>" as const`) o márquela con `trustHtml`.

Los datos de servidor conservan la marca: un export de `<script server>` o el resultado de `load` de tipo `TrustedHtml` llega a la plantilla con ese tipo (`ServerData<T>` y el contrato de la página la mantienen), porque el payload es JSON y la marca sólo existe en los tipos. Marque el HTML en el módulo de servidor que lo produce y declare `TrustedHtml` en sus tipos compartidos.

`MEEK107` es un aviso: se muestra, pero no hace fallar `meeko check` ni `meeko build`, y no cambia el SSR, la hidratación ni el código generado; todo lo que compilaba en `1.2` sigue compilando y funcionando igual. Está deprecado insertar un `string` sin marcar: en `2.0` el aviso pasará a ser un error (véase [Deprecación](stability.md#apis-deprecadas)).

### Listas con y sin `each:key`

Desde `1.1`, `each:key` es opcional (antes, una lista sin clave daba `MEEK023`, que se retira). Sin clave, la clave de cada fila es su índice: la fila `i` conserva sus nodos y recibe el elemento `i`, y las filas sólo se añaden o se quitan al final. Al insertar, borrar o reordenar en medio de la lista, cada fila muestra el elemento que ahora ocupa su posición.

```html
<li each:of="tags.value" each:as="tag">{tag}</li>
<li each:of="todos.value" each:as="todo" each:key="todo.id"><TodoItem bind:todo="todo" /></li>
```

Use `each:key` cuando la lista cambia de orden o recibe elementos en medio y cada fila tiene estado propio que debe acompañar a su elemento: un componente hijo con señales, un control de formulario que el usuario está editando, el foco o una animación. Con la clave, Meeko mueve las filas existentes en lugar de reasignarlas. Para listas que sólo se muestran o sólo crecen al final, el índice basta.

### Estilos del componente: `<style>` y `<style scoped>`

Un `.meeko` admite un bloque de estilos, con o sin `scoped`. Los dos pasan por el mismo PostCSS que `app/styles/main.css` (`postcss.config.*`, Tailwind, `@utilities`) y Vite los empaqueta junto al componente: el SSR enlaza el CSS de los componentes de la página y la navegación cliente carga el de cada ruta al entrar en ella.

| | `<style scoped>` | `<style>` |
| --- | --- | --- |
| Alcance | Sólo los elementos de la plantilla del componente, mediante el atributo `data-meeko-s-<hash>`. | **Toda la página**, como `app/styles/main.css`. |
| Hijos y contenido de `html="..."` | No, salvo con `:global(...)`. | Sí. |
| `:global(...)` | Desenvuelve el selector sin el atributo. | No se transforma: no lo use. |
| Riesgo | Ninguna fuga. | Una `.card` de un componente afecta a la `.card` de cualquier otro. |

Un `<style>` sin `scoped` es CSS global que vive junto al componente que lo necesita. No se limita a los momentos en que el componente está montado: una vez cargado, sigue aplicándose al navegar a otras rutas, y su orden frente a otras hojas depende de cuándo se cargó. Úselo para estilos globales a propósito, por ejemplo los de un contenido de terceros que el componente envuelve:

```html
<!-- MarkdownView.meeko -->
<template>
  <article class="markdown-view" html="props.content"></article>
</template>

<style>
  /* Global a propósito: el prefijo .markdown-view evita afectar al resto de la página. */
  .markdown-view p { margin-block: 0.75em; }
  .markdown-view pre { overflow-x: auto; }
</style>
```

Para casi todo lo demás, `<style scoped>` es la opción por defecto, y `:global(...)` alcanza a los hijos o al contenido de `html` sin perder el ámbito: `.markdown-view :global(p)` da `.markdown-view[data-meeko-s-…] p`. Los estilos de toda la aplicación (reset, tokens, tipografía) van mejor en `app/styles/main.css` o en un archivo que esta importe, donde su orden es explícito.

### Estilos con ámbito y `:global(...)`

`<style scoped>` añade el atributo `data-meeko-s-<hash>` al último compuesto de cada selector, antes de un pseudoelemento si lo hay (`.card::before` se convierte en `.card[data-meeko-s-…]::before`). `:global(<selector>)` emite el selector interno sin el atributo de ámbito:

| Fuente | Resultado |
| --- | --- |
| `.card :global(.icon)` | `.card[data-meeko-s-…] .icon` |
| `:global(body) .card` | `body .card[data-meeko-s-…]` |
| `:global(html.dark)` | `html.dark`, sin atributo de ámbito |

Un compuesto que contiene `:global(...)` no se limita; el atributo se añade al último compuesto local del selector, y un selector completamente global no lo recibe. `:global` sin paréntesis o vacío, una lista de selectores dentro de `:global(...)` y un `:global(...)` anidado en otra pseudoclase, como `:not(...)`, fallan con `MEEK019` en su posición. Las reglas dentro de `@keyframes` no se modifican.

#### Qué elementos reciben el atributo

Por defecto, `data-meeko-s-<hash>` va en todos los elementos de la plantilla del componente. Desde `1.2`, la opción `css.scopeAttribute: "matched"` de `meeko.config.ts` lo añade sólo a los elementos que algún selector con ámbito puede seleccionar, y el HTML pesa menos:

```ts
// meeko.config.ts
import { defineMeekoConfig } from "@meekojs/meeko/framework";

export default defineMeekoConfig({
  css: { scopeAttribute: "matched" }, // "all" por defecto en 1.x
});
```

La opción vale para todo lo que compila el proyecto: el plugin de Vite (`meeko dev`, `meeko build` y el prerender; fuera del framework, el plugin lee el `meeko.config.ts` de la raíz de Vite) y `meeko compile`, que lee la configuración de la carpeta del `package.json` más cercano. Quien llama a `compile()` directamente pasa `{ scopeAttribute: "matched" }` en sus opciones. `meeko check` y el editor no dependen de ella: sólo cambia el HTML que se renderiza, no los tipos ni los diagnósticos. Como cualquier cambio de `meeko.config.ts`, cambiarla exige reiniciar `meeko dev`.

En `1.x` el valor por defecto es `"all"`, porque `"matched"` puede cambiar el resultado de un caso que antes funcionaba: una clase o un atributo que el script añade con la API del DOM a un elemento que se quedó sin el atributo (véase el final de esta sección). En `2.0`, `"matched"` pasará a ser el valor por defecto; véase [Estabilidad](stability.md#cambios-previstos-para-20).

Con `"matched"`, los elementos a los que las reglas aplican son los mismos que con `"all"`. De cada selector cuenta únicamente el compuesto que lleva el atributo: los demás compuestos (ancestros, hermanos y `:global(...)`) seleccionan cualquier elemento de la página, con atributo o sin él, así que un elemento que sólo aparece como ancestro, como el `.card` de `.card .title`, no lo necesita. Un elemento recibe el atributo cuando ese compuesto puede coincidir con él:

- Una etiqueta coincide con los elementos de esa etiqueta; una clase, un id o un selector de atributo (`[href^="/"]`), con los elementos que los tienen en la plantilla. Las mayúsculas no se distinguen.
- `*`, las pseudoclases (`:hover`, `:focus-visible`, `:nth-child(...)`, `:not(...)`, `:has(...)`) y los pseudoelementos no restringen: `:hover` a solas pone el atributo en todos los elementos y `a:hover`, en todos los `<a>`.
- `:is(...)` y `:where(...)` coinciden cuando coincide alguno de sus argumentos; `&` en CSS anidado, cuando coincide el selector de la regla que lo contiene.

Un atributo que puede cambiar después del render cuenta como presente con cualquier valor:

- `bind:class` puede dar cualquier clase; `bind:id`, cualquier id; `bind:nombre`, el atributo `nombre` (`bind:aria-current` y `[aria-current="page"]`).
- `model` da `value` y `checked` a su control, y un `<select model>` da `selected` a sus `<option>`.
- Un elemento con `ref:` o con un `on:evento` queda en manos del script, por la referencia o por `event.currentTarget`, y un elemento personalizado (`<x-chip>`) gestiona sus propios atributos: en ellos sólo cuenta la etiqueta, y cualquier clase o atributo del selector puede coincidir.
- El navegador añade `open` a `<details>` y a `<dialog>`.

```html
<template>
  <section class="card">
    <h2 class="title">Título</h2>
    <p>Texto</p>
    <span bind:class="state.value">Estado</span>
    <em>Nota</em>
  </section>
</template>

<style scoped>
.card .title { font-weight: 700; } /* el <h2>; .card es sólo un ancestro */
p:hover { color: teal; }           /* el <p> */
.active { color: green; }          /* el <span>, por bind:class */
</style>
```

Con `"matched"`, aquí `<section>` y `<em>` se renderizan sin el atributo. El contenido de `html="..."` y los elementos de un componente hijo no reciben el atributo del padre, como antes (selecciónelos con `:global(...)`, por ejemplo `.content :global(p)`), y el contenido de un snippet recibe el del componente que lo escribe. Un componente sin `<style scoped>` nunca emite el atributo y, con `"matched"`, tampoco uno cuyos selectores son todos globales. El SSR, la hidratación y las regiones de `if:when` y `each:of` comparten la plantilla compilada, así que el atributo coincide en el HTML del servidor y en el que se renderiza en el navegador.

Antes de activar `"matched"`, revise el código que cambia clases o atributos con la API del DOM (`classList`, `setAttribute`, `toggleAttribute`). En un elemento sin `ref:` ni `on:`, como un descendiente al que el script llega con `querySelector`, `closest` o `event.target`, o uno que modifica una biblioteca externa, la clase sólo recibe los estilos con ámbito si ese elemento ya tenía el atributo. Use `bind:class` o `bind:nombre`, ponga una `ref:` en ese elemento o escriba el selector con `:global(...)`. Con `"all"`, todos los elementos de la plantilla tienen el atributo y este caso no se da.

CLI y VS Code comprueban el tipo del evento que recibe `on:event` y que `each:key` devuelve `string | number`; ambos ubican el diagnóstico en la expresión de la plantilla. Desde `1.2`, en un elemento HTML el evento tiene el tipo de `HTMLElementEventMap` (`SVGElementEventMap` dentro de `<svg>`) para su nombre, como `KeyboardEvent` en `on:keydown` o `PointerEvent` en `on:pointerdown`, y `Event` si el nombre no está en el mapa (antes sólo se tipaban `click`, `input`, `change`, `submit`, `keydown`, `keyup`, `focus` y `blur`). Además, `event.currentTarget` tiene el tipo del elemento de la etiqueta, el mismo que da `ref:` (`HTMLInputElement` en `<input>`, `HTMLSelectElement` en `<select>`, `HTMLElement` en un elemento personalizado), así que `on:input="(event) => query.value = event.currentTarget.value"` y `on:change="(event) => accepted.value = event.currentTarget.checked"` se comprueban sin conversiones; una propiedad que el elemento no tiene sigue siendo un error. `event.target` conserva el tipo `EventTarget | null`, porque puede ser un descendiente. En una etiqueta de componente, `on:evento` es una prop de callback y recibe los argumentos de su `defineEmits`. El documento virtual de VS Code aplica las mismas opciones estrictas de acceso indexado, props opcionales exactas e imports de tipo que `meeko check`.

`each:index` tiene tipo `number` tanto en el componente compilado como en el documento virtual de VS Code; no se infiere como el literal inicial `0`.

Los handlers de `on:event` pueden ser asíncronos. Meeko observa su promesa y entrega los fallos síncronos o rechazos al observador más cercano, sin dejar un rechazo no manejado ni detener otros listeners. La limpieza del componente elimina sus listeners. Si no hay observador, Meeko registra el fallo en consola.

Dentro del script de un componente, `provideErrorHandler((error, source) => { ... })` registra un observador para sus eventos y los de sus hijos, y también para los rechazos de un `effect` u `onCleanup` que devolvió por error una promesa. Se autoimporta como una función ESM real; `error` tiene tipo `unknown`, por lo que debe refinarse antes de leer sus propiedades, y `source` es un `ErrorSource` (`"event"`, `"effect"`, `"cleanup"`, `"mounted"`, `"navigation"`, `"socket"` y, desde `1.3`, `"uncaught"` y `"rejection"` para los fallos globales de la página en una aplicación montada; véase [Errores](framework.md#errores)). La unión puede ganar miembros en un minor: un `switch` exhaustivo necesita una rama por defecto. `"mounted"` (desde `1.1`) identifica los fallos de un callback de `onMounted` y de la continuación en el navegador de un setup con `await` (véase [Ciclo de vida](#ciclo-de-vida)). Un componente descendiente puede registrar otro observador para su propia rama. El contexto está aislado por raíz; un observador asíncrono que rechace se registra junto al error original. En una aplicación montada, la navegación y los canales Socket creados dentro de la aplicación también utilizan el observador activo; sus opciones explícitas `onNavigationError` y `onError` tienen prioridad. El servidor usa su propio observador con `requestId`.

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

Para componer componentes, importa el módulo hijo en el script y usa `<component is="Child" bind:label="expression"></component>`. `is` acepta una expresión de módulo y cada `bind:` define una prop tipada (véanse también las [props estáticas](#props-estáticas)). CLI y VS Code comprueban las props requeridas, los nombres y los tipos de los valores contra las props que declara el hijo; el editor ofrece completado y ubica el diagnóstico en la expresión original. Desde `1.1` los nombres se comprueban también cuando la etiqueta pasa otras props válidas: antes, una prop desconocida junto a una conocida no daba error. Una prop obligatoria que falta se señala en la etiqueta. `<component>` se cierra con `</component>` o solo (`<component is="..." />`); desde `1.5` su contenido son los snippets del componente, como en su etiqueta (véase [Snippets](#snippets-con-definesnippets)), y `is` también acepta etiquetas HTML (véase [Etiquetas HTML en `<component is>`](#etiquetas-html-en-component-is)). El HTML SSR marca un rango de comentarios para hidratar el hijo sin elemento envolvente; los hijos pueden aparecer en condiciones y listas.

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

El padre puede usar `<component is="Card" bind:content="Content" bind:label="'Hola'"></component>`, donde `Content` es un módulo `.meeko` importado. Si la expresión `is` cambia reactivamente, Meeko libera la instancia anterior y renderiza e hidrata la nueva dentro de los mismos marcadores. El contenido se crea como componente independiente, con su propio estado y limpieza. Para pasar contenido inline, escríbalo entre las etiquetas: hasta `1.4`, `<component is>` no admitía contenido (`MEEK031`); desde `1.5` el contenido suelto llena el snippet `default` y cada `<snippet name>`, el suyo, igual que en una etiqueta de componente. Un componente tipado sólo como `Component<Props>` no declara snippets, así que pasarle contenido es un error de tipos; tipe la prop con el módulo (`typeof Card`) para pasarle contenido.

`<component is>` exige `Component<Props>`: su función `renderWithState` es obligatoria para transferir el estado SSR del hijo. `ComponentModule<Props>` conserva esa función como opcional para usos de bajo nivel que renderizan sin transferencia. El outlet de `app/app.meeko` y de los layouts también se declara como `Component<Record<string, unknown>>`. CLI y VS Code diagnostican un módulo que no satisface este contrato.

Si falla la hidratación de un reemplazo reactivo, Meeko restaura el contenido previo y vuelve a hidratarlo. Si también falla la restauración, entrega ambas causas en `AggregateError` y detiene esa vinculación. Las listas preparan las filas nuevas antes de retirar las anteriores: un fallo de render, hidratación o movimiento intenta restablecer el orden y las instancias anteriores. Los errores de limpieza se conservan junto al fallo original.

Los scripts aceptan `import type`, `export interface`, `export type` y reexportaciones de tipos. Por ejemplo, `import type { ComputedRef } from "./contract.js"; export interface CardProps { label: string }; const props = defineProps<CardProps & ComputedRef<string>>();` conserva la intersección en `ComponentProps` y en la declaración `.d.meeko.ts`. El consumidor debe proporcionar todos sus campos; el nombre `ComputedRef` por sí mismo no convierte una prop en señal reactiva.

### Etiquetas de componente (`<AppButton />`)

Desde `1.1`, una etiqueta cuyo nombre empieza por mayúscula es un componente: `<AppButton bind:label="'Guardar'" />` equivale a `<component is="AppButton" bind:label="'Guardar'"></component>`. El nombre es un identificador del script, ya sea un import (`import * as AppButton from "./AppButton.meeko"`) o un autoimport de `app/components`. Admite las mismas props `bind:` y estáticas, eventos `on:`, modelos `model:` y `ref:` que `<component>`, se comprueba igual en CLI y VS Code y puede ir dentro de `if:when` y `each:of`.

- Puede cerrarse sola (`<AppButton />`) o con su etiqueta de cierre (`<AppButton></AppButton>`). Los nodos que siguen a una etiqueta autocerrada son sus hermanos, no su contenido.
- Su contenido son snippets del hijo (véase [Snippets](#snippets-con-definesnippets)). Pasar contenido a un componente sin `defineSnippets` es un error de tipos. `MEEK049`, que rechazaba cualquier contenido, ya no se emite.
- Un cierre `</AppButton>` sin apertura da `MEEK008`, y una etiqueta de componente fuera de `<template>`, `<script>` y `<style>` da `MEEK002`.
- Los nombres en mayúscula no se confunden con elementos HTML: `<Table>`, `<Input>` o `<Title>` son componentes.
- Desde `1.2`, una prop opcional del hijo (`error?: string`) acepta también `undefined` en la etiqueta, como `bind:error="failed.value ? 'Obligatorio' : undefined"`, aunque el proyecto use `exactOptionalPropertyTypes`: para Meeko pasar `undefined` equivale a no pasar la prop, y si la prop tiene default en `defineProps` el hijo recibe el default. Las props obligatorias siguen rechazando `undefined` y una prop desconocida sigue siendo un error.

Use `<component is="expression">` cuando el componente se elige con una expresión, como `props.outlet` o `props.content`; para un componente fijo, la etiqueta es más corta. El editor completa los nombres tras `<` y lleva de la etiqueta al archivo `.meeko`.

### Etiquetas HTML en `<component is>`

Desde `1.5`, `is` también acepta una etiqueta HTML: un literal de texto (`'a'`), una expresión cuyo tipo sea una unión de etiquetas (`props.href ? 'a' : 'button'`, o una prop `as: "section" | "article"`), un componente o una unión de etiquetas y componentes. Con una etiqueta, `<component is>` es ese elemento, con sus atributos, eventos `on:`, `ref:`, `html` y `bind="obj"`, y con su **contenido**: hijos, `if:when`, `each:of`, `<render>` y componentes. Con un componente, el contenido son sus snippets, como en una etiqueta de componente.

Un botón que es un enlace cuando recibe `href`, con una sola plantilla:

```html
<!-- Button.meeko -->
<script lang="ts">
import { computed } from "@meekojs/meeko";
const props = defineProps<{ href?: string; target?: string; type?: "button" | "submit" | "reset"; disabled?: boolean; loading?: boolean }>();
const emit = defineEmits<{ click: [event: MouseEvent] }>();
const snippets = defineSnippets<{ default?: []; leading?: []; trailing?: [] }>();
const inactive = computed(() => Boolean(props.disabled || props.loading));
const rel = computed(() => props.target === "_blank" ? "noopener noreferrer" : undefined);
const state = computed(() => ({ "data-loading": props.loading ? "" : undefined, "aria-disabled": inactive.value ? "true" : undefined }));
function onClick(event: MouseEvent): void {
  if (inactive.value) {
    event.preventDefault();
    return;
  }
  emit("click", event);
}
</script>
<template>
  <component is="props.href ? 'a' : 'button'" class="button" bind="state.value" on:click="onClick"
    bind:href="inactive.value ? undefined : props.href" bind:target="props.target" bind:rel="rel.value"
    bind:type="props.type" bind:disabled="props.disabled">
    <span if:when="props.loading" class="button__spinner" aria-hidden="true"></span>
    <span class="button__label"><render snippet="snippets.leading" /><render snippet="snippets.default" /><render snippet="snippets.trailing" /></span>
  </component>
</template>
```

Sin `href` renderiza `<button class="button" type="button" data-meeko="0">…</button>`; con `href`, `<a class="button" href="/docs" target="_blank" rel="noopener noreferrer" data-meeko="0">…</a>`. `type` y `disabled` no se escriben en `<a>`, ni `href`, `target` y `rel` en `<button>` (véase [Atributos según la etiqueta](#atributos-según-la-etiqueta)).

- **Tipos.** Meeko deduce la unión de etiquetas del tipo de `is`. `event.currentTarget` de un `on:` es la unión de sus elementos (`HTMLAnchorElement | HTMLButtonElement`, con los eventos tipados por elemento de `1.2`) y `useElementRef` de un `ref:` también. Un valor de `is` que no es una etiqueta permitida ni un componente es un error de tipos (`MEEK112`), igual que un `string` cualquiera: tipe la etiqueta como una unión de literales o use el tipo `TagName`. Una etiqueta sin contenido (`img`, `input`, `hr`…) con contenido da `MEEK031`.
- **Etiquetas permitidas.** Las de los datos HTML de Meeko (los de MDN que usa el editor), salvo `script`, `style`, `iframe`, `object`, `embed`, `template`, `slot`, `textarea`, `title`, `base`, `link`, `meta`, `head`, `html`, `body`, `noscript`, `param` y `fencedframe`. El tipo público `TagName` es esa unión. Un literal no permitido es el error de compilación `MEEK112`; un valor no permitido que llega en ejecución (con `as any`, por ejemplo) lanza `TypeError` con `MEEK112` en SSR y en el navegador antes de escribir HTML: el nombre de la etiqueta nunca inyecta marcado. Los elementos personalizados (`x-card`) y las etiquetas SVG no se admiten como valor de `is`; dentro de `<svg>`, `is` sólo admite componentes.
- **SSR e hidratación.** Meeko lee los resultados de `is` de su sintaxis (las ramas de `?:`, sin `as` ni paréntesis). Si todos son literales, el SSR escribe el elemento tal cual, sin marcadores. Si todos son nombres en PascalCase o imports de un `.meeko` (`is="open ? Dialog : Sheet"`), es un componente, como antes de `1.5` (una constante con una etiqueta debe tener un nombre en minúscula). En los demás casos (`props.as`, `view()`) el tipo decide en ejecución: el elemento va entre los comentarios de rango del componente y su contenido, en un rango de snippet.
- **Cambio de etiqueta.** Si la etiqueta cambia en el navegador, un elemento nuevo sustituye al anterior: los hijos se **mueven** a él con sus nodos, así que conservan su estado reactivo, el de sus componentes, el valor de sus controles y el foco; si el foco estaba en el elemento, pasa al nuevo. Los atributos, eventos, `ref:`, `html` y `bind` del elemento se vuelven a enlazar en el nuevo. Al pasar de una etiqueta a un componente, o al revés, el rango se vacía y el contenido se monta de nuevo.
- **Etiqueta o componente.** Con una unión de los dos, cada atributo se comprueba contra lo que lo admite: `aria-label`, `html` o `data-*` sólo valen si `is` es una etiqueta, y `model`, `model:x` o `<snippet name>` sólo si es un componente (`MEEK112` en `meeko check` y el editor cuando el tipo de `is` admite el otro tipo).
- **`<MeekoLink>` no es un valor.** `<MeekoLink>` es una etiqueta del compilador, no un componente que se pueda pasar a `is`: `is="internal ? MeekoLink : 'a'"` no es válido. Use dos ramas con `if:when` o un componente propio que envuelva a `<MeekoLink>`.
- **Límites.** El contenido debe ser válido dentro de cada etiqueta posible (un `<div>` dentro de `<p>` lo saca el navegador y la hidratación no coincide), y `<component is>` dentro de `<table>` sigue las reglas de ese contenedor. `model` en un `<component is>` cuyos resultados son etiquetas da `MEEK112`: use un control de formulario.

### Atributos según la etiqueta

En un `<component is>` con etiquetas, Meeko escribe cada atributo sólo mientras la etiqueta del momento lo admite según sus datos HTML, sin ternarios: `bind:href`, `target` y `rel` sólo en `<a>`, `bind:type` y `disabled` sólo en `<button>`. Los atributos globales (`class`, `id`, `style`, `title`, `hidden`, `tabindex`, `role`, `lang`, `dir`, `aria-*`, `data-*`…) y los eventos `on:` se escriben siempre; `aria-disabled` es global, así que vale para un enlace desactivado. `type` no cuenta como atributo de `<a>` ni de `<area>`, donde sólo es una sugerencia de tipo MIME. En los elementos normales nada cambia.

`meeko check` y el editor dan el error `MEEK112` en un atributo que no admite **ninguna** de las etiquetas posibles (`bind:colspan` en `'a' | 'button'`): Meeko no lo escribiría nunca. Cuando `is` escribe sus etiquetas como literales, el editor completa sus atributos e indica en cuáles se aplica cada uno, y el hover de `component` muestra los elementos posibles.

### Atributos en bloque con `bind`

Desde `1.5`, `bind="obj"` escribe las claves de un objeto como atributos de un elemento, de `<component is>` o, en una etiqueta de componente, como sus props:

```html
<script lang="ts">
import { computed } from "@meekojs/meeko";
import type { ElementAttributes } from "@meekojs/meeko";
const props = defineProps<{ busy: boolean; id: string }>();
const attrs = computed((): ElementAttributes<"section"> => ({ id: props.id, "aria-busy": props.busy, hidden: false }));
</script>
<template><section class="panel" bind="attrs.value">...</section></template>
```

- **Tipos.** El objeto se comprueba contra los atributos de la etiqueta (o de alguna de las de `<component is>`), o contra las props del componente: una clave que no lo es da `MEEK113`. `ElementAttributes<Tag>` tipa el objeto. En un elemento personalizado (`<x-card bind="...">`), `bind` sigue siendo un atributo HTML, como `html` y `model`.
- **Valores.** Las claves con `undefined`, `null` o `false` no se escriben, igual que con `bind:x`; `true` escribe el atributo vacío. En un componente, una clave `undefined` es una prop ausente.
- **Orden.** Un `bind:x` explícito o un atributo estático gana sobre la misma clave del objeto. `class` y `style` se **combinan**: las clases explícitas y las del objeto se juntan, y las declaraciones de `style` del objeto van antes de las explícitas, que ganan. En un componente no se combinan: la prop explícita gana.
- **Sin manejadores.** Una clave que empieza por `on` es un error de tipos (`MEEK113`) y, en ejecución, un `TypeError`: los manejadores de eventos no se crean desde datos; use `on:evento`. Tampoco se admiten las claves `data-meeko*`, reservadas a Meeko. Como en HTML, los nombres se comparan sin distinguir mayúsculas: `Data-Meeko` también se rechaza, y una clave `ID` junto a `bind:id` no escribe un segundo `id`.
- **Reactivo.** Si el objeto cambia, Meeko escribe los atributos nuevos y quita los que ya no tiene; un componente recibe las props nuevas en su sitio. `bind=""` o `bind` sin valor da `MEEK113`, igual que en `<template>`.

### Props estáticas

Desde `1.1`, un atributo sin prefijo en una etiqueta de componente o en `<component is>` pasa una prop estática, como en un elemento HTML:

```html
<AppButton variant="primary" disabled bind:label="title.value" />
```

- **Valor.** El texto del atributo llega como un literal de texto (`"primary"`, con su tipo literal) y un atributo sin valor llega como `true`. Ambos se comprueban con tipos contra las props del hijo, igual que `bind:`: `variant="tertiary"` frente a `variant: "primary" | "secondary"` es un error en el atributo.
- **Nombres reservados.** `is`, `ref` y `html` no son props estáticas, ni `bind`, que desde `1.5` pasa props en bloque (véase [Atributos en bloque con `bind`](#atributos-en-bloque-con-bind)), y tampoco los nombres con guiones (`data-label`, `aria-label`) ni los que llevan `:` sin ser una directiva (`bind:`, `on:`, `model:`, `ref:`, `if:when`, `each:*`): todos dan `MEEK032`. Para pasar una prop llamada `ref` use `bind:ref`.
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
// Para que el modelo por defecto sea opcional: defineModel<string>({ default: "" })
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
- **Modelo por defecto opcional.** Las opciones van sin nombre para el modelo por defecto: `defineModel<string>({ default: "" })` lo hace opcional, igual que `defineModel<string>("default", { default: "" })`, que es la misma declaración con el nombre escrito. Con `defineModel<string>()`, en cambio, un padre que no pasa `model` (por ejemplo, porque el campo recibe un `FormField` en `bind:field`) da `TS2741` («Property '"default"' is missing in type '{}' but required in type 'ComponentModels'»). No hay ambigüedad entre las dos formas: el nombre es siempre un literal de texto y las opciones, un objeto literal.
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
- **Snippets condicionales.** Desde `1.4`, `<snippet name="x" if:when="expresión">` pasa el snippet sólo mientras la expresión es verdadera. Con la condición falsa, para el hijo el snippet no existe: `snippets.x` es `undefined`, su `if:when="snippets.x"` es falso y un `<render>` no pinta nada. Sirve para reenviar un snippet opcional; sin `if:when`, la card de este ejemplo recibiría siempre `footer` y su `<footer if:when="snippets.footer">` pintaría un contenedor vacío cuando el panel no recibe `actions`:

  ```html
  <!-- AppPanel.meeko: defineSnippets<{ default: []; actions?: [close: () => void] }>() -->
  <AppCard>
    <render snippet="snippets.default" />
    <snippet name="footer" if:when="snippets.actions"><render snippet="snippets.actions" args="close" /></snippet>
  </AppCard>
  ```

  La condición se evalúa en el ámbito del padre (no ve los `params` del propio snippet), igual en el servidor y al hidratar, y es reactiva: cuando cambia, el hijo sigue montado, con su DOM, su estado y su foco, y sólo se actualizan los bindings que leen `snippets.x` (los hijos sin props reactivas se vuelven a montar; véase [Props reactivas](#props-reactivas)). Mientras sigue verdadera, el hijo conserva el mismo snippet. Como con las props, un valor que el setup del hijo copia de `snippets.x` (`const hasFooter = Boolean(snippets.footer)`) conserva el inicial: léalo en la plantilla o en un `computed`. Sólo vale para un snippet que el hijo declara opcional (`x?:`): en uno obligatorio es el error de tipos `MEEK110`. Como `if:when` en un elemento, estrecha los tipos dentro del contenido del snippet. Vale también en `<snippet name="default">`; el contenido suelto, que llena `default` sin etiqueta, no admite condición.
- **Reutilizar los snippets de otro componente.** Desde `1.4`, el valor de una clave de `T` también puede ser un `Snippet<Args>`, que cuenta como su tupla `Args`. Así, `T` puede partir del mapa de snippets de otro componente, `AppCardSnippets` (el tipo con nombre de cada componente autoimportado; véase [Tipos de cada componente](framework.md#tipos-de-cada-componente)) o el `ComponentSnippets` de su módulo, y recortarlo o ampliarlo con `Omit`, `Pick` o `&`. Cada snippet conserva sus parámetros y su `?`: un modal que envuelve una card declara los de la card salvo `footer`, añade `actions` y los reenvía con `<snippet if:when>`:

  ```html
  <!-- app/components/App/Card.meeko -->
  <script lang="ts">
  const snippets = defineSnippets<{ header?: []; default: []; footer?: [] }>();
  </script>

  <!-- app/components/App/Modal.meeko -->
  <script lang="ts">
  const open = defineModel<boolean>();
  const snippets = defineSnippets<Omit<AppCardSnippets, "footer"> & { actions?: [close: () => void] }>();
  function close(): void {
      open.value = false;
  }
  </script>
  <template>
      <AppCard>
          <snippet name="header" if:when="snippets.header"><render snippet="snippets.header" /></snippet>
          <render snippet="snippets.default" />
          <snippet name="footer" if:when="snippets.actions"><render snippet="snippets.actions" args="close" /></snippet>
      </AppCard>
  </template>
  ```

  Para quien usa `<AppModal>`, `header` y `actions` son opcionales, `default` es obligatorio, `footer` no existe y `actions` entrega `close`: `meeko check` y el editor lo comprueban en sus etiquetas como en cualquier otro componente, también en uno genérico (`Pick<ListSnippets<T>, "row">`). Las tuplas de siempre no cambian: `defineSnippets<{ item: [name: string] }>()` tiene el mismo tipo que antes y puede mezclarse con entradas `Snippet`. Un valor que no es una tupla ni un `Snippet` sigue siendo el error `TS2344`.

`defineSnippets` aparece una sola vez, en su propia declaración `const` de nivel superior con un nombre simple (`MEEK059`), con un argumento de tipo y sin argumentos en tiempo de ejecución (`MEEK060`). `MEEK061` señala un `<snippet>` que no es hijo directo de una etiqueta de componente, sin `name` o con un nombre o parámetros que no son identificadores, repetido, con atributos distintos de `name`, `params` e `if:when`, con un `if:when` vacío o sin valor, o un `<snippet name="default">` junto a contenido suelto. `MEEK110`, un error de tipos de `meeko check` y del editor, señala el `if:when` de un `<snippet>` que llena un snippet obligatorio del hijo. `MEEK062` señala un `<render>` sin `snippet`, con contenido o con atributos distintos de `snippet` y `args`. Una `ref:` dentro del contenido de un `<snippet>` da `MEEK052`, porque el hijo puede pintarlo varias veces. `<snippet>` y `<render>` pueden cerrarse solos.

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
- Desde `1.5`, `<component is>` admite contenido como snippets, igual que la etiqueta: un componente genérico con snippets obligatorios puede usarse con los dos. Hasta `1.4` no lo admitía (`MEEK031`), así que sólo podía usarse con su etiqueta.
- Las páginas, los layouts, `app/app.meeko` y `app/error.meeko` no pueden ser genéricos, porque Meeko les pasa sus props (véase [framework](framework.md#routing-layouts-y-ssr)). Tampoco un `<script server>` lleva `generic`.

`MEEK100` señala un `generic` vacío o que no es una lista de parámetros de tipo válida (también si cierra la lista antes de tiempo, como `generic="T> = string; type X<U"`), un parámetro con modificadores (`const`, `in`, `out`), con un nombre que empieza por `__` o repetido, `generic` en `<script server>` o en una página, un layout, `app.meeko` o `error.meeko`, y una declaración de tipo del script que usa un parámetro.

### Composables de nivel superior y `await`

`useElementRef`, `useApi`, `useRpcQuery` y `useRpcMutation` sólo se llaman en el nivel superior del `<script>`; dentro de una función, un handler, un `effect` o `onMounted` dan `MEEK054`. `useState`, `useSocket`, `useSocketClient` y `useNavigation` mantienen su comportamiento de `1.0` y pueden llamarse también desde código anidado, igual que `useRoute` (véase [Ruta actual](framework.md#ruta-actual)). `useForm` (desde `1.2`) tampoco da `MEEK054`, aunque su lugar es el nivel superior del script, como cualquier estado del componente (véase [Formularios: `useForm`](framework.md#formularios-useform)). `useHead` y `useSeoMeta` (desde `1.2`) no dan `MEEK054` y pueden llamarse dentro de un composable que el script invoca; fuera del script de un componente montado no hacen nada (véase [Head del documento](framework.md#head-del-documento-document-usehead-y-useseometa)). `useApi`, `useRpcQuery` y `useRpcMutation` pertenecen al framework y se describen en [framework.md](framework.md#datos-en-componentes-useapi-userpcquery-y-userpcmutation).

Desde `1.2`, `useApiMutation` y `useStorage` necesitan que el script del componente se esté ejecutando (fuera de él lanzan un `Error`), pero el compilador no las incluye en `MEEK054`, para no rechazar funciones propias con el mismo nombre de proyectos anteriores. Llame a `useApiMutation` en el nivel superior, como `useRpcMutation`; `useStorage` puede llamarse también dentro de un composable que el script invoca. `await useApiMutation(...)` da `MEEK055`. Se describen en [Mutaciones](framework.md#mutaciones) y en [Estado persistente](framework.md#estado-persistente-usestorage).

El setup sigue siendo síncrono, con una excepción: admite `await` de nivel superior sólo sobre estos composables, y de dos clases.

| `await` | Dónde se resuelve | Resultado |
| --- | --- | --- |
| `await useApi(...)`, `await useRpcQuery(...)` | En el render del framework: SSR, hidratación y navegación | Los datos cargados, con `data` no nulo |
| `await useElementRef(...)`, `await useSocket(...)`, `await useSocketClient(...)` | Sólo en el navegador, tras montar | El elemento, o el socket una vez abierto |

El `await` debe ser la sentencia completa o el inicializador completo de una declaración (`const notes = await useApi(...)`), con uno por sentencia. Cualquier otro `await` de nivel superior, `await useRpcMutation(...)`, `for await` y `await using` dan `MEEK055`; lleve ese trabajo a una función o a `onMounted`.

Sin `await`, `useApi` y `useRpcQuery` devuelven el recurso enseguida, con `data` en `null` hasta que la petición, que empieza en el navegador al montar, termina. Su zona sale vacía en el HTML del servidor y crece al llegar los datos; desde `1.5`, `<MeekoAwait for="recurso" reserve>` la envuelve con sus estados y reserva su altura (véase [Evitar saltos de altura](framework.md#evitar-saltos-de-altura-cls)).

El primer `await` de navegador divide el setup:

- Las sentencias anteriores son el setup normal, que se ejecuta en SSR y al hidratar. La plantilla sólo puede usar nombres declarados ahí: un nombre declarado después da `MEEK057`.
- Desde ese `await`, el resto es una continuación que sólo se ejecuta en el navegador, una vez montado el componente y listo lo que espera. Pertenece al componente: sus `effect`, `onCleanup` y composables se liberan al desmontarlo, y si se desmonta mientras espera, la continuación no se reanuda. Un fallo llega al observador de errores con la fuente `"mounted"`.
- `defineProps`, `defineEmits`, `defineExpose`, `defineModel` y `defineSnippets` deben ir antes de ese `await` (`MEEK058`).
- Un `await useApi(...)` o `await useRpcQuery(...)` posterior se ejecuta también sólo en el navegador, como una petición normal.
- La continuación es una función asíncrona y admite las mismas sentencias que el setup síncrono: declaraciones `const`/`let` simples y funciones, cualquier sentencia de expresión (asignaciones como `count.value = 1`, no sólo llamadas), `if`, `for`, `for...of`, `for...in`, `while`, `do...while`, `try`, `switch`, bloques, sentencias etiquetadas y sentencias vacías. `useElementRef`, `useApi`, `useRpcQuery` y `useRpcMutation` dentro de una de esas sentencias de control se ejecutarían de forma condicional o repetida y dan `MEEK054`. Cualquier otra sentencia (una clase, `export const`…) da `MEEK018`.

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

Desde `1.4`, cada componente autoimportado también tiene esos cuatro tipos con su nombre de etiqueta, sin import: `<AppCard>` (`app/components/App/Card.meeko`) da `AppCardProps`, `AppCardSnippets`, `AppCardModels` y `AppCardExposed`, que son exactamente su `ComponentProps`, `ComponentSnippets`, `ComponentModels` y `ComponentExposed`, `null` incluido (véase [Tipos de cada componente](framework.md#tipos-de-cada-componente)). El módulo `.meeko` no los exporta con ese nombre, porque el nombre depende de dónde lo autoimporta el proyecto (carpeta y prefijo de módulo), no del componente: desde un import explícito siguen siendo `import type { ComponentSnippets as CardSnippets } from "./Card.meeko"`.

Desde `1.5`, una señal del script que vale `undefined` viaja en el estado de `renderWithState` (bajo la clave `"meeko:undefined"`, que lista sus nombres) y se hidrata como `undefined`, aunque el script del navegador la cree con otro valor. Un valor que JSON no representa fielmente (una fecha, un `Map`, una instancia de clase o un `undefined` dentro de un objeto) falla con el componente y la señal, y una pista: `app/pages/agenda.meeko: the signal "when" cannot be sent to the browser with the SSR state (Non-plain object at $.when)`. Sólo viajan las señales editables del nivel superior del script: un `computed`, una constante o una señal guardada dentro de un objeto no forman parte del estado.

Para transferir props o estado en una etiqueta `<script>`, usa `serializeJson(value)`; comprueba que el dato pueda representarse fielmente en JSON y escapa caracteres que podrían cerrar la etiqueta. `renderToString` sigue disponible cuando el estado inicial se deriva de forma determinista de las props y no se necesita una captura explícita. `renderToString` y `renderWithState` son síncronos: fuera del render del framework no pueden esperar un `await useApi(...)` o `await useRpcQuery(...)`, y un componente que lo necesita lanza un error con el código `MEEKO_SUSPENDED`. Use el componente desde una página del framework o use el composable sin `await`. Dentro del framework, un componente que se monta en el navegador después de la página espera sus datos con la zona vacía en lugar de lanzar ese error (véase [Componentes que se montan más tarde](framework.md#componentes-que-se-montan-más-tarde)). Los módulos compilados exportan además `hasDataAwait` y `__meekoChildren`, marcas que el framework lee para saltarse la carga previa de una navegación, `__meekoReactiveProps` (desde `1.2`), que indica al padre que puede actualizar las props del hijo sin volver a montarlo, y `__meekoChannels` y `__meekoTag`, que sólo tipan las etiquetas del padre; ninguna forma parte del contrato. Al cambiar las props de un hijo, Meeko actualiza en su sitio los bindings que las leen (véase [Props reactivas](#props-reactivas)); cuando el hijo se vuelve a montar, conserva sus señales editables por nombre.

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

La raíz `@meekojs/meeko` exporta exactamente `signal`, `computed`, `effect`, `batch`, `untrack`, `createRoot`, `onCleanup`, `onMounted`, `createContext`, `provide`, `inject`, `provideErrorHandler`, `serializeJson`, desde `1.3`, `trustHtml` y, desde `1.5`, `useId`, más los tipos de señales, contexto, componentes, `HotState`, DevTools y, desde `1.3`, `TrustedHtml`. Este motor documenta además `@meekojs/meeko/vite` y `@meekojs/meeko/devtools-ui`. Las subrutas del framework y de los adaptadores (`/framework`, `/server`, `/node`, `/bun`, `/deno`, `/cloudflare` y `/build`) se describen en la [guía del framework](framework.md). El compilador importa sus funciones de DOM, HMR y registro de DevTools desde `@meekojs/meeko/internal`. Esa ruta es un contrato entre el compilador y su runtime de la **misma versión exacta**, y no está destinada a imports manuales. Un módulo generado debe compilarse con la misma versión del paquete que lo ejecuta, así que hay que volver a compilarlo al actualizar Meeko.

### IDs estables: `useId`

Desde `1.5`, `useId()` devuelve un ID para los atributos que enlazan elementos (`id`, `for`, `aria-describedby`, `aria-controls`, `aria-labelledby`): el mismo en el HTML del servidor y al hidratar, y distinto en cada instancia del componente. Se exporta desde la raíz y se autoimporta en las aplicaciones del framework; un export propio del proyecto con el mismo nombre tiene prioridad.

```html
<!-- app/components/AppSwitch.meeko -->
<script lang="ts">
const props = defineProps<{ label: string; hint?: string }>();
const on = defineModel<boolean>();
const id = useId();
</script>
<template>
    <input type="checkbox" role="switch" bind:id="id" bind:aria-describedby="props.hint ? `${id}-hint` : null" model="on">
    <label bind:for="id">{props.label}</label>
    <p if:when="props.hint" bind:id="`${id}-hint`">{props.hint}</p>
</template>
```

- **Determinista.** El ID no viaja en el estado: sale de la posición de la instancia en el árbol (el componente que la contiene, la clave de su fila en un `each:` y el `if:` o el snippet que la pintan) y del orden de la llamada en su script. El servidor y el navegador recorren las mismas posiciones, así que la hidratación encuentra el mismo `id` en cada atributo.
- **Único.** Dos instancias nunca comparten ID, tampoco las filas de una lista ni el contenido que un `if:` o un snippet pinta más tarde en el navegador. Una fila con `each:key` conserva su ID al reordenarse la lista, y un componente que un `if:` vuelve a crear recupera el que tenía.
- **Dónde llamarlo.** En el nivel superior del script, como `onMounted`, y antes de cualquier `await`. Cada llamada da un ID nuevo (`id` y `hint`, no uno para todo); para varios elementos de un mismo campo, derive sufijos de uno solo: `` `${id}-hint` ``. Fuera del script de un componente (en un manejador de eventos o en un test) devuelve un ID único que no coincide entre servidor y navegador.
- **Formato.** Prefijo de la aplicación, `-`, la posición y el contador: `m-0`, `m-2_f0n3-1`; una posición con claves de texto largas o con otros caracteres se resume en un hash (`m-h1x2y3…-0`). Sólo lleva letras, números, `-` y `_`, así que sirve también en un selector CSS. No dependa de su forma, que puede cambiar entre versiones.
- **Prefijo.** `document.idPrefix` de `meeko.config.ts` (una letra seguida de letras, números, `-` o `_`; `m` por defecto) lo cambia en el servidor y en el navegador a la vez. Distíngalo cuando dos aplicaciones Meeko compartan una página. Un host propio pasa el mismo valor en `DocumentOptions.config` y `mountClientApp({ document })`.
- **Raíces sueltas.** Con `hydrate` o `renderWithState` sin el framework, cada raíz empieza en la posición vacía: dos raíces independientes de la misma página repetirían sus IDs.

`useForm` lo usa para los IDs de [`form.field`](framework.md#componentes-de-campo-formfield).

## Componentes integrados

Desde `1.5`, Meeko trae dos componentes accesibles, `<MeekoPopover>` y `<MeekoSelect>`, como etiquetas propias: no se importan y funcionan igual en el motor independiente y en el framework. No tienen estilos visuales; exponen su estado con atributos `data-*` y ARIA para que la aplicación los estilice.

- **Peso.** Cada etiqueta es un módulo propio (`@meekojs/meeko/builtins/popover` y `@meekojs/meeko/builtins/select`), que el compilador importa sólo en los componentes que la usan. Una aplicación que no las escribe no carga su código, y `<MeekoSelect>` lleva consigo `<MeekoPopover>`. Esas rutas son, como `@meekojs/meeko/internal`, un contrato entre el compilador y su runtime de la misma versión: no las importe a mano.
- **SSR e hidratación.** El HTML del servidor trae el disparador (con el valor elegido en un select) y el contenido oculto por su atributo `popover`, sin parpadeo. Los IDs que enlazan disparador, contenido y opciones salen de [`useId`](#ids-estables-useid): son los mismos al hidratar.
- **CSP.** Nada va en atributos `style="…"`. El anclaje es una hoja construida (`adoptedStyleSheets`) en la capa de cascada `meeko`, compartida por todos, y cada instancia pasa sus valores en propiedades personalizadas por CSSOM; una CSP sin `'unsafe-inline'` basta. Como está en una capa, cualquier regla de la aplicación tiene prioridad.
- **Nombres.** Un componente del proyecto llamado `MeekoPopover` o `MeekoSelect` tiene prioridad sobre la etiqueta, con el aviso `MEEK106`. Los tipos de sus props, `MeekoPopoverProps` y `MeekoSelectProps`, se exportan desde `@meekojs/meeko/framework` y se autoimportan en `app/`.

### Popover: `<MeekoPopover>`

Un contenido en la capa superior del navegador (la API `popover`), anclado a su disparador con *CSS anchor positioning*:

```html
<script lang="ts">
const open = signal(false);
</script>
<template>
    <MeekoPopover placement="bottom-start" bind:offset="8" model="open" role="menu" on:toggle="(event) => console.log(event.open)">
        <snippet name="trigger">Opciones ▾</snippet>
        <button role="menuitem" on:click="rename">Renombrar</button>
        <button role="menuitem" on:click="duplicate">Duplicar</button>
        <button role="menuitem" on:click="remove">Eliminar</button>
    </MeekoPopover>
</template>
```

Meeko pinta un `<button>` con `popovertarget`, `aria-expanded`, `aria-controls` y `aria-haspopup` (según `role`), cuyo contenido es el snippet `trigger`, y el contenido suelto dentro de un elemento con `popover` y `data-meeko-popover`. Con `popovertarget`, el botón abre y cierra el contenido incluso antes de hidratar.

| Prop | Por defecto | Qué hace |
| --- | --- | --- |
| `mode` | `"auto"` | `"auto"` se cierra al pulsar fuera y con `Esc`; `"manual"` sólo desde el disparador, `Esc` o el modelo; `"hint"` es un tooltip (abajo). |
| `placement` | `"bottom-start"` | `top`, `bottom`, `left` o `right`, con `-start` o `-end` para alinearlo con un borde del disparador. |
| `offset` | `0` | Separación en píxeles con el disparador. |
| `role` | — | `"menu"`, `"dialog"` o `"tooltip"` (por defecto con `mode="hint"`): el patrón ARIA del contenido. |
| `label` | — | `aria-label` del contenido; sin ella, un menú o un diálogo se nombran con el disparador (`aria-labelledby`). |
| `class`, `triggerClass` | — | Clases del contenido y del botón. |
| `triggerId` | `useId` | `id` del disparador; con un disparador propio, el `id` que lleva. |
| `matchWidth` | `false` | El contenido mide al menos lo que el disparador (`anchor-size(width)`). |
| `delay`, `closeDelay` | `300`, `150` | Con `mode="hint"`, milisegundos antes de abrir y de cerrar con el puntero. |

`model` (el modelo por defecto) es la señal de apertura: asignarla abre o cierra el contenido, y el usuario la cambia al abrirlo o cerrarlo. `on:toggle` emite `{ open }` (tipo `PopoverToggleEvent`) con cada cambio. Una `ref:` recibe `show()`, `hide()` y `toggle()`.

**Teclado y foco.**

- `Esc` cierra y devuelve el foco al disparador. Pulsar fuera cierra un `mode="auto"` sin mover el foco.
- Con `role="menu"`, el contenido sigue el patrón de menú: `Intro`, `Espacio` o `↓` en el disparador abren el menú con el foco en el primer `menuitem` (`↑`, en el último); las flechas lo mueven (dando la vuelta), `Inicio` y `Fin` van a los extremos y las primeras letras buscan un elemento. Los elementos con `disabled` o `aria-disabled="true"` se saltan. Elegir un `role="menuitem"` cierra el menú y devuelve el foco; un `menuitemcheckbox` o `menuitemradio` lo deja abierto. `Tab` cierra el menú. Marque los elementos con `role="menuitem"`: Meeko no cambia el rol de su contenido.
- Con `role="dialog"`, el foco entra en el primer control (o en el elemento con `autofocus`) al abrirse.

**Tooltip.** `mode="hint"` usa `popover="hint"`: se abre al pasar el puntero (tras `delay`) o al enfocar el disparador, se queda abierto mientras el puntero está sobre él o sobre el contenido, se cierra con `Esc` o al perder el foco y nunca toma el foco. El disparador lleva `aria-describedby` con el contenido, que es `role="tooltip"`.

```html
<MeekoPopover mode="hint"><snippet name="trigger">?</snippet>El código está en el reverso de la tarjeta.</MeekoPopover>
```

**Posición.** El contenido usa `position-anchor`, `position-area` y `position-try-fallbacks: flip-block, flip-inline`, así que se coloca al otro lado si no cabe. En un navegador sin anchor positioning, Meeko lo marca con `data-meeko-popover-fallback` y calcula su posición en JavaScript al abrirse y con cada `resize` o `scroll`: también se da la vuelta y nunca sale del viewport, y el lado elegido queda en `data-side`. El contenido abierto lleva `data-open`.

**Disparador propio.** El snippet `anchor` sustituye el botón: recibe en `trigger` (tipo `PopoverTrigger`) los atributos que el disparador debe llevar, con el nombre de cada atributo como clave, así que basta con [`bind="trigger"`](#atributos-en-bloque-con-bind). `<MeekoPopover>` encuentra el elemento por su `id` al montarse y le añade el teclado y el anclaje:

```html
<MeekoPopover role="menu">
    <snippet name="anchor" params="trigger">
        <button type="button" class="avatar" bind="trigger"><img src="/me.png" alt="Mi cuenta"></button>
    </snippet>
    <a role="menuitem" href="/perfil">Perfil</a>
</MeekoPopover>
```

Con un componente propio, `<AppButton bind="trigger">` le pasa esas claves como props: el componente debe declararlas (por ejemplo, `defineProps<Partial<PopoverTrigger> & { variant?: "ghost" }>()`) y ponerlas en su `<button>`, que es el elemento que lleva el `id`.

Un disparador que no es un `<button>` (sin `popovertarget`) abre el contenido con el modelo: `on:click="() => open.value = !open.value"`.

### Select: `<MeekoSelect>`

Un select accesible construido sobre `<MeekoPopover>`. `model` es el valor y su tipo sale de `options`:

```html
<script lang="ts">
interface User { id: number; name: string; team: string }
const colors = ["Rojo", "Verde", "Azul"];
const color = signal<string | null>(null);
const users = signal<User[]>([]);
const user = signal<User | null>(null);
const tags = signal<string[]>([]);
</script>
<template>
    <label for="color">Color</label>
    <MeekoSelect id="color" model="color" bind:options="colors" placeholder="Elige un color" name="color" />

    <MeekoSelect model="user" bind:options="users.value" by="id" label="Responsable">
        <snippet name="option" params="user, state">{user.name} <span if:when="state.selected">✓</span></snippet>
        <snippet name="value" params="user">{user.name}</snippet>
    </MeekoSelect>

    <MeekoSelect model="tags" multiple searchable bind:options="colors" bind:max="2" name="tags" />
</template>
```

| Prop | Qué hace |
| --- | --- |
| `options` | Las opciones, primitivos u objetos. Es reactiva. |
| `multiple` | El modelo es un array y cada opción se alterna. |
| `by` | Cómo se compara una opción con el valor: una clave (`by="id"`) o una función `(a, b) => boolean`. Por defecto, `Object.is`. |
| `labelBy`, `disabledBy`, `groupBy` | La etiqueta (por defecto, el texto del primitivo o `label`/`name` del objeto), si está deshabilitada (por defecto, `disabled: true`) y el grupo de cada opción: una clave o una función. |
| `placeholder` | Texto sin valor elegido. |
| `name` | `name` de los `<input type="hidden">` que se envían con el `<form>`. |
| `required`, `disabled` | Como en un control nativo. |
| `searchable` | El disparador es un `<input>` que filtra las opciones. |
| `filter` | Búsqueda propia, síncrona o asíncrona. |
| `max` | Con `multiple`, cuántas opciones se pueden elegir como mucho. |
| `field` | El campo de `useForm`: `bind:field="form.field('color')"`. |
| `id`, `label`, `describedBy`, `invalid` | `id` del disparador (para `<label for>`), su `aria-label`, `aria-describedby` y `aria-invalid`. |
| `class`, `listClass`, `placement`, `offset` | Clases de la raíz y de la lista, y la posición de la lista. |

`on:change` emite el valor nuevo con cada elección del usuario. Los snippets son `option` (`[option, state]`, con `state.selected`, `state.active` y `state.disabled`), `value` (cómo se ve cada valor elegido en el disparador; sin él, las etiquetas separadas por comas), `group` (el encabezado de un grupo), `empty` (sin opciones; por defecto, «Sin resultados») y `loading` (mientras carga una búsqueda asíncrona).

**Tipos.** `meeko check` y el editor infieren de la etiqueta el tipo de las opciones (`T`) y si es múltiple: el modelo de un select simple es una `Signal<T | null>` y el de uno múltiple, `Signal<T[]>`; `by`, `labelBy` y `groupBy` sólo admiten claves de `T`, y los parámetros de los snippets tienen el tipo `T`. El tipo `SelectModel<T, Multiple>` describe el valor.

**ARIA y teclado.** El disparador es un `role="combobox"` (un `<button>` o, con `searchable`, un `<input>` con `aria-autocomplete="list"`) con `aria-expanded`, `aria-controls`, `aria-haspopup="listbox"` y `aria-activedescendant`: el foco nunca sale de él. La lista es un `role="listbox"` (con `aria-multiselectable` en un select múltiple) de `role="option"` con `aria-selected` y `aria-disabled`, agrupadas en `role="group"` con `groupBy`. Un `<label for>` externo nombra el disparador por su `id`.

- `↓`, `↑`, `Intro` o `Espacio` abren la lista sobre la opción elegida (o la primera); `Inicio` y `Fin` abren en un extremo; las letras abren y buscan.
- Con la lista abierta, las flechas, `Inicio`, `Fin`, `RePág` y `AvPág` mueven la opción activa (sin dar la vuelta, saltando las deshabilitadas) y la desplazan hasta verla; las letras buscan por el principio de la etiqueta, sin distinguir acentos.
- `Intro` elige la opción activa; `Espacio` también, salvo con `searchable`, donde escribe un espacio. En un select simple, elegir cierra la lista; en uno múltiple, alterna la opción y la lista sigue abierta. `Alt+↑` elige y cierra.
- `Esc` cierra sin cambiar el valor y `Tab` cierra. Pulsar fuera o mover el foco fuera también cierran.
- Con el ratón, un clic en una opción la elige; pasar el puntero la activa. Pulsar en la lista no quita el foco al disparador.

Con `max`, en cuanto hay `max` opciones elegidas las demás quedan `aria-disabled="true"` y `data-disabled` hasta que se quite una.

**Atributos de estado.** Las opciones llevan `data-active`, `data-selected` y `data-disabled`, y la raíz (`data-meeko-select`) `data-open`, `data-multiple`, `data-disabled` y `data-loading`. La lista mide al menos lo que el disparador (`anchor-size(width)` o, sin anchor positioning, el ancho calculado), tiene una altura máxima y se desplaza; ambas reglas están en la capa `meeko`, así que su CSS las sustituye:

```css
[data-meeko-select] [role="option"][data-active] { background: var(--hover); }
[data-meeko-select] [role="option"][data-selected]::after { content: " ✓"; }
[data-meeko-select] [data-meeko-popover] { max-height: 16rem; }
```

**Búsqueda.** Con `searchable`, escribir filtra las opciones cuya etiqueta contiene el texto, sin distinguir mayúsculas ni acentos («amb» encuentra «Ámbar»). `filter(query, { options, signal })` sustituye ese filtro: devuelve las opciones que se muestran o una promesa de ellas para buscar en el servidor. Mientras la promesa no resuelve, la raíz lleva `data-loading`, la lista `aria-busy="true"` y se muestra el snippet `loading`; una búsqueda nueva aborta la anterior (`signal`) y descarta su respuesta. Con la búsqueda vacía se muestran `options`, sin llamar a `filter`, así que la búsqueda nunca se ejecuta en el servidor.

```html
<script lang="ts">
interface City { code: string; name: string }
const city = signal<City | null>(null);
const search = (query: string, { signal }: { signal: AbortSignal }): Promise<City[]> =>
    fetch(`/api/cities?q=${encodeURIComponent(query)}`, { signal }).then((response) => response.json());
</script>
<template>
    <MeekoSelect model="city" bind:options="[]" by="code" searchable bind:filter="search" placeholder="Busca una ciudad">
        <snippet name="loading">Buscando…</snippet>
        <snippet name="empty">Ninguna ciudad con ese nombre</snippet>
    </MeekoSelect>
</template>
```

**Formularios.** Con `name`, el select envía un `<input type="hidden">` por valor (uno vacío en un select simple sin valor, ninguno en uno múltiple vacío), como un `<select>` nativo; con `disabled` no envía nada. El valor de cada opción es su clave de `by`, el propio primitivo o su etiqueta. `required` impide enviar el `<form>` sin valor: el disparador recibe el foco y `aria-invalid="true"` hasta que se elige una opción. Con `useForm`, `model="form.fields.color"` funciona como en cualquier control, y `bind:field="form.field('color')"` da además el valor, el `id` del campo (para su `<label for>`), el `name`, `aria-invalid` y `aria-describedby` con el mensaje de error; `focusInvalid` lleva el foco al select cuando falla la validación. El valor inicial `""` de un campo cuenta como «sin valor» (salvo que una opción sea `""`).

```html
<form on:submit="form.submit" novalidate>
    <label bind:for="form.field('country').id">País</label>
    <MeekoSelect bind:field="form.field('country')" bind:options="countries" placeholder="Elige un país" />
    <p if:when="form.errors.value.country" bind:id="form.field('country').errorId">{form.errors.value.country}</p>
    <button>Guardar</button>
</form>
```

**Listas largas.** `<MeekoSelect>` pinta todas las opciones (en el HTML del servidor también). Para miles de opciones, use `searchable` con un `filter` que devuelva sólo las primeras coincidencias; una lista virtual que sólo pinte las visibles (`virtual`) no está disponible en `1.5`.

**Alternativa nativa.** Para un caso simple, sin búsqueda ni opciones con contenido propio, un `<select>` nativo con `model` sigue siendo la opción más ligera. En los navegadores que lo admiten, `appearance: base-select` permite estilizarlo por completo y conserva el teclado, la accesibilidad y el envío del formulario del navegador:

```css
select, ::picker(select) { appearance: base-select; }
```

## Herramientas

`meeko check archivo.meeko` comprueba sintaxis y tipos; `--json` entrega diagnósticos estructurados. `meeko compile entrada.meeko salida.ts` genera el módulo tipado y no escribe un archivo si hay errores. `meeko types archivo.meeko` emite declaraciones `Archivo.d.meeko.ts` para ese componente y los hijos importados bajo `.meeko/types/`, reflejando su ruta relativa al proyecto; no escribe declaraciones junto a las fuentes. En una aplicación de framework, la generación registra sus salidas en `.meeko/manifests/component-types.json` y elimina únicamente declaraciones administradas cuyo componente ya no existe. La primera ejecución tras actualizar reconoce mediante AST únicamente declaraciones generadas huérfanas de versiones anteriores, mientras conserva archivos ajenos y regenera los componentes vigentes. Para resolver esos imports con props precisas, TypeScript necesita `allowArbitraryExtensions` y `rootDirs` que superponga el árbol fuente con `.meeko/types/`. `meeko init` escribe esa configuración; un consumidor configurado a mano debe incorporarla. El plugin `@meekojs/meeko/vite` compila los imports `.meeko` en cliente y SSR y añade HMR y CSS durante desarrollo. `meeko lsp --stdio` (también disponible como bin `meeko-language-server`) arranca el servidor de lenguaje que usan la [extensión de VS Code](../packages/vscode/README.md) y [otros editores](editors.md) para ofrecer las mismas comprobaciones en el editor.

`@meekojs/meeko/prettier` es el plugin de Prettier para `.meeko`. Con `{ "plugins": ["@meekojs/meeko/prettier"] }` en la configuración de Prettier, `prettier --write "**/*.meeko"` formatea script, `<script server>`, plantilla y estilo; la opción `meekoIndentSections` (por defecto `false`) indenta un nivel el contenido de todas las secciones, y `meekoPreserveArrayBreaks` (por defecto `true`) deja expandido, en todo el JavaScript y TypeScript que formatee Prettier, un array con un salto de línea tras `[`, como `objectWrap: "preserve"` con los objetos. El servidor de lenguaje usa el mismo plugin, así que el editor y la CI coinciden (véase [editores](editors.md#formato-con-prettier)).

## Compatibilidad y límites

- Node.js 24 o posterior y TypeScript 7.0.2 para la CLI, el build, Vite y el servidor de lenguaje. Los entornos de ejecución y navegadores admitidos se listan en la [política de estabilidad](stability.md#entornos-soportados).
- La API pública sigue SemVer durante la serie 1.x: los cambios incompatibles requieren una versión major y las deprecaciones se anuncian en un minor (véase la [política de estabilidad](stability.md)). El paquete se distribuye como `@meekojs/meeko` bajo licencia MIT.
- El parser acepta el subconjunto de TypeScript y HTML descrito arriba; informa las construcciones no soportadas mediante diagnósticos.
- La hidratación requiere que el servidor y el navegador obtengan los mismos valores iniciales y el mismo orden de listas.
- No se ofrecen garantías de compatibilidad con plugins de Vue. El streaming SSR (`render: "stream"` con `defer` de `@meekojs/meeko/framework`) se describe en [framework.md](framework.md).

## Verificación del paquete

`pnpm run package:smoke` instala el tarball en un consumidor fuera del monorepo y comprueba CLI, SSR, tipos y Vite. `tests/package-boundaries.test.ts` fija la lista exacta de exports de la raíz. La extensión de VS Code se empaqueta y prueba en un host aislado con un proyecto consumidor externo. Los pasos de cada publicación están en [releasing.md](releasing.md).
