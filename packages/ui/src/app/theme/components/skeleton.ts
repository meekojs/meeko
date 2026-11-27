// The look of <UISkeleton>: bars that pulse while the content loads. The keyframes `ui-skeleton-pulse` stay in
// feedback.css.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'

/**
 * Receta de `UISkeleton`, con los slots `base` y `line`.
 *
 * @example
 * ```ts
 * import { skeletonTheme } from '@meekojs/ui/theme'
 *
 * const { line } = skeletonTheme()
 * ```
 */
export const skeletonTheme = defineTheme({
	slots: {
		base: 'grid gap-3',
		/** A bar that pulses, with the keyframes `ui-skeleton-pulse` of feedback.css. */
		line: [
			'h-4 rounded-sm bg-control-active',
			'animate-[ui-skeleton-pulse_var(--ui-skeleton-duration)_var(--ui-ease-in-out)_infinite_alternate] motion-reduce:animate-none',
		],
	},
})

/** Variantes de la receta de `UISkeleton`, derivadas de `skeletonTheme`. */
export type SkeletonThemeProps = ThemeVariants<typeof skeletonTheme>

/** The width of each line of a skeleton, from the scale of the tokens. Not a variant: the prop is `widths`, one per line. */
export const skeletonWidths = {
	full: 'w-full',
	long: 'w-(--ui-skeleton-width-long)',
	short: 'w-(--ui-skeleton-width-short)',
}
