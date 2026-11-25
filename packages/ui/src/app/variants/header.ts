// The look of <UIHeader>, <UIFooter> and the brand they share. Each property is set by one part only.
import { tv } from 'tailwind-variants/lite'

import { focusRing } from './focus'

/** The link to the home page: logo, name and product. On a narrow phone the name can give way. */
export const brand = tv({
	slots: {
		base: [
			'inline-flex flex-none items-center gap-2 rounded-md',
			'text-md font-semibold tracking-snug text-text no-underline decoration-current',
			focusRing,
		],
		// It grows with the text beside it; the width and height attributes keep its proportion.
		image: 'block h-(--ui-brand-image-height) w-auto',
		name: '',
		product: 'font-semibold text-primary-text',
	},
	variants: {
		/** The name hides on a narrow phone, when a product or the logo still say whose site it is. */
		yields: {
			true: { name: 'max-phone:hidden' },
			false: '',
		},
	},
	defaultVariants: {
		yields: false,
	},
})

/** A link of the bar and of its menu: soft text, a background on hover and on the current page. */
const headerLink = [
	'flex items-center rounded-md p-(--ui-control-padding-md) min-h-(--ui-control-height-md)',
	'font-control text-control-md whitespace-nowrap no-underline decoration-current',
	'text-text-soft hover:bg-control-hover hover:text-text',
	'[&[aria-current]]:bg-control-active [&[aria-current]]:text-text',
	'transition-[background-color,color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
	focusRing,
]

/**
 * The look of <UIHeader>: a bar of a fixed height. Below a tablet the links leave the bar for a native
 * popover menu, which floats under it.
 */
export const header = tv({
	slots: {
		base: 'z-(--ui-z-sticky) border-b-(length:--ui-border-width) border-b-border bg-bg font-sans text-text',
		// The bar shares its element with a <UIContainer>, which sets its width.
		bar: 'flex h-(--ui-header-height) items-center gap-6',
		// When the links do not fit next to the actions they scroll sideways, and never overlap them. The
		// padding keeps the focus ring inside the scroll box.
		nav: 'flex min-w-0 flex-1 items-center gap-1 overflow-x-auto py-1 [scrollbar-width:none] max-tablet:hidden',
		link: headerLink,
		actions: 'ms-auto flex flex-none items-center gap-2',
		toggle: [
			'hidden max-tablet:inline-flex size-(--ui-control-height-md) cursor-pointer items-center justify-center',
			'rounded-md border-(length:--ui-border-width) border-border bg-transparent text-text hover:bg-control-hover',
			focusRing,
		],
		// A popover the width of the screen, under the bar. Only its bottom edge has a border.
		menu: [
			'fixed inset-x-0 top-(--ui-header-height) bottom-auto m-0 w-full max-h-[calc(100dvh-var(--ui-header-height))] overflow-y-auto',
			'[border-width:0_0_var(--ui-border-width)] [border-style:none_none_solid] border-b-border bg-surface-raised text-text [box-shadow:var(--ui-shadow-md)]',
			'px-(--ui-container-gutter-md) pt-2 pb-4',
		],
		menuNav: 'grid gap-0.5',
	},
	variants: {
		sticky: {
			// It stays on top, and a heading reached by an anchor stays clear of it.
			true: { base: 'sticky top-0 [:root:has(&)]:[scroll-padding-block-start:calc(var(--ui-header-height)+var(--ui-space-4))]' },
			false: '',
		},
	},
	defaultVariants: {
		sticky: true,
	},
})

/** A plain link of the footer: its text color until the pointer is on it. */
const footerLink = [
	'text-inherit no-underline decoration-current hover:text-text hover:underline hover:underline-offset-(--ui-underline-offset)',
	'transition-[color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
	focusRing,
]

/** The look of <UIFooter>: about, columns of links and a legal row, in one column below a tablet. */
export const footer = tv({
	slots: {
		base: [
			'border-t-(length:--ui-border-width) border-t-border font-sans text-sm leading-normal text-text-soft',
			// The links an application writes in the snippets, without a class of their own, look like the footer's.
			'[&_a:not([class])]:text-inherit [&_a:not([class])]:no-underline [&_a:not([class])]:decoration-current [&_a:not([class]):hover]:text-text [&_a:not([class]):hover]:underline [&_a:not([class]):hover]:underline-offset-(--ui-underline-offset)',
			'[&_a:not([class])]:transition-[color] [&_a:not([class])]:duration-(--ui-duration-fast) motion-reduce:[&_a:not([class])]:transition-none motion-reduce:[&_a:not([class])]:duration-0',
			'[&_a:not([class]):focus-visible]:outline-(length:--ui-focus-ring-width) [&_a:not([class]):focus-visible]:outline-solid [&_a:not([class]):focus-visible]:outline-focus [&_a:not([class]):focus-visible]:outline-offset-(--ui-focus-ring-offset)',
		],
		// The inner row shares its element with a <UIContainer>, which sets its width.
		inner: 'grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-x-8 gap-y-10 py-10 max-tablet:grid-cols-[minmax(0,1fr)]',
		// Its paragraphs, the description or those of the `about` snippet, keep a measure.
		about: 'grid [align-content:start] justify-items-start gap-3 [&_p]:m-0 [&_p]:max-w-(--ui-prose-measure)',
		actions: 'flex flex-wrap items-center gap-2',
		groups: 'grid grid-cols-[repeat(auto-fit,minmax(var(--ui-table-column-min),1fr))] gap-8',
		title: 'mx-0 mt-0 mb-3 font-medium text-text',
		list: 'm-0 grid list-none gap-2 p-0',
		link: footerLink,
		// Alone, the legal row needs no line above it.
		legal: [
			'col-span-full flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-sm',
			'[border-top:var(--ui-border-width)_solid_var(--ui-color-border)] pt-5 only:[border-top:0] only:pt-0',
		],
		legalNav: 'flex flex-wrap gap-x-4 gap-y-2',
	},
})
