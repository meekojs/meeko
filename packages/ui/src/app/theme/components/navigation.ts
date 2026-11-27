// The look of the lists of links: <UINavigationTree>, <UINavigationTabs>, <UIBreadcrumb>, <UIPageNavigation>,
// <UIPagination> and <UITableOfContents>. Each property is set by one part only; what a component decides
// by itself (a group that folds, the next page, a nested entry…) lives in its own constant or defineTheme(), so that
// it never becomes a prop.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { focusRing, focusRingInset } from '../base/focus'
import { disabledBusy } from './button'

/** No transition when the reader asks for less motion. */
const still = 'motion-reduce:transition-none motion-reduce:duration-0'

/**
 * The chevron of a <details> that folds: it points to the text while closed, and down when open. Also used
 * by <UIDisclosure>.
 */
export const chevron = [
	'-rotate-90 rtl:rotate-90 [details[open]>summary>&]:rotate-0 text-text-soft',
	'transition-[rotate] duration-(--ui-duration-base) ease-out',
	still,
].join(' ')

/** The look of <UINavigationTree>: groups that fold with a native <details>, and their links. */
export const navigationTreeTheme = defineTheme({
	slots: {
		base: 'grid grid-cols-[minmax(0,1fr)] gap-5 font-sans text-md text-text-soft',
		// Where the browser animates to `auto`, a group opens and closes by its height.
		group: [
			'supports-[interpolate-size:allow-keywords]:[interpolate-size:allow-keywords]',
			'supports-[interpolate-size:allow-keywords]:details-content:[block-size:0] supports-[interpolate-size:allow-keywords]:details-content:overflow-clip',
			'supports-[interpolate-size:allow-keywords]:details-content:[transition:block-size_var(--ui-duration-base)_var(--ui-ease-out),content-visibility_var(--ui-duration-base)_allow-discrete]',
			'supports-[interpolate-size:allow-keywords]:open:details-content:[block-size:auto]',
			'motion-reduce:details-content:[transition:none]',
		],
		// The title of a group: a <summary> when the group folds (`foldingTitle`), a <p> otherwise.
		title: 'm-0 flex items-center justify-between gap-2 rounded-sm px-2 py-1 text-md font-medium text-text',
		titleText: 'inline-flex min-w-0 items-center gap-2',
		chevron,
		list: 'mx-0 mt-1 mb-0 grid list-none grid-cols-[minmax(0,1fr)] gap-0.5 p-0',
		link: [
			'flex items-center gap-2 rounded-sm px-2 py-1 text-md leading-normal text-inherit no-underline decoration-current',
			'hover:bg-control-hover hover:text-text',
			'[&[aria-current]]:bg-primary-soft [&[aria-current]]:font-medium [&[aria-current]]:text-primary-text',
			'transition-[background-color,color] duration-(--ui-duration-fast) ease-[ease]',
			still,
			focusRingInset,
		],
		label: 'min-w-0',
		empty: 'px-2 py-1 text-md',
	},
})

/** The title of a group of <UINavigationTree> that folds: its <summary>, without the marker. */
export const foldingTitle = ['cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-control-hover', focusRingInset].join(' ')

/** The text of a link of <UINavigationTree> whose label is code: one line of monospace. */
export const codeLabel = 'overflow-hidden font-mono text-md text-ellipsis whitespace-nowrap'

/**
 * The look of <UINavigationTabs>, by its `layout`. `underline`: a row whose indicator follows the current link with CSS
 * anchor positioning, and where that is missing the link marks itself; `position` makes the row the box of
 * the indicator, which scrolls with it. `segmented`: the look of a segmented <UIRadioGroup>, without the
 * indicator.
 */
