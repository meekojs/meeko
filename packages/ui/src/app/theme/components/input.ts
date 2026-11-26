// The look of a text field: <UIInput> and, through `inputControlTheme`, the trigger of <UISelect> and <UICombobox>;
// <UITextarea> lives in ./textarea.ts. A field is a form control: whatever its color, its border is the one of the
// controls, `--ui-color-control-border`, with a contrast of 3:1 on every surface (tests/tokens.test.mjs), and an
// invalid field (`aria-invalid="true"`) turns it to the danger color. The pair of `variant` and `color` of the
// catalog (`appearance()`) paints the background, the text and the background under the pointer; a neutral
// outline, the default, is the field of always: the background and the text of the controls. Each property is set
// by one part only: the height and the inline padding live in `size`, and the end padding makes room for the
// button of `reveal`, or for the clear button of a `clearable` trigger. `defineTheme` merges the classes with
// Tailwind Merge, so the `class` of the consumer wins over the one of the recipe.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { appearance } from '../base/appearance'

/** Tratamientos que admite un campo: con borde (`outline`), con fondo tenue (`surface`, `soft`) o subrayado (`ghost`). */
export const inputVariants = ['outline', 'surface', 'soft', 'ghost'] as const

const selection = appearance({ variant: inputVariants, color: true, radius: true })

/** Border, font, transitions and focus ring of every control that looks like a field. */
export const fieldStructure = [
	'box-border block w-full py-1.5',
	'border-(length:--ui-border-width) border-solid border-control-border aria-[invalid=true]:border-danger',
	'font-sans text-(length:--ui-input-font-size) leading-snug font-regular text-text placeholder:text-text-soft',
	'transition-[background-color] duration-(--ui-duration-fast) ease-[ease] motion-reduce:transition-none motion-reduce:duration-0',
	'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid',
]

/** The field of always: the structure on the background of the controls, which the pointer darkens. */
export const fieldLook = [...fieldStructure, 'rounded-md bg-control not-disabled:hover:bg-control-hover']

/** A disabled field: the element itself has the `disabled` attribute. */
export const fieldDisabled = 'disabled:cursor-not-allowed disabled:opacity-(--ui-opacity-disabled)'

/**
 * The classes of a pair of the catalog for a field: without its borders, which are the ones of the controls, nor
 * the pressed background, since a click only places the caret; a neutral field writes with the text of the page.
 */
const forField = (classes: string, color: string): string => {
	const names = classes
		.split(' ')
		.filter((name) => !name.startsWith('border-') && !name.startsWith('not-disabled:hover:border-') && !name.startsWith('not-disabled:active:'))
		.map((name) => (color === 'neutral' && name === 'text-neutral-11' ? 'text-text' : name))
	// The catalog gives `outline` and `ghost` no resting background: a field has no preflight to clear the one of the
	// browser, so it is set transparent (a neutral outline takes the one of the controls in `neutralOutline`).
	return (names.some((name) => name.startsWith('bg-')) ? names : [...names, 'bg-transparent']).join(' ')
}

const fieldCompounds = selection.compoundVariants.map((entry) => ({ ...entry, class: forField(entry.class, entry.color) }))

/** A neutral outline is the field of always, with the background of the controls. */
const neutralOutline = { variant: 'outline', color: 'neutral', class: 'bg-control not-disabled:hover:bg-control-hover' } as const

/** A ghost field is a line under the text: only its bottom border is left. */
const ghostLine = { variant: 'ghost', class: 'border-x-0 border-t-0' } as const

/** The button of `reveal` at the end of the field, a square as tall as its size. */
const revealSizes = [
	{ reveal: true, size: 'xs', class: 'pe-(--ui-control-height-xs)' },
	{ reveal: true, size: 'sm', class: 'pe-(--ui-control-height-sm)' },
	{ reveal: true, size: 'md', class: 'pe-(--ui-control-height-md)' },
	{ reveal: true, size: 'lg', class: 'pe-(--ui-control-height-lg)' },
	{ reveal: true, size: 'xl', class: 'pe-(--ui-control-height-xl)' },
] as const

/**
 * Receta de `UIInput`: `variant` (`outline`, `surface`, `soft` o `ghost`), `color`, `size` (de `xs` a `xl`, sobre los
 * tokens `--ui-control-*`), `radius` y `reveal`. Sin ellas es el campo de siempre: `outline` y `neutral`, con el
 * fondo y el borde de los controles, de tamaño `md` y radio `md`. El borde es siempre el de los controles, salvo en
 * un campo inválido (`aria-invalid="true"`), que lo pinta del color de peligro. Con `reveal`, el final del texto deja
 * sitio al botón que muestra la contraseña.
 *
 * @example
 * ```ts
 * import { inputTheme } from '@meekojs/ui/theme'
 *
 * const classes = inputTheme({ variant: 'soft', color: 'primary', size: 'lg', class: 'max-w-sm' })
 * ```
 */
