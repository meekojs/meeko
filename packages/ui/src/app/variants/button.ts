import type { VariantProps } from 'tailwind-variants/lite'

// The look of <UIButton> and <UILink>, also used by the components that render a native <a> or <button>
// with that look (Pagination, Drawer, LocaleSuggestion). Each property is set by one part only: without
// tailwind-merge two classes of the same property would be decided by the order of the stylesheet.
import { tv } from 'tailwind-variants/lite'

import { buttonAppearance, type ButtonAppearance } from '../theme/recipes'

const base = [
	'meeko-ui-component m-0 box-border inline-flex cursor-pointer items-center justify-center gap-1.5',
	'border-(length:--ui-border-width) font-sans font-control leading-tight tracking-snug',
	'indent-0 text-center whitespace-nowrap normal-case no-underline [text-shadow:none] [word-spacing:normal]',
	'transition-[background-color,border-color] duration-(--ui-duration-fast) motion-reduce:transition-none',
	'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid',
	'disabled:cursor-not-allowed disabled:opacity-(--ui-opacity-disabled)',
	// Busy: a spinner before the text, and the pointer says so.
	'aria-busy:cursor-progress',
	'aria-busy:before:box-border aria-busy:before:size-(--ui-icon-size-sm) aria-busy:before:flex-none aria-busy:before:rounded-full',
	'aria-busy:before:border-(length:--ui-focus-ring-width) aria-busy:before:border-current aria-busy:before:border-e-transparent',
	'aria-busy:before:animate-spin motion-reduce:aria-busy:before:animate-none',
]

/** Aplica la apariencia al botón sin perder sus estados nativos ni el indicador de carga. */
export function buttonWithAppearance(appearance: ButtonAppearance, iconOnly: boolean, className?: string): string {
	return [
	...base,
	buttonAppearance(appearance),
	iconOnly ? 'aspect-square px-0! [&>svg]:size-(--ui-icon-size) [&>svg]:flex-none aria-busy:*:hidden' : undefined,
	className,
	].filter(Boolean).join(' ')
}

export const button = tv({
	base,
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
			sm: 'min-h-(--ui-control-height-sm) text-control-sm',
			md: 'min-h-(--ui-control-height-md) text-control-md',
			lg: 'min-h-(--ui-control-height-lg) text-control-lg',
		},
		shape: {
			rounded: 'rounded-md',
			pill: 'rounded-full',
		},
		iconOnly: {
			true: 'p-0 [&>svg]:size-(--ui-icon-size) [&>svg]:flex-none aria-busy:*:hidden',
			false: '',
		},
	},
	compoundVariants: [
		// Padding and width: a button with text grows with it, an icon is a square.
		{ iconOnly: false, size: 'sm', class: 'p-(--ui-control-padding-sm)' },
		{ iconOnly: false, size: 'md', class: 'p-(--ui-control-padding-md)' },
		{ iconOnly: false, size: 'lg', class: 'p-(--ui-control-padding-lg)' },
		{ iconOnly: true, size: 'sm', class: 'min-w-(--ui-control-height-sm)' },
		{ iconOnly: true, size: 'md', class: 'min-w-(--ui-control-height-md)' },
		{ iconOnly: true, size: 'lg', class: 'min-w-(--ui-control-height-lg)' },
		// Colors: one combination of variant and tone each.
		{
			variant: 'primary',
			tone: 'neutral',
			class: 'border-transparent bg-primary text-primary-contrast not-disabled:hover:bg-primary-hover not-disabled:active:bg-primary-active',
		},
		{
			variant: ['secondary', 'outline', 'ghost'],
			tone: 'neutral',
			class: 'text-text not-disabled:hover:bg-control-hover not-disabled:active:bg-control-active',
		},
		{ variant: 'secondary', tone: 'neutral', class: 'border-border bg-control' },
		{ variant: 'outline', tone: 'neutral', class: 'border-control-border bg-transparent' },
		{ variant: 'ghost', tone: 'neutral', class: 'border-transparent bg-transparent' },
		{
			variant: 'primary',
			tone: 'danger',
			class: 'border-transparent bg-danger text-danger-contrast not-disabled:hover:bg-danger-hover not-disabled:hover:text-danger-contrast-hover not-disabled:active:bg-danger-hover not-disabled:active:text-danger-contrast-hover',
		},
		{
			variant: ['secondary', 'outline', 'ghost'],
			tone: 'danger',
			class: 'text-danger-text not-disabled:hover:bg-danger-soft not-disabled:active:bg-danger-soft',
		},
		{ variant: 'secondary', tone: 'danger', class: 'border-danger-border bg-danger-soft' },
		{ variant: 'outline', tone: 'danger', class: 'border-danger-border bg-transparent' },
		{ variant: 'ghost', tone: 'danger', class: 'border-transparent bg-transparent' },
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
		{ variant: 'primary', tone: 'neutral', class: { base: 'aria-pressed:bg-primary-active aria-pressed:not-disabled:hover:bg-primary-active' } },
		{
			variant: ['secondary', 'outline', 'ghost'],
			tone: 'neutral',
			class: { base: 'aria-pressed:border-primary-border aria-pressed:bg-primary-soft aria-pressed:text-primary-text aria-pressed:not-disabled:hover:bg-primary-soft-hover' },
		},
		{ variant: 'primary', tone: 'danger', class: { base: 'aria-pressed:bg-danger-hover aria-pressed:text-danger-contrast-hover aria-pressed:not-disabled:hover:bg-danger-hover' } },
		{ variant: ['secondary', 'outline', 'ghost'], tone: 'danger', class: { base: 'aria-pressed:border-danger-text aria-pressed:bg-danger-soft aria-pressed:not-disabled:hover:bg-danger-soft' } },
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
	'aria-disabled:cursor-progress',
	'aria-disabled:before:box-border aria-disabled:before:size-(--ui-icon-size-sm) aria-disabled:before:flex-none aria-disabled:before:rounded-full',
	'aria-disabled:before:border-(length:--ui-focus-ring-width) aria-disabled:before:border-current aria-disabled:before:border-e-transparent',
	'aria-disabled:before:animate-spin motion-reduce:aria-disabled:before:animate-none',
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
		status: 'sr-only',
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
			class: { base: 'data-[copy-state=copied]:[color:var(--ui-copy-button-copied-color)] data-[copy-state=failed]:[color:var(--ui-copy-button-failed-color)]' },
		},
	],
	defaultVariants: {
		size: 'md',
		shape: 'rounded',
	},
})

/** A copy button that needs the script waits for it hidden, keeping its place: without JavaScript it could not copy. */
export const copyButtonWaiting = 'invisible'
