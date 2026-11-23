// The look of <UIPage> and <UIPageHeader>. Each property is set by one part only: what changes with the
// layout lives in each value of `layout`, and the columns of the body in one compound variant per set of zones.
import { tv } from 'tailwind-variants/lite'

import { focusRing } from './focus'

/** No transition when the reader asks for less motion. */
const still = 'ui:motion-reduce:transition-none ui:motion-reduce:duration-0'

/** A side column: it stays under the header and scrolls on its own, with a scrollbar only while in use. */
const sideColumn = [
	'ui:sticky ui:top-(--ui-header-height) ui:[align-self:start] ui:pt-8 ui:pb-10 ui:max-h-[calc(100dvh-var(--ui-header-height))]',
	'ui:overflow-y-auto ui:overscroll-contain ui:[scrollbar-gutter:stable] ui:[scrollbar-width:thin]',
	'ui:[scrollbar-color:transparent_transparent] ui:hover:[scrollbar-color:var(--ui-color-border-strong)_transparent] ui:focus-within:[scrollbar-color:var(--ui-color-border-strong)_transparent]',
]

/**
 * The look of <UIPage>. `group/page` lets what lives inside a page (the collapsible <UITableOfContents>) know
 * it. Below `desktop` the aside leaves, and below `sidebar` the sidebar gives its place to the bar.
 */
export const page = tv({
	slots: {
		base: 'ui:group/page ui:flex ui:min-h-dvh ui:flex-col ui:font-sans ui:text-text',
		// Off the screen until the keyboard reaches it, so it never takes room; no shadow while it is hidden,
		// or it would show above the header.
		skip: [
			'ui:fixed ui:start-2 ui:top-2 ui:z-(--ui-z-floating) ui:[translate:0_calc(-100%_-_var(--ui-space-4))] ui:focus-visible:[translate:0_0]',
			'ui:rounded-md ui:bg-primary ui:px-3 ui:py-2 ui:text-md ui:font-medium ui:text-primary-contrast ui:no-underline ui:decoration-current',
			'ui:focus-visible:[box-shadow:var(--ui-shadow-md)]',
			'ui:transition-[translate] ui:duration-(--ui-duration-fast) ui:ease-out',
			still,
			focusRing,
		],
		// Notices under the header, on the width of the page; without any, it takes no room.
		notices: 'ui:mx-auto ui:box-border ui:grid ui:w-full ui:max-w-(--ui-page-width) ui:gap-2 ui:px-(--ui-container-gutter-md) ui:pt-3 ui:not-has-[*]:hidden',
		bar: [
			'ui:hidden ui:max-sidebar:sticky ui:max-sidebar:top-(--ui-header-height) ui:max-sidebar:z-(--ui-z-sticky) ui:max-sidebar:flex ui:max-sidebar:items-center ui:max-sidebar:gap-3',
			'ui:max-sidebar:min-h-(--ui-control-height-lg) ui:max-sidebar:border-b-(length:--ui-border-width) ui:max-sidebar:border-b-border ui:max-sidebar:bg-bg ui:max-sidebar:px-(--ui-container-gutter-md)',
		],
		body: 'ui:mx-auto ui:box-border ui:w-full ui:flex-1',
		sidebar: [sideColumn, 'ui:max-sidebar:hidden'],
		// It takes the focus from the skip link only to move the reading position: a ring around it says nothing.
		main: 'ui:min-w-0 ui:focus:outline-none',
		aside: [sideColumn, 'ui:max-desktop:hidden'],
	},
	variants: {
		layout: {
			docs: {
				body: 'ui:grid ui:max-w-(--ui-page-width) ui:gap-12 ui:px-(--ui-container-gutter-md) ui:max-desktop:gap-10',
				main: 'ui:pt-10 ui:pb-20 ui:max-sidebar:pt-6',
			},
			dashboard: {
				body: 'ui:grid ui:max-w-(--ui-page-width) ui:gap-8 ui:px-(--ui-container-gutter-md)',
				main: 'ui:pt-8 ui:pb-12',
			},
			// Each section of a landing page sets its own width, with <UIContainer> or a band.
			landing: {
				body: 'ui:block ui:max-w-none ui:gap-12 ui:px-0 ui:max-desktop:gap-10',
				main: 'ui:pt-0 ui:pb-0',
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
		{ sidebar: false, aside: false, class: 'ui:grid-cols-[minmax(0,1fr)]' },
		{ sidebar: true, aside: false, class: 'ui:grid-cols-[var(--ui-page-sidebar-width)_minmax(0,1fr)] ui:max-sidebar:grid-cols-[minmax(0,1fr)]' },
		{ sidebar: false, aside: true, class: 'ui:grid-cols-[minmax(0,1fr)_var(--ui-page-aside-width)] ui:max-desktop:grid-cols-[minmax(0,1fr)]' },
		{
			sidebar: true,
			aside: true,
			class: 'ui:grid-cols-[var(--ui-page-sidebar-width)_minmax(0,1fr)_var(--ui-page-aside-width)] ui:max-desktop:grid-cols-[var(--ui-page-sidebar-width)_minmax(0,1fr)] ui:max-sidebar:grid-cols-[minmax(0,1fr)]',
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
		base: 'ui:grid ui:gap-4 ui:font-sans',
		row: 'ui:flex ui:flex-wrap ui:items-start ui:justify-between ui:gap-x-8 ui:gap-y-4',
		text: 'ui:min-w-0 ui:grow ui:shrink ui:basis-(--ui-floating-panel-width)',
		title: 'ui:m-0 ui:leading-tight ui:text-balance ui:text-text',
		description: 'ui:mx-0 ui:mb-0 ui:max-w-(--ui-prose-measure) ui:text-pretty ui:text-text-soft',
		// It may shrink: with `flex: none` the row of actions keeps its whole width and widens a narrow page.
		actions: 'ui:flex ui:flex-initial ui:flex-wrap ui:items-center ui:gap-2',
	},
	variants: {
		layout: {
			docs: {
				base: 'ui:mb-10 ui:border-b-(length:--ui-border-width) ui:border-b-border ui:pb-8',
				title: 'ui:text-(length:--ui-page-title-size) ui:font-semibold ui:tracking-(--ui-page-title-tracking)',
				description: 'ui:mt-3 ui:text-lg ui:leading-relaxed',
			},
			dashboard: {
				base: 'ui:mb-6 ui:pb-0',
				title: 'ui:text-(length:--ui-page-title-size) ui:font-semibold ui:tracking-(--ui-page-title-tracking)',
				description: 'ui:mt-1.5 ui:text-md ui:leading-normal',
			},
			landing: {
				base: 'ui:mb-0 ui:pb-8',
				// The code of a title, written in its `title` snippet, reads as a chip.
				title: [
					'ui:text-(length:--ui-landing-title-size) ui:font-bold ui:tracking-display',
					'ui:[&_code]:rounded-sm ui:[&_code]:bg-code-soft ui:[&_code]:p-(--ui-prose-code-padding) ui:[&_code]:text-(length:--ui-prose-code-size) ui:[&_code]:font-medium ui:[&_code]:text-code-text',
				],
				description: 'ui:mt-3 ui:text-xl ui:leading-relaxed',
			},
		},
	},
	defaultVariants: {
		layout: 'docs',
	},
})
