/**
 * Nombres de los iconos disponibles en el proyecto, como claves. `@meekojs/icon` lo amplía en
 * `.meeko/types/modules/%40meekojs%2Ficon/` con los iconos de cada colección configurada y con los
 * SVG locales (`local:<nombre>`), al ejecutar `meeko dev`, `meeko build` o `meeko check`.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * declare module '@meekojs/icon' {
 * 	interface GeneratedIconNames {
 * 		'lucide:search': true
 * 	}
 * }
 * ```
 */
export interface GeneratedIconNames {}

/**
 * Colecciones `@iconify-json/<colección>` instaladas en el proyecto, como claves, para completar
 * `icon.collections` en `meeko.config.ts`. Lo amplía la declaración generada.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * declare module '@meekojs/icon' {
 * 	interface GeneratedIconCollections {
 * 		lucide: true
 * 	}
 * }
 * ```
 */
export interface GeneratedIconCollections {}

/**
 * Nombre de un icono, `colección:icono` (`'lucide:search'`) o `local:<nombre>` para un SVG de
 * `app/icons`. Con las declaraciones generadas es la unión de los iconos disponibles; sin ellas, cualquier
 * cadena con la forma `prefijo:nombre`.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import type { IconName } from '@meekojs/icon'
 *
 * const close: IconName = 'lucide:x'
 * ```
 */
export type IconName = [keyof GeneratedIconNames] extends [never] ? `${string}:${string}` : Extract<keyof GeneratedIconNames, string>

/**
 * Nombre de una colección de Iconify para `icon.collections`: las instaladas se completan en el
 * editor; cualquier otra cadena sigue siendo válida y el build comprueba que esté instalada.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import type { IconCollectionName } from '@meekojs/icon'
 *
 * const collections: IconCollectionName[] = ['lucide', 'mdi']
 * ```
 */
export type IconCollectionName = (string & {}) | Extract<keyof GeneratedIconCollections, string>

/**
 * Entrada de `icon.include`: un icono que debe estar disponible para nombres dinámicos
 * (`bind:name`), o `'<colección>:*'` para todos los iconos de una colección.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import type { IconInclude } from '@meekojs/icon'
 *
 * const include: IconInclude[] = ['lucide:check', 'lucide:x']
 * ```
 */
export type IconInclude = `${string}:*` | IconName

/**
 * Icono resuelto al compilar: su `viewBox` y el contenido del `<svg>`, ya limpio. Es el formato del
 * registro de iconos dinámicos y de la prop interna `resolved` de `<UIIcon>`.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import type { IconData } from '@meekojs/icon'
 *
 * const dot: IconData = ['0 0 24 24', '<circle cx="12" cy="12" r="4"/>']
 * ```
 */
export type IconData = readonly [viewBox: string, body: string]

/**
 * Props de `<UIIcon>`.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import type { IconProps } from '@meekojs/icon'
 *
 * const props: IconProps = { name: 'lucide:trash-2', label: 'Eliminar' }
 * ```
 */
export interface IconProps {
	/** Clases del `<svg>`. */
	class?: string
	/**
	 * Texto accesible. Sin él, el icono es decorativo (`aria-hidden="true"`); con él, el `<svg>`
	 * lleva `role="img"` y `aria-label`.
	 */
	label?: string
	/**
	 * Icono: `colección:icono` o `local:<nombre>`. Un valor literal se resuelve al compilar; uno
	 * dinámico (`bind:name`) debe estar en `icon.include` o ser un literal de la expresión.
	 */
	name: IconName
	/**
	 * Uso interno: los iconos que el compilador resuelve para esta etiqueta. No lo escriba.
	 *
	 * @internal
	 */
	resolved?: Readonly<Record<string, IconData>>
	/** Alto del icono, una longitud CSS (`'1.5em'`, `'20px'`); por defecto, `icon.size` (`'1em'`). El ancho sigue la proporción del icono. */
	size?: string
}

export { iconView } from './runtime'
export type { IconView } from './runtime'
