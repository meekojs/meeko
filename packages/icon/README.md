# Meeko Icon

Iconos de [Iconify](https://iconify.design) y SVG propios para Meeko, con `<UIIcon>`: tipados, resueltos al compilar e incrustados en el HTML. Sin peticiones en tiempo de ejecución, sin CDN y compatibles con una Content Security Policy estricta.

**Guía con ejemplos: [ui.meekojs.com/icons](https://ui.meekojs.com/icons).**

## Instalación

Necesitas `@meekojs/meeko` `>=1.8 <2`. Cada colección es un paquete `@iconify-json/<colección>` del proyecto.

```sh
pnpm add @meekojs/icon
pnpm add -D @iconify-json/lucide
```

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/icon'],
	icon: {
		collections: ['lucide'],
	},
})
```

## Ejemplo mínimo

```html
<template>
	<UIIcon name="lucide:search" />
	<UIIcon
		name="lucide:trash-2"
		label="Eliminar"
	/>
</template>
```

Sin `label`, el icono es decorativo. Un nombre que no existe es un error de tipos en `meeko check`, `meeko build` y el editor.

## Más información

- [Colecciones y opciones](https://ui.meekojs.com/icons#setup)
- [Nombres dinámicos](https://ui.meekojs.com/icons#dynamic)
- [SVG propios](https://ui.meekojs.com/icons#local)
- [API](https://ui.meekojs.com/icons#api)
