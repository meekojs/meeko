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

- [Orden de las clases](https://meekojs.com/docs/editors#orden-de-las-clases): `meekoSortClasses`, con los órdenes `off` (por defecto), `stylesheet` y `alphabetical`.
- [Cadenas en expresiones](https://meekojs.com/docs/editors#cadenas-en-expresiones): `meekoClassFunctions`, para `tv()`, `clsx()` o `cn()`.
- [Junto a `prettier-plugin-tailwindcss`](https://meekojs.com/docs/editors#junto-a-prettier-plugin-tailwindcss).

## Clases de Tailwind CSS

El plugin no incluye ni carga Tailwind CSS. Para ordenar las clases de Tailwind en `.meeko`, usa `meekoSortClasses: 'stylesheet'`: ordena según la hoja global del proyecto. Si existe `.meeko/styles/main.css`, la que `meeko dev` escribe con todo el pipeline de Vite y sus plugins, usa esa: contiene las utilidades de Tailwind aunque se registre como `@tailwindcss/vite` (lo que hace `@meekojs/ui`), en el orden en que Tailwind las emite, y sólo se lee, sin ejecutar nada del proyecto. Si no existe, ordena según `app/styles/main.css` procesada con el `postcss.config` del proyecto, que sólo contiene las utilidades si Tailwind está en él (`@tailwindcss/postcss`); un proyecto con Tailwind sólo como plugin de Vite necesita haber ejecutado `meeko dev`. Tailwind sólo emite las utilidades que detecta en los archivos: una clase recién escrita cuenta como desconocida y va primera hasta que `meeko dev`, en marcha, regenera la hoja al guardar; las clases que no contiene van primero y en su orden. Si la hoja de `meeko dev` es anterior a `app/styles/main.css`, se usa igualmente y se avisa una vez. `.meeko/` suele ignorarse en git: en una CI limpia no hay hoja de `meeko dev` y se usa el procesado de `app/styles/main.css`.

El valor `meekoSortClasses: 'tailwind'` y la opción `meekoTailwindStylesheet` de versiones anteriores ya no existen: Prettier rechaza el valor `"tailwind"` como una opción inválida e ignora `meekoTailwindStylesheet` como desconocida.