export const navigationTabsTheme = defineTheme({
	slots: {
		base: 'group/tabs relative overflow-x-auto font-sans [anchor-scope:--tabs-current] [scrollbar-width:none]',
		link: [
			'flex flex-none items-center gap-2 font-control text-control-md whitespace-nowrap no-underline decoration-current',
			'text-text-soft hover:not-[[aria-current]]:text-text',
			still,
			focusRingInset,
		],
		indicator: 'hidden',
	},
	variants: {
		layout: {
			underline: {
				base: 'flex gap-1 border-b-(length:--ui-border-width) border-b-border',
				link: [
					'min-h-(--ui-control-height-lg) rounded-t-md rounded-b-none p-(--ui-control-padding-md) transition-[color] duration-(--ui-duration-fast) ease-[ease]',
					'[&[aria-current]]:text-text',
					'[&[aria-current]]:[box-shadow:inset_0_calc(var(--ui-tabs-indicator-height)*-1)_var(--ui-color-primary)]',
					'supports-[anchor-name:--tabs-current]:[&[aria-current]]:[anchor-name:--tabs-current] supports-[anchor-name:--tabs-current]:[&[aria-current]]:[box-shadow:none]',
				],
				indicator: [
					'supports-[anchor-name:--tabs-current]:group-has-[a[aria-current]]/tabs:block',
					'supports-[anchor-name:--tabs-current]:absolute supports-[anchor-name:--tabs-current]:[position-anchor:--tabs-current]',
					'supports-[anchor-name:--tabs-current]:top-[calc(anchor(bottom)-var(--ui-tabs-indicator-height))] supports-[anchor-name:--tabs-current]:left-[anchor(left)]',
					'supports-[anchor-name:--tabs-current]:w-[anchor-size(width)] supports-[anchor-name:--tabs-current]:h-(--ui-tabs-indicator-height)',
					'supports-[anchor-name:--tabs-current]:bg-primary supports-[anchor-name:--tabs-current]:pointer-events-none',
					'supports-[anchor-name:--tabs-current]:transition-[left,width] supports-[anchor-name:--tabs-current]:duration-(--ui-duration-base) supports-[anchor-name:--tabs-current]:ease-out',
					// A navigation moves it with its View Transition, also when each page mounts its own tabs: the
					// `left` transition would still be at the old place when the new page is captured.
					'supports-[anchor-name:--tabs-current]:[html:active-view-transition-type(meeko-route)_&]:group-has-[a[aria-current]]/tabs:[view-transition-name:ui-navigation-tabs-indicator]',
					'supports-[anchor-name:--tabs-current]:[html:active-view-transition-type(meeko-route)_&]:group-has-[a[aria-current]]/tabs:transition-none',
					still,
				],
			},
			segmented: {
				base: 'inline-flex max-w-full gap-0.5 rounded-lg border-(length:--ui-border-width) border-control-border bg-control p-0.5',
				link: [
					'min-h-(--ui-control-height-sm) rounded-md px-3 py-0',
					'transition-[background-color,color] duration-(--ui-duration-fast) ease-[ease]',
					'hover:not-[[aria-current]]:bg-control-hover',
					'[&[aria-current]]:bg-primary-soft [&[aria-current]]:font-semibold [&[aria-current]]:text-primary-text',
				],
			},
		},
	},
	defaultVariants: {
		layout: 'underline',
	},
})

/** The look of <UIBreadcrumb>: an ordered list whose steps a slash divides. */
export const breadcrumbTheme = defineTheme({
	slots: {
		base: 'font-sans text-sm/[inherit] text-text-soft',
		list: 'm-0 flex list-none flex-wrap items-center gap-x-1.5 gap-y-1 p-0',
		item: "inline-flex min-w-0 items-center gap-1.5 not-first:before:opacity-(--ui-opacity-subtle) not-first:before:content-['/'_/_'']",
		link: [
			'rounded-xs text-inherit no-underline decoration-current hover:text-text hover:underline hover:underline-offset-(--ui-underline-offset)',
			'transition-[color] duration-(--ui-duration-fast) ease-[ease]',
			still,
			focusRing,
		],
		current: 'aria-[current=page]:font-medium aria-[current=page]:text-text',
	},
})

/** The look of <UIPageNavigation>: the previous page and the next one, in one column on a phone. */
export const pageNavigationTheme = defineTheme({
	slots: {
		base: 'grid grid-cols-2 gap-3 font-sans max-phone:grid-cols-1',
		link: [
			'grid gap-1 rounded-lg border-(length:--ui-border-width) border-border px-4 py-3 text-text no-underline decoration-current wrap-anywhere',
			'hover:border-border-strong hover:bg-control-hover',
			'transition-[border-color,background-color] duration-(--ui-duration-fast) ease-[ease]',
			still,
			focusRing,
		],
		hint: 'flex items-center gap-1.5 text-sm/[inherit] text-text-soft',
		label: 'text-md font-medium',
		// The arrows point the way of the reading.
		icon: 'rtl:[scale:-1_1]',
	},
})

/** What the link to the next page adds: the second column, and its text at the end. */
export const pageNavigationNext = {
	link: 'col-start-2 text-end max-phone:col-start-auto',
	hint: 'justify-end',
}

/**
 * The look of <UIPagination>: the count, and at the end of the row the action that loads more or, in the
 * numbered mode, the list of pages. Pages and controls are buttons of `size: 'sm'` (theme/components/button):
 * the current page `solid` and `primary`, the rest `ghost` and `neutral`; these slots only add what the button
 * does not decide.
 */
