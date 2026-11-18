// The look of <UIStat> and <UIDescriptionList>: a term in small soft text over its value, in the text of the
// page. A value never widens its column: it breaks anywhere.
import { tv } from 'tailwind-variants/lite'

/** A <dl> in the text of the page. */
const list = 'ui:m-0 ui:grid ui:min-w-0 ui:font-sans ui:text-md ui:leading-normal ui:font-regular ui:text-text ui:[overflow-wrap:anywhere]'

/** The term of a <dl>. */
const term = 'ui:text-sm ui:text-text-soft'

/** A value, and its figures in columns. */
const value = 'ui:m-0 ui:tabular-nums'

/** The context under a value. */
const detail = [value, term]

/** The look of <UIStat>: a big value between its label and its context. */
export const stat = tv({
	slots: {
		base: [list, 'ui:content-start ui:gap-1'],
		label: term,
		value: [value, 'ui:text-2xl ui:font-semibold ui:tracking-tight'],
		detail,
	},
})

/** The look of <UIDescriptionList>: one column, or up to three from a `compact` screen. */
export const descriptionList = tv({
	slots: {
		base: [list, 'ui:gap-5'],
		item: 'ui:grid ui:content-start ui:gap-1',
		label: term,
		value,
		code: 'ui:font-mono ui:text-(length:--ui-prose-code-size) ui:[overflow-wrap:anywhere]',
		detail,
	},
	variants: {
		columns: {
			1: '',
			2: { base: 'ui:compact:grid-cols-2' },
			3: { base: 'ui:compact:grid-cols-3' },
		},
	},
	defaultVariants: {
		columns: 1,
	},
})
