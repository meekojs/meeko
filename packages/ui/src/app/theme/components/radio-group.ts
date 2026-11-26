// The look of <UIRadioGroup>: a <fieldset> of radios, each in the label of a choice (./checkbox.ts), or a segmented
// control whose options are the labels, which it shares with <UISegmentedControl> (./segmented-control.ts).
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { choiceBox, choiceBoxBorder, choiceInput, choiceLabel, choiceRow } from './checkbox'

/** The dot of a radio. */
const dot = 'rounded-full checked:before:size-1.5 checked:before:rounded-full'

/** The <fieldset> of a group of radios: no frame of its own, and dimmed when disabled. */
export const radioFieldset = 'm-0 min-w-0 p-0 [border:0] font-sans text-text disabled:cursor-not-allowed disabled:opacity-(--ui-opacity-disabled)'

/** The visible <legend> of a group. */
export const radioLegend = 'mb-2 p-0 text-sm font-medium'

/** The track of a segmented control: a framed row whose segments are the labels. */
export const segmentTrack = 'gap-0.5 rounded-lg border-(length:--ui-border-width) border-solid border-control-border bg-control p-0.5'

/** A segment: the label of a radio, filled when checked. Its height and its text come from its size. */
export const segment = [
	'relative rounded-md',
	'transition-[background-color,color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
	'[&:hover:not(:has(:disabled,:checked))]:bg-control-hover has-checked:bg-primary-soft has-checked:font-semibold has-checked:text-primary-text',
	'has-focus-visible:outline-(length:--ui-focus-ring-width) has-focus-visible:outline-focus has-focus-visible:outline-solid',
]

/** The input covers its segment, unseen: the label is the segment. */
export const segmentInput = 'absolute inset-0 size-full [border:0] opacity-(--ui-opacity-hidden)'

/**
 * Receta de `UIRadioGroup`, con los slots `base` (el `<fieldset>`), `legend`, `options`, `option` (cada `<label>`)
 * e `input`. `layout` elige la presentación, no un tratamiento de color: `default` es una lista de radios y
 * `segmented`, un control segmentado cuyas opciones son las etiquetas.
 *
 * @example
 * ```ts
 * import { radioGroupTheme } from '@meekojs/ui/theme'
 *
 * const { options, option } = radioGroupTheme({ layout: 'segmented' })
 * ```
 */
export const radioGroupTheme = defineTheme({
	slots: {
		base: radioFieldset,
		legend: radioLegend,
		options: 'flex flex-wrap',
		option: choiceLabel,
		input: [...choiceInput, choiceBox, dot],
	},
	variants: {
		layout: {
			default: {
				options: 'gap-2',
				option: choiceRow,
				input: choiceBoxBorder,
			},
			segmented: {
				options: ['w-fit', segmentTrack],
				option: [...segment, 'min-h-(--ui-control-height-sm) px-3 has-focus-visible:outline-offset-(--ui-focus-ring-offset)'],
				input: segmentInput,
			},
		},
	},
	defaultVariants: {
		layout: 'default',
	},
})

/** Variantes de la receta de `UIRadioGroup`, derivadas de `radioGroupTheme`. */
export type RadioGroupThemeProps = ThemeVariants<typeof radioGroupTheme>
