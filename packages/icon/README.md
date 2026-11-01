# Meeko Icon

Iconos de [Iconify](https://iconify.design) y SVG propios para Meeko, con `<UIIcon>`: tipados, resueltos al compilar e incrustados en el HTML. Sin peticiones en tiempo de ejecución, sin CDN y compatibles con una Content Security Policy estricta.

Guía con ejemplos: [ui.meekojs.com/icons](https://ui.meekojs.com/icons).

## Instalación

```sh
pnpm add @meekojs/icon
pnpm add -D @iconify-json/lucide
```

Cada colección es un paquete `@iconify-json/<colección>` del proyecto. Si `icon.collections` nombra una que no está instalada, `meeko check`, `meeko dev` y `meeko build` fallan con el comando para instalarla.

```ts
// meeko.config.ts
import { defineMeekoConfig } from '@meekojs/meeko/framework'

export default defineMeekoConfig({
	modules: ['@meekojs/icon'],
	icon: {
		collections: ['lucide'],
		local: 'app/icons',
		size: '1em',
		include: ['lucide:check', 'lucide:x'],
	},
})
```

| Opción        | Tipo              | Por defecto             | Descripción                                                                       |
| ------------- | ----------------- | ----------------------- | --------------------------------------------------------------------------------- |
| `collections` | `string[]`        | `[]`                    | Colecciones de Iconify (`'lucide'`, `'mdi'`…). El editor completa las instaladas. |
| `include`     | `IconInclude[]`   | `[]`                    | Iconos para nombres dinámicos, o `'<colección>:*'` para una colección entera.     |
| `local`       | `string \| false` | `'app/icons'` si existe | Carpeta de SVG propios; cada `<nombre>.svg` es `local:<nombre>`.                  |
| `size`        | `string`          | `'1em'`                 | Alto por defecto, una longitud CSS.                                               |

## Uso

```html
<UIIcon name="lucide:search" />
<UIIcon
	name="lucide:trash-2"
	label="Eliminar"
/>
<UIIcon
	name="local:logo"
	size="1.5em"
/>
<UIIcon bind:name="open.value ? 'lucide:x' : 'lucide:menu'" />
```

| Prop    | Tipo       | Descripción                                                                                                  |
| ------- | ---------- | ------------------------------------------------------------------------------------------------------------ |
| `name`  | `IconName` | `colección:icono` o `local:<nombre>`. Obligatoria.                                                           |
| `label` | `string`   | Texto accesible. Sin él, el icono es decorativo (`aria-hidden="true"`); con él, `role="img"` y `aria-label`. |
| `size`  | `string`   | Alto; por defecto, `icon.size`. El ancho sigue la proporción del icono.                                      |
| `class` | `string`   | Clases del `<svg>`, que siempre lleva `meeko-icon`.                                                          |

`<UIIcon>` escribe un `<svg>` con `width`, `height`, `viewBox`, `fill="currentColor"` y `focusable="false"` como atributos (nunca `style`), y toma el color del texto. La hoja del módulo sólo alinea el icono con la línea base (`.meeko-icon`).

## Cómo se resuelve

- **Nombres literales.** Durante el build, un plugin de Vite resuelve cada `name="…"` de `<UIIcon>` con `@iconify/utils` y lo incrusta en el componente que lo usa, antes de que Meeko lo compile. El bundle de cada página sólo lleva sus iconos; el SSR y el navegador ven el mismo SVG, así que la hidratación y la navegación no parpadean.
- **Nombres dinámicos.** Los literales de una expresión `bind:name` se resuelven igual. Un valor que no aparece en el código (de datos o de una señal tipada) se busca en `icon.include`. Si tampoco está, se pinta un `<svg>` vacío y `meeko dev` avisa en la consola.
- **Nombre inexistente.** Es un error de tipos (`TS2820`, con la sugerencia más parecida) en `meeko check`, `meeko build` y el editor; el build también lo rechaza con el archivo y la posición.

## Tipos

El módulo genera la unión de los nombres disponibles en `.meeko/types/modules/%40meekojs%2Ficon/`, una declaración por colección más la de los SVG locales. `name` de `<UIIcon>` y `icon.include` de `meeko.config.ts` usan esa unión: el editor completa `name="lucide:…"` y marca los nombres que no existen. Con Lucide (2.302 nombres), Tabler y Material Design Icons a la vez (22.802), la comprobación de TypeScript 7 sube unos 35 ms.

```ts
import type { IconName } from '@meekojs/icon'

const close: IconName = 'lucide:x'
```

## SVG propios

Cada `<nombre>.svg` (en kebab-case) de `app/icons` es `local:<nombre>`. Al compilar se sanea con una lista de elementos y atributos permitidos: se quitan `<script>`, `<style>`, `<foreignObject>`, `<image>`, enlaces, animaciones, manejadores `on*`, `style`, `class` y toda referencia fuera del icono (`href` y `url(…)` sólo a `#id`). Un icono de un solo color pasa a `currentColor`. Los `id` internos se prefijan por icono para que dos iconos no choquen.

## Requisitos

`@meekojs/meeko` `>=1.7 <2`, con el registro de módulos por su nombre (`modules: ['@meekojs/icon']`) de 1.8.
