// The look of <UISegmentedControl>: the segments of <UIRadioGroup variant="segmented"> (./radio-group.ts) on a
// track that never wraps.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { choiceInput, choiceLabelLayout, choiceLabelState } from './checkbox'
import { radioFieldset, radioLegend, segment, segmentInput, segmentTrack } from './radio-group'

/**
 * Receta de `UISegmentedControl`, con los slots `base` (el `<fieldset>`), `legend`, `options` (la pista), `option`
 * (cada `<label>`) e `input`, y las variantes `size` (`sm` o `md`) y `hideLegend`. Si los segmentos no caben, la
 * pista se desplaza en horizontal dentro de su ancho, así que la página no crece y ningún segmento se parte en
 * líneas; el anillo del foco va dentro del segmento, donde el desplazamiento no lo corta.
 *
 * @example
 * ```ts
 * import { segmentedControlTheme } from '@meekojs/ui/theme'
 *
 * const { options, option } = segmentedControlTheme({ size: 'sm' })
 * ```
 */
export const segmentedControlTheme = defineTheme({
	slots: {
		base: ['max-w-full', radioFieldset],
		legend: radioLegend,
		options: ['flex w-fit max-w-full flex-nowrap overflow-x-auto overscroll-x-contain [scrollbar-width:thin]', segmentTrack],
		option: [choiceLabelLayout, 'font-sans leading-tight font-regular text-text', choiceLabelState, 'shrink-0 justify-center whitespace-nowrap', ...segment, 'has-focus-visible:outline-offset-[calc(var(--ui-focus-ring-width)*-1)]'],
		input: [...choiceInput, segmentInput],
	},
	variants: {
		/** The size of the whole control, track included, is the one of a control of that size: a button beside it lines up. */
		size: {
			sm: { option: 'min-h-[calc(var(--ui-control-height-sm)-var(--ui-space-1)-var(--ui-border-width)*2)] px-2 text-control-sm' },
			md: { option: 'min-h-[calc(var(--ui-control-height-md)-var(--ui-space-1)-var(--ui-border-width)*2)] px-3 text-control-md' },
		},
		/** A legend only for screen readers: the group keeps its name. */
		hideLegend: {
			true: { legend: 'absolute size-(--ui-border-width) overflow-hidden whitespace-nowrap [clip-path:inset(50%)]' },
			false: '',
		},
	},
	defaultVariants: {
		size: 'md',
		hideLegend: false,
	},
})

/** Variantes de la receta de `UISegmentedControl`, derivadas de `segmentedControlTheme`. */
export type SegmentedControlThemeProps = ThemeVariants<typeof segmentedControlTheme>
