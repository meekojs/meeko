# Estilos de componentes

## Estilos del componente: `<style>` y `<style scoped>`

Un `.meeko` admite un bloque de estilos, con o sin `scoped`. Los dos pasan por el mismo PostCSS que `app/styles/main.css` (`postcss.config.*`, Tailwind, `@utilities`) y Vite los empaqueta junto al componente: el SSR enlaza el CSS de los componentes de la página y la navegación cliente carga el de cada ruta al entrar en ella.

|                                   | `<style scoped>`                                                                               | `<style>`                                                           |
| --------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Alcance                           | Sólo los elementos de la plantilla del componente, mediante el atributo `data-meeko-s-<hash>`. | **Toda la página**, como `app/styles/main.css`.                     |
| Hijos y contenido de `html="..."` | No, salvo con `:global(...)`.                                                                  | Sí.                                                                 |
| `:global(...)`                    | Desenvuelve el selector sin el atributo.                                                       | No se transforma: no lo use.                                        |
| Riesgo                            | Ninguna fuga.                                                                                  | Una `.card` de un componente afecta a la `.card` de cualquier otro. |

Un `<style>` sin `scoped` es CSS global que vive junto al componente que lo necesita. No se limita a los momentos en que el componente está montado: una vez cargado, sigue aplicándose al navegar a otras rutas, y su orden frente a otras hojas depende de cuándo se cargó. Úselo para estilos globales a propósito, por ejemplo los de un contenido de terceros que el componente envuelve:

```html
<!-- MarkdownView.meeko -->
<template>
	<article
		class="markdown-view"
		html="props.content"
	></article>
</template>

<style>
	/* Global a propósito: el prefijo .markdown-view evita afectar al resto de la página. */
	.markdown-view p {
		margin-block: 0.75em;
	}
	.markdown-view pre {
		overflow-x: auto;
	}
</style>
```

Para casi todo lo demás, `<style scoped>` es la opción por defecto, y `:global(...)` alcanza a los hijos o al contenido de `html` sin perder el ámbito: `.markdown-view :global(p)` da `.markdown-view[data-meeko-s-…] p`. Los estilos de toda la aplicación (reset, tokens, tipografía) van mejor en `app/styles/main.css` o en un archivo que esta importe, donde su orden es explícito.

## Estilos con ámbito y `:global(...)`

`<style scoped>` añade el atributo `data-meeko-s-<hash>` al último compuesto de cada selector, antes de un pseudoelemento si lo hay (`.card::before` se convierte en `.card[data-meeko-s-…]::before`). `:global(<selector>)` emite el selector interno sin el atributo de ámbito:

| Fuente                 | Resultado                           |
| ---------------------- | ----------------------------------- |
| `.card :global(.icon)` | `.card[data-meeko-s-…] .icon`       |
| `:global(body) .card`  | `body .card[data-meeko-s-…]`        |
| `:global(html.dark)`   | `html.dark`, sin atributo de ámbito |

Un compuesto que contiene `:global(...)` no se limita; el atributo se añade al último compuesto local del selector, y un selector completamente global no lo recibe. `:global` sin paréntesis o vacío, una lista de selectores dentro de `:global(...)` y un `:global(...)` anidado en otra pseudoclase, como `:not(...)`, fallan con `MEEK019` en su posición. Las reglas dentro de `@keyframes` no se modifican.

### Qué elementos reciben el atributo

Por defecto, `data-meeko-s-<hash>` va en todos los elementos de la plantilla del componente. Desde `1.2`, la opción `css.scopeAttribute: "matched"` de `meeko.config.ts` lo añade sólo a los elementos que algún selector con ámbito puede seleccionar, y el HTML pesa menos:

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	css: { scopeAttribute: 'matched' }, // "all" por defecto en 1.x
})
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
	.card .title {
		font-weight: 700;
	} /* el <h2>; .card es sólo un ancestro */
	p:hover {
		color: teal;
	} /* el <p> */
	.active {
		color: green;
	} /* el <span>, por bind:class */
