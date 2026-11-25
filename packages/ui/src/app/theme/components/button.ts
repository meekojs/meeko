// The look of <UIButton> and <UILink>, also used by the components that paint a native <a> or <button> with
// that look (UIMenu, UIPagination, UIDrawer, UILocaleSuggestion, the confirmation of useModal). The color comes
// from the shared catalog (`appearance()`): each pair of `variant` and `color` is one compound variant with the
// steps of its scale. This recipe only adds what a button needs whatever its color: the native states (focus,
// disabled), the spinner of `aria-busy` and the square of `iconOnly`. `defineTheme` merges the classes with
// Tailwind Merge, so the `class` of the consumer wins over the one of the recipe.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { appearance } from '../base/appearance'

/** Tratamientos que admite un botón: los del catálogo salvo `plain`, que no pinta, y `glass`. */
export const buttonVariants = ['solid', 'soft', 'surface', 'outline', 'subtle', 'ghost', 'link'] as const

/** Ancho de un botón: el de su contenido o el de su contenedor. */
export const buttonWidths = ['auto', 'full'] as const

const selection = appearance({
	variant: buttonVariants,
	color: true,
	size: true,
	radius: true,
	width: buttonWidths,
	elevation: true,
})

/**
 * The structure of a button, shared with the recipes of <UIIconButton> and <UICopyButton>. A native <button>
 * starts transparent and without color of its own: the pair of `variant` and `color` paints it.
 */
export const buttonBase = [
	'meeko-ui-component m-0 box-border inline-flex cursor-pointer items-center justify-center gap-1.5',
	'border-(length:--ui-border-width) border-transparent bg-transparent font-sans font-control tracking-snug',
	'indent-0 text-center whitespace-nowrap normal-case no-underline [text-shadow:none] [word-spacing:normal]',
	'transition-[background-color,border-color,color] duration-(--ui-duration-fast) motion-reduce:transition-none',
	'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid',
	'disabled:cursor-not-allowed disabled:opacity-(--ui-opacity-disabled)',
	// Busy: a spinner before the text, and the pointer says so.
	'aria-busy:cursor-progress',
	'aria-busy:before:box-border aria-busy:before:size-(--ui-icon-size-sm) aria-busy:before:flex-none aria-busy:before:rounded-full',
	'aria-busy:before:border-(length:--ui-focus-ring-width) aria-busy:before:border-current aria-busy:before:border-e-transparent',
	'aria-busy:before:animate-spin motion-reduce:aria-busy:before:animate-none',
]

/**
 * The line height of every size. A `text-*` of the consumer keeps it, since `themeMergeConfig` does not let a
 * font size drop a `leading-*`, and a `leading-*` of the consumer replaces it.
 */
const lineHeight = { size: ['xs', 'sm', 'md', 'lg', 'xl'], class: 'leading-tight' } as const

/**
 * A neutral outline button is a form control: its border is the one of the controls, `--ui-color-control-border`,
 * with a contrast of 3:1 on every surface (tests/tokens.test.mjs), not the decorative step 7 of the scale, and the
 * pointer does not lighten it.
 */
export const controlBorder = { variant: 'outline', color: 'neutral', class: 'border-control-border not-disabled:hover:border-control-border' } as const

/** A button with only an icon: a square as tall as its size, without padding, whose icon hides while busy. */
const iconOnlyBase = '[&>svg]:size-(--ui-icon-size) [&>svg]:flex-none aria-busy:*:hidden'

/** The square of `iconOnly` for each size: after the padding of the size, so it wins. */
const iconOnlySizes = [
	{ iconOnly: true, size: 'xs', class: 'min-w-(--ui-control-height-xs) p-0' },
	{ iconOnly: true, size: 'sm', class: 'min-w-(--ui-control-height-sm) p-0' },
	{ iconOnly: true, size: 'md', class: 'min-w-(--ui-control-height-md) p-0' },
	{ iconOnly: true, size: 'lg', class: 'min-w-(--ui-control-height-lg) p-0' },
	{ iconOnly: true, size: 'xl', class: 'min-w-(--ui-control-height-xl) p-0' },
] as const

/**
 * Receta de `UIButton` y `UILink`: `variant`, `color`, `size`, `radius`, `width`, `elevation` e `iconOnly`.
 * Sin ellas es un botón sólido del color primario, de tamaño `md` y radio `md`. Sirve también para dar el
 * aspecto de un botón a un elemento propio.
 *
 * @example
 * ```ts
 * import { buttonTheme } from '@meekojs/ui/theme'
 *
 * const classes = buttonTheme({ variant: 'outline', color: 'neutral', size: 'sm', class: 'ms-auto' })
 * ```
 */
export const buttonTheme = defineTheme({
	base: buttonBase,
	variants: {
		...selection.variants,
		iconOnly: {
			true: iconOnlyBase,
			false: '',
		},
	},
	compoundVariants: [...selection.compoundVariants, controlBorder, lineHeight, ...iconOnlySizes],
	defaultVariants: { variant: 'solid', color: 'primary', size: 'md', radius: 'md', iconOnly: false },
})

/** Variantes de la receta de `UIButton`, derivadas de `buttonTheme`. */
export type ButtonThemeProps = ThemeVariants<typeof buttonTheme>

/** Tratamiento visual de un botón: `solid`, `soft`, `surface`, `outline`, `subtle`, `ghost` o `link`. */
export type UIButtonVariant = NonNullable<ButtonThemeProps['variant']>
/** Color semántico de un botón: `primary`, `secondary`, `neutral`, `success`, `info`, `warning` o `danger`. */
export type UIButtonColor = NonNullable<ButtonThemeProps['color']>
/** Tamaño de un botón, de `xs` a `xl`, sobre los tokens `--ui-control-*`. */
export type UIButtonSize = NonNullable<ButtonThemeProps['size']>
/** Radio del contorno de un botón, de `none` a `full`. */
export type UIButtonRadius = NonNullable<ButtonThemeProps['radius']>
/** Ancho de un botón: `auto` o `full`. */
export type UIButtonWidth = NonNullable<ButtonThemeProps['width']>
/** Sombra de un botón, de `none` a `2xl`. */
export type UIButtonElevation = NonNullable<ButtonThemeProps['elevation']>

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
