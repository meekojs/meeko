// The look of <UIContainer>, also the width of the bars of <UIHeader> and <UIFooter>. An app widens or narrows
// every container with --ui-container-max-width and --ui-container-gutter, over the preset of `size` and `gutter`.
import { tv } from 'tailwind-variants/lite'

export const container = tv({
	base: 'ui:mx-auto ui:box-border ui:w-full ui:min-w-0',
	variants: {
		size: {
			sm: 'ui:max-w-[var(--ui-container-max-width,var(--ui-container-sm))]',
			md: 'ui:max-w-[var(--ui-container-max-width,var(--ui-container-md))]',
			lg: 'ui:max-w-[var(--ui-container-max-width,var(--ui-container-lg))]',
			xl: 'ui:max-w-[var(--ui-container-max-width,var(--ui-container-xl))]',
			'2xl': 'ui:max-w-[var(--ui-container-max-width,var(--ui-container-2xl))]',
			'3xl': 'ui:max-w-[var(--ui-container-max-width,var(--ui-container-3xl))]',
			'4k': 'ui:max-w-[var(--ui-container-max-width,var(--ui-container-4k))]',
			full: 'ui:max-w-[var(--ui-container-max-width,none)]',
		},
		// `none` lets a container nest in another without doubling the gutter.
		gutter: {
			none: 'ui:px-[var(--ui-container-gutter,0)]',
			sm: 'ui:px-[var(--ui-container-gutter,var(--ui-container-gutter-sm))]',
			md: 'ui:px-[var(--ui-container-gutter,var(--ui-container-gutter-md))]',
			lg: 'ui:px-[var(--ui-container-gutter,var(--ui-container-gutter-lg))]',
		},
	},
	defaultVariants: {
		size: 'xl',
		gutter: 'md',
	},
})