</style>
```

Con `"matched"`, aquí `<section>` y `<em>` se renderizan sin el atributo. El contenido de `html="..."` y los elementos de un componente hijo no reciben el atributo del padre, como antes (selecciónelos con `:global(...)`, por ejemplo `.content :global(p)`), y el contenido de un snippet recibe el del componente que lo escribe. Un componente sin `<style scoped>` nunca emite el atributo y, con `"matched"`, tampoco uno cuyos selectores son todos globales. El SSR, la hidratación y las regiones de `if:when` y `each:of` comparten la plantilla compilada, así que el atributo coincide en el HTML del servidor y en el que se renderiza en el navegador.

Antes de activar `"matched"`, revise el código que cambia clases o atributos con la API del DOM (`classList`, `setAttribute`, `toggleAttribute`). En un elemento sin `ref:` ni `on:`, como un descendiente al que el script llega con `querySelector`, `closest` o `event.target`, o uno que modifica una biblioteca externa, la clase sólo recibe los estilos con ámbito si ese elemento ya tenía el atributo. Use `bind:class` o `bind:nombre`, ponga una `ref:` en ese elemento o escriba el selector con `:global(...)`. Con `"all"`, todos los elementos de la plantilla tienen el atributo y este caso no se da.

CLI y VS Code comprueban el tipo del evento que recibe `on:event` y que `each:key` devuelve `string | number`; ambos ubican el diagnóstico en la expresión de la plantilla. Desde `1.2`, en un elemento HTML el evento tiene el tipo de `HTMLElementEventMap` (`SVGElementEventMap` dentro de `<svg>`) para su nombre, como `KeyboardEvent` en `on:keydown` o `PointerEvent` en `on:pointerdown`, y `Event` si el nombre no está en el mapa (antes sólo se tipaban `click`, `input`, `change`, `submit`, `keydown`, `keyup`, `focus` y `blur`). Además, `event.currentTarget` tiene el tipo del elemento de la etiqueta, el mismo que da `ref:` (`HTMLInputElement` en `<input>`, `HTMLSelectElement` en `<select>`, `HTMLElement` en un elemento personalizado), así que `on:input="(event) => query.value = event.currentTarget.value"` y `on:change="(event) => accepted.value = event.currentTarget.checked"` se comprueban sin conversiones; una propiedad que el elemento no tiene sigue siendo un error. `event.target` conserva el tipo `EventTarget | null`, porque puede ser un descendiente. En una etiqueta de componente, `on:evento` es una prop de callback y recibe los argumentos de su `defineEmits`. El documento virtual de VS Code aplica las mismas opciones estrictas de acceso indexado, props opcionales exactas e imports de tipo que `meeko check`.

`each:index` tiene tipo `number` tanto en el componente compilado como en el documento virtual de VS Code; no se infiere como el literal inicial `0`.

Los handlers de `on:event` pueden ser asíncronos. Meeko observa su promesa y entrega los fallos síncronos o rechazos al observador más cercano, sin dejar un rechazo no manejado ni detener otros listeners. La limpieza del componente elimina sus listeners. Si no hay observador, Meeko registra el fallo en consola.

Dentro del script de un componente, `provideErrorHandler((error, source) => { ... })` registra un observador para sus eventos y los de sus hijos, y también para los rechazos de un `effect` u `onCleanup` que devolvió por error una promesa. Se autoimporta como una función ESM real; `error` tiene tipo `unknown`, por lo que debe refinarse antes de leer sus propiedades, y `source` es un `ErrorSource` (`"event"`, `"effect"`, `"cleanup"`, `"mounted"`, `"navigation"`, `"socket"` y, desde `1.3`, `"uncaught"` y `"rejection"` para los fallos globales de la página en una aplicación montada; véase [Errores](framework.md#errores)). La unión puede ganar miembros en un minor: un `switch` exhaustivo necesita una rama por defecto. `"mounted"` (desde `1.1`) identifica los fallos de un callback de `onMounted` y de la continuación en el navegador de un setup con `await` (véase [Ciclo de vida](language-reactivity.md#ciclo-de-vida)). Un componente descendiente puede registrar otro observador para su propia rama. El contexto está aislado por raíz; un observador asíncrono que rechace se registra junto al error original. En una aplicación montada, la navegación y los canales Socket creados dentro de la aplicación también utilizan el observador activo; sus opciones explícitas `onNavigationError` y `onError` tienen prioridad. El servidor usa su propio observador con `requestId`.

```html
<script lang="ts">
	provideErrorHandler((error) => {
		console.error('Component failed', error)
	})
	function save(): void {
		// Handle the action here.
	}
</script>
<template><button on:click="save">Save</button></template>
```

Para componer componentes, importa el módulo hijo en el script y usa `<component is="Child" bind:label="expression"></component>`. `is` acepta una expresión de módulo y cada `bind:` define una prop tipada (véanse también las [props estáticas](component-attributes.md#props-estáticas)). CLI y VS Code comprueban las props requeridas, los nombres y los tipos de los valores contra las props que declara el hijo; el editor ofrece completado y ubica el diagnóstico en la expresión original. Desde `1.1` los nombres se comprueban también cuando la etiqueta pasa otras props válidas: antes, una prop desconocida junto a una conocida no daba error. Una prop obligatoria que falta se señala en la etiqueta. `<component>` se cierra con `</component>` o solo (`<component is="..." />`); desde `1.5` su contenido son los snippets del componente, como en su etiqueta (véase [Snippets](component-events.md#snippets-con-definesnippets)), y `is` también acepta etiquetas HTML (véase [Etiquetas HTML en `<component is>`](component-dynamic.md#etiquetas-html-en-component-is)). El HTML SSR marca un rango de comentarios para hidratar el hijo sin elemento envolvente; los hijos pueden aparecer en condiciones y listas.

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
