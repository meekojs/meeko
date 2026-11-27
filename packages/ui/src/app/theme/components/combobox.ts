// The look of <UICombobox>: the root, the clear button and the list of <UISelect> (./select.ts), with several
// values as chips over the trigger and the notes of a search. Its trigger is a field, painted with
// `inputControlTheme` of ./input.ts. Each property is set by one part only.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { selectNote, selectRoot } from './select'

/**
 * Receta de `UICombobox`, con los slots `base`, `trigger`, `values`, `chips`, `chip`, `value`, `placeholder`, `list`,
 * `group`, `groupLabel`, `option`, `loading`, `empty` y `clear`, y las variantes `disabled` y `clearable`, que el
 * componente fija desde sus props. Una opción activa lleva el anillo del teclado, una elegida va en negrita y una
 * deshabilitada se atenúa.
 *
 * @example
 * ```ts
 * import { comboboxTheme } from '@meekojs/ui/theme'
 *
 * const { option } = comboboxTheme()
 * ```
 */
export const comboboxTheme = defineTheme({
	...selectRoot,
	slots: {
		...selectRoot.slots,
		/** The values in the trigger, with a `value` snippet. */
		values: 'flex flex-wrap gap-1.5',
		/** The chips of a searchable multiple combobox, over its field. */
		chips: 'mb-1.5 flex flex-wrap gap-1.5',
		chip: 'rounded-full border-(length:--ui-border-width) border-solid border-border bg-control px-2 py-0.5 text-sm/[inherit]',
		loading: selectNote,
		empty: selectNote,
	},
})

/** Variantes de la receta de `UICombobox`, derivadas de `comboboxTheme`. */
export type ComboboxThemeProps = ThemeVariants<typeof comboboxTheme>
