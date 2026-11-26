import { createTV, createTwMerge, type TWMergeConfig } from 'tailwind-variants/config'

export type { VariantProps as ThemeVariants } from 'tailwind-variants/config'

/**
 * Enseña a Tailwind Merge las utilidades propias de `theme.css` que no sigue por defecto:
 * `text-control-<tamaño>` es tamaño de fuente (no color), `font-control` y `font-regular` son pesos (no
 * familias), `tracking-snug` y `tracking-display` son interletrado, y `max-w-4k`, `card-narrow` y
 * `stat-narrow` son contenedores. Los colores (`bg-<color>-<paso>`, `text-<color>-contrast`,
 * `bg-gray-a<n>`…) ya se reconocen como color.
 *
 * Un tamaño de fuente no elimina un `leading-*` anterior: en Tailwind 4 `text-*` lee el interlineado de
 * `--tw-leading`, que fija `leading-*`, así que ambos se suman en cualquier orden. Un `text-sm/6` con
 * interlineado propio sí lo sustituye.
 */
export const themeMergeConfig = {
	extend: {
		theme: {
			text: ['control-xs', 'control-sm', 'control-md', 'control-lg', 'control-xl'],
			'font-weight': ['regular', 'control'],
			tracking: ['snug', 'display'],
			container: ['4k', 'card-narrow', 'stat-narrow'],
		},
	},
	override: {
		conflictingClassGroups: {
			'font-size': [],
		},
	},
} satisfies TWMergeConfig

/**
 * Fusiona clases de Tailwind con la configuración de {@link themeMergeConfig}: ante dos utilidades en
 * conflicto gana la última, así que las clases del consumidor, puestas al final, sustituyen a las de la
 * receta en lugar de competir con ellas por el orden de la hoja.
 *
 * @since 1.11.0
 * @example
 * ```ts
 * mergeClasses('bg-control text-text', 'bg-amber-500') // 'text-text bg-amber-500'
 * ```
 */
export const mergeClasses = createTwMerge(themeMergeConfig)

/** Crea recetas de tema tipadas y resuelve conflictos entre utilidades de Tailwind, incluidas las propias. */
export const defineTheme = createTV({ twMergeConfig: themeMergeConfig })
