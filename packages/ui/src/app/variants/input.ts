// The look of a text field: <UIInput>, <UITextarea> and, through `control`, the trigger of <UISelect> and
// <UICombobox>. Each property is set by one part only: the height is the only one that changes between a
// line and a box of text, so it lives in `multiline` and not in the base, and the end padding makes room for
// the clear button of a `clearable` trigger, so it lives out of the base too.
import { tv } from 'tailwind-variants/lite'

/** Border, background, text, hover, placeholder, invalid and focus of every control that looks like a field. */
const look = [
	'ui:box-border ui:block ui:w-full ui:ps-3 ui:py-1.5',
	'ui:rounded-md ui:border-(length:--ui-border-width) ui:border-solid ui:border-control-border ui:aria-[invalid=true]:border-danger',
	'ui:bg-control ui:not-disabled:hover:bg-control-hover',
	'ui:font-sans ui:text-(length:--ui-input-font-size) ui:leading-snug ui:font-regular ui:text-text ui:placeholder:text-text-soft',
	'ui:transition-[background-color] ui:duration-(--ui-duration-fast) ui:motion-reduce:transition-none ui:motion-reduce:duration-0',
	'ui:focus-visible:outline-(length:--ui-focus-ring-width) ui:focus-visible:outline-focus ui:focus-visible:outline-offset-(--ui-focus-ring-offset) ui:focus-visible:outline-solid',
]

/** A line of text, as tall as a button. */
const line = 'ui:min-h-(--ui-control-height-md)'

/** A box of text, which the user can make taller. */
const box = 'ui:min-h-24 ui:resize-y'

/** The padding at the end of the text, as at its start. */
const end = 'ui:pe-3'

/** A disabled field: the element itself has the `disabled` attribute. */
const disabled = 'ui:disabled:cursor-not-allowed ui:disabled:opacity-(--ui-opacity-disabled)'

/**
 * The look of a field without its disabled state, for a control that is not an <input> or a <textarea>: the
 * trigger of <UISelect> and <UICombobox>, whose wrapper already dims itself when disabled. The trigger adds
 * its own pointer and alignment through `class`.
 *
 * @example
 * ```ts
 * const triggerClass = control({ class: 'ui:cursor-pointer ui:text-start' })
 * ```
 */
export const control = tv({
	base: look,
	variants: {
		multiline: {
			false: line,
			true: box,
		},
		/** The trigger leaves room at its end for the clear button, a square as tall as the control. */
		clearable: {
			false: end,
			true: 'ui:pe-(--ui-control-height-md)',
		},
	},
	defaultVariants: {
		multiline: false,
		clearable: false,
	},
})

/** The look of <UIInput>. */
export const input = tv({ base: [...look, line, end, disabled] })

/** The look of <UITextarea>. */
export const textarea = tv({ base: [...look, box, end, disabled] })
