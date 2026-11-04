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

El módulo registra los componentes con el prefijo `UI` y su CSS. `theme: true` activa los temas del framework y es opcional.

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
