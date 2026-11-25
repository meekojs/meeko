// The look of <UIContainer>, also the width of the bars of <UIHeader> and <UIFooter>. An app widens or narrows
// every container with --ui-container-max-width and --ui-container-gutter, over the preset of `size` and `gutter`.
import { tv } from '../utils/theme'

export const container = tv({
	base: 'mx-auto box-border w-full min-w-0',
	variants: {
		size: {
			sm: 'max-w-[var(--ui-container-max-width,var(--ui-container-sm))]',
			md: 'max-w-[var(--ui-container-max-width,var(--ui-container-md))]',
			lg: 'max-w-[var(--ui-container-max-width,var(--ui-container-lg))]',
			xl: 'max-w-[var(--ui-container-max-width,var(--ui-container-xl))]',
			'2xl': 'max-w-[var(--ui-container-max-width,var(--ui-container-2xl))]',
			'3xl': 'max-w-[var(--ui-container-max-width,var(--ui-container-3xl))]',
			'4k': 'max-w-[var(--ui-container-max-width,var(--ui-container-4k))]',
			full: 'max-w-[var(--ui-container-max-width,none)]',
		},
		// `none` lets a container nest in another without doubling the gutter.
		gutter: {
			none: 'px-[var(--ui-container-gutter,0)]',
			sm: 'px-[var(--ui-container-gutter,var(--ui-container-gutter-sm))]',
			md: 'px-[var(--ui-container-gutter,var(--ui-container-gutter-md))]',
			lg: 'px-[var(--ui-container-gutter,var(--ui-container-gutter-lg))]',
		},
	},
	defaultVariants: {
		size: 'xl',
		gutter: 'md',
	},
})
