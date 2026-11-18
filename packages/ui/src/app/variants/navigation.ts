// The look of the lists of links: <UINavigationTree>, <UINavigationTabs>, <UIBreadcrumb>, <UIPageNavigation>,
// <UIPagination> and <UITableOfContents>. Each property is set by one part only; what a component decides
// by itself (a group that folds, the next page, a nested entry…) lives in its own constant or tv(), so that
// it never becomes a prop.
import { tv } from 'tailwind-variants/lite'

import { disabledBusy } from './button'
import { focusRing, focusRingInset } from './focus'

/** No transition when the reader asks for less motion. */
const still = 'ui:motion-reduce:transition-none ui:motion-reduce:duration-0'

/**
 * The chevron of a <details> that folds: it points to the text while closed, and down when open. Also used
 * by <UIDisclosure>.
 */
export const chevron = [
	'ui:-rotate-90 ui:rtl:rotate-90 ui:[details[open]>summary>&]:rotate-0 ui:text-text-soft',
	'ui:transition-[rotate] ui:duration-(--ui-duration-base) ui:ease-out',
	still,
].join(' ')

/** The look of <UINavigationTree>: groups that fold with a native <details>, and their links. */
export const navigationTree = tv({
	slots: {
		base: 'ui:grid ui:grid-cols-[minmax(0,1fr)] ui:gap-5 ui:font-sans ui:text-md ui:text-text-soft',
		// Where the browser animates to `auto`, a group opens and closes by its height.
		group: [
			'ui:supports-[interpolate-size:allow-keywords]:[interpolate-size:allow-keywords]',
			'ui:supports-[interpolate-size:allow-keywords]:details-content:[block-size:0] ui:supports-[interpolate-size:allow-keywords]:details-content:overflow-clip',
			'ui:supports-[interpolate-size:allow-keywords]:details-content:[transition:block-size_var(--ui-duration-base)_var(--ui-ease-out),content-visibility_var(--ui-duration-base)_allow-discrete]',
			'ui:supports-[interpolate-size:allow-keywords]:open:details-content:[block-size:auto]',
			'ui:motion-reduce:details-content:[transition:none]',
		],
		// The title of a group: a <summary> when the group folds (`foldingTitle`), a <p> otherwise.
		title: 'ui:m-0 ui:flex ui:items-center ui:justify-between ui:gap-2 ui:rounded-sm ui:px-2 ui:py-1 ui:text-md ui:font-medium ui:text-text',
		titleText: 'ui:inline-flex ui:min-w-0 ui:items-center ui:gap-2',
		chevron,
		list: 'ui:mx-0 ui:mt-1 ui:mb-0 ui:grid ui:list-none ui:grid-cols-[minmax(0,1fr)] ui:gap-0.5 ui:p-0',
		link: [
			'ui:flex ui:items-center ui:gap-2 ui:rounded-sm ui:px-2 ui:py-1 ui:text-md ui:leading-normal ui:text-inherit ui:no-underline ui:decoration-current',
			'ui:hover:bg-control-hover ui:hover:text-text',
			'ui:[&[aria-current]]:bg-primary-soft ui:[&[aria-current]]:font-medium ui:[&[aria-current]]:text-primary-text',
			'ui:transition-[background-color,color] ui:duration-(--ui-duration-fast)',
			still,
			focusRingInset,
		],
		label: 'ui:min-w-0',
		empty: 'ui:px-2 ui:py-1 ui:text-md',
	},
})

/** The title of a group of <UINavigationTree> that folds: its <summary>, without the marker. */
export const foldingTitle = ['ui:cursor-pointer ui:list-none ui:[&::-webkit-details-marker]:hidden ui:hover:bg-control-hover', focusRingInset].join(' ')

/** The text of a link of <UINavigationTree> whose label is code: one line of monospace. */
export const codeLabel = 'ui:overflow-hidden ui:font-mono ui:text-md ui:text-ellipsis ui:whitespace-nowrap'

/**
 * The look of <UINavigationTabs>. `underline`: a row whose indicator follows the current link with CSS
 * anchor positioning, and where that is missing the link marks itself; `position` makes the row the box of
 * the indicator, which scrolls with it. `segmented`: the look of a segmented <UIRadioGroup>, without the
 * indicator.
 */