export const inputTheme = defineTheme({
	base: [...fieldStructure, fieldDisabled],
	variants: {
		...selection.variants,
		/**
		 * The height of a control of that size and its inline padding. From `md` up the text keeps the size of a field
		 * and its vertical padding; `xs` and `sm` take the text of a button of their size and a thinner padding, so the
		 * line, the padding and the border fit in the height of the token and the field is as tall as that button.
		 */
		size: {
			xs: 'min-h-(--ui-control-height-xs) ps-1.5 pe-1.5 py-0.5 text-control-xs',
			sm: 'min-h-(--ui-control-height-sm) ps-2 pe-2 py-0.5 text-control-sm',
			md: 'min-h-(--ui-control-height-md) ps-3 pe-3',
			lg: 'min-h-(--ui-control-height-lg) ps-4 pe-4',
			xl: 'min-h-(--ui-control-height-xl) ps-5 pe-5 text-control-xl',
		},
		reveal: {
			true: '',
			false: '',
		},
	},
	compoundVariants: [...fieldCompounds, neutralOutline, ghostLine, ...revealSizes],
	defaultVariants: { variant: 'outline', color: 'neutral', size: 'md', radius: 'md', reveal: false },
})

/** Variantes de la receta de `UIInput`, derivadas de `inputTheme`. */
export type InputThemeProps = ThemeVariants<typeof inputTheme>

/** Tratamiento visual de un campo: `outline`, `surface`, `soft` o `ghost`. */
export type UIInputVariant = NonNullable<InputThemeProps['variant']>
/** Color semántico de un campo: `primary`, `secondary`, `neutral`, `success`, `info`, `warning` o `danger`. */
export type UIInputColor = NonNullable<InputThemeProps['color']>
/** Tamaño de un campo, de `xs` a `xl`, sobre los tokens `--ui-control-*`. */
export type UIInputSize = NonNullable<InputThemeProps['size']>
/** Radio del contorno de un campo, de `none` a `full`. */
export type UIInputRadius = NonNullable<InputThemeProps['radius']>

/**
 * Lo que `<UIInput type="password" reveal>` añade alrededor del campo: una caja que lo contiene (`base`) y el botón
 * que muestra u oculta la contraseña (`toggle`), al final del campo, tan ancho como alto es el campo de su `size` y
 * con el color del texto suave. Antes de hidratar, el botón espera invisible (`inputRevealWaiting`) sin mover nada:
 * sin JavaScript no podría hacer nada.
 */
export const inputRevealTheme = defineTheme({
	slots: {
		base: 'relative block w-full',
		toggle: [
			'absolute inset-y-0 end-0 inline-flex cursor-pointer items-center justify-center',
			'rounded-md [border:0] bg-transparent p-0 text-text-soft not-disabled:hover:text-text',
			'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:-outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid',
			fieldDisabled,
		],
	},
	variants: {
		size: {
			xs: { toggle: 'w-(--ui-control-height-xs)' },
			sm: { toggle: 'w-(--ui-control-height-sm)' },
			md: { toggle: 'w-(--ui-control-height-md)' },
			lg: { toggle: 'w-(--ui-control-height-lg)' },
			xl: { toggle: 'w-(--ui-control-height-xl)' },
		},
	},
	defaultVariants: { size: 'md' },
})

/** Variantes de la receta del botón de `reveal`, derivadas de `inputRevealTheme`. */
export type InputRevealThemeProps = ThemeVariants<typeof inputRevealTheme>

/**
 * Lo que `<UIInput>` añade a un campo de números, horas o fechas (`number`, `time`, `month`, `date` y
 * `datetime-local`): cifras del mismo ancho, que no bailan al escribir ni al cambiar con las flechas, y, en
 * WebKit, el valor de una fecha o una hora alineado al principio, como el texto, en lugar de centrado.
 */
export const inputNumeric = '[font-variant-numeric:tabular-nums] [&::-webkit-date-and-time-value]:text-start'

/** El botón de `reveal` espera invisible hasta hidratar, sin mover nada. */
export const inputRevealWaiting = 'invisible'

/** A line of text, as tall as a button. */
const line = 'min-h-(--ui-control-height-md)'

/** A box of text, which the user can make taller; also the one of <UITextarea>. */
export const fieldBox = 'min-h-24 resize-y'

/** The padding at the start and at the end of the text of a field that has no `size`. */
export const fieldStart = 'ps-3'
export const fieldEnd = 'pe-3'

/**
 * El aspecto de campo sin su estado deshabilitado, para un control que no es un `<input>` ni un `<textarea>`: el
 * disparador de `UISelect` y `UICombobox`, cuyo contenedor ya se atenúa al deshabilitarse. El disparador añade su
 * propio puntero y su alineación con `class`; `clearable` deja sitio al final al botón que lo vacía.
 *
 * @example
 * ```ts
 * const triggerClass = inputControlTheme({ clearable: true, class: 'cursor-pointer text-start' })
 * ```
 */
export const inputControlTheme = defineTheme({
	base: [...fieldLook, fieldStart],
	variants: {
		multiline: {
			false: line,
			true: fieldBox,
		},
		/** The trigger leaves room at its end for the clear button, a square as tall as the control. */
		clearable: {
			false: fieldEnd,
			true: 'pe-(--ui-control-height-md)',
		},
	},
	defaultVariants: { multiline: false, clearable: false },
})

/** Variantes de la receta del disparador de `UISelect` y `UICombobox`, derivadas de `inputControlTheme`. */
export type InputControlThemeProps = ThemeVariants<typeof inputControlTheme>
