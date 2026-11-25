// The look of <UIPage> and <UIPageHeader>. Each property is set by one part only: what changes with the
// layout lives in each value of `layout`, and the columns of the body in one compound variant per set of zones.
import { tv } from '../utils/theme'
import { focusRing } from './focus'

/** No transition when the reader asks for less motion. */
const still = 'motion-reduce:transition-none motion-reduce:duration-0'

/** A side column: it stays under the header and scrolls on its own, with a scrollbar only while in use. */
const sideColumn = [
	'sticky top-(--ui-header-height) [align-self:start] pt-8 pb-10 max-h-[calc(100dvh-var(--ui-header-height))]',
	'overflow-y-auto overscroll-contain [scrollbar-gutter:stable] [scrollbar-width:thin]',
	'[scrollbar-color:transparent_transparent] hover:[scrollbar-color:var(--ui-color-border-strong)_transparent] focus-within:[scrollbar-color:var(--ui-color-border-strong)_transparent]',
]

/**
 * The look of <UIPage>. `group/page` lets what lives inside a page (the collapsible <UITableOfContents>) know
 * it. Below `desktop` the aside leaves, and below `sidebar` the sidebar gives its place to the bar.
 */
export const page = tv({
	slots: {
		base: 'group/page flex min-h-dvh flex-col font-sans text-text',
		// Off the screen until the keyboard reaches it, so it never takes room; no shadow while it is hidden,
		// or it would show above the header.
		skip: [
			'fixed start-2 top-2 z-(--ui-z-floating) [translate:0_calc(-100%_-_var(--ui-space-4))] focus-visible:[translate:0_0]',
			'rounded-md bg-primary px-3 py-2 text-md font-medium text-primary-contrast no-underline decoration-current',
			'focus-visible:[box-shadow:var(--ui-shadow-md)]',
			'transition-[translate] duration-(--ui-duration-fast) ease-out',
			still,
			focusRing,
		],
		// Notices under the header, on the width of the page; without any, it takes no room.
		notices: 'mx-auto box-border grid w-full max-w-(--ui-page-width) gap-2 px-(--ui-container-gutter-md) pt-3 not-has-[*]:hidden',
		bar: [
			'hidden max-sidebar:sticky max-sidebar:top-(--ui-header-height) max-sidebar:z-(--ui-z-sticky) max-sidebar:flex max-sidebar:items-center max-sidebar:gap-3',
			'max-sidebar:min-h-(--ui-control-height-lg) max-sidebar:border-b-(length:--ui-border-width) max-sidebar:border-b-border max-sidebar:bg-bg max-sidebar:px-(--ui-container-gutter-md)',
		],
		body: 'mx-auto box-border w-full flex-1',
		sidebar: [sideColumn, 'max-sidebar:hidden'],
		// It takes the focus from the skip link only to move the reading position: a ring around it says nothing.
		main: 'min-w-0 focus:outline-none',
		aside: [sideColumn, 'max-desktop:hidden'],
	},
	variants: {
		layout: {
			docs: {
				body: 'grid max-w-(--ui-page-width) gap-12 px-(--ui-container-gutter-md) max-desktop:gap-10',
				main: 'pt-10 pb-20 max-sidebar:pt-6',
			},
			dashboard: {
				body: 'grid max-w-(--ui-page-width) gap-8 px-(--ui-container-gutter-md)',
				main: 'pt-8 pb-12',
			},
			// Each section of a landing page sets its own width, with <UIContainer> or a band.
			landing: {
				body: 'block max-w-none gap-12 px-0 max-desktop:gap-10',
				main: 'pt-0 pb-0',
			},
		},
	},
	defaultVariants: {
		layout: 'docs',
	},
})

/**
 * The columns of the body of <UIPage>, by the zones it has; they are not props, the snippets decide them. The
 * aside comes after <main> in the document, and on a slow page it arrives much later: its column is in the
 * opening tag of the body, so the text is not laid out again when it appears.
 */
export const pageColumns = tv({
	variants: {
		sidebar: {
			true: '',
			false: '',
		},
		aside: {
			true: '',
			false: '',
		},
	},
	compoundVariants: [
		{ sidebar: false, aside: false, class: 'grid-cols-[minmax(0,1fr)]' },
		{ sidebar: true, aside: false, class: 'grid-cols-[var(--ui-page-sidebar-width)_minmax(0,1fr)] max-sidebar:grid-cols-[minmax(0,1fr)]' },
		{ sidebar: false, aside: true, class: 'grid-cols-[minmax(0,1fr)_var(--ui-page-aside-width)] max-desktop:grid-cols-[minmax(0,1fr)]' },
		{
			sidebar: true,
			aside: true,
			class: 'grid-cols-[var(--ui-page-sidebar-width)_minmax(0,1fr)_var(--ui-page-aside-width)] max-desktop:grid-cols-[var(--ui-page-sidebar-width)_minmax(0,1fr)] max-sidebar:grid-cols-[minmax(0,1fr)]',
		},
	],
	defaultVariants: {
		sidebar: false,
		aside: false,
	},
})

/** The look of <UIPageHeader>, the only <h1> of a page: its size and its border follow the layout. */
export const pageHeader = tv({
	slots: {
		base: 'grid gap-4 font-sans',
		row: 'flex flex-wrap items-start justify-between gap-x-8 gap-y-4',
		text: 'min-w-0 grow shrink basis-(--ui-floating-panel-width)',
		title: 'm-0 leading-tight text-balance text-text',
		description: 'mx-0 mb-0 max-w-(--ui-prose-measure) text-pretty text-text-soft',
		// It may shrink: with `flex: none` the row of actions keeps its whole width and widens a narrow page.
		actions: 'flex flex-initial flex-wrap items-center gap-2',
	},
	variants: {
		layout: {
			docs: {
				base: 'mb-10 border-b-(length:--ui-border-width) border-b-border pb-8',
				title: 'text-(length:--ui-page-title-size) font-semibold tracking-(--ui-page-title-tracking)',
				description: 'mt-3 text-lg leading-relaxed',
			},
			dashboard: {
				base: 'mb-6 pb-0',
				title: 'text-(length:--ui-page-title-size) font-semibold tracking-(--ui-page-title-tracking)',
				description: 'mt-1.5 text-md leading-normal',
			},
			landing: {
				base: 'mb-0 pb-8',
				// The code of a title, written in its `title` snippet, reads as a chip.
				title: [
					'text-(length:--ui-landing-title-size) font-bold tracking-display',
					'[&_code]:rounded-sm [&_code]:bg-code-soft [&_code]:p-(--ui-prose-code-padding) [&_code]:text-(length:--ui-prose-code-size) [&_code]:font-medium [&_code]:text-code-text',
				],
				description: 'mt-3 text-xl leading-relaxed',
			},
		},
	},
	defaultVariants: {
		layout: 'docs',
	},
})