export const navigationTabs = tv({
	slots: {
		base: 'ui:group/tabs ui:relative ui:overflow-x-auto ui:font-sans ui:[anchor-scope:--tabs-current] ui:[scrollbar-width:none]',
		link: [
			'ui:flex ui:flex-none ui:items-center ui:gap-2 ui:font-control ui:text-control-md ui:whitespace-nowrap ui:no-underline ui:decoration-current',
			'ui:text-text-soft ui:hover:not-[[aria-current]]:text-text',
			still,
			focusRingInset,
		],
		indicator: 'ui:hidden',
	},
	variants: {
		variant: {
			underline: {
				base: 'ui:flex ui:gap-1 ui:border-b-(length:--ui-border-width) ui:border-b-border',
				link: [
					'ui:min-h-(--ui-control-height-lg) ui:rounded-t-md ui:rounded-b-none ui:p-(--ui-control-padding-md) ui:transition-[color] ui:duration-(--ui-duration-fast)',
					'ui:[&[aria-current]]:text-text',
					'ui:[&[aria-current]]:[box-shadow:inset_0_calc(var(--ui-tabs-indicator-height)*-1)_var(--ui-color-primary)]',
					'ui:supports-[anchor-name:--tabs-current]:[&[aria-current]]:[anchor-name:--tabs-current] ui:supports-[anchor-name:--tabs-current]:[&[aria-current]]:[box-shadow:none]',
				],
				indicator: [
					'ui:supports-[anchor-name:--tabs-current]:group-has-[a[aria-current]]/tabs:block',
					'ui:supports-[anchor-name:--tabs-current]:absolute ui:supports-[anchor-name:--tabs-current]:[position-anchor:--tabs-current]',
					'ui:supports-[anchor-name:--tabs-current]:top-[calc(anchor(bottom)-var(--ui-tabs-indicator-height))] ui:supports-[anchor-name:--tabs-current]:left-[anchor(left)]',
					'ui:supports-[anchor-name:--tabs-current]:w-[anchor-size(width)] ui:supports-[anchor-name:--tabs-current]:h-(--ui-tabs-indicator-height)',
					'ui:supports-[anchor-name:--tabs-current]:bg-primary ui:supports-[anchor-name:--tabs-current]:pointer-events-none',
					'ui:supports-[anchor-name:--tabs-current]:transition-[left,width] ui:supports-[anchor-name:--tabs-current]:duration-(--ui-duration-base) ui:supports-[anchor-name:--tabs-current]:ease-out',
					// A navigation moves it with its View Transition, also when each page mounts its own tabs: the
					// `left` transition would still be at the old place when the new page is captured.
					'ui:supports-[anchor-name:--tabs-current]:[html:active-view-transition-type(meeko-route)_&]:group-has-[a[aria-current]]/tabs:[view-transition-name:ui-navigation-tabs-indicator]',
					'ui:supports-[anchor-name:--tabs-current]:[html:active-view-transition-type(meeko-route)_&]:group-has-[a[aria-current]]/tabs:transition-none',
					still,
				],
			},
			segmented: {
				base: 'ui:inline-flex ui:max-w-full ui:gap-0.5 ui:rounded-lg ui:border-(length:--ui-border-width) ui:border-control-border ui:bg-control ui:p-0.5',
				link: [
					'ui:min-h-(--ui-control-height-sm) ui:rounded-md ui:px-3 ui:py-0',
					'ui:transition-[background-color,color] ui:duration-(--ui-duration-fast)',
					'ui:hover:not-[[aria-current]]:bg-control-hover',
					'ui:[&[aria-current]]:bg-primary-soft ui:[&[aria-current]]:font-semibold ui:[&[aria-current]]:text-primary-text',
				],
			},
		},
	},
	defaultVariants: {
		variant: 'underline',
	},
})

/** The look of <UIBreadcrumb>: an ordered list whose steps a slash divides. */
export const breadcrumb = tv({
	slots: {
		base: 'ui:font-sans ui:text-sm ui:text-text-soft',
		list: 'ui:m-0 ui:flex ui:list-none ui:flex-wrap ui:items-center ui:gap-x-1.5 ui:gap-y-1 ui:p-0',
		item: "ui:inline-flex ui:min-w-0 ui:items-center ui:gap-1.5 ui:not-first:before:opacity-(--ui-opacity-subtle) ui:not-first:before:content-['/'_/_'']",
		link: [
			'ui:rounded-xs ui:text-inherit ui:no-underline ui:decoration-current ui:hover:text-text ui:hover:underline ui:hover:underline-offset-(--ui-underline-offset)',
			'ui:transition-[color] ui:duration-(--ui-duration-fast)',
			still,
			focusRing,
		],
		current: 'ui:aria-[current=page]:font-medium ui:aria-[current=page]:text-text',
	},
})

