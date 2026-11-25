// The look of <UITable>. Each property is set by one part only: the padding of the cells by `density`, the grid
// by `layout`. A <UICard> also reaches the cells of a table in its body (variants/card), with selectors more
// specific than these.
import { tv } from 'tailwind-variants/lite'

import { inProse } from './card'
import { focusRing } from './focus'

/** The line under a row; the last row of the body, and the foot, have none. */
const rowLine = '[border-bottom:var(--ui-border-width)_solid_var(--ui-color-border)]'

export const table = tv({
	slots: {
		// `relative`: what a cell hides for a screen reader stays inside this box, and never widens the page.
		base: ['relative max-w-full overflow-x-auto overscroll-x-contain', focusRing, inProse],
		table: [
			'w-full border-separate border-spacing-0 bg-surface text-left font-sans text-md text-text tabular-nums',
			// A table scrolls before a word breaks, also inside a card, whose text may break anywhere.
			'[overflow-wrap:normal]',
			// A row is scanned: a link the app writes in a cell marks itself when the pointer reaches it.
			'[&_a:not(.meeko-ui-component)]:no-underline [&_a:not(.meeko-ui-component)]:decoration-current [&_a:not(.meeko-ui-component):hover]:underline',
			// A type breaks at its spaces, and a name is never cut: `anywhere` would let the column shrink to a few
			// letters (`docs/en/do|ctor.md`). `break-word` only cuts what does not fit even in a whole line, and it
			// does not count for the width of the column, so a grid column stays inside the table.
			'[&_code]:font-mono [&_code]:text-(length:--ui-prose-code-size) [&_code]:[overflow-wrap:break-word]',
		],
		caption: 'text-text-soft [text-align:inherit]',
		section: '',
		row: '',
		bodyRow: 'hover:bg-control-hover',
		headerCell: ['align-middle font-medium whitespace-nowrap text-text-soft', rowLine],
		cell: ['align-middle [tr:last-child>&]:[border-bottom:0]', rowLine],
		// The one cell that says the table has no rows.
		empty: '',
		footerCell: 'align-middle [border-top:var(--ui-border-width)_solid_var(--ui-color-border)]',
	},
	variants: {
		layout: {
			native: '',
			// Rows of a subgrid, where the browser has it: the columns line up across the whole table.
			grid: {
				table: 'supports-[grid-template-columns:subgrid]:grid supports-[grid-template-columns:subgrid]:grid-cols-(--table-columns)',
				caption: 'supports-[grid-template-columns:subgrid]:col-span-full',
				section: 'supports-[grid-template-columns:subgrid]:col-span-full supports-[grid-template-columns:subgrid]:grid supports-[grid-template-columns:subgrid]:grid-cols-subgrid',
				row: 'supports-[grid-template-columns:subgrid]:col-span-full supports-[grid-template-columns:subgrid]:grid supports-[grid-template-columns:subgrid]:grid-cols-subgrid',
				bodyRow: 'supports-[grid-template-columns:subgrid]:col-span-full supports-[grid-template-columns:subgrid]:grid supports-[grid-template-columns:subgrid]:grid-cols-subgrid',
				headerCell: 'supports-[grid-template-columns:subgrid]:flex supports-[grid-template-columns:subgrid]:min-w-0 supports-[grid-template-columns:subgrid]:items-center',
				cell: 'supports-[grid-template-columns:subgrid]:flex supports-[grid-template-columns:subgrid]:min-w-0 supports-[grid-template-columns:subgrid]:items-center',
				footerCell: 'supports-[grid-template-columns:subgrid]:flex supports-[grid-template-columns:subgrid]:min-w-0 supports-[grid-template-columns:subgrid]:items-center',
				empty: 'supports-[grid-template-columns:subgrid]:col-span-full',
			},
		},
		density: {
			compact: { headerCell: 'px-2 py-1', cell: 'px-2 py-1', footerCell: 'px-2 py-1' },
			normal: { headerCell: 'px-3 py-2', cell: 'px-3 py-2', footerCell: 'px-3 py-2' },
			comfortable: { headerCell: 'px-3 py-4', cell: 'px-3 py-4', footerCell: 'px-3 py-4' },
		},
		/** The caption names the table without being seen, when a heading already says it. */
		hideCaption: {
			true: { caption: 'absolute size-(--ui-border-width) overflow-hidden p-0 whitespace-nowrap [clip-path:inset(50%)]' },
			false: { caption: 'px-3 py-2' },
		},
		/** A column of numbers ends at the right edge, also its total in the foot. */
		numeric: {
			true: { headerCell: 'justify-end text-end', cell: 'justify-end text-end', footerCell: 'justify-end text-end' },
			false: { headerCell: '[text-align:inherit]', cell: '[text-align:inherit]', footerCell: '[text-align:inherit]' },
		},
		/** A cell that never breaks its text: a number, a code or a date. The header never breaks anyway. */
		nowrap: {
			true: { cell: 'whitespace-nowrap', footerCell: 'whitespace-nowrap' },
			false: '',
		},
		/** A header of a row, in the body: it keeps the color of the text. */
		rowHeader: {
			true: { cell: 'font-medium text-text' },
			false: '',
		},
	},
	defaultVariants: {
		layout: 'native',
		density: 'normal',
		hideCaption: false,
		numeric: false,
		nowrap: false,
		rowHeader: false,
	},
})
