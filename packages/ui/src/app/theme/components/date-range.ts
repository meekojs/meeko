// The look of <UIDateRange>: a <fieldset> without a frame, a row of shortcut buttons, the two native date
// fields with their labels, and the message of an invalid range. The component paints the shortcuts with
// `buttonTheme` (./button.ts: an outline, neutral button of size `sm`, whose pressed state is the soft primary
// accent read from `aria-pressed`) and the fields with `inputTheme` (./input.ts, as <UIInput type="date">); the
// `preset` and `input` slots only carry the classes of the consumer.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'

/**
 * Receta de `UIDateRange`, con los slots `base` (el `<fieldset>`), `legend`, `presets` (la fila de atajos),
 * `preset`, `fields` (la fila de las dos fechas), `field`, `fieldLabel`, `input` y `error`. No tiene variantes.
 * Los atajos tienen el aspecto de `buttonTheme({ variant: 'outline', color: 'neutral', size: 'sm' })`, con el
 * acento suave cuando están pulsados (`aria-pressed`), y las fechas, el de `inputTheme()`; las dos fechas se
 * reparten la fila y bajan una bajo otra si no caben.
 *
 * @example
 * ```ts
 * import { dateRangeTheme } from '@meekojs/ui/theme'
 *
 * const { base, fields } = dateRangeTheme()
 * ```
 */
export const dateRangeTheme = defineTheme({
	slots: {
		base: 'm-0 grid min-w-0 gap-3 [border:0] p-0 font-sans text-text',
		legend: 'mb-2 p-0 text-sm font-medium',
		presets: 'flex flex-wrap gap-2',
		preset: '',
		fields: 'flex flex-wrap items-end gap-3',
		field: 'grid min-w-0 flex-[1_1_10rem] gap-1.5',
		fieldLabel: 'text-sm font-medium',
		input: '',
		error: 'm-0 text-sm text-danger-text',
	},
})

/** Variantes de la receta de `UIDateRange`, derivadas de `dateRangeTheme`: ninguna. */
export type DateRangeThemeProps = ThemeVariants<typeof dateRangeTheme>