/** The look of <UIPageNavigation>: the previous page and the next one, in one column on a phone. */
export const pageNavigation = tv({
	slots: {
		base: 'ui:grid ui:grid-cols-2 ui:gap-3 ui:font-sans ui:max-phone:grid-cols-1',
		link: [
			'ui:grid ui:gap-1 ui:rounded-lg ui:border-(length:--ui-border-width) ui:border-border ui:px-4 ui:py-3 ui:text-text ui:no-underline ui:decoration-current ui:wrap-anywhere',
			'ui:hover:border-border-strong ui:hover:bg-control-hover',
			'ui:transition-[border-color,background-color] ui:duration-(--ui-duration-fast)',
			still,
			focusRing,
		],
		hint: 'ui:flex ui:items-center ui:gap-1.5 ui:text-sm ui:text-text-soft',
		label: 'ui:text-md ui:font-medium',
		// The arrows point the way of the reading.
		icon: 'ui:rtl:[scale:-1_1]',
	},
})

/** What the link to the next page adds: the second column, and its text at the end. */
export const pageNavigationNext = {
	link: 'ui:col-start-2 ui:text-end ui:max-phone:col-start-auto',
	hint: 'ui:justify-end',
}

/** The look of <UIPagination>: the count, and the action at the end of the row. */
export const pagination = tv({
	slots: {
		base: 'ui:flex ui:flex-wrap ui:items-center ui:justify-between ui:gap-x-4 ui:gap-y-2 ui:font-sans',
		count: 'ui:m-0 ui:text-sm ui:text-text-soft ui:[font-variant-numeric:tabular-nums]',
		// An outline button (variants/button) at the end of the row, with a spinner while the next page loads.
		action: ['ui:ms-auto', disabledBusy],
	},
})

/** The look of <UITableOfContents>: a column of links, or a <details> that holds them. */
export const tableOfContents = tv({
	slots: {
		base: 'ui:font-sans ui:text-md ui:leading-normal ui:text-text-soft',
		title: 'ui:mx-0 ui:mt-0 ui:mb-2 ui:font-medium ui:text-text',
		list: 'ui:m-0 ui:list-none ui:p-0',
		// The collapsible view: inside <UIPage> (its `group/page`), only below `desktop`, where variants/page
		// hides the aside with the same breakpoint.
		collapsible: [
			'ui:rounded-lg ui:border-(length:--ui-border-width) ui:border-border ui:font-sans ui:text-md',
			'ui:group-[&]/page:mb-8 ui:group-[&]/page:hidden ui:max-desktop:group-[&]/page:block',
		],
		summary: [
			'ui:flex ui:cursor-pointer ui:list-none ui:items-center ui:justify-between ui:rounded-lg ui:px-3 ui:py-2 ui:font-medium ui:text-text',
			'ui:[&::-webkit-details-marker]:hidden',
			focusRingInset,
		],
		chevron,
		panel: 'ui:max-h-(--ui-toc-max-height) ui:overflow-y-auto ui:border-t-(length:--ui-border-width) ui:border-t-border ui:px-3 ui:pt-2 ui:pb-3',
		link: [
			'ui:block ui:border-s-(length:--ui-border-width) ui:border-s-border ui:py-1 ui:text-inherit ui:no-underline ui:decoration-current ui:hover:text-text',
			'ui:transition-[color,border-color] ui:duration-(--ui-duration-fast)',
			still,
			focusRingInset,
		],
	},
})

/**
 * What a link of <UITableOfContents> adds by its place: the indent of a nested entry, and the accent on the
 * edge of the active one, which `scroll-target-group` paints without a script where it exists
 * (`tracking: auto`), and `aria-current` everywhere else.
 */
export const tableOfContentsLink = tv({
	variants: {
		nested: {
			0: 'ui:ps-3',
			1: 'ui:ps-6',
			2: 'ui:ps-8',
		},
		tracking: {
			auto: [
				'ui:supports-[scroll-target-group:auto]:[&:target-current]:border-s-primary ui:supports-[scroll-target-group:auto]:[&:target-current]:text-text',
				'ui:not-supports-[scroll-target-group:auto]:aria-[current=location]:border-s-primary ui:not-supports-[scroll-target-group:auto]:aria-[current=location]:text-text',
			],
			manual: 'ui:aria-[current=location]:border-s-primary ui:aria-[current=location]:text-text',
		},
	},
	defaultVariants: {
		nested: 0,
		tracking: 'auto',
	},
})

/** The list of <UITableOfContents> in `tracking: auto`, the group whose current target the browser follows. */
export const tableOfContentsTracking = 'ui:supports-[scroll-target-group:auto]:[scroll-target-group:auto]'
