// The look of <UIHint>: an ⓘ of the size of the text around it, in a heading as in a paragraph, that sits on its
// line like a letter. Its hit area reaches a little beyond the icon without moving the text around it.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { triggerFocusRing } from './popover'

/**
 * Receta de `UIHint`, con los slots `base` (el botón), `icon` y `tooltip`.
 *
 * @example
 * ```ts
 * import { hintTheme } from '@meekojs/ui/theme'
 *
 * const { base } = hintTheme()
 * ```
 */
export const hintTheme = defineTheme({
	slots: {
		base: [
			'relative m-0 inline-flex cursor-help items-center justify-center rounded-full [border:0] bg-transparent p-0 align-(--ui-icon-text-align)',
			'text-text-soft hover:text-text [font:inherit] leading-none',
			'transition-[color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
			'before:absolute before:-inset-(--ui-hint-hit-area) before:rounded-full',
			triggerFocusRing,
		],
		icon: '',
		tooltip: '',
	},
})

/** Variantes de la receta de `UIHint`, derivadas de `hintTheme`. */
export type HintThemeProps = ThemeVariants<typeof hintTheme>
