# Plantillas y directivas

## Condiciones con `if:when` y tipos

Desde `1.2`, `if:when` estrecha los tipos dentro de su elemento, como `v-if` en Vue: sus atributos, sus props, sus eventos y su contenido se comprueban sabiendo que la condición se cumple, en `meeko check` y en VS Code. No hace falta `!`:

```html
<p if:when="user.value">{user.value.name}</p>
<WorkspaceHeader
	if:when="session.data.value.staff"
	bind:staff="session.data.value.staff"
/>
```

- TypeScript estrecha la misma referencia que comprueba la condición: `if:when="user.value"` estrecha `user.value.name`, pero no otra expresión que devuelva el mismo valor.
- Alcanza a las condiciones y listas anidadas y al contenido de una etiqueta de componente (sus snippets). El `if:when` de un `<snippet>` estrecha también su contenido (véase [Snippets condicionales](component-events.md#snippets-con-definesnippets)). Un `each:as`, un `each:index` o un parámetro de snippet con el mismo nombre que una variable de la condición la oculta, y ahí no se estrecha.
- Dentro de una función flecha escrita en la plantilla, como `on:click="() => save(user.value.id)"`, TypeScript no conserva el estrechamiento de una propiedad; extraiga el manejador a una función del script o compruebe el valor dentro de la función.
- Sólo cambia la comprobación de tipos: en ejecución el contenido nunca se evalúa con la condición falsa.

Una expresión de texto puede contener llaves propias de JavaScript: objetos literales (`{ { total: count.value }.total }`), plantillas literales con `${...}`, cadenas que incluyen `{` o `}`, comentarios y expresiones regulares. La expresión termina en la llave que equilibra la de apertura; si no existe, el compilador informa `MEEK010` en la llave de apertura. Los valores de directivas pueden escribirse sin comillas cuando HTML lo permite, por ejemplo `on:click=increment` o `each:of=items`; CLI y VS Code los ubican igual que los valores entre comillas.

## Controles de formulario con `model`

Desde `1.1`, `model="signal"` enlaza un control de formulario con una señal en los dos sentidos: el control muestra el valor de la señal y cada edición del usuario lo escribe en ella.

```html
<script lang="ts">
	const name = signal('')
	const accepted = signal(false)
	const plan = signal<string | null>('free')
	const tags = signal<string[]>([])
</script>
<template>
	<input model="name" />
	<input
		type="checkbox"
		model="accepted"
	/>
	<input
		type="radio"
		value="free"
		model="plan"
	/>
	<input
		type="radio"
		value="pro"
		model="plan"
	/>
	<select
		multiple
		model="tags"
	>
		<option value="a">A</option>
		<option value="b">B</option>
	</select>
</template>
```

| Control                                                                                  | Propiedad y evento                                              | Tipo de la señal              |
| ---------------------------------------------------------------------------------------- | --------------------------------------------------------------- | ----------------------------- |
| `<input>` de texto (cualquier `type` salvo los siguientes, o `bind:type`) y `<textarea>` | `value`, en `input`                                             | `string`                      |
| `<input type="checkbox">`                                                                | `checked`, en `change`                                          | `boolean`                     |
| `<input type="radio">`                                                                   | marcado si la señal vale su `value`; `change` escribe ese valor | `string \| null \| undefined` |
| `<select>`                                                                               | `value`, en `change`                                            | `string`                      |
| `<select multiple>`                                                                      | las opciones seleccionadas, en `change`                         | `string[]`                    |

- **Números.** Un `<input type="number">` también entrega texto: guarde un `string` y conviértalo donde se use. Un `<input type="range">`, desde `1.8`, recibe números si la señal guarda un número.
- **Señal escribible.** La expresión debe ser una señal escribible del tipo de la tabla. Un `computed`, una señal de sólo lectura o un valor normal es un error de tipos, y en ejecución lanza un `TypeError`.
- **Sincronización.** Asignar la señal desde código actualiza la propiedad viva del control, como `bind:value` desde `1.0.1`. En SSR, el HTML lleva el valor de la señal (`value`, `checked`, el contenido del `<textarea>` o el `selected` de cada `<option>`). Si el usuario edita el control antes de que la página se hidrate (o el navegador restaura su valor), se conserva lo que escribió y se copia a la señal al terminar la hidratación, antes de los `onMounted`: las regiones `if:`, `each:`, `<render>` y los padres que leen la señal se hidratan primero con el valor del SSR y después reaccionan al valor restaurado.
- **Radio.** Necesita `value="..."` o `bind:value="expression"`.
- **`type` dinámico.** Desde `1.2`, `model` admite `bind:type` en `<input>` y trata el control siempre como uno de texto: `value`, en `input`, con una señal `string`, también cuando el tipo cambia. Sirve, por ejemplo, para un campo de contraseña que muestra su texto:

  ```html
  <script lang="ts">
    const password = signal('')
    const revealed = signal(false)
  </script>
  <template>
    <input
    	bind:type="revealed.value ? 'text' : 'password'"
    	model="password"
    	autocomplete="current-password"
    />
    <button
    	type="button"
    	on:click="() => revealed.value = !revealed.value"
    >
    	Mostrar
    </button>
  </template>
  ```

  `bind:type` sólo puede dar tipos de texto (`text`, `password`, `email`, `search`, `number`…). Con `checkbox`, `radio`, `file`, `submit`, `reset`, `button` o `image`, que no tienen un valor de texto, el modelo no cambia ni la señal ni el control: si el control ya tiene ese tipo al hidratarse, la hidratación lanza un `TypeError`; si lo toma después, cada lectura o escritura del modelo entrega un `TypeError` al observador de errores más cercano (véase `provideErrorHandler`). Para un checkbox o un radio, use otro `<input>` con su `type` estático.

`MEEK065` señala los usos no admitidos: `model` en un elemento que no es `<input>`, `<textarea>` o `<select>`; en `<input type="file">`, `submit`, `reset`, `button` o `image`; con `bind:type` y además `type="..."` en el mismo `<input>`; con `bind:multiple` en lugar de `multiple` estático; con contenido en `<textarea model>`; junto a `value`, `bind:value` u `on:input` en un control de texto (o `checked`, `bind:checked` u `on:change` en uno marcable, y `value`, `bind:value` u `on:change` en un `<select>`); un segundo `model` o `model:nombre`, que es sólo para componentes. Los demás eventos `on:` se admiten.

## `<select>` con contenido rico

Desde `1.8`, un `<select>` conserva el contenido que admiten los navegadores actuales: `<button>`, `<selectedcontent>`, `<legend>`, `<div>` y opciones con `<span>` o `<svg>`. Con `appearance: base-select` en el `<select>` y en su `::picker(select)`, el navegador pinta ese contenido en un desplegable propio:

```html
<script lang="ts">
	const plan = signal('pro')
	const plans = [
		{ id: 'free', name: 'Gratis' },
		{ id: 'pro', name: 'Pro' },
	]
</script>
<template>
	<select model="plan">
		<button type="button"><selectedcontent></selectedcontent></button>
		<option
			each:of="plans"
			each:as="item"
			each:key="item.id"
			bind:value="item.id"
		>
			<span class="dot"></span>
			<span>{item.name}</span>
		</option>
	</select>
</template>
```

- **Hidratación.** El navegador copia la opción elegida dentro de `<selectedcontent>`, con sus atributos. Los enlaces (`bind:`, `on:`, `{texto}`) son siempre de la opción real, nunca de la copia. No pongas `id` dentro de una opción, porque la copia lo duplica.
- **La copia no es reactiva.** Si cambia el contenido de la opción elegida, la copia sigue igual hasta que se elija otra. `select.selectedIndex = select.selectedIndex` la rehace.
- **`<input>` y otro `<select>`.** El navegador cierra el `<select>` al encontrarlos y saca de él lo que viene detrás, así que dentro de un `<select>` son `MEEK008`. Colócalos fuera.
- **Botón interno.** El `<button>` de un `<select>` es inerte: los clics llegan al `<select>`. Un botón para vaciar la selección va fuera.
- **Otros navegadores.** Firefox conserva este contenido, pero sin `base-select` muestra el desplegable nativo y `<selectedcontent>` queda vacío. Comprueba el soporte en [MDN](https://developer.mozilla.org/en-US/docs/Learn_web_development/Extensions/Forms/Customizable_select).

## HTML sin escapar con `html`

Desde `1.1`, `html="expression"` en un elemento lo llena con el HTML de la expresión, **sin escapar**. La expresión es un `string`; `null` y `undefined` dejan el elemento vacío. Desde `1.3`, ese `string` debe estar marcado como de confianza con `trustHtml` (tipo `TrustedHtml`) o `meeko check` avisa con `MEEK107`; véase [HTML de confianza](#html-de-confianza-trustedhtml-y-trusthtml).

```html
<script lang="ts">
	import { trustHtml } from '@meekojs/meeko'
	const article = signal(trustHtml('<p>Contenido <strong>generado</strong> en el servidor.</p>'))
</script>
<template>
	<article
		class="prose"
		html="article.value"
	></article>
</template>
```

- **SSR.** El HTML de la expresión se normaliza para el elemento antes de escribirlo, de modo que al analizar el documento ningún nodo salga de él (ni pueda imitar marcadores de Meeko fuera de él): se cierran las etiquetas, comentarios y elementos de texto (`<style>`, `<textarea>`…) que quedaron abiertos (`"<b>Hola"` da `<b>Hola</b>`), se descartan los cierres que no corresponden a nada abierto en el valor (un `</div>` no cierra el elemento), y los cierres implícitos se escriben explícitos. El texto y los atributos se escriben tal cual. Si el navegador sacaría parte del contenido del elemento, el SSR deja el elemento vacío y el navegador lo llena al hidratar con `innerHTML`, que lo mantiene dentro; sin JavaScript ese contenido no se ve. Pasa con un `<div>` u otro bloque dentro de un `<p>` o de un elemento en línea (`<span>`, `<a>`, `<em>`, `<label>`…, que podrían estar dentro de un `<p>`), un `<li>` suelto, un título dentro de otro, celdas o filas fuera de su tabla, texto suelto en un `<table>`, `<tbody>` o `<tr>`, contenido distinto de `<option>` en un `<select>`, un bloque HTML dentro de `<svg>` y los elementos `<noscript>` y `<plaintext>`. Use un elemento que admita el contenido (`<div html>`, `<ul html>` para una lista de `<li>`, `<tbody html>` para filas). La normalización no conoce los antepasados del elemento: no anide enlaces, botones ni formularios entre la plantilla y el contenido.
- **Hidratación.** Si el contenido del elemento coincide con el HTML de la expresión (analizado en el contexto del elemento, así que `<br/>` y `<br>` coinciden), no se toca el DOM; si difiere, se sustituye `innerHTML`.
- **Reactividad.** Cada cambio del valor sustituye `innerHTML`. El contenido insertado no es parte de la plantilla: no tiene directivas, y la hidratación nunca busca marcadores de Meeko dentro de él.
- **Eventos.** Para reaccionar a clics dentro del HTML insertado, escuche en el propio elemento (`on:click`) y use `event.target.closest(...)`.

**Es inseguro con contenido no confiable.** Un HTML que venga de usuarios o de terceros puede ejecutar scripts en la página (XSS): sanéelo antes de insertarlo o use `{expression}`, que escapa el texto. Meeko nunca ejecuta los `<script>` del contenido cuando lo inserta en el navegador, igual que `innerHTML`: ni al hidratar un contenido distinto, ni al cambiar el valor, ni en una región que se monta después (`if:`, `each:`, un componente) ni al navegar a otra página. Los que lleva el HTML del documento inicial sí se ejecutan, porque los analiza el navegador como cualquier script de la página. `html` no es un mecanismo para cargar scripts.

El elemento no admite hijos, ni siquiera comentarios o `{expression}`; sólo espacios. `MEEK095` señala también `html` en un elemento vacío (`<img>`, `<input>`…), en uno de texto (`<textarea>`, `<title>`, `<script>`, `<style>`…), en `<template>`, junto a `model` o con un valor vacío. En una etiqueta de componente, `html` no es una prop (`MEEK032`). `bind:html` sigue siendo un atributo HTML llamado `html`.

**Elementos personalizados.** `html` y `model` son directivas sólo en los elementos HTML estándar, donde no son atributos HTML válidos. En un elemento personalizado (una etiqueta con guion, como `<x-markdown html="intro">` o `<my-input model="query">`) siguen siendo atributos HTML literales, como en `1.0`, y el elemento admite hijos.

### HTML de confianza: `TrustedHtml` y `trustHtml`

Desde `1.3`, el tipo de la expresión de `html` declara de dónde viene el HTML. `TrustedHtml` es un `string` con una marca que sólo existe en los tipos, y `trustHtml(html)` la pone: en ejecución devuelve el mismo `string`, sin copiarlo ni comprobarlo. Ambos se importan de `@meekojs/meeko`; no son autoimports, para que la declaración de confianza sea siempre un import visible y funcione igual fuera del framework.

**`trustHtml` no sanea: sólo declara.** Úselo donde nace el HTML, no justo antes de la plantilla:

```ts
// server/content/articles.ts
import DOMPurify from 'isomorphic-dompurify'
import { trustHtml } from '@meekojs/meeko'
import type { TrustedHtml } from '@meekojs/meeko'

// HTML de usuarios o de terceros: se sanea primero y después se declara de confianza.
export function commentHtml(input: string): TrustedHtml {
	return trustHtml(DOMPurify.sanitize(input))
}

// HTML propio, como el Markdown del repositorio renderizado en el build: basta con declararlo.
export function articleHtml(markdownDeConfianza: string): TrustedHtml {
	return trustHtml(markdownDeConfianza)
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

### HTML que viaja una vez: `documentHtml`

Desde `1.8`, un `TrustedHtml` grande que sólo se lee en `html="..."` puede viajar una vez. Sin la marca, un dato de la página llega dos veces en la primera carga: en el HTML del documento y en el payload de hidratación, donde además pesa más por el escape de JSON. `documentHtml` lo deja sólo en el HTML:

```html
<script server lang="ts">
import { trustHtml } from "@meekojs/meeko";
import { documentHtml } from "@meekojs/meeko/framework";

export const guide = { body: documentHtml(trustHtml("<h2>Guía</h2><p>Un artículo largo.</p>")) };
</script>

<template>
  <article html="guide.body"></article>
</template>
```

El payload del documento lleva un marcador, y la hidratación adopta el contenido del elemento sin leerlo ni reescribirlo. Las navegaciones de cliente reciben el valor completo. Si la página vuelve a pintar el elemento, por ejemplo un `if:` que se cierra y se abre, el navegador pide el valor al servidor: el DOM nunca aporta HTML.

No es automático porque cambia lo que el navegador ve en esa primera carga: el valor es el marcador, así que `{guide.body.length}` o un `computed` que lo analice no darían lo mismo que en el servidor. Márquelo sólo si nada más lo lee. El valor sigue en el payload si `html` no lo pintó en el documento o si el SSR dejó vacío alguno de sus elementos. Si la página vuelve a pintar el elemento, el navegador pide el valor al servidor y sólo inserta el que esa respuesta declare marcado; si ya no está, carga el documento de nuevo. Véase [`documentHtml`](/docs/reference/documenthtml).

## Listas con y sin `each:key`

Desde `1.1`, `each:key` es opcional (antes, una lista sin clave daba `MEEK023`, que se retira). Sin clave, la clave de cada fila es su índice: la fila `i` conserva sus nodos y recibe el elemento `i`, y las filas sólo se añaden o se quitan al final. Al insertar, borrar o reordenar en medio de la lista, cada fila muestra el elemento que ahora ocupa su posición.

```html
<li
	each:of="tags.value"
	each:as="tag"
>
	{tag}
</li>
<li
	each:of="todos.value"
	each:as="todo"
	each:key="todo.id"
>
	<TodoItem bind:todo="todo" />
</li>
```

Use `each:key` cuando la lista cambia de orden o recibe elementos en medio y cada fila tiene estado propio que debe acompañar a su elemento: un componente hijo con señales, un control de formulario que el usuario está editando, el foco o una animación. Con la clave, Meeko mueve las filas existentes en lugar de reasignarlas. Para listas que sólo se muestran o sólo crecen al final, el índice basta.

## Elementos sin contenido (`<div />`)

Desde `1.8`, cualquier elemento HTML no vacío se puede cerrar con `/>` cuando no tiene contenido, como en Vue: `<div class="spacer" />` equivale a `<div class="spacer"></div>`, y lo mismo `<span />`, `<textarea name="nota" />`, `<td />`, `<option value="" />`, `<iframe src="…" />` o un elemento personalizado como `<my-element />`. Antes era `MEEK001`, porque el parser HTML abre `<div/>` y mete dentro todo lo que sigue.

```html
<template>
	<ul>
		<li
			each:of="items.value"
			each:as="item"
			each:key="item.id"
			bind:data-id="item.id"
		/>
	</ul>
	<span
		if:when="loading.value"
		class="spinner"
	/>
	<p>Los nodos que siguen a <code>&lt;span /&gt;</code> son sus hermanos.</p>
</template>
```

- Los nodos que siguen a un elemento autocerrado son sus hermanos, no su contenido. Admite atributos, `bind:`, `on:`, `ref:`, `if:when` y `each:of` como la forma con etiqueta de cierre, y compila exactamente igual.
- El SSR escribe HTML válido (`<div></div>`, nunca `<div/>`), y la hidratación, las actualizaciones y la liberación funcionan como con la etiqueta de cierre.
- Los elementos vacíos (`<input />`, `<br />`, `<img />`) no cambian, y SVG y MathML ya cerraban con `/>` (`<path d="…" />`, `<mi />`).
- `<template>`, `<script>`, `<style>`, `<html>`, `<head>`, `<body>` y los nombres desconocidos (`<foo />`) siguen necesitando su etiqueta de cierre: `MEEK001`.
- `<td />`, `<th />`, `<tr />`, `<option />` y el resto de elementos de tabla y de lista conservan su nombre para el parser, así que su propia etiqueta de cierre detrás (`<td /></td>`) da `MEEK008`.
- El servidor de lenguaje, `meeko check`, el parser de ESLint y Prettier entienden ambas formas. Prettier las conserva tal como están escritas; la regla optativa [`meeko/html-self-closing`](../packages/eslint-plugin/docs/rules/html-self-closing.md) unifica el estilo con autofix.

## `<script>` y `<style>` en la plantilla

Desde `1.9`, una expresión `{…}` dentro de un `<script>` o un `<style>` de la plantilla (también en SVG) es el error `MEEK140`, en la compilación, `meeko check` y el editor. El navegador no lee su contenido como HTML, así que el escape de `{…}` no lo protege: en un script, un valor con un salto de línea o con `${…}` entre comillas invertidas se ejecutaría. Un `<script src="…">` o un contenido sin `{` siguen igual.

- **Datos para un script.** Páselos con `useHead`, que escribe un bloque JSON que no puede cerrar su etiqueta (`useHead({ script: [{ type: 'application/json', children: JSON.stringify(config) }] })`), o con atributos `data-*` (`<div bind:data-config="JSON.stringify(config)">`), y léalos desde el script.
- **Estilos.** Use la sección `<style>` del componente, `bind:style` o variables CSS (`bind:style="{ '--accent': color }"`).
- **Contenido estático.** Desde `1.10`, el texto de un `<script>` o un `<style>` de la plantilla se escribe tal cual, sin escapar, porque el navegador no decodifica entidades en él: `<script>if (a && b) go("x")</script>` llega igual al navegador (antes se escribía `&amp;&amp;` y `&quot;`, y el script fallaba). En `<svg>`, `<script>` y `<style>` son marcado y conservan el escape.
- **Otros elementos de texto crudo.** `<xmp>`, `<iframe>`, `<noembed>` y `<noframes>` también escriben su contenido tal cual y, desde `1.10`, rechazan `{…}` con `MEEK140`: el navegador mostraba los marcadores y las entidades, o ignoraba el contenido.
- **`<textarea>` y `<title>`.** Su contenido es texto (RCDATA): `{…}` se escapa y, desde `1.10`, todo el contenido es un único texto enlazado al elemento, sin marcadores de hidratación, que antes se veían como texto (`<!--meeko:text:0-->`). La hidratación y las actualizaciones escriben su `textContent`; en `<textarea>` es el valor por defecto, que el control muestra mientras el usuario no lo edite (para un valor editable, use `model`).
- **`<noscript>`.** Sólo lo muestra un navegador sin JavaScript, que lo lee como HTML: desde `1.10` su marcado estático se escribe tal cual (antes salía escapado, como texto) y cada `{…}` se escapa sin marcadores. No se hidrata ni se actualiza.

## Contenido de frase

HTML define qué puede ir dentro de cada elemento. `<p>`, `<span>`, `<button>`, `<label>`, los encabezados (`<h1>`…`<h6>`), `<em>`, `<strong>`, `<code>` y otros sólo admiten **contenido de frase**: texto y elementos en línea como `<span>`, `<a>`, `<img>` o `<input>`. Un elemento de bloque (`<div>`, `<ul>`, `<table>`, `<form>`, `<section>`…) no puede ir dentro. `<a>`, `<ins>` y `<del>` son transparentes: admiten lo que admite su padre.

Dentro de un `<p>` no es sólo una cuestión de validez: el navegador **cierra el párrafo** antes del bloque y saca de él lo que sigue. Si el bloque está escrito en la plantilla, el compilador ya ve ese árbol y el resultado no es el escrito (`<p>a<div>b</div>c</p>` se pinta como `<p>a</p><div>b</div>c<p></p>`). Si el bloque lo pinta un componente, o es un `<div />`, el HTML del servidor lo lleva dentro del `<p>`, el navegador lo saca al leerlo y la hidratación ya no encuentra el DOM que espera: la página entera se queda sin JavaScript.

```html
<template>
	<!-- MEEK139: <UITooltip> pinta un <div> dentro de <p> -->
	<p>Precio <UITooltip text="Con IVA">…</UITooltip></p>

	<!-- Un contenedor de bloque admite ambos -->
	<div class="paragraph">Precio <UITooltip text="Con IVA">…</UITooltip></div>
</template>
```

Desde `1.10`, `meeko check`, `meeko build` y el editor lo avisan con `MEEK139`:

- Para los elementos HTML de la plantilla, en cualquier padre que sólo admite contenido de frase.
- Para un componente, en `meeko check` y en el editor, cuando se conoce su raíz: la de un componente importado con una ruta `.meeko` o autoimportado (también de un módulo, como `@meekojs/ui`), con las etiquetas HTML de bloque del nivel superior de su plantilla, siguiendo los componentes que pinta ahí (`<UITooltip>` pinta un `<Popover>`, que pinta un `<div>`). Las etiquetas propias de Meeko, `<component is>`, `resolveComponent` y el contenido de los snippets no se comprueban.
- Es un aviso: no cambia el código de salida de `meeko check` ni la compilación.

En `meeko dev`, si la hidratación de la página falla de todas formas, el navegador lo muestra: `console.error` con el componente, la ubicación en la plantilla y el nodo esperado y el encontrado, y el overlay de errores de Vite. Para un `<p>` que el navegador cerró antes de un bloque, el mensaje lo dice. En producción el error se lanza como hasta ahora.
