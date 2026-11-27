// The look of <UIDisclosure>: a native <details> whose summary drops the marker of the browser for the chevron of
// the navigation.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { focusRing } from '../base/focus'

/**
 * Receta de `UIDisclosure`, con los slots `base`, `summary` y `body`.
 *
 * @example
 * ```ts
 * import { disclosureTheme } from '@meekojs/ui/theme'
 *
 * const { summary } = disclosureTheme()
 * ```
 */
export const disclosureTheme = defineTheme({
	slots: {
		base: '',
		/** The summary, without the marker of the browser: the chevron of ./navigation.ts takes its place. */
		summary: [
			'inline-flex cursor-pointer list-none items-center gap-1 rounded-sm',
			'text-md text-text-soft hover:text-text [&::-webkit-details-marker]:hidden',
			'transition-[color] duration-(--ui-duration-fast)',
			'motion-reduce:transition-none motion-reduce:duration-0',
			focusRing,
		],
		body: 'pt-3',
	},
})

/** Variantes de la receta de `UIDisclosure`, derivadas de `disclosureTheme`. */
export type DisclosureThemeProps = ThemeVariants<typeof disclosureTheme>
