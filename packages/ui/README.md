# @meekojs/ui

Componentes visuales y estilos para [Meeko]: formularios, navegación, tablas, modales y temas, con HTML nativo y sin hojas que importar a mano. Es un paquete del mismo ecosistema, con versión propia, que se activa como módulo del framework.

**Documentación y ejemplos: [ui.meekojs.com](https://ui.meekojs.com).** Referencia completa de la API: [meekojs.com/docs/ui-api](https://meekojs.com/docs/ui-api).

## Instalación

Necesitas Node.js 24 o superior y `@meekojs/meeko` `>=1.8 <2`.

```sh
pnpm add @meekojs/ui
```

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/ui'],
	theme: true,
})
```

El módulo registra los componentes con el prefijo `UI` y su CSS, ya compilado: la aplicación no necesita Tailwind. `theme: true` activa los temas del framework y es opcional.

Para adaptarlo a tu marca, redefine los tokens `--ui-*` o usa `ui.tokens`. Para retocar un componente, `class` llega a su elemento raíz y la prop `ui` añade clases a cada parte: `<UICard bind:ui="{ title: 'pricing-title' }">`. Cualquier regla sin capa de tu CSS gana a la del componente. Consulta las [clases por slot](https://meekojs.com/docs/ui-api#clases-por-slot) y cómo [migrar desde las clases `.meeko-ui-*`](https://meekojs.com/docs/ui-api#migración-desde-las-clases-retiradas).

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
