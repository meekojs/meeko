# Meeko

<p align="center">
  <img src="https://raw.githubusercontent.com/meekojs/meeko/main/assets/brand/meeko-logo.png" alt="Carita de Meeko, una gatita de ojos azules, orejas oscuras y pelaje crema" width="200" />
</p>

Este proyecto está dedicado a mi gatita Meeko. Su carita inspira el logo que lo acompaña.

**Meeko** es un motor de componentes para TypeScript y un framework full-stack. Los archivos `.meeko` combinan lógica tipada, plantilla y estilos. El compilador produce HTML para SSR y, durante la hidratación, conecta la reactividad al HTML existente.

**Documentación: [meekojs.com/docs/inicio-rapido](https://meekojs.com/docs/inicio-rapido).**

## Instalación

Necesitas Node.js 24 o superior. El paquete incluye TypeScript 7 y la CLI `meeko`.

```sh
pnpm add @meekojs/meeko
pnpm exec meeko init-framework my-app
cd my-app
npm install
npm run dev
```

Abre `http://localhost:4173`. Las aplicaciones construidas se ejecutan en Node 24, Bun, Deno o Cloudflare Workers.

## Ejemplo mínimo

Cada archivo de `app/pages` es una ruta. Sustituye `app/pages/index.meeko` por este componente: el servidor renderiza el HTML y el navegador lo hidrata sin volver a crearlo.

```html
<script lang="ts">
	const count = signal(0)
</script>

<template>
	<button
		type="button"
		on:click="() => count.value++"
	>
		Pulsado {count.value} veces
	</button>
</template>
```

`npm run check` comprueba los tipos y `npm run build` genera la versión de producción.

## Más información

- [Primera aplicación](https://meekojs.com/docs/primeros-pasos)
- [Framework full-stack](https://meekojs.com/docs/framework)
- [Componentes y API](https://meekojs.com/docs/api)
- [Política de estabilidad](https://meekojs.com/docs/stability)
- [Historial de cambios](https://meekojs.com/docs/changelog)

Se distribuye bajo la [licencia MIT](https://github.com/meekojs/meeko/blob/main/LICENSE). El código está en [GitHub](https://github.com/meekojs/meeko).
