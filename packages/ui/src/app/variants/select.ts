// The look of <UISelect> and <UICombobox>. Their trigger is a field: the component paints it with `control`
// of ./input.ts, which takes `clearable` for the room of the clear button. The list of <UICombobox> is the
// content of a <UIPopover>; the list of <UISelect> is the browser's own, which select.css paints where the
// browser lets it (`appearance: base-select`), placeholder included. Each property is set by one part only.
import { tv } from 'tailwind-variants/lite'

/** The focus ring inside a box that clips it, such as the clear button at the end of the trigger. */
const insetRing = 'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:-outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid'

/** A line of soft text in the list: the name of a group, nothing found or loading. */
const note = 'px-2 py-1.5 text-sm text-text-soft'

/** What both share: the root dims itself when disabled, and holds the clear button over the trigger. */
const root = {
	slots: {
		base: 'font-sans',
		/** What the trigger adds to `control`: it is a button, whose text starts at the start. */
		trigger: 'cursor-pointer text-start',
		groupLabel: note,
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

/** The look of <UISelect>. The `<select>` is the trigger, and a customizable select lays out its value and its arrow. */
export const select = tv({
	...root,
	slots: {
		...root.slots,
		trigger: [
			root.slots.trigger,
			'supports-[appearance:base-select]:flex supports-[appearance:base-select]:items-center supports-[appearance:base-select]:justify-between supports-[appearance:base-select]:gap-2',
		],
		/** The value in the trigger, when an `option` or a `value` snippet paints the options. */
		value: '',
		// Firefox paints its arrow at the very end of the select: the clear button goes just before it.
		clear: [...root.slots.clear, 'end-0 not-supports-[appearance:base-select]:end-5'],
		groupLabel: [note, 'font-regular'],
	},
})

/** The look of <UICombobox>: its options are elements, and several values are chips over the trigger. */
export const combobox = tv({
	...root,
	slots: {
		...root.slots,
		clear: [...root.slots.clear, 'end-0'],
		/** The values in the trigger, with a `value` snippet. */
		values: 'flex flex-wrap gap-1.5',
		/** The chips of a searchable multiple combobox, over its field. */
		chips: 'mb-1.5 flex flex-wrap gap-1.5',
		chip: 'rounded-full border-(length:--ui-border-width) border-solid border-border bg-control px-2 py-0.5 text-sm',
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
		loading: note,
		empty: note,
	},
})
