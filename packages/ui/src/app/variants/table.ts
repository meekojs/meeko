// The look of <UITable>. Each property is set by one part only: the padding of the cells by `density`, the grid
// by `layout`. A <UICard> also reaches the cells of a table in its body (variants/card), with selectors more
// specific than these.
import { tv } from 'tailwind-variants/lite'

import { inProse } from './card'
import { focusRing } from './focus'

/** The line under a row; the last row of the body, and the foot, have none. */
const rowLine = 'ui:[border-bottom:var(--ui-border-width)_solid_var(--ui-color-border)]'

export const table = tv({
	slots: {
		// `relative`: what a cell hides for a screen reader stays inside this box, and never widens the page.
		base: ['ui:relative ui:max-w-full ui:overflow-x-auto ui:overscroll-x-contain', focusRing, inProse],
		table: [
			'ui:w-full ui:border-separate ui:border-spacing-0 ui:bg-surface ui:text-left ui:font-sans ui:text-md ui:text-text ui:tabular-nums',
			// A table scrolls before a word breaks, also inside a card, whose text may break anywhere.
			'ui:[overflow-wrap:normal]',
			// A row is scanned: a link the app writes in a cell marks itself when the pointer reaches it.
			"ui:[&_a:not([class*='ui:'])]:no-underline ui:[&_a:not([class*='ui:'])]:decoration-current ui:[&_a:not([class*='ui:']):hover]:underline",
			// A type breaks at its spaces, and a name is never cut: `anywhere` would let the column shrink to a few
			// letters (`docs/en/do|ctor.md`). `break-word` only cuts what does not fit even in a whole line, and it
			// does not count for the width of the column, so a grid column stays inside the table.
			'ui:[&_code]:font-mono ui:[&_code]:text-(length:--ui-prose-code-size) ui:[&_code]:[overflow-wrap:break-word]',
		],
		caption: 'ui:text-text-soft ui:[text-align:inherit]',
		section: '',
		row: '',
		bodyRow: 'ui:hover:bg-control-hover',
		headerCell: ['ui:align-middle ui:font-medium ui:whitespace-nowrap ui:text-text-soft', rowLine],
		cell: ['ui:align-middle ui:[tr:last-child>&]:[border-bottom:0]', rowLine],
		// The one cell that says the table has no rows.
		empty: '',
		footerCell: 'ui:align-middle ui:[text-align:inherit] ui:[border-top:var(--ui-border-width)_solid_var(--ui-color-border)]',
	},
	variants: {
		layout: {
			native: '',
			// Rows of a subgrid, where the browser has it: the columns line up across the whole table.
			grid: {
				table: 'ui:supports-[grid-template-columns:subgrid]:grid ui:supports-[grid-template-columns:subgrid]:grid-cols-(--table-columns)',
				caption: 'ui:supports-[grid-template-columns:subgrid]:col-span-full',
				section: 'ui:supports-[grid-template-columns:subgrid]:col-span-full ui:supports-[grid-template-columns:subgrid]:grid ui:supports-[grid-template-columns:subgrid]:grid-cols-subgrid',
				row: 'ui:supports-[grid-template-columns:subgrid]:col-span-full ui:supports-[grid-template-columns:subgrid]:grid ui:supports-[grid-template-columns:subgrid]:grid-cols-subgrid',
				bodyRow: 'ui:supports-[grid-template-columns:subgrid]:col-span-full ui:supports-[grid-template-columns:subgrid]:grid ui:supports-[grid-template-columns:subgrid]:grid-cols-subgrid',
				headerCell: 'ui:supports-[grid-template-columns:subgrid]:flex ui:supports-[grid-template-columns:subgrid]:min-w-0 ui:supports-[grid-template-columns:subgrid]:items-center',
				cell: 'ui:supports-[grid-template-columns:subgrid]:flex ui:supports-[grid-template-columns:subgrid]:min-w-0 ui:supports-[grid-template-columns:subgrid]:items-center',
				footerCell: 'ui:supports-[grid-template-columns:subgrid]:flex ui:supports-[grid-template-columns:subgrid]:min-w-0 ui:supports-[grid-template-columns:subgrid]:items-center',
				empty: 'ui:supports-[grid-template-columns:subgrid]:col-span-full',
			},
		},
		density: {
			compact: { headerCell: 'ui:px-2 ui:py-1', cell: 'ui:px-2 ui:py-1', footerCell: 'ui:px-2 ui:py-1' },
			normal: { headerCell: 'ui:px-3 ui:py-2', cell: 'ui:px-3 ui:py-2', footerCell: 'ui:px-3 ui:py-2' },
			comfortable: { headerCell: 'ui:px-3 ui:py-4', cell: 'ui:px-3 ui:py-4', footerCell: 'ui:px-3 ui:py-4' },
		},
		/** The caption names the table without being seen, when a heading already says it. */
		hideCaption: {
			true: { caption: 'ui:absolute ui:size-(--ui-border-width) ui:overflow-hidden ui:p-0 ui:whitespace-nowrap ui:[clip-path:inset(50%)]' },
			false: { caption: 'ui:px-3 ui:py-2' },
		},
		/** A column of numbers ends at the right edge. */
		numeric: {
			true: { headerCell: 'ui:justify-end ui:text-end', cell: 'ui:justify-end ui:text-end' },
			false: { headerCell: 'ui:[text-align:inherit]', cell: 'ui:[text-align:inherit]' },
		},
		/** A header of a row, in the body: it keeps the color of the text. */
		rowHeader: {
			true: { cell: 'ui:font-medium ui:text-text' },
			false: '',
		},
	},
	defaultVariants: {
		layout: 'native',
		density: 'normal',
		hideCaption: false,
		numeric: false,
		rowHeader: false,
	},
})
