// The look of a text field: <UIInput>, <UITextarea> and, through `control`, the trigger of <UISelect> and
// <UICombobox>. Each property is set by one part only: the height is the only one that changes between a
// line and a box of text, so it lives in `multiline` and not in the base, and the end padding makes room for
// the clear button of a `clearable` trigger, so it lives out of the base too.
import { tv } from 'tailwind-variants/lite'

import { inputAppearance, type InputAppearance } from '../theme/recipes'

/** Border, background, text, hover, placeholder, invalid and focus of every control that looks like a field. */
const structure = [
	'box-border block w-full ps-3 py-1.5',
	'border-(length:--ui-border-width) aria-[invalid=true]:border-danger',
	'font-sans text-(length:--ui-input-font-size) leading-snug font-regular',
	'transition-[background-color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
	'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid',
]

const look = [...structure, 'rounded-md border-solid border-control-border bg-control not-disabled:hover:bg-control-hover text-text placeholder:text-text-soft']

/** A line of text, as tall as a button. */
const line = 'min-h-(--ui-control-height-md)'

/** A box of text, which the user can make taller. */
const box = 'min-h-24 resize-y'

/** The padding at the end of the text, as at its start. */
const end = 'pe-3'

/** A disabled field: the element itself has the `disabled` attribute. */
const disabled = 'disabled:cursor-not-allowed disabled:opacity-(--ui-opacity-disabled)'

/**
 * The look of a field without its disabled state, for a control that is not an <input> or a <textarea>: the
 * trigger of <UISelect> and <UICombobox>, whose wrapper already dims itself when disabled. The trigger adds
 * its own pointer and alignment through `class`.
 *
 * @example
 * ```ts
 * const triggerClass = control({ class: 'cursor-pointer text-start' })
 * ```
 */
export const control = tv({
	base: look,
	variants: {
		multiline: {
			false: line,
			true: box,
		},
		/** The trigger leaves room at its end for the clear button, a square as tall as the control. */
		clearable: {
			false: end,
			true: 'pe-(--ui-control-height-md)',
		},
	},
	defaultVariants: {
		multiline: false,
		clearable: false,
	},
})

/**
 * El aspecto de <UIInput>. Con `reveal`, el final del texto deja sitio al botón que muestra la contraseña,
 * un cuadrado tan alto como el control.
 */
export const input = tv({
	base: [...look, line, disabled],
	variants: {
		reveal: {
			false: end,
			true: 'pe-(--ui-control-height-md)',
		},
	},
	defaultVariants: {
		reveal: false,
	},
})

/**
 * Lo que <UIInput type="password" reveal> añade alrededor del campo: una caja que lo contiene y el botón que
 * muestra u oculta la contraseña, al final del campo y con el color del texto suave. Antes de hidratar, el
 * botón espera invisible (`inputRevealWaiting`) sin mover nada: sin JavaScript no podría hacer nada.
 */
export const inputReveal = tv({
	slots: {
		base: 'relative block w-full',
		toggle: [
			'absolute inset-y-0 end-0 inline-flex w-(--ui-control-height-md) cursor-pointer items-center justify-center',
			'rounded-md [border:0] bg-transparent p-0 text-text-soft not-disabled:hover:text-text',
			'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:-outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid',
			disabled,
		],
	},
})

/** Aplica el catálogo a un campo sin cambiar el espacio reservado para reveal. */
export function inputWithAppearance(appearance: InputAppearance, reveal: boolean, className?: string): string {
	return [
		...structure,
		disabled,
		'border-solid not-aria-[invalid=true]:border-control-border',
		appearance.variant === 'ghost' ? 'border-x-0 border-t-0' : undefined,
		reveal ? '[padding-inline-end:var(--ui-control-height-md)]' : end,
		inputAppearance(appearance),
		'placeholder:text-(color:--ui-12) placeholder:opacity-100',
		className,
	].filter(Boolean).join(' ')
}

/**
 * Lo que <UIInput> añade a un campo de números, horas o fechas (`number`, `time`, `month`, `date` y
 * `datetime-local`): cifras del mismo ancho, que no bailan al escribir ni al cambiar con las flechas, y, en
 * WebKit, el valor de una fecha o una hora alineado al principio, como el texto, en lugar de centrado.
 */
export const inputNumeric = '[font-variant-numeric:tabular-nums] [&::-webkit-date-and-time-value]:text-start'

/** El botón de `reveal` espera invisible hasta hidratar, sin mover nada. */
export const inputRevealWaiting = 'invisible'

/** The look of <UITextarea>. */
export const textarea = tv({ base: [...look, box, end, disabled] })
