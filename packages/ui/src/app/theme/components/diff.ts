// The look of <UIDiff>: one line per row, as wide as the longest, with the colour of its kind (`diffLine`). The
// kind of a line is decided by the component, so it lives in its own constant and never becomes a prop.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { focusRing } from '../base/focus'
import { inProse } from './card'

/**
 * Receta de `UIDiff`, con los slots `base`, `line` y `empty`. El color de cada línea sale de `diffLine`.
 *
 * @example
 * ```ts
 * import { diffTheme } from '@meekojs/ui/theme'
 *
 * const { base, line } = diffTheme()
 * ```
 */
export const diffTheme = defineTheme({
	slots: {
		base: [
			'm-0 max-h-(--ui-code-max-height) overflow-auto rounded-lg border-(length:--ui-border-width) border-border bg-bg-subtle py-2',
			'font-mono text-sm leading-normal whitespace-pre text-text-soft',
			focusRing,
			inProse,
		],
		line: 'block min-h-lh w-fit min-w-full px-4',
		empty: 'm-0 font-sans text-md text-text-soft',
	},
})

/** Variantes de la receta de `UIDiff`, derivadas de `diffTheme`. */
export type DiffThemeProps = ThemeVariants<typeof diffTheme>

/** The colour of each kind of line of a diff; the context keeps the text of the block. */
export const diffLine = {
	add: 'bg-success-soft text-text',
	remove: 'bg-danger-soft text-text',
	hunk: 'bg-primary-soft text-primary-text',
	file: 'font-medium text-text-soft',
	context: '',
} as const
