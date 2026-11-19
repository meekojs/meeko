// The look of <UIHeader>, <UIFooter> and the brand they share. Each property is set by one part only.
import { tv } from 'tailwind-variants/lite'

import { focusRing } from './focus'

/** The link to the home page: logo, name and product. On a narrow phone the name can give way. */
export const brand = tv({
	slots: {
		base: [
			'ui:inline-flex ui:flex-none ui:items-center ui:gap-2 ui:rounded-md',
			'ui:text-md ui:font-semibold ui:tracking-snug ui:text-text ui:no-underline ui:decoration-current',
			focusRing,
		],
		// It grows with the text beside it; the width and height attributes keep its proportion.
		image: 'ui:block ui:h-(--ui-brand-image-height) ui:w-auto',
		name: '',
		product: 'ui:font-semibold ui:text-primary-text',
	},
	variants: {
		/** The name hides on a narrow phone, when a product or the logo still say whose site it is. */
		yields: {
			true: { name: 'ui:max-phone:hidden' },
			false: '',
		},
	},
	defaultVariants: {
		yields: false,
	},
})

/** A link of the bar and of its menu: soft text, a background on hover and on the current page. */
const headerLink = [
	'ui:flex ui:items-center ui:rounded-md ui:p-(--ui-control-padding-md) ui:min-h-(--ui-control-height-md)',
	'ui:font-control ui:text-control-md ui:whitespace-nowrap ui:no-underline ui:decoration-current',
	'ui:text-text-soft ui:hover:bg-control-hover ui:hover:text-text',
	'ui:[&[aria-current]]:bg-control-active ui:[&[aria-current]]:text-text',
	'ui:transition-[background-color,color] ui:duration-(--ui-duration-fast) ui:motion-reduce:transition-none ui:motion-reduce:duration-0',
	focusRing,
]

/**
 * The look of <UIHeader>: a bar of a fixed height. Below a tablet the links leave the bar for a native
 * popover menu, which floats under it.
 */
export const header = tv({
	slots: {
		base: 'ui:z-(--ui-z-sticky) ui:border-b-(length:--ui-border-width) ui:border-b-border ui:bg-bg ui:font-sans ui:text-text',
		// The bar shares its element with a <UIContainer>, which sets its width.
		bar: 'ui:flex ui:h-(--ui-header-height) ui:items-center ui:gap-6',
		// When the links do not fit next to the actions they scroll sideways, and never overlap them. The
		// padding keeps the focus ring inside the scroll box.
		nav: 'ui:flex ui:min-w-0 ui:flex-1 ui:items-center ui:gap-1 ui:overflow-x-auto ui:py-1 ui:[scrollbar-width:none] ui:max-tablet:hidden',
		link: headerLink,
		actions: 'ui:ms-auto ui:flex ui:flex-none ui:items-center ui:gap-2',
		toggle: [
			'ui:hidden ui:max-tablet:inline-flex ui:size-(--ui-control-height-md) ui:cursor-pointer ui:items-center ui:justify-center',
			'ui:rounded-md ui:border-(length:--ui-border-width) ui:border-border ui:bg-transparent ui:text-text ui:hover:bg-control-hover',
			focusRing,
		],
		// A popover the width of the screen, under the bar. Only its bottom edge has a border.
		menu: [
			'ui:fixed ui:inset-x-0 ui:top-(--ui-header-height) ui:bottom-auto ui:m-0 ui:w-full ui:max-h-[calc(100dvh-var(--ui-header-height))] ui:overflow-y-auto',
			'ui:[border-width:0_0_var(--ui-border-width)] ui:[border-style:none_none_solid] ui:border-b-border ui:bg-surface-raised ui:text-text ui:[box-shadow:var(--ui-shadow-md)]',
			'ui:px-(--ui-container-gutter-md) ui:pt-2 ui:pb-4',
		],
		menuNav: 'ui:grid ui:gap-0.5',
	},
	variants: {
		sticky: {
			// It stays on top, and a heading reached by an anchor stays clear of it.
			true: { base: 'ui:sticky ui:top-0 ui:[:root:has(&)]:[scroll-padding-block-start:calc(var(--ui-header-height)+var(--ui-space-4))]' },
			false: '',
		},
	},
	defaultVariants: {
		sticky: true,
	},
})

/** A plain link of the footer: its text color until the pointer is on it. */
const footerLink = [
	'ui:text-inherit ui:no-underline ui:decoration-current ui:hover:text-text ui:hover:underline ui:hover:underline-offset-(--ui-underline-offset)',
	'ui:transition-[color] ui:duration-(--ui-duration-fast) ui:motion-reduce:transition-none ui:motion-reduce:duration-0',
	focusRing,
]

/** The look of <UIFooter>: about, columns of links and a legal row, in one column below a tablet. */
export const footer = tv({
	slots: {
		base: [
			'ui:border-t-(length:--ui-border-width) ui:border-t-border ui:font-sans ui:text-sm ui:leading-normal ui:text-text-soft',
			// The links an application writes in the snippets, without a class of their own, look like the footer's.
			'ui:[&_a:not([class])]:text-inherit ui:[&_a:not([class])]:no-underline ui:[&_a:not([class])]:decoration-current ui:[&_a:not([class]):hover]:text-text ui:[&_a:not([class]):hover]:underline ui:[&_a:not([class]):hover]:underline-offset-(--ui-underline-offset)',
			'ui:[&_a:not([class])]:transition-[color] ui:[&_a:not([class])]:duration-(--ui-duration-fast) ui:motion-reduce:[&_a:not([class])]:transition-none ui:motion-reduce:[&_a:not([class])]:duration-0',
			'ui:[&_a:not([class]):focus-visible]:outline-(length:--ui-focus-ring-width) ui:[&_a:not([class]):focus-visible]:outline-solid ui:[&_a:not([class]):focus-visible]:outline-focus ui:[&_a:not([class]):focus-visible]:outline-offset-(--ui-focus-ring-offset)',
		],
		// The inner row shares its element with a <UIContainer>, which sets its width.
		inner: 'ui:grid ui:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] ui:gap-x-8 ui:gap-y-10 ui:py-10 ui:max-tablet:grid-cols-[minmax(0,1fr)]',
		// Its paragraphs, the description or those of the `about` snippet, keep a measure.
		about: 'ui:grid ui:[align-content:start] ui:justify-items-start ui:gap-3 ui:[&_p]:m-0 ui:[&_p]:max-w-(--ui-prose-measure)',
		actions: 'ui:flex ui:flex-wrap ui:items-center ui:gap-2',
		groups: 'ui:grid ui:grid-cols-[repeat(auto-fit,minmax(var(--ui-table-column-min),1fr))] ui:gap-8',
		title: 'ui:mx-0 ui:mt-0 ui:mb-3 ui:font-medium ui:text-text',
		list: 'ui:m-0 ui:grid ui:list-none ui:gap-2 ui:p-0',
		link: footerLink,
		// Alone, the legal row needs no line above it.
		legal: [
			'ui:col-span-full ui:flex ui:flex-wrap ui:items-center ui:justify-between ui:gap-x-6 ui:gap-y-3 ui:text-sm',
			'ui:[border-top:var(--ui-border-width)_solid_var(--ui-color-border)] ui:pt-5 ui:only:[border-top:0] ui:only:pt-0',
		],
		legalNav: 'ui:flex ui:flex-wrap ui:gap-x-4 ui:gap-y-2',
	},
})
