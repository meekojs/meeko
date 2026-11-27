// The look of <UICombobox>: the root and the clear button of <UISelect> (./select.ts), with options that are
// elements, the content of a <UIPopover>, and several values as chips over the trigger. Its trigger is a field,
// painted with `inputControlTheme` of ./input.ts. Each property is set by one part only.
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
		clear: [...selectRoot.slots.clear, 'end-0'],
		/** The values in the trigger, with a `value` snippet. */
		values: 'flex flex-wrap gap-1.5',
		/** The chips of a searchable multiple combobox, over its field. */
		chips: 'mb-1.5 flex flex-wrap gap-1.5',
		chip: 'rounded-full border-(length:--ui-border-width) border-solid border-border bg-control px-2 py-0.5 text-sm/[inherit]',
		/** The value in the trigger, without a `value` snippet, or the placeholder without a value. */
		value: '',
		placeholder: 'text-text-soft',
		list: '',
		group: '',
		/** An option: the keyboard ring when active, bold when chosen, dimmed when it cannot be chosen. */
		option: [
			'cursor-pointer rounded-sm px-2 py-1.5',
			'data-active:bg-control-active data-active:[box-shadow:var(--ui-option-active-ring)] data-selected:font-semibold',
			'data-disabled:cursor-not-allowed data-disabled:opacity-(--ui-opacity-disabled)',
		],
		loading: selectNote,
		empty: selectNote,
	},
})

/** Variantes de la receta de `UICombobox`, derivadas de `comboboxTheme`. */
export type ComboboxThemeProps = ThemeVariants<typeof comboboxTheme>
