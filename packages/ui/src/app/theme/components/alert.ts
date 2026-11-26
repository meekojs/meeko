// The look of <UIAlert>, whose box, actions and close button <UIToast> shares (./toast.ts). The color comes from
// the shared catalog (`appearance()`), aimed at the `base` slot: each pair of `variant` and `color` is one compound
// variant with the steps of its scale. A message is not a control, so it drops the pointer states of the catalog.
// The default `soft` keeps the border of step 7 that a message always had, and the neutral one is the surface of
// the page. `defineTheme` merges the classes with Tailwind Merge, so the `class` of the consumer wins over the one
// of the recipe.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { appearance } from '../base/appearance'
import { focusRing } from '../base/focus'

/** Tratamientos que admiten un aviso y una notificación. */
export const messageVariants = ['soft', 'surface', 'outline', 'solid'] as const

/** The catalog of a message, aimed at its root. */
export const messageSelection = appearance({ variant: messageVariants, color: true }, { slot: 'base' })

/** The classes of a pair without the pointer states: a message does not react to the pointer. */
const still = (classes: string): string =>
	classes
		.split(' ')
		.filter((name) => !name.startsWith('not-disabled:'))
		.join(' ')

/** The pairs of the catalog for a static box, still aimed at `base`. */
const stillCompounds = messageSelection.compoundVariants.map((entry) => ({ ...entry, class: { base: still(entry.class.base) } }))

/** A soft message has the border of step 7 of its color, which the catalog leaves transparent. */
const softBorders = [
	{ variant: 'soft', color: 'primary', class: { base: 'border-primary-7' } },
	{ variant: 'soft', color: 'secondary', class: { base: 'border-secondary-7' } },
	{ variant: 'soft', color: 'success', class: { base: 'border-success-7' } },
	{ variant: 'soft', color: 'info', class: { base: 'border-info-7' } },
	{ variant: 'soft', color: 'warning', class: { base: 'border-warning-7' } },
	{ variant: 'soft', color: 'danger', class: { base: 'border-danger-7' } },
] as const

/** On a solid, the close button keeps the contrast text and darkens it a little under the pointer. */
const solidDismiss = { variant: 'solid', class: { dismiss: 'hover:bg-gray-a4 hover:text-inherit' } } as const

/**
 * The compound variants of a message. `neutral` is the look of the neutral soft one, which reads the semantic
 * tokens of the page (`ui.tokens` only sets those): the surface of an alert, the raised one of a toast.
 */
export const messageCompounds = <const N extends string>(neutral: N) => [...stillCompounds, ...softBorders, { variant: 'soft', color: 'neutral', class: { base: neutral } } as const, solidDismiss]

/** The box of an alert and a toast: the pair of `variant` and `color` gives the colors. */
export const messageBox = [
	'box-border flex [align-items:start] gap-3 p-4',
	'rounded-lg border-(length:--ui-border-width) border-solid',
	'font-sans text-md leading-normal font-regular wrap-anywhere',
]

/** The buttons of the `actions` snippet, under the message. */
export const messageActions = 'mt-3 flex flex-wrap gap-2'

/** The close button of an alert and a toast: a square as tall as a control, centered on the first line, in the color of its message. */
export const messageDismiss = [
	'ms-auto mt-[calc((var(--ui-font-size-md)*var(--ui-line-height-normal)-var(--ui-control-height-md))/2)]',
	'inline-flex size-(--ui-control-height-md) flex-none cursor-pointer items-center justify-center',
	'rounded-md [border:0] bg-transparent text-inherit hover:bg-control-hover hover:text-text',
	focusRing,
]

/**
 * Receta de `UIAlert`: `variant` y `color`, con los slots `base`, `icon`, `content`, `title`, `description`,
 * `actions` y `dismiss`. Sin ellas es un aviso `soft` y `neutral`, la superficie de la página con su borde; con
 * otro color, el fondo suave de su escala con el borde del paso 7.
 *
 * @example
 * ```ts
 * import { alertTheme } from '@meekojs/ui/theme'
 *
 * const { base, title } = alertTheme({ color: 'warning' })
 * ```
 */
export const alertTheme = defineTheme({
	slots: {
		// In the text of <UIProse> it is a block of its own, with the space of a paragraph under it unless it ends the text.
		base: [...messageBox, '[.meeko-ui-prose>&]:mt-0 [.meeko-ui-prose>&:not(:last-child)]:mb-6'],
		/** The icon snippet: a direct <svg> is drawn with lines, as tall as the first line. */
		icon: [
			'inline-flex w-(--ui-icon-size) h-[calc(var(--ui-font-size-md)*var(--ui-line-height-normal))] shrink-0',
			'[&>svg]:size-full [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:var(--ui-icon-stroke-width)]',
		],
		content: 'min-w-0 flex-1',
		title: 'm-0 font-semibold',
		description: 'm-0 text-inherit',
		actions: messageActions,
		dismiss: messageDismiss,
	},
	variants: messageSelection.variants,
	compoundVariants: messageCompounds('border-border bg-surface text-text'),
	defaultVariants: { variant: 'soft', color: 'neutral' },
})

/** Variantes de la receta de `UIAlert`, derivadas de `alertTheme`. */
export type AlertThemeProps = ThemeVariants<typeof alertTheme>

/** Tratamiento visual de un aviso o una notificación: `soft`, `surface`, `outline` o `solid`. */
export type UIMessageVariant = NonNullable<AlertThemeProps['variant']>
/** Color semántico de un aviso o una notificación: `primary`, `secondary`, `neutral`, `success`, `info`, `warning` o `danger`. */
export type UIMessageColor = NonNullable<AlertThemeProps['color']>
