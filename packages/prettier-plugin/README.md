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

- [Orden de las clases](https://meekojs.com/docs/editors#orden-de-las-clases): `meekoSortClasses`, con los órdenes `stylesheet`, `tailwind` y `alphabetical`.
- [Cadenas en expresiones](https://meekojs.com/docs/editors#cadenas-en-expresiones): `meekoClassFunctions`, para `tv()`, `clsx()` o `cn()`.
- [Junto a `prettier-plugin-tailwindcss`](https://meekojs.com/docs/editors#junto-a-prettier-plugin-tailwindcss).
