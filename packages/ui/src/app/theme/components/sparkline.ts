// The look of <UISparkline>: an <svg> as wide as its container and as tall as --ui-sparkline-height, whose paths
// stretch to it while the stroke keeps its width (vector-effect). The series uncovers itself once from its start,
// when it is inserted, except with reduced motion: a clip of the whole <svg>, because a dash of a stroke that does
// not scale is measured on the screen, not on the path. The clip only lasts the animation (`backwards`), so it never
// cuts the round caps at the edges. A line has no treatment: `color` is the step 11 of its scale, the one of text.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'

/**
 * Receta de `UISparkline`: `color`, con los slots `base`, `area` y `line`. Sin `color`, la línea toma el color del
 * texto (`currentColor`); `neutral` es el texto suave de la página.
 *
 * @example
 * ```ts
 * import { sparklineTheme } from '@meekojs/ui/theme'
 *
 * const { base, line } = sparklineTheme({ color: 'success' })
 * ```
 */
export const sparklineTheme = defineTheme({
	slots: {
		base: [
			'block h-(--ui-sparkline-height) w-full max-w-full overflow-visible',
			'animate-[ui-sparkline-draw_var(--ui-sparkline-duration)_var(--ui-ease-out)_backwards] motion-reduce:animate-none',
		],
		area: 'fill-current [fill-opacity:var(--ui-sparkline-area-opacity)] stroke-none',
		line: 'fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:var(--ui-sparkline-stroke-width)] [vector-effect:non-scaling-stroke]',
	},
	variants: {
		color: {
			primary: { base: 'text-primary-11' },
			secondary: { base: 'text-secondary-11' },
			// The soft text of the page, which `ui.tokens.textSoft` sets.
			neutral: { base: 'text-text-soft' },
			success: { base: 'text-success-11' },
			info: { base: 'text-info-11' },
			warning: { base: 'text-warning-11' },
			danger: { base: 'text-danger-11' },
		},
	},
})

/** Variantes de la receta de `UISparkline`, derivadas de `sparklineTheme`. */
export type SparklineThemeProps = ThemeVariants<typeof sparklineTheme>

/** Color semántico de un sparkline: `primary`, `secondary`, `neutral`, `success`, `info`, `warning` o `danger`. */
export type UISparklineColor = NonNullable<SparklineThemeProps['color']>
