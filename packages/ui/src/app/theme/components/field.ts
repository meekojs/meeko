// The look of <UIField>: a label, the control the app renders, and its description, error, hint and counter.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'

/** A line of help under the control, in soft text. */
const help = 'm-0 text-sm/[inherit] text-text-soft'

/**
 * Receta de `UIField`, con los slots `base`, `label`, `description`, `error`, `meta` (la fila de la ayuda y el
 * contador), `hint` y `counter`. No tiene variantes.
 *
 * @example
 * ```ts
 * import { fieldTheme } from '@meekojs/ui/theme'
 *
 * const { label, error } = fieldTheme()
 * ```
 */
export const fieldTheme = defineTheme({
	slots: {
		base: 'grid gap-1.5 font-sans text-text',
		label: 'text-sm/[inherit] font-medium',
		description: help,
		error: 'm-0 text-sm/[inherit] text-danger-text',
		// The hint and the counter share a row, one at each end; a counter without a hint stays at the start.
		meta: 'flex justify-between gap-3',
		hint: help,
		counter: [help, 'flex-none tabular-nums'],
	},
})

/** Variantes de la receta de `UIField`, derivadas de `fieldTheme`: ninguna. */
export type FieldThemeProps = ThemeVariants<typeof fieldTheme>