export const paginationTheme = defineTheme({
	slots: {
		base: 'flex flex-wrap items-center justify-between gap-x-4 gap-y-2 font-sans',
		count: 'm-0 text-sm/[inherit] text-text-soft [font-variant-numeric:tabular-nums]',
		// A neutral outline button (theme/components/button) at the end of the row, with a spinner while the next page loads.
		action: ['ms-auto', disabledBusy],
		list: 'my-0 me-0 ms-auto flex list-none flex-wrap items-center gap-1 p-0',
		item: 'flex',
		// A number is at least a square, and its figures keep their width from one page to the next.
		page: 'min-w-(--ui-control-height-sm) [font-variant-numeric:tabular-nums] aria-disabled:cursor-progress',
		// Previous, next, first and last: a square with its icon.
		control: 'aria-disabled:cursor-progress',
		// The arrows point the way of the reading.
		icon: 'rtl:[scale:-1_1]',
		ellipsis: 'inline-flex min-w-(--ui-control-height-sm) justify-center text-sm/[inherit] text-text-soft select-none',
	},
})

/** The look of <UITableOfContents>: a column of links, or a <details> that holds them. */
export const tableOfContentsTheme = defineTheme({
	slots: {
		base: 'font-sans text-md leading-normal text-text-soft',
		title: 'mx-0 mt-0 mb-2 font-medium text-text',
		list: 'm-0 list-none p-0',
		// The collapsible view: inside <UIPage> (its `group/page`), only below `desktop`, where theme/components/page
		// hides the aside with the same breakpoint.
		collapsible: [
			'rounded-lg border-(length:--ui-border-width) border-border font-sans text-md',
			'group-[&]/page:mb-8 group-[&]/page:hidden max-desktop:group-[&]/page:block',
		],
		summary: [
			'flex cursor-pointer list-none items-center justify-between rounded-lg px-3 py-2 font-medium text-text',
			'[&::-webkit-details-marker]:hidden',
			focusRingInset,
		],
		chevron,
		panel: 'max-h-(--ui-toc-max-height) overflow-y-auto border-t-(length:--ui-border-width) border-t-border px-3 pt-2 pb-3',
		link: [
			'block border-s-(length:--ui-border-width) border-s-border py-1 text-inherit no-underline decoration-current hover:text-text',
			'transition-[color,border-color] duration-(--ui-duration-fast) ease-[ease]',
			still,
			focusRingInset,
		],
	},
})

/**
 * What a link of <UITableOfContents> adds by its place: the indent of a nested entry, and the accent on the
 * edge of the active one, from its `aria-current`, which the observer of the component keeps in every browser.
 * `:target-current` would paint it with no script where `scroll-target-group` exists, but lightningcss, the
 * minifier of Vite, warns about that pseudo-class in the build of every app; the accent waits for hydration.
 */
export const tableOfContentsLinkTheme = defineTheme({
	variants: {
		nested: {
			0: 'ps-3',
			1: 'ps-6',
			2: 'ps-8',
		},
		tracking: {
			auto: 'aria-[current=location]:border-s-primary aria-[current=location]:text-text',
			manual: 'aria-[current=location]:border-s-primary aria-[current=location]:text-text',
		},
	},
	defaultVariants: {
		nested: 0,
		tracking: 'auto',
	},
})

/** The list of <UITableOfContents> in `tracking: auto`, the group whose current target the browser follows. */
export const tableOfContentsTracking = 'supports-[scroll-target-group:auto]:[scroll-target-group:auto]'

/** Variantes de la receta `navigationTreeTheme`, derivadas de ella. */
export type NavigationTreeThemeProps = ThemeVariants<typeof navigationTreeTheme>

/** Variantes de la receta `navigationTabsTheme`, derivadas de ella. */
export type NavigationTabsThemeProps = ThemeVariants<typeof navigationTabsTheme>

/** Variantes de la receta `breadcrumbTheme`, derivadas de ella. */
export type BreadcrumbThemeProps = ThemeVariants<typeof breadcrumbTheme>

/** Variantes de la receta `pageNavigationTheme`, derivadas de ella. */
export type PageNavigationThemeProps = ThemeVariants<typeof pageNavigationTheme>

/** Variantes de la receta `paginationTheme`, derivadas de ella. */
export type PaginationThemeProps = ThemeVariants<typeof paginationTheme>

/** Variantes de la receta `tableOfContentsTheme`, derivadas de ella. */
export type TableOfContentsThemeProps = ThemeVariants<typeof tableOfContentsTheme>

/** Variantes de la receta `tableOfContentsLinkTheme`, derivadas de ella. */
export type TableOfContentsLinkThemeProps = ThemeVariants<typeof tableOfContentsLinkTheme>
