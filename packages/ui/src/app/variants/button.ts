import type { VariantProps } from 'tailwind-variants/lite'

// The look of <UIButton> and <UILink>, also used by the components that render a native <a> or <button>
// with that look (Pagination, Drawer, LocaleSuggestion). Each property is set by one part only: without
// tailwind-merge two classes of the same property would be decided by the order of the stylesheet.
import { tv } from 'tailwind-variants/lite'

export const button = tv({
	base: [
		'ui:m-0 ui:box-border ui:inline-flex ui:cursor-pointer ui:items-center ui:justify-center ui:gap-1.5',
		'ui:border-(length:--ui-border-width) ui:font-sans ui:font-control ui:leading-tight ui:tracking-snug',
		'ui:indent-0 ui:text-center ui:whitespace-nowrap ui:normal-case ui:no-underline ui:[text-shadow:none] ui:[word-spacing:normal]',
		'ui:transition-[background-color,border-color] ui:duration-(--ui-duration-fast) ui:motion-reduce:transition-none',
		'ui:focus-visible:outline-(length:--ui-focus-ring-width) ui:focus-visible:outline-focus ui:focus-visible:outline-offset-(--ui-focus-ring-offset) ui:focus-visible:outline-solid',
		'ui:disabled:cursor-not-allowed ui:disabled:opacity-(--ui-opacity-disabled)',
		// Busy: a spinner before the text, and the pointer says so.
		'ui:aria-busy:cursor-progress',
		'ui:aria-busy:before:box-border ui:aria-busy:before:size-(--ui-icon-size-sm) ui:aria-busy:before:flex-none ui:aria-busy:before:rounded-full',
		'ui:aria-busy:before:border-(length:--ui-focus-ring-width) ui:aria-busy:before:border-current ui:aria-busy:before:border-e-transparent',
		'ui:aria-busy:before:animate-spin ui:motion-reduce:aria-busy:before:animate-none',
	],
	variants: {
		variant: {
			primary: '',
			secondary: '',
			outline: '',
			ghost: '',
		},
		tone: {
			neutral: '',
			danger: '',
		},
		size: {
			sm: 'ui:min-h-(--ui-control-height-sm) ui:text-control-sm',
			md: 'ui:min-h-(--ui-control-height-md) ui:text-control-md',
			lg: 'ui:min-h-(--ui-control-height-lg) ui:text-control-lg',
		},
		shape: {
			rounded: 'ui:rounded-md',
			pill: 'ui:rounded-full',
		},
		iconOnly: {
			true: 'ui:p-0 ui:[&>svg]:size-(--ui-icon-size) ui:[&>svg]:flex-none ui:aria-busy:*:hidden',
			false: '',
		},
	},
	compoundVariants: [
		// Padding and width: a button with text grows with it, an icon is a square.
		{ iconOnly: false, size: 'sm', class: 'ui:p-(--ui-control-padding-sm)' },
		{ iconOnly: false, size: 'md', class: 'ui:p-(--ui-control-padding-md)' },
		{ iconOnly: false, size: 'lg', class: 'ui:p-(--ui-control-padding-lg)' },
		{ iconOnly: true, size: 'sm', class: 'ui:min-w-(--ui-control-height-sm)' },
		{ iconOnly: true, size: 'md', class: 'ui:min-w-(--ui-control-height-md)' },
		{ iconOnly: true, size: 'lg', class: 'ui:min-w-(--ui-control-height-lg)' },
		// Colors: one combination of variant and tone each.
		{
			variant: 'primary',
			tone: 'neutral',
			class: 'ui:border-transparent ui:bg-primary ui:text-primary-contrast ui:not-disabled:hover:bg-primary-hover ui:not-disabled:active:bg-primary-active',
		},
		{
			variant: ['secondary', 'outline', 'ghost'],
			tone: 'neutral',
			class: 'ui:text-text ui:not-disabled:hover:bg-control-hover ui:not-disabled:active:bg-control-active',
		},
		{ variant: 'secondary', tone: 'neutral', class: 'ui:border-border ui:bg-control' },
		{ variant: 'outline', tone: 'neutral', class: 'ui:border-control-border ui:bg-transparent' },
		{ variant: 'ghost', tone: 'neutral', class: 'ui:border-transparent ui:bg-transparent' },
		{
			variant: 'primary',
			tone: 'danger',
			class: 'ui:border-transparent ui:bg-danger ui:text-danger-contrast ui:not-disabled:hover:bg-danger-hover ui:not-disabled:hover:text-danger-contrast-hover ui:not-disabled:active:bg-danger-hover ui:not-disabled:active:text-danger-contrast-hover',
		},
		{
			variant: ['secondary', 'outline', 'ghost'],
			tone: 'danger',
			class: 'ui:text-danger-text ui:not-disabled:hover:bg-danger-soft ui:not-disabled:active:bg-danger-soft',
		},
		{ variant: 'secondary', tone: 'danger', class: 'ui:border-danger-border ui:bg-danger-soft' },
		{ variant: 'outline', tone: 'danger', class: 'ui:border-danger-border ui:bg-transparent' },
		{ variant: 'ghost', tone: 'danger', class: 'ui:border-transparent ui:bg-transparent' },
	],
	defaultVariants: {
		variant: 'primary',
		tone: 'neutral',
		size: 'md',
		shape: 'rounded',
		iconOnly: false,
	},
})

export type ButtonVariants = VariantProps<typeof button>

/**
 * The spinner of a busy button for an element that cannot take `aria-busy`, such as the "more" link of
 * Pagination, which marks itself with `aria-disabled` while the next page loads.
 */
export const disabledBusy = [
	'ui:aria-disabled:cursor-progress',
	'ui:aria-disabled:before:box-border ui:aria-disabled:before:size-(--ui-icon-size-sm) ui:aria-disabled:before:flex-none ui:aria-disabled:before:rounded-full',
	'ui:aria-disabled:before:border-(length:--ui-focus-ring-width) ui:aria-disabled:before:border-current ui:aria-disabled:before:border-e-transparent',
	'ui:aria-disabled:before:animate-spin ui:motion-reduce:aria-disabled:before:animate-none',
].join(' ')
