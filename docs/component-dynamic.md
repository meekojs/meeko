# Componentes y etiquetas dinámicos

## Etiquetas de componente (`<AppButton />`)

Desde `1.1`, una etiqueta cuyo nombre empieza por mayúscula es un componente: `<AppButton bind:label="'Guardar'" />` equivale a `<component is="AppButton" bind:label="'Guardar'"></component>`. El nombre es un identificador del script, ya sea un import (`import * as AppButton from "./AppButton.meeko"`) o un autoimport de `app/components`. Admite las mismas props `bind:` y estáticas, eventos `on:`, modelos `model:` y `ref:` que `<component>`, se comprueba igual en CLI y VS Code y puede ir dentro de `if:when` y `each:of`.

- Puede cerrarse sola (`<AppButton />`) o con su etiqueta de cierre (`<AppButton></AppButton>`). Los nodos que siguen a una etiqueta autocerrada son sus hermanos, no su contenido.
- Su contenido son snippets del hijo (véase [Snippets](component-events.md#snippets-con-definesnippets)). Pasar contenido a un componente sin `defineSnippets` es un error de tipos. `MEEK049`, que rechazaba cualquier contenido, ya no se emite.
- Un cierre `</AppButton>` sin apertura da `MEEK008`, y una etiqueta de componente fuera de `<template>`, `<script>` y `<style>` da `MEEK002`.
- Los nombres en mayúscula no se confunden con elementos HTML: `<Table>`, `<Input>` o `<Title>` son componentes.
- Desde `1.2`, una prop opcional del hijo (`error?: string`) acepta también `undefined` en la etiqueta, como `bind:error="failed.value ? 'Obligatorio' : undefined"`, aunque el proyecto use `exactOptionalPropertyTypes`: para Meeko pasar `undefined` equivale a no pasar la prop, y si la prop tiene default en `defineProps` el hijo recibe el default. Las props obligatorias siguen rechazando `undefined` y una prop desconocida sigue siendo un error.

Use `<component is="expression">` cuando el componente se elige con una expresión, como `props.outlet` o `props.content`; para un componente fijo, la etiqueta es más corta. El editor completa los nombres tras `<` y lleva de la etiqueta al archivo `.meeko`.

## Etiquetas HTML en `<component is>`

Desde `1.5`, `is` también acepta una etiqueta HTML: un literal de texto (`'a'`), una expresión cuyo tipo sea una unión de etiquetas (`props.href ? 'a' : 'button'`, o una prop `as: "section" | "article"`), un componente o una unión de etiquetas y componentes. Con una etiqueta, `<component is>` es ese elemento, con sus atributos, eventos `on:`, `ref:`, `html` y `bind="obj"`, y con su **contenido**: hijos, `if:when`, `each:of`, `<render>` y componentes. Con un componente, el contenido son sus snippets, como en una etiqueta de componente.

Un botón que es un enlace cuando recibe `href`, con una sola plantilla:

```html
<!-- Button.meeko -->
<script lang="ts">
	import { computed } from '@meekojs/meeko'
	const props = defineProps<{ href?: string; target?: string; type?: 'button' | 'submit' | 'reset'; disabled?: boolean; loading?: boolean }>()
	const emit = defineEmits<{ click: [event: MouseEvent] }>()
	const snippets = defineSnippets<{ default?: []; leading?: []; trailing?: [] }>()
	const inactive = computed(() => Boolean(props.disabled || props.loading))
	const rel = computed(() => (props.target === '_blank' ? 'noopener noreferrer' : undefined))
	const state = computed(() => ({ 'data-loading': props.loading ? '' : undefined, 'aria-disabled': inactive.value ? 'true' : undefined }))
	function onClick(event: MouseEvent): void {
		if (inactive.value) {
			event.preventDefault()
			return
		}
		emit('click', event)
	}
</script>
<template>
	<component
		is="props.href ? 'a' : 'button'"
		class="button"
		bind="state.value"
		on:click="onClick"
		bind:href="inactive.value ? undefined : props.href"
		bind:target="props.target"
		bind:rel="rel.value"
		bind:type="props.type"
		bind:disabled="props.disabled"
	>
		<span
			if:when="props.loading"
			class="button__spinner"
			aria-hidden="true"
		></span>
		<span class="button__label">
			<render snippet="snippets.leading" />
			<render snippet="snippets.default" />
			<render snippet="snippets.trailing" />
		</span>
	</component>
</template>
```

Sin `href` renderiza `<button class="button" type="button" data-meeko="0">…</button>`; con `href`, `<a class="button" href="/docs" target="_blank" rel="noopener noreferrer" data-meeko="0">…</a>`. `type` y `disabled` no se escriben en `<a>`, ni `href`, `target` y `rel` en `<button>` (véase [Atributos según la etiqueta](component-attributes.md#atributos-según-la-etiqueta)).

- **Tipos.** Meeko deduce la unión de etiquetas del tipo de `is`. `event.currentTarget` de un `on:` es la unión de sus elementos (`HTMLAnchorElement | HTMLButtonElement`, con los eventos tipados por elemento de `1.2`) y `useElementRef` de un `ref:` también. Un valor de `is` que no es una etiqueta permitida ni un componente es un error de tipos (`MEEK112`), igual que un `string` cualquiera: tipe la etiqueta como una unión de literales o use el tipo `TagName`. Una etiqueta sin contenido (`img`, `input`, `hr`…) con contenido da `MEEK031`.
- **Etiquetas permitidas.** Las de los datos HTML de Meeko (los de MDN que usa el editor), salvo `script`, `style`, `iframe`, `object`, `embed`, `template`, `slot`, `textarea`, `title`, `base`, `link`, `meta`, `head`, `html`, `body`, `noscript`, `param` y `fencedframe`. El tipo público `TagName` es esa unión. Un literal no permitido es el error de compilación `MEEK112`; un valor no permitido que llega en ejecución (con `as any`, por ejemplo) lanza `TypeError` con `MEEK112` en SSR y en el navegador antes de escribir HTML: el nombre de la etiqueta nunca inyecta marcado. Los elementos personalizados (`x-card`) y las etiquetas SVG no se admiten como valor de `is`; dentro de `<svg>`, `is` sólo admite componentes.
- **SSR e hidratación.** Meeko lee los resultados de `is` de su sintaxis (las ramas de `?:`, sin `as` ni paréntesis). Si todos son literales, el SSR escribe el elemento tal cual, sin marcadores. Si todos son identificadores en PascalCase o imports de un `.meeko` (`is="open ? Dialog : Sheet"`), es un componente, como antes de `1.5` (una constante con una etiqueta debe tener un nombre en minúscula). Desde `1.8`, un literal en PascalCase (`'MeekoLink'`, `'UICard'`) nombra un componente que el compilador resuelve (véase [Nombres de componente en `is`](#nombres-de-componente-en-is)). En los demás casos (`props.as`, `view()`) el tipo decide en ejecución: el elemento va entre los comentarios de rango del componente y su contenido, en un rango de snippet.
- **Cambio de etiqueta.** Si la etiqueta cambia en el navegador, un elemento nuevo sustituye al anterior: los hijos se **mueven** a él con sus nodos, así que conservan su estado reactivo, el de sus componentes, el valor de sus controles y el foco; si el foco estaba en el elemento, pasa al nuevo. Los atributos, eventos, `ref:`, `html` y `bind` del elemento se vuelven a enlazar en el nuevo. Al pasar de una etiqueta a un componente, o al revés, el rango se vacía y el contenido se monta de nuevo.
- **Etiqueta o componente.** Con una unión de los dos, cada atributo se comprueba contra lo que lo admite: `aria-label`, `html` o `data-*` sólo valen si `is` es una etiqueta, y `model`, `model:x` o `<snippet name>` sólo si es un componente (`MEEK112` en `meeko check` y el editor cuando el tipo de `is` admite el otro tipo).
- **`'MeekoLink'` en `is`.** `<MeekoLink>` es una etiqueta del compilador, no un valor: `is="internal ? MeekoLink : 'a'"` sigue siendo `TS2304: Cannot find name 'MeekoLink'`. Desde `1.8` se escribe como literal, `is="internal ? 'MeekoLink' : 'a'"`, igual que un componente del proyecto (véase [Nombres de componente en `is`](#nombres-de-componente-en-is)).
- **Límites.** El contenido debe ser válido dentro de cada etiqueta posible (un `<div>` dentro de `<p>` lo saca el navegador y la hidratación no coincide), y `<component is>` dentro de `<table>` sigue las reglas de ese contenedor. `model` en un `<component is>` cuyos resultados son etiquetas da `MEEK112`: use un control de formulario.

## Nombres de componente en `is`

Desde `1.8`, un literal de texto en **PascalCase** dentro de `is` nombra un componente que se conoce al compilar: `'MeekoLink'`, un componente importado de un `.meeko` o uno autoimportado, como los de `app/components` o los `UI*` de `@meekojs/ui`. Se combina con etiquetas HTML en las ramas de `?:`, así que un botón que es ruta, enlace externo o `<button>` cabe en una sola plantilla:

```html
<component
	is="to !== undefined ? 'MeekoLink' : href !== undefined ? 'a' : 'button'"
	bind:to="to"
	bind:params="params"
	bind:href="href"
	bind:type="type"
	class="button"
>
	Abrir
</component>
```

- **Mayúscula o minúscula.** Las etiquetas HTML se escriben en minúscula y los componentes en PascalCase: `'button'` es el elemento y `'Button'`, un componente del proyecto llamado `Button`. Un literal en PascalCase que no es `'MeekoLink'` ni un componente importado, autoimportado o declarado en el script es `MEEK132` sobre el literal. `'MeekoOutlet'` y `'MeekoTeleport'` no se admiten.
- **Resolución estática.** El compilador importa cada nombre como su etiqueta (`<MeekoLink>`, `<UICard>`), sin `import()` ni promesas, así que funciona igual en SSR, hidratación y navegación. Cada nombre es una región `if:when` cuya condición es el camino de `?:` hasta su literal (`to !== undefined` para `'MeekoLink'`), y las etiquetas HTML forman otra, un elemento cuya etiqueta cambia. Al pasar de una rama a otra, la anterior se libera y la nueva se monta, como con `if:when`; entre `'a'` y `'button'` el elemento se sustituye y los hijos se mueven, como siempre.
- **Atributos por rama.** Cada atributo va sólo a las ramas que lo admiten: `to`, `params`, `search` y `match` a `'MeekoLink'`, que construye su `href` tipado y su `aria-current` como la etiqueta, junto con los demás atributos de su `<a>` salvo `href`; cada atributo HTML a las etiquetas que lo aceptan, como `href` en `<a>` y `type` o `disabled` en `<button>` (véase [Atributos según la etiqueta](component-attributes.md#atributos-según-la-etiqueta)); y las props, eventos, modelos y `bind="obj"` a los componentes. Un componente recibe todas las props de la etiqueta y sólo lee las que declara. Los bloques `<snippet name>` son de los componentes; los elementos pintan el contenido suelto.
- **Tipos.** `meeko check` y el editor comprueban cada rama tras su condición, que la estrecha: dentro de `'MeekoLink'`, `to` es una ruta y sus `params` los de esa ruta. Cada componente se comprueba con sus props (una prop suya con un valor de otro tipo es un error), pero una prop que no declara no es una propiedad sobrante, porque puede ser de otra rama. Un atributo que no admite **ninguna** rama, ni las etiquetas ni las props de los componentes, es `MEEK112` (`colour no se aplica a ninguna rama de is`). El editor completa los nombres dentro de `is` y muestra el componente o `<MeekoLink>` en el hover del literal.
- **Límites.** Con nombres, todos los resultados de `is` son literales: un valor (`x ? 'MeekoLink' : props.as`) es `MEEK132`. `ref:` sólo vale con un único nombre (`MEEK052`); con varias ramas, cada una es un elemento o componente distinto. Las condiciones de `?:` se evalúan en cada rama que las recorre, así que deben ser expresiones sin efectos.
- **Nombres en ejecución.** Un nombre que llega en ejecución (de una URL, de la base de datos) no se resuelve al compilar: cárguelo con [`resolveComponent(name)`](reference/components/componentregistry.md), que devuelve una promesa con el módulo, y pase el módulo a `is`. Use el literal en `is` cuando el nombre se conoce al escribir la plantilla, y `resolveComponent` cuando se elige en ejecución o el componente debe cargarse en diferido.

## Un botón que es ruta, enlace o botón

Un solo componente que pinta `<MeekoLink>` si recibe `to`, un `<a>` si recibe `href` y un `<button>` si no recibe ninguno, cada uno con sus props y con los atributos HTML que le pase el padre. Desde `1.8` cabe en una sola plantilla con `'MeekoLink'` en `is` (véase [Nombres de componente en `is`](#nombres-de-componente-en-is)). Este es el patrón verificado con `meeko check`, SSR, hidratación y navegación del cliente:

```html
<!-- app/components/AppButton.meeko -->
<script lang="ts">
import { computed } from '@meekojs/meeko'
import type { ElementAttributes } from '@meekojs/meeko'

/** Los params de la ruta K: `{ id: string }` en `/users/[id]`, `{}` en una ruta estática. */
type RouteParamsOf<K extends RouteId> = NonNullable<MeekoLinkProps<K>['params']>
/** Una ruta con sus params correlacionados: obligatorios si la ruta los tiene, prohibidos si no. */
type LinkTarget = {
	[K in RouteId]: { to: K; search?: MeekoLinkProps['search'] } & (keyof RouteParamsOf<K> extends never ? { params?: never } : { params: RouteParamsOf<K> })
}[RouteId]
type LinkProps = LinkTarget & { href?: never; target?: never; rel?: never; download?: never; type?: never; disabled?: never }
type AnchorProps = {
	href: string
	target?: '_self' | '_blank' | '_parent' | '_top'
	rel?: string
	download?: string | boolean
	to?: never
	params?: never
	search?: never
	type?: never
	disabled?: never
}
type ButtonProps = {
	type?: 'button' | 'submit' | 'reset'
	disabled?: boolean
	to?: never
	params?: never
	search?: never
	href?: never
	target?: never
	rel?: never
	download?: never
}
/** Atributos que se reenvían tal cual, comunes a `<a>` y `<button>`: `id`, `title`, `aria-*`, `data-*`… */
type SharedAttributes = Pick<ElementAttributes<'a'>, keyof ElementAttributes<'a'> & keyof ElementAttributes<'button'>>
type ForwardedAttributes = Omit<SharedAttributes, 'class' | 'type'>

const props = defineProps<(LinkProps | AnchorProps | ButtonProps) & ForwardedAttributes & { label?: string; class?: string }>()
const emit = defineEmits<{ click: [event: MouseEvent] }>()
const snippets = defineSnippets<{ default?: [] }>()

const linkRel = computed(() => props.rel ?? (props.target === '_blank' ? 'noopener noreferrer' : undefined))
/** Las props propias van a su rama; el resto (`id`, `title`, `aria-*`, `data-*`…) se reenvía con `bind`. */
const attributes = computed((): ForwardedAttributes => {
	const { to, params, search, href, target, rel, download, type, disabled, label, class: className, ...rest } = props
	return rest
})
</script>
<template>
	<component
		is="props.to !== undefined ? 'MeekoLink' : props.href !== undefined ? 'a' : 'button'"
		bind:to="props.to"
		bind:params="props.params"
		bind:search="props.search"
		bind:class="props.class"
		bind="attributes.value"
		bind:href="props.href"
		bind:target="props.target"
		bind:rel="linkRel.value"
		bind:download="props.download"
		bind:type="props.type ?? 'button'"
		bind:disabled="props.disabled"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{props.label ?? ''}
	</component>
</template>
```

`to`, `params` y `search` sólo llegan a la rama de `'MeekoLink'`; `href`, `target`, `rel` y `download`, al `<a>` de la segunda rama (y `target`, `rel` y `download` también al de `<MeekoLink>`, que construye su `href`); `type` y `disabled`, sólo al `<button>`. Antes de `1.8`, o si prefiere ramas explícitas, la misma plantilla se escribe con dos `if:when`, que también estrechan `props`:

```html
<template>
	<MeekoLink
		if:when="props.to !== undefined"
		bind:to="props.to"
		bind:params="props.params"
		bind:search="props.search"
		bind:class="props.class"
		bind="attributes.value"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{props.label ?? ''}
	</MeekoLink>
	<component
		if:when="props.to === undefined"
		is="props.href !== undefined ? 'a' : 'button'"
		bind:class="props.class"
		bind="attributes.value"
		bind:href="props.href"
		bind:target="props.target"
		bind:rel="linkRel.value"
		bind:download="props.download"
		bind:type="props.type ?? 'button'"
		bind:disabled="props.disabled"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{props.label ?? ''}
	</component>
</template>
```

El padre lo usa con las props de cada rama; `aria-*`, `data-*`, `id` y `title` llegan al elemento:

```html
<AppButton to="/about" label="Acerca" />
<AppButton to="/users/[id]" bind:params="{ id: user.id }" bind:search="{ tab: 'actividad' }" aria-label="Perfil">Perfil</AppButton>
<AppButton href="https://example.com" target="_blank" label="Documentación" />
<AppButton href="/informe.pdf" download="informe.pdf" label="Descargar" />
<AppButton type="submit" bind:aria-busy="saving.value" label="Guardar" />
<AppButton bind:disabled="!valid.value" on:click="reset" data-testid="reset">Reiniciar</AppButton>
```

Con `id: "7"`, el SSR escribe, en este orden, un `<a>` con `href="/about"`; otro con `aria-label="Perfil"` y `href="/users/7?tab=actividad"`; un `<a>` con `target="_blank"` y `rel="noopener noreferrer"`; uno con `download="informe.pdf"`; un `<button type="submit">` y un `<button>` con `data-testid="reset"`, `type="button"` y `disabled`. La hidratación conserva esos elementos, `on:click` llega al padre por `emit` y los atributos reenviados se actualizan cuando cambian.

- **Tres ramas que se excluyen.** Cada rama declara como `never` las props de las otras, así que `to` con `href`, `to` o `href` con `type` o `disabled`, y `type` con `target` son errores de tipos en el padre (`TS2345` o `TS2322`). Sin `to` ni `href` es un botón, con `type="button"` por defecto.
- **Rutas con sus parámetros.** `MeekoLinkProps['params']` no relaciona los parámetros con la ruta: con `to: RouteId` y `params?: MeekoLinkProps['params']`, el padre podría olvidar `params` de `/users/[id]`. `LinkTarget` recorre `RouteId` y crea una variante por ruta, así que `meeko check` exige `params` en `/users/[id]` (`TS2345`), rechaza una clave que no existe (`TS2353`) y prohíbe `params` en una ruta estática. Una ruta que no existe es `TS2322` en `to`.
- **`<MeekoLink>` con una unión de rutas.** Dentro del componente, `bind:to="props.to"` es una unión de rutas y `bind:params="props.params"` una unión de parámetros que TypeScript no puede relacionar en esa expresión. Desde `1.8`, `<MeekoLink>` acepta entonces unos `params` de alguna de las rutas, o ninguno, y un `search` opcional; antes daba `TS2412`. Quien correlaciona la ruta y sus parámetros es el tipo de las props, que el padre sí comprueba.
- **Una plantilla o dos ramas.** Con `'MeekoLink'` en `is`, cada rama se comprueba tras la condición de `?:` que lleva a ella, igual que `if:when` estrecha `props` en cada rama (véase [Condiciones con `if:when` y tipos](component-template.md#condiciones-con-ifwhen-y-tipos)): `props.to` es una ruta dentro de `'MeekoLink'`. `<component is>` sólo escribe `href`, `target`, `rel` y `download` en `<a>` y `type` y `disabled` en `<button>` (véase [Atributos según la etiqueta](component-attributes.md#atributos-según-la-etiqueta)). Las dos formas pintan los mismos elementos y `meeko check` comprueba las mismas reglas en el padre.
- **Atributos del padre.** Desde `1.8`, `aria-*` y `data-*` (estáticos o con `bind:`) pasan a un componente como props con ese nombre, igual que `id` o `title`; el componente las declara, aquí con `ElementAttributes`, y una que no declara es `TS2353` en el atributo (véase [Props estáticas](component-attributes.md#props-estáticas)). `ForwardedAttributes` son los atributos comunes a `<a>` y `<button>`: `bind` en `<MeekoLink>` se comprueba contra los de `<a>` (`MEEK113`), así que un atributo propio de `<button>` como `autocomplete` no vale en las tres ramas.
- **El resto, con `bind`.** Las props propias se separan con una desestructuración dentro de un `computed`, que sigue a las props, y el resto va a `bind`. Desde `1.8`, `props` no incluye entre sus claves los manejadores de `defineEmits` (`onClick`), así que el resto no los arrastra; antes, `bind` lanzaba `MEEK113` con la clave `onClick` (véase [Eventos de componente](component-events.md#eventos-de-componente-defineemits-y-on)).
- **`rel` por defecto.** `linkRel` pone `noopener noreferrer` a un `target="_blank"` sin `rel`; un `rel` explícito gana.
- **Texto opcional.** `{props.label ?? ''}`: `{expresión}` escribe el texto de su valor, también `undefined`.

Con las props desestructuradas (desde `1.8`), el script y la plantilla del mismo componente son más cortos; los tipos no cambian y `meeko check` comprueba las mismas reglas en el padre:

```html
<script lang="ts">
// …los mismos imports y tipos…
const { to, params, search, href, target, rel, download, type = 'button', disabled = false, label = '', class: className, ...rest } = defineProps<(LinkProps | AnchorProps | ButtonProps) & ForwardedAttributes & { label?: string; class?: string }>()
const emit = defineEmits<{ click: [event: MouseEvent] }>()
const snippets = defineSnippets<{ default?: [] }>()

const linkRel = computed(() => rel ?? (target === '_blank' ? 'noopener noreferrer' : undefined))
</script>
<template>
	<MeekoLink
		if:when="to !== undefined"
		bind:to="to"
		bind:params="params"
		bind:search="search"
		bind:class="className"
		bind="rest"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{label}
	</MeekoLink>
	<component
		if:when="to === undefined"
		is="href !== undefined ? 'a' : 'button'"
		bind:class="className"
		bind="rest"
		bind:href="href"
		bind:target="target"
		bind:rel="linkRel.value"
		bind:download="download"
		bind:type="type"
		bind:disabled="disabled"
		on:click="(event) => emit('click', event)"
	>
		<render snippet="snippets.default" />{label}
	</component>
</template>
```

`rest` sustituye al `computed` de `attributes`, `if:when="to !== undefined"` estrecha `params` igual que `props.to`, y los defaults del patrón (`type = 'button'`) siguen siendo exclusivos de su rama: `to` con `type` sigue siendo un error en el padre. Véase [Desestructurar las props](component-basics.md#desestructurar-las-props).
