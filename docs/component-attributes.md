# Atributos y props estáticas

## Atributos según la etiqueta

En un `<component is>` con etiquetas, Meeko escribe cada atributo sólo mientras la etiqueta del momento lo admite según sus datos HTML, sin ternarios: `bind:href`, `target` y `rel` sólo en `<a>`, `bind:type` y `disabled` sólo en `<button>`. Los atributos globales (`class`, `id`, `style`, `title`, `hidden`, `tabindex`, `role`, `lang`, `dir`, `aria-*`, `data-*`…) y los eventos `on:` se escriben siempre; `aria-disabled` es global, así que vale para un enlace desactivado. `type` no cuenta como atributo de `<a>` ni de `<area>`, donde sólo es una sugerencia de tipo MIME. En los elementos normales nada cambia.

`meeko check` y el editor dan el error `MEEK112` en un atributo que no admite **ninguna** de las etiquetas posibles (`bind:colspan` en `'a' | 'button'`): Meeko no lo escribiría nunca. Desde `1.8`, con nombres de componente en `is`, la regla vale para todas las ramas: `'MeekoLink'` es un `<a>` sin `href`, y un componente admite sus props (véase [Nombres de componente en `is`](component-dynamic.md#nombres-de-componente-en-is)). Cuando `is` escribe sus etiquetas como literales, el editor completa sus atributos e indica en cuáles se aplica cada uno, y el hover de `component` muestra los elementos posibles.

## Valores de los atributos

Desde `1.8`, Meeko conoce los valores que el estándar HTML admite en cada atributo, a partir de sus datos HTML (generados del WHATWG, WAI-ARIA y `@mdn/browser-compat-data`): `type` de `<button>` es `"submit" | "reset" | "button"`, `hidden` es `"" | "hidden" | "until-found"`, `closedby` de `<dialog>` es `"any" | "closerequest" | "none"` y `aria-pressed` es `"true" | "false" | "mixed" | "undefined"`.

- **Tipos.** `AttributeValues<Tag, Name>` es la unión de esos valores (`never` en un atributo de texto libre, de sugerencias o de lista de palabras, como `href`, `rel` o `class`). `AttributeValueOf<Tag, Name>` es esa unión más cualquier valor de atributo (`string`, `number`, `boolean`, `null`, `undefined`), así que el editor sugiere los valores sin rechazar los demás; es el tipo de cada clave de `ElementAttributes<Tag>`, que conserva sus claves.
- **Aviso `MEEK122`.** `meeko check`, `meeko build` y el editor avisan cuando el valor es un literal de texto que no está entre los del estándar, comparado sin distinguir mayúsculas como en HTML: `<button type="sumbit">`, `bind:type="'sumbit'"` o una expresión cuyo tipo es una unión de literales sin ninguno válido. Un valor de tipo `string`, un número, un booleano o un atributo sin valores cerrados nunca avisan. Vale en los elementos HTML y en `<component is>` con etiquetas, con los valores de cualquiera de ellas; no en los elementos personalizados ni en SVG. Es un aviso: no hace fallar `meeko check` ni cambia el código generado. En `2.0` será un error (véase [APIs deprecadas](stability.md#apis-deprecadas)).
- **`hidden`.** Ya no es sólo booleano: `hidden="until-found"` y `bind:hidden="'until-found'"` escriben `hidden="until-found"`, que oculta el contenido hasta que la búsqueda de la página lo encuentra. `bind:hidden` con `true` escribe `hidden=""` y con `false`, `null`, `undefined`, `0` o `""` lo quita, como antes; sólo un texto no vacío cambia: antes se escribía `hidden=""`.
- **Booleanos.** Los atributos booleanos del estándar (`disabled`, `open`, `inert`, `itemscope`…) se escriben vacíos con un valor verdadero y se quitan con uno falso, en SSR y en el navegador. Desde `1.8` la lista sale de los mismos datos HTML; los nuevos respecto a `1.7` son `alpha`, `headingreset`, `itemscope`, `scoped`, `seamless`, `typemustmatch` y los `shadowroot*` de `<template>`: con `bind:` y un texto, ahora escriben el atributo vacío en vez del texto.

```html
<script lang="ts">
	import type { AttributeValues } from '@meekojs/meeko'
	const props = defineProps<{ kind?: AttributeValues<'button', 'type'> }>()
</script>
<template>
	<button bind:type="props.kind ?? 'button'">Enviar</button>
	<details hidden="until-found">…</details>
</template>
```

## `class` y `style` junto a `bind:class` y `bind:style`

Desde `1.8`, un elemento puede llevar a la vez el `class` estático y `bind:class`, o `style` y `bind:style`, y Meeko escribe un único atributo con los dos, igual en SSR, al hidratar y al actualizar. Las clases dinámicas van tras las estáticas, y las declaraciones dinámicas de `style` tras las estáticas, así que ganan. Si el valor dinámico es `undefined`, `null`, `false` o una cadena vacía, queda el texto estático tal cual. Vale también en un `<component is>` que sólo puede ser una etiqueta; en un componente, `class` y `bind:class` pasan la misma prop (`MEEK090`).

```html
<article
	class="card"
	bind:class="open.value ? 'is-open' : undefined"
>
	...
</article>
```

Antes de `1.8`, el SSR escribía `class` dos veces (`class="card" class="is-open"`): el navegador se quedaba con el primero y la hidratación fallaba con un desajuste.

## Atributos en bloque con `bind`

Desde `1.5`, `bind="obj"` escribe las claves de un objeto como atributos de un elemento, de `<component is>` o, en una etiqueta de componente, como sus props:

```html
<script lang="ts">
	import { computed } from '@meekojs/meeko'
	import type { ElementAttributes } from '@meekojs/meeko'
	const props = defineProps<{ busy: boolean; id: string }>()
	const attrs = computed((): ElementAttributes<'section'> => ({ id: props.id, 'aria-busy': props.busy, hidden: false }))
</script>
<template>
	<section
		class="panel"
		bind="attrs.value"
	>
		...
	</section>
</template>
```

- **Tipos.** El objeto se comprueba contra los atributos de la etiqueta (o de alguna de las de `<component is>`), o contra las props del componente: una clave que no lo es da `MEEK113`. Si `is` puede ser las dos cosas, vale una clave que admita cualquiera de ellas. `ElementAttributes<Tag>` tipa el objeto. En un elemento personalizado (`<x-card bind="...">`), `bind` sigue siendo un atributo HTML, como `html` y `model`.
- **Una lista con un componente por fila.** Si `is` y `bind` leen el mismo objeto (`is="option.component" bind="option.props"`), cada entrada se comprueba contra su propio componente, y unas props equivocadas dan `MEEK113` en `bind`. Con otras expresiones, TypeScript no puede relacionarlos y el objeto debe valer para todos los componentes posibles. Véase [la lista de `<component is>`](reference/components/component-tag.md#una-lista-con-un-componente-por-fila).
- **Valores.** Las claves con `undefined`, `null` o `false` no se escriben, igual que con `bind:x`; `true` escribe el atributo vacío. En un componente, una clave `undefined` es una prop ausente.
- **Orden.** Un `bind:x` explícito o un atributo estático gana sobre la misma clave del objeto. `class` y `style` se **combinan** en cualquier orden, también `class`, `bind:class` y `bind` a la vez: las clases explícitas y las del objeto se juntan, y las declaraciones de `style` del objeto van antes de las explícitas, que ganan. En un componente no se combinan: la prop explícita gana.
- **El mismo atributo como texto y con `bind:`.** Salvo `class` y `style`, `id="a" bind:id="b"` da el aviso `MEEK133`: sólo vale `bind:id`, en cualquier orden, y el texto se ignora. Deja uno de los dos.
- **Sin manejadores.** Una clave que empieza por `on` es un error de tipos (`MEEK113`) y, en ejecución, un `TypeError`: los manejadores de eventos no se crean desde datos; use `on:evento`. Tampoco se admiten las claves `data-meeko*`, reservadas a Meeko. Como en HTML, los nombres se comparan sin distinguir mayúsculas: `Data-Meeko` también se rechaza, y una clave `ID` junto a `bind:id` no escribe un segundo `id`.
- **Reactivo.** Si el objeto cambia, Meeko escribe los atributos nuevos y quita los que ya no tiene; un componente recibe las props nuevas en su sitio. `bind=""` o `bind` sin valor da `MEEK113`, igual que en `<template>`.

## Props estáticas

Desde `1.1`, un atributo sin prefijo en una etiqueta de componente o en `<component is>` pasa una prop estática, como en un elemento HTML:

```html
<AppButton
	variant="primary"
	disabled
	bind:label="title.value"
/>
```

- **Valor.** El texto del atributo llega como un literal de texto (`"primary"`, con su tipo literal) y un atributo sin valor llega como `true`. Ambos se comprueban con tipos contra las props del hijo, igual que `bind:`: `variant="tertiary"` frente a `variant: "primary" | "secondary"` es un error en el atributo.
- **Nombres reservados.** `is`, `ref` y `html` no son props estáticas, ni `bind`, que desde `1.5` pasa props en bloque (véase [Atributos en bloque con `bind`](#atributos-en-bloque-con-bind)), y tampoco los nombres con guiones distintos de `aria-*` y `data-*` (`x-label`) ni los que llevan `:` sin ser una directiva (`bind:`, `on:`, `model:`, `ref:`, `if:when`, `each:*`): todos dan `MEEK032`. Para pasar una prop llamada `ref` use `bind:ref`.
- **`aria-*` y `data-*`.** Desde `1.8`, `aria-label="Cerrar"`, `data-state="open"` y sus formas `bind:aria-busy="saving.value"` y `bind:data-count="n"` pasan una prop con ese nombre, en etiquetas de componente y en `<component is>` con un componente; antes daban `MEEK032`. El hijo las declara como cualquier prop, por ejemplo con `defineProps<Props & ElementAttributes<'button'>>()`, y las escribe en su elemento con `bind` (véase [Un botón que es ruta, enlace o botón](component-dynamic.md#un-botón-que-es-ruta-enlace-o-botón)); si no las declara, `meeko check` da `TS2353` en el atributo. Se escriben en minúsculas, como en HTML (`Aria-Label` da `MEEK032`), y `data-meeko*` está reservado. En un `<component is>` que puede ser etiqueta o componente siguen siendo atributos de la etiqueta (véase [Etiquetas HTML en `<component is>`](component-dynamic.md#etiquetas-html-en-component-is)).
- **Conflictos.** La misma prop como texto estático y con `bind:` u `on:` (`variant="primary" bind:variant="x"`) da `MEEK090`. `on:save` junto a `bind:onSave` sigue siendo `MEEK048`.
