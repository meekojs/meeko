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
 * What <UIIconButton> adds to the look of `button` with `iconOnly`: the pressed state of a toggle, read from
 * `aria-pressed` so that it needs no class of its own, and the slots of its icon and of its tooltip. Its
 * variants are the ones of `button`, so that `ui.defaults.iconButton` accepts the same values: the component
 * passes them to both. Its default variant is `ghost`, the usual one of a toolbar.
 */
export const iconButton = tv({
	slots: {
		base: '',
		icon: '',
		tooltip: '',
	},
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
			sm: '',
			md: '',
			lg: '',
		},
		shape: {
			rounded: '',
			pill: '',
		},
	},
	compoundVariants: [
		// Pressed: a deeper solid, or the soft accent with its border, which the pointer does not take away.
		{ variant: 'primary', tone: 'neutral', class: { base: 'ui:aria-pressed:bg-primary-active ui:aria-pressed:not-disabled:hover:bg-primary-active' } },
		{
			variant: ['secondary', 'outline', 'ghost'],
			tone: 'neutral',
			class: { base: 'ui:aria-pressed:border-primary-border ui:aria-pressed:bg-primary-soft ui:aria-pressed:text-primary-text ui:aria-pressed:not-disabled:hover:bg-primary-soft-hover' },
		},
		{ variant: 'primary', tone: 'danger', class: { base: 'ui:aria-pressed:bg-danger-hover ui:aria-pressed:text-danger-contrast-hover ui:aria-pressed:not-disabled:hover:bg-danger-hover' } },
		{ variant: ['secondary', 'outline', 'ghost'], tone: 'danger', class: { base: 'ui:aria-pressed:border-danger-text ui:aria-pressed:bg-danger-soft ui:aria-pressed:not-disabled:hover:bg-danger-soft' } },
	],
	defaultVariants: {
		variant: 'ghost',
		tone: 'neutral',
		size: 'md',
		shape: 'rounded',
	},
})

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

/**
 * What <UICopyButton> adds to the look of `button` or of `iconButton`: the color of the result of the last
 * copy, read from `data-copy-state` and its tokens (`--ui-copy-button-copied-color`, `-failed-color`), only
 * where the text is not on a solid; and the announcement for screen readers, which takes no room. Its
 * variants are the ones of `button`, so that `ui.defaults.copyButton` accepts the same values.
 */
export const copyButton = tv({
	slots: {
		base: '',
		status: 'ui:sr-only',
	},
	variants: {
		variant: {
			primary: '',
			secondary: '',
			outline: '',
			ghost: '',
		},
		size: {
			sm: '',
			md: '',
			lg: '',
		},
		shape: {
			rounded: '',
			pill: '',
		},
	},
	compoundVariants: [
		{
			variant: ['secondary', 'outline', 'ghost'],
			class: { base: 'ui:data-[copy-state=copied]:[color:var(--ui-copy-button-copied-color)] ui:data-[copy-state=failed]:[color:var(--ui-copy-button-failed-color)]' },
		},
	],
	defaultVariants: {
		size: 'md',
		shape: 'rounded',
	},
})

/** A copy button that needs the script waits for it hidden, keeping its place: without JavaScript it could not copy. */
export const copyButtonWaiting = 'ui:invisible'
