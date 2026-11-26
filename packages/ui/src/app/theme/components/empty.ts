// The look of <UIEmpty>: a title, its help and the actions of the `actions` snippet, inline in the content or as a
// panel with the surface of the page. It has no color of its own: `layout` is where it sits, not a treatment of
// the catalog.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { messageActions } from './alert'

/**
 * Receta de `UIEmpty`: `layout` (`inline` o `panel`), con los slots `base`, `title`, `description` y `actions`.
 * Sin ella es `inline`.
 *
 * @example
 * ```ts
 * import { emptyTheme } from '@meekojs/ui/theme'
 *
 * const { base } = emptyTheme({ layout: 'panel' })
 * ```
 */
export const emptyTheme = defineTheme({
	slots: {
		base: 'grid justify-items-start gap-2 font-sans text-md leading-normal font-regular text-text',
		title: 'm-0 font-semibold',
		description: 'm-0 text-text-soft',
		actions: messageActions,
	},
	variants: {
		layout: {
			inline: { base: 'py-4' },
			panel: { base: 'rounded-lg border-(length:--ui-border-width) border-solid border-border bg-surface p-6' },
		},
	},
	defaultVariants: {
		layout: 'inline',
	},
})

/** Variantes de la receta de `UIEmpty`, derivadas de `emptyTheme`. */
export type EmptyThemeProps = ThemeVariants<typeof emptyTheme>
