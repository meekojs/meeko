// The look of <UISelect>, and what it shares with <UICombobox> (./combobox.ts): a trigger that is a field, which
// the component paints with `inputControlTheme` of ./input.ts (it takes `clearable` for the room of the clear
// button), and a list of their own inside a <UIPopover>, with its groups and its options. Each property is set by
// one part only.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'

/** The focus ring inside a box that clips it, such as the clear button at the end of the trigger. */
const insetRing = 'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:-outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid'

/** A line of soft text in the list: the name of a group, nothing found or loading. */
export const selectNote = 'px-2 py-1.5 text-sm/[inherit] text-text-soft'

/**
 * What <UISelect> and <UICombobox> share: the root dims itself when disabled and holds the clear button over the
 * trigger, and the list has groups and options that are elements. The root is as wide as its container, like
 * <UIInput>: in a flex row or a grid it would otherwise shrink to its content, and the `w-full` of the trigger
 * would only fill that.
 */
export const selectRoot = {
	slots: {
		base: 'block w-full font-sans',
		/** What the trigger adds to `inputControlTheme`: it is a button, whose text starts at the start. */
		trigger: 'cursor-pointer text-start',
		/** The value in the trigger, or the placeholder without a value. */
		value: '',
		placeholder: 'text-text-soft',
		/** The listbox, inside the content of the <UIPopover> that paints its box. */
		list: '',
		group: '',
		groupLabel: selectNote,
		/** An option: the keyboard ring when active, bold when chosen, dimmed when it cannot be chosen. */
		option: [
			'cursor-pointer rounded-sm px-2 py-1.5',
			'data-active:bg-control-active data-active:[box-shadow:var(--ui-option-active-ring)] data-selected:font-semibold',
			'data-disabled:cursor-not-allowed data-disabled:opacity-(--ui-opacity-disabled)',
		],
		/** A square as tall as the control, at the end of the trigger. */
		clear: [
			'absolute end-0 bottom-0 inline-flex size-(--ui-control-height-md) cursor-pointer items-center justify-center',
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
 * What the box of the list of <UISelect> adds to the content of <UIPopover>: a list without options paints
 * nothing. Such is the one that `popovertarget` opens before the script arrives, or without it: an empty box
 * under the trigger would look like a broken list.
 */
export const selectPopover = 'has-[[role=listbox]:empty]:hidden'

/**
 * Receta de `UISelect`, con los slots `base` (la raíz), `trigger` (el botón, que además toma el aspecto de campo de
 * `inputControlTheme`), `value`, `placeholder`, `chevron` (la flecha, que gira con la lista abierta), `list` (el
 * `role="listbox"`), `group`, `groupLabel`, `option`, `indicator` (la marca de la opción elegida) y `clear`, y las
 * variantes `disabled` y `clearable`, que el componente fija desde sus props. Una opción activa lleva el anillo del
 * teclado, una elegida va en negrita y con su marca, y una deshabilitada se atenúa. La caja flotante de la lista es
 * el contenido de un `UIPopover` (`popoverTheme`).
 *
 * @since 1.12.0 Los slots `placeholder`, `chevron`, `list`, `group`, `option` e `indicator`: la lista es propia.
 * @example
 * ```ts
 * import { selectTheme } from '@meekojs/ui/theme'
 *
 * const { base, trigger, option } = selectTheme({ clearable: true })
 * ```
 */
export const selectTheme = defineTheme({
	...selectRoot,
	slots: {
		...selectRoot.slots,
		/** The value takes the free width, so the chevron stays at the end. */
		trigger: [selectRoot.slots.trigger, 'flex items-center justify-between gap-2'],
		value: 'min-w-0 flex-1 truncate',
		placeholder: [selectRoot.slots.placeholder, 'min-w-0 flex-1 truncate'],
		/** The chevron at the end of the trigger: it turns while the list is open. */
		chevron: 'text-text-soft transition-[rotate] duration-(--ui-duration-base) ease-out in-aria-expanded:rotate-180 motion-reduce:transition-none motion-reduce:duration-0',
		groupLabel: [selectNote, 'font-regular'],
		/** The content of an option and, at its end, the mark of the chosen one. */
		option: [...selectRoot.slots.option, 'flex items-center gap-2'],
		indicator: 'ms-auto text-primary-text',
	},
})

/** Variantes de la receta de `UISelect`, derivadas de `selectTheme`. */
export type SelectThemeProps = ThemeVariants<typeof selectTheme>
