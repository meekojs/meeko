// The look of <UISelect>, and what it shares with <UICombobox> (./combobox.ts). Their trigger is a field: the
// component paints it with `inputControlTheme` of ./input.ts, which takes `clearable` for the room of the clear
// button. The list of <UISelect> is the browser's own, which select.css paints where the browser lets it
// (`appearance: base-select`), placeholder included. Each property is set by one part only.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'

/** The focus ring inside a box that clips it, such as the clear button at the end of the trigger. */
const insetRing = 'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:-outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid'

/** A line of soft text in the list: the name of a group, nothing found or loading. */
export const selectNote = 'px-2 py-1.5 text-sm/[inherit] text-text-soft'

/** What <UISelect> and <UICombobox> share: the root dims itself when disabled, and holds the clear button over the trigger. */
export const selectRoot = {
	slots: {
		base: 'font-sans',
		/** What the trigger adds to `inputControlTheme`: it is a button, whose text starts at the start. */
		trigger: 'cursor-pointer text-start',
		groupLabel: selectNote,
		/** A square as tall as the control, at the end of the trigger. */
		clear: [
			'absolute bottom-0 inline-flex size-(--ui-control-height-md) cursor-pointer items-center justify-center',
			'rounded-md [border:0] bg-transparent font-sans text-xl leading-none font-regular text-text-soft hover:text-text',
			insetRing,
		],
	},
	variants: {
		disabled: {
			true: { base: 'cursor-not-allowed opacity-(--ui-opacity-disabled)' },
			false: '',
		},
		clearable: {
			true: { base: 'relative' },
			false: '',
		},
	},
	defaultVariants: {
		disabled: false,
		clearable: false,
	},
} as const

/**
 * Receta de `UISelect`, con los slots `base`, `trigger` (el `<select>`), `value`, `groupLabel` y `clear`, y las
 * variantes `disabled` y `clearable`, que el componente fija desde sus props. Un select personalizable
 * (`appearance: base-select`) reparte en el disparador su valor y su flecha.
 *
 * @example
 * ```ts
 * import { selectTheme } from '@meekojs/ui/theme'
 *
 * const { base, trigger } = selectTheme({ clearable: true })
 * ```
 */
export const selectTheme = defineTheme({
	...selectRoot,
	slots: {
		...selectRoot.slots,
		trigger: [
			selectRoot.slots.trigger,
			'supports-[appearance:base-select]:flex supports-[appearance:base-select]:items-center supports-[appearance:base-select]:justify-between supports-[appearance:base-select]:gap-2',
		],
		/** The value in the trigger, when an `option` or a `value` snippet paints the options. */
		value: '',
		// Firefox paints its arrow at the very end of the select: the clear button goes just before it.
		clear: [...selectRoot.slots.clear, 'end-0 not-supports-[appearance:base-select]:end-5'],
		groupLabel: [selectNote, 'font-regular'],
	},
})

/** Variantes de la receta de `UISelect`, derivadas de `selectTheme`. */
export type SelectThemeProps = ThemeVariants<typeof selectTheme>
