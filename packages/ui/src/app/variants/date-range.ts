// The look of <UIDateRange>: a <fieldset> without a frame, a row of shortcut buttons, the two native date
// fields with their labels, and the message of an invalid range. The fields take the classes of <UIInput>
// from ./input in the component; the shortcuts, those of an outline <UIButton> of size `sm`, pressed with the
// soft accent of a pressed <UIIconButton>.
import { tv } from 'tailwind-variants/lite'

import { button } from './button'

/**
 * El aspecto de <UIDateRange>. Los atajos son botones `outline` de tamaño `sm`, con el acento suave cuando
 * están pulsados (`aria-pressed`); las dos fechas se reparten la fila y bajan una bajo otra si no caben.
 */
export const dateRange = tv({
	slots: {
		base: 'ui:m-0 ui:grid ui:min-w-0 ui:gap-3 ui:p-0 ui:[border:0] ui:font-sans ui:text-text',
		legend: 'ui:mb-2 ui:p-0 ui:text-sm ui:font-medium',
		presets: 'ui:flex ui:flex-wrap ui:gap-2',
		preset: [
			button({ variant: 'outline', size: 'sm' }),
			'ui:aria-pressed:border-primary-border ui:aria-pressed:bg-primary-soft ui:aria-pressed:text-primary-text ui:aria-pressed:not-disabled:hover:bg-primary-soft-hover',
		],
		fields: 'ui:flex ui:flex-wrap ui:items-end ui:gap-3',
		field: 'ui:grid ui:min-w-0 ui:flex-[1_1_10rem] ui:gap-1.5',
		fieldLabel: 'ui:text-sm ui:font-medium',
		input: '',
		error: 'ui:m-0 ui:text-sm ui:text-danger-text',
	},
})
