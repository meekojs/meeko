# @meekojs/prettier-plugin

Plugin de Prettier para las secciones TypeScript, plantilla y CSS de los componentes `.meeko`. Formatea con el mismo resultado en la CLI, el editor y la CI, y puede ordenar las clases.

**Documentación: [meekojs.com/docs/editors](https://meekojs.com/docs/editors#el-paquete-meekojsprettier-plugin).**

## Instalación

Necesitas Prettier 3 y `@meekojs/meeko`.

```sh
pnpm add -D prettier @meekojs/prettier-plugin
```

## Ejemplo mínimo

```js
// prettier.config.mjs
export default {
	plugins: ['@meekojs/prettier-plugin'],
	meekoIndentSections: true,
}
```

```sh
pnpm exec prettier --check "app/**/*.meeko"
```

## Más información

El formateador deja una línea en blanco entre las secciones `script`, `template` y `style`.

Los comentarios de bloque quedan junto al elemento o sección que explican; la separación anterior se conserva y los saltos excesivos se reducen a una línea en blanco. `prettier-ignore` permanece junto al código protegido, cuyo contenido no se modifica. Las expresiones TypeScript de `bind:*`, `on:*` e interpolaciones se indentan según Prettier y el ancho configurado. El editor conserva sin cambios un documento incompleto que no puede formatearse; al completar su sintaxis vuelve a formatearlo.

`htmlWhitespaceSensitivity: 'ignore'` permite que Prettier reorganice los espacios y saltos de toda la plantilla, incluidos los bloques `snippet`, con etiquetas completas e indentación normal. Puede cambiar los espacios visibles entre elementos inline. Sin esa opción, Meeko conserva los límites de los nodos de texto y los espacios propios de `snippet`. El contenido literal de `pre` y `textarea` se conserva en ambos casos.

- [Orden de las clases](https://meekojs.com/docs/editors#orden-de-las-clases): `meekoSortClasses`, con los órdenes `stylesheet`, `tailwind` y `alphabetical`.
- [Cadenas en expresiones](https://meekojs.com/docs/editors#cadenas-en-expresiones): `meekoClassFunctions`, para `tv()`, `clsx()` o `cn()`.
- [Junto a `prettier-plugin-tailwindcss`](https://meekojs.com/docs/editors#junto-a-prettier-plugin-tailwindcss).
