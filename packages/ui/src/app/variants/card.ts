// The look of <UICard> and <UILinkCard>. Each property is set by one part only: the colors by `variant`, the
// space between the content and the edge by `padding`, which the component also fills from `density`.
import { tv } from 'tailwind-variants/lite'

import { focusRing } from './focus'

/**
 * A component written straight in a <UIProse> keeps the rhythm of its blocks: no space above it and the gap of a
 * paragraph below, except as the last one. The prose's own rules stop at any element with a ui:* class.
 */
export const inProse = 'ui:[.meeko-ui-prose>&]:mt-0 ui:[.meeko-ui-prose>&]:mb-6 ui:[.meeko-ui-prose>&:last-child]:mb-0'

/**
 * The look of <UICard>. Its padding lives in --card-padding, which a <UITable> inside the body also reads: a
 * table lines up with the rest of the body, and a table alone reaches the edges of its card, which is its frame,
 * while its first and last cells keep the card's padding. A <UITable> is the <table role="table"> it renders.
 */
export const card = tv({
	slots: {
		base: [
			'ui:group/card ui:box-border ui:flex ui:min-w-0 ui:flex-col',
			'ui:rounded-lg ui:border-(length:--ui-border-width) ui:font-sans ui:leading-normal',
			inProse,
		],
		header: [
			'ui:grid ui:gap-y-1.5 ui:px-(--card-padding) ui:pt-(--card-padding) ui:pb-0 ui:[overflow-wrap:anywhere]',
			'ui:group-has-[>div>:only-child>table[role=table]]/card:pb-3',
			// The title, or the headings of the `header` snippet.
			'ui:[&_:is(h1,h2,h3,h4)]:m-0 ui:[&_:is(h1,h2,h3,h4)]:text-xl ui:[&_:is(h1,h2,h3,h4)]:leading-snug ui:[&_:is(h1,h2,h3,h4)]:font-semibold ui:[&_:is(h1,h2,h3,h4)]:tracking-tight ui:[&_:is(h1,h2,h3,h4)]:text-inherit',
		],
		title: '',
		description: 'ui:m-0 ui:text-md',
		actions: 'ui:flex ui:min-h-lh ui:flex-wrap ui:items-center ui:justify-end ui:[align-self:start] ui:gap-2',
		body: [
			'ui:flex-1 ui:p-(--card-padding) ui:[overflow-wrap:anywhere] ui:[&>:first-child]:mt-0 ui:[&>:last-child]:mb-0',
			'ui:[&_table[role=table]>*>tr>:first-child]:ps-0 ui:[&_table[role=table]>*>tr>:last-child]:pe-0',
			'ui:has-[>:only-child>table[role=table]]:p-0 ui:[&>:only-child:has(>table[role=table])]:rounded-[inherit] ui:[&>:only-child>table[role=table]]:bg-transparent',
			'ui:[&>:only-child>table[role=table]>*>tr>:first-child]:ps-(--card-padding) ui:[&>:only-child>table[role=table]>*>tr>:last-child]:pe-(--card-padding)',
		],
		footer: 'ui:px-(--card-padding) ui:pt-0 ui:pb-(--card-padding) ui:[overflow-wrap:anywhere] ui:[&>:first-child]:mt-0 ui:[&>:last-child]:mb-0',
	},
	variants: {
		variant: {
			outline: { base: 'ui:border-border ui:bg-surface ui:text-text', description: 'ui:text-text-soft' },
			soft: { base: 'ui:border-transparent ui:bg-control-hover ui:text-text', description: 'ui:text-text-soft' },
			// An app rule such as `.page p { color }` would leave the text of a solid unreadable.
			solid: { base: 'ui:border-transparent ui:bg-primary ui:text-primary-contrast ui:[&_:where(p,li):not([class])]:text-inherit', description: 'ui:text-primary-contrast' },
			elevated: { base: 'ui:border-border ui:bg-surface-raised ui:text-text ui:[box-shadow:var(--ui-card-shadow,var(--ui-shadow-md))]', description: 'ui:text-text-soft' },
		},
		padding: {
			none: { base: 'ui:[--card-padding:var(--ui-space-0)]' },
			sm: { base: 'ui:[--card-padding:var(--ui-space-3)]' },
			md: { base: 'ui:[--card-padding:var(--ui-space-5)]' },
			lg: { base: 'ui:[--card-padding:var(--ui-space-6)]' },
		},
		/** With actions the header has two columns: the text, and the actions beside the title and description. */
		actions: {
			true: { header: 'ui:grid-cols-[minmax(0,1fr)_auto] ui:gap-x-4 ui:[&>:not(:last-child)]:col-[1]', actions: 'ui:col-[2] ui:row-[1/span_2]' },
			false: { header: 'ui:gap-x-1.5' },
		},
	},
	defaultVariants: {
		variant: 'outline',
		padding: 'md',
		actions: false,
	},
})

/** The look of <UILinkCard>: a linked surface, which marks itself under the pointer. */
export const linkCard = tv({
	slots: {
		base: [
			'ui:box-border ui:flex ui:h-full ui:min-w-0 ui:flex-col ui:gap-1.5 ui:p-[var(--ui-link-card-padding,var(--ui-space-4))]',
			'ui:rounded-lg ui:border-(length:--ui-border-width) ui:border-border ui:bg-surface ui:font-sans ui:text-text ui:no-underline ui:decoration-current ui:[overflow-wrap:anywhere]',
			'ui:hover:border-border-strong ui:hover:bg-control-hover',
			'ui:transition-[border-color,background-color] ui:duration-(--ui-duration-fast) ui:motion-reduce:transition-none ui:motion-reduce:duration-0',
			focusRing,
		],
		title: 'ui:text-lg ui:leading-snug ui:font-medium ui:tracking-tight',
		description: 'ui:text-sm ui:leading-normal ui:text-text-soft',
	},
})
