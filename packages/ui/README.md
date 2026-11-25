# @meekojs/ui

Componentes visuales y estilos para [Meeko]: formularios, navegación, tablas, modales y temas, con HTML nativo y una sola entrada CSS que la aplicación compila con su Tailwind 4. Es un paquete del mismo ecosistema, con versión propia, que se activa como módulo del framework.

**Documentación y ejemplos: [ui.meekojs.com](https://ui.meekojs.com).** Referencia completa de la API: [meekojs.com/docs/ui-api](https://meekojs.com/docs/ui-api).

## Instalación

Necesitas Node.js 24 o superior y `@meekojs/meeko` `>=1.8 <2`.

```sh
pnpm add @meekojs/ui tailwindcss
```

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	theme: true,
})
```

El módulo registra los componentes con el prefijo `UI`, la base global y `@tailwindcss/vite`. La aplicación compila los estilos de UI con su Tailwind 4, en una sola pasada con sus propias clases: empieza `app/styles/main.css` con

```css
@import 'tailwindcss';
@import '@meekojs/ui';
```

y añade, si las usa, `@import '@meekojs/ui/hues';` para las combinaciones de tonos crudos. `theme: true` activa los temas del framework y es opcional.

`@import 'tailwindcss'` trae el preflight de Tailwind, que quita los márgenes, las viñetas de las listas y el tamaño de los encabezados. UI no lo necesita: para conservar el aspecto de una aplicación que no usaba Tailwind, importa sólo su tema y sus utilidades.

```css
@layer theme, base, components, utilities;
@import 'tailwindcss/theme.css' layer(theme);
@import 'tailwindcss/utilities.css' layer(utilities);
@import '@meekojs/ui';
```

Para adaptarlo a tu marca, redefine los tokens `--ui-*` o usa `ui.tokens`. Para retocar un componente, `class` llega a su elemento raíz y la prop `ui` añade clases a cada parte: `<UICard bind:ui="{ title: 'pricing-title' }">`. Se fusionan con Tailwind Merge, así que tu utilidad sustituye a la del componente que fija la misma propiedad, y cualquier regla sin capa de tu CSS gana a la del componente. Consulta las [clases por slot](https://meekojs.com/docs/ui-api#clases-por-slot) y cómo [migrar desde las clases `.meeko-ui-*`](https://meekojs.com/docs/ui-api#migración-desde-las-clases-retiradas).

## Ejemplo mínimo

```html
<script lang="ts">
	const name = signal('')
</script>

<template>
	<UIField
		id="user-name"
		label="Nombre"
	>
		<snippet
			name="default"
			params="id, describedBy"
		>
			<UIInput
				bind:id="id"
				bind:describedBy="describedBy"
				model="name"
			/>
		</snippet>
	</UIField>
	<UIButton on:click="() => console.log(name.value)">Guardar</UIButton>
</template>
```

## Más información

- [Instalación](https://ui.meekojs.com/installation) y [temas](https://ui.meekojs.com/theming)
- [Todos los componentes](https://ui.meekojs.com/components)
- [Guía de Meeko UI](https://meekojs.com/docs/ui)

[Meeko]: https://meekojs.com
