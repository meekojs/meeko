// The look of <UIField>: a label, the control the app renders, and its description, error, hint and counter.
import { tv } from 'tailwind-variants/lite'

/** A line of help under the control, in soft text. */
const help = 'm-0 text-sm text-text-soft'

export const field = tv({
	slots: {
		base: 'grid gap-1.5 font-sans text-text',
		label: 'text-sm font-medium',
		description: help,
		error: 'm-0 text-sm text-danger-text',
		// The hint and the counter share a row, one at each end; a counter without a hint stays at the start.
		meta: 'flex justify-between gap-3',
		hint: help,
		counter: [help, 'flex-none tabular-nums'],
	},
})
