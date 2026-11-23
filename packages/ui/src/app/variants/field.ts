// The look of <UIField>: a label, the control the app renders, and its description, error, hint and counter.
import { tv } from 'tailwind-variants/lite'

/** A line of help under the control, in soft text. */
const help = 'ui:m-0 ui:text-sm ui:text-text-soft'

export const field = tv({
	slots: {
		base: 'ui:grid ui:gap-1.5 ui:font-sans ui:text-text',
		label: 'ui:text-sm ui:font-medium',
		description: help,
		error: 'ui:m-0 ui:text-sm ui:text-danger-text',
		// The hint and the counter share a row, one at each end; a counter without a hint stays at the start.
		meta: 'ui:flex ui:justify-between ui:gap-3',
		hint: help,
		counter: [help, 'ui:flex-none ui:tabular-nums'],
	},
})
