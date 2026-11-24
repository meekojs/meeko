// The look of <UISelect> and <UICombobox>. Their trigger is a field: the component paints it with `control`
// of ./input.ts, which takes `clearable` for the room of the clear button. The list of <UICombobox> is the
// content of a <UIPopover>; the list of <UISelect> is the browser's own, which select.css paints where the
// browser lets it (`appearance: base-select`), placeholder included. Each property is set by one part only.
import { tv } from 'tailwind-variants/lite'

/** The focus ring inside a box that clips it, such as the clear button at the end of the trigger. */
const insetRing = 'ui:focus-visible:outline-(length:--ui-focus-ring-width) ui:focus-visible:outline-focus ui:focus-visible:-outline-offset-(--ui-focus-ring-offset) ui:focus-visible:outline-solid'

/** A line of soft text in the list: the name of a group, nothing found or loading. */
const note = 'ui:px-2 ui:py-1.5 ui:text-sm ui:text-text-soft'

/**
 * What both share: the root dims itself when disabled, and holds the clear button over the trigger. It is as
 * wide as its container, like <UIInput>: in a flex row or a grid it would otherwise shrink to its content, and
 * the `w-full` of the trigger would only fill that.
 */
const root = {
	slots: {
		base: 'ui:block ui:w-full ui:font-sans',
		/** What the trigger adds to `control`: it is a button, whose text starts at the start. */
		trigger: 'ui:cursor-pointer ui:text-start',
		groupLabel: note,
		/** A square as tall as the control, at the end of the trigger. */
		clear: [
			'ui:absolute ui:bottom-0 ui:inline-flex ui:size-(--ui-control-height-md) ui:cursor-pointer ui:items-center ui:justify-center',
			'ui:rounded-md ui:[border:0] ui:bg-transparent ui:font-sans ui:text-xl ui:leading-none ui:font-regular ui:text-text-soft ui:hover:text-text',
			insetRing,
		],
	},
	variants: {
		disabled: {
			true: { base: 'ui:cursor-not-allowed ui:opacity-(--ui-opacity-disabled)' },
			false: '',
		},
		clearable: {
			true: { base: 'ui:relative' },
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
			'ui:supports-[appearance:base-select]:flex ui:supports-[appearance:base-select]:items-center ui:supports-[appearance:base-select]:justify-between ui:supports-[appearance:base-select]:gap-2',
		],
		/** The value in the trigger, when an `option` or a `value` snippet paints the options. */
		value: '',
		// Firefox paints its arrow at the very end of the select: the clear button goes just before it.
		clear: [...root.slots.clear, 'ui:end-0 ui:not-supports-[appearance:base-select]:end-5'],
		groupLabel: [note, 'ui:font-regular'],
	},
})

/** The look of <UICombobox>: its options are elements, and several values are chips over the trigger. */
export const combobox = tv({
	...root,
	slots: {
		...root.slots,
		clear: [...root.slots.clear, 'ui:end-0'],
		/** The values in the trigger, with a `value` snippet. */
		values: 'ui:flex ui:flex-wrap ui:gap-1.5',
		/** The chips of a searchable multiple combobox, over its field. */
		chips: 'ui:mb-1.5 ui:flex ui:flex-wrap ui:gap-1.5',
		chip: 'ui:rounded-full ui:border-(length:--ui-border-width) ui:border-solid ui:border-border ui:bg-control ui:px-2 ui:py-0.5 ui:text-sm',
		/** The value in the trigger, without a `value` snippet, or the placeholder without a value. */
		value: '',
		placeholder: 'ui:text-text-soft',
		list: '',
		group: '',
		/** An option: the keyboard ring when active, bold when chosen, dimmed when it cannot be chosen. */
		option: [
			'ui:cursor-pointer ui:rounded-sm ui:px-2 ui:py-1.5',
			'ui:data-active:bg-control-active ui:data-active:[box-shadow:var(--ui-option-active-ring)] ui:data-selected:font-semibold',
			'ui:data-disabled:cursor-not-allowed ui:data-disabled:opacity-(--ui-opacity-disabled)',
		],
		loading: note,
		empty: note,
	},
})
