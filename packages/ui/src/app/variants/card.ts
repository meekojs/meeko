// The look of <UICard> and <UILinkCard>. Each property is set by one part only: the colors by `variant`, the
// space between the content and the edge by `padding`, which the component also fills from `density`.
import { tv } from 'tailwind-variants/lite'

import { focusRing } from './focus'

export { cardAppearance } from '../theme/recipes'

/**
 * A component written straight in a <UIProse> keeps the rhythm of its blocks: no space above it and the gap of a
 * paragraph below, except as the last one. The prose's own rules stop at elements marked with meeko-ui-component.
 */
export const inProse = 'meeko-ui-component [.meeko-ui-prose>&]:mt-0 [.meeko-ui-prose>&]:mb-6 [.meeko-ui-prose>&:last-child]:mb-0'

/**
 * The look of <UICard>. Its padding lives in --card-padding, which a <UITable> inside the body also reads: a
 * table lines up with the rest of the body, and a table alone reaches the edges of its card, which is its frame,
 * while its first and last cells keep the card's padding. A <UITable> is the <table role="table"> it renders.
 */
export const card = tv({
	slots: {
		base: [
			'group/card box-border flex min-w-0 flex-col',
			'font-sans leading-normal',
			inProse,
		],
		header: [
			'grid gap-y-1.5 px-(--card-padding) pt-(--card-padding) pb-0 [overflow-wrap:anywhere]',
			'group-has-[>div>:only-child>table[role=table]]/card:pb-3',
			// The title, or the headings of the `header` snippet.
			'[&_:is(h1,h2,h3,h4)]:m-0 [&_:is(h1,h2,h3,h4)]:text-xl [&_:is(h1,h2,h3,h4)]:leading-snug [&_:is(h1,h2,h3,h4)]:font-semibold [&_:is(h1,h2,h3,h4)]:tracking-tight [&_:is(h1,h2,h3,h4)]:text-inherit',
		],
		title: '',
		description: 'm-0 text-md',
		actions: 'flex min-h-lh flex-wrap items-center [align-self:start] gap-2',
		body: [
			'flex-1 p-(--card-padding) [overflow-wrap:anywhere] [&>:first-child]:mt-0 [&>:last-child]:mb-0',
			'[&_table[role=table]>*>tr>:first-child]:ps-0 [&_table[role=table]>*>tr>:last-child]:pe-0',
			'has-[>:only-child>table[role=table]]:p-0 [&>:only-child:has(>table[role=table])]:rounded-[inherit] [&>:only-child>table[role=table]]:bg-transparent',
			'[&>:only-child>table[role=table]>*>tr>:first-child]:ps-(--card-padding) [&>:only-child>table[role=table]>*>tr>:last-child]:pe-(--card-padding)',
		],
		footer: 'px-(--card-padding) pt-0 pb-(--card-padding) [overflow-wrap:anywhere] [&>:first-child]:mt-0 [&>:last-child]:mb-0',
	},
	variants: {
		variant: {
			custom: { description: 'opacity-80' },
			outline: { base: 'rounded-lg border-(length:--ui-border-width) border-border bg-surface text-text', description: 'text-text-soft' },
			soft: { base: 'rounded-lg border-(length:--ui-border-width) border-transparent bg-control-hover text-text', description: 'text-text-soft' },
			// An app rule such as `.page p { color }` would leave the text of a solid unreadable.
			solid: { base: 'rounded-lg border-(length:--ui-border-width) border-transparent bg-primary text-primary-contrast [&_:where(p,li):not([class])]:text-inherit', description: 'text-primary-contrast' },
			elevated: { base: 'rounded-lg border-(length:--ui-border-width) border-border bg-surface-raised text-text [box-shadow:var(--ui-card-shadow,var(--ui-shadow-md))]', description: 'text-text-soft' },
		},
		padding: {
			none: { base: '[--card-padding:var(--ui-space-0)]' },
			sm: { base: '[--card-padding:var(--ui-space-3)]' },
			md: { base: '[--card-padding:var(--ui-space-5)]' },
			lg: { base: '[--card-padding:var(--ui-space-6)]' },
		},
		/** With actions the text stays in the first column; `actionsWrap` places the actions. */
		actions: {
			true: { header: '[&>:not(:last-child)]:col-[1]' },
			false: { header: 'gap-x-1.5' },
		},
		/** Where the actions go: it only applies with actions, in the compound variants below. */
		actionsWrap: {
			inline: {},
			below: {},
			auto: {},
		},
	},
	compoundVariants: [
		// Two columns: the text, and the actions beside the title and description.
		{ actions: true, actionsWrap: 'inline', class: { header: 'grid-cols-[minmax(0,1fr)_auto] gap-x-4', actions: 'col-[2] row-[1/span_2] justify-end' } },
		// One column: the actions follow the text, in the order of the DOM.
		{ actions: true, actionsWrap: 'below', class: { actions: 'pt-1.5' } },
		// The header is the container: below the width of --container-card-narrow the actions leave the second
		// column for a row of their own, and the empty column takes no space because the gap is their margin.
		{
			actions: true,
			actionsWrap: 'auto',
			class: {
				header: '@container grid-cols-[minmax(0,1fr)_auto]',
				actions: [
					'col-[2] row-[1/span_2] ms-4 justify-end',
					'@max-card-narrow:col-[1] @max-card-narrow:row-auto @max-card-narrow:ms-0 @max-card-narrow:justify-start @max-card-narrow:pt-1.5',
				],
			},
		},
	],
	defaultVariants: {
		variant: 'outline',
		padding: 'md',
		actions: false,
		actionsWrap: 'inline',
	},
})

/** The look of <UILinkCard>: a linked surface, which marks itself under the pointer. */
export const linkCard = tv({
	slots: {
		base: [
			'box-border flex h-full min-w-0 flex-col gap-1.5 p-[var(--ui-link-card-padding,var(--ui-space-4))]',
			'rounded-lg border-(length:--ui-border-width) border-border bg-surface font-sans text-text no-underline decoration-current [overflow-wrap:anywhere]',
			'hover:border-border-strong hover:bg-control-hover',
			'transition-[border-color,background-color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
			focusRing,
		],
		title: 'text-lg leading-snug font-medium tracking-tight',
		description: 'text-sm leading-normal text-text-soft',
	},
})
