// The look of <UIStat>: a big value between its label and its context, in a <dl> of the text of the page whose
// term is small soft text. A value never widens its column: it breaks anywhere. <UIDescriptionList> shares the
// list, the term and the value (./description-list.ts).
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { focusRing } from '../base/focus'

/** A <dl> in the text of the page. */
export const dataList = 'm-0 grid min-w-0 font-sans text-md leading-normal font-regular text-text [overflow-wrap:anywhere]'

/** The term of a <dl>. */
export const dataTerm = 'text-sm text-text-soft'

/** A value, and its figures in columns. */
export const dataValue = 'm-0 tabular-nums'

/** The context under a value. */
export const dataDetail = [dataValue, dataTerm]

/**
 * Receta de `UIStat`, con los slots `base`, `label`, `hint`, `value`, `detail`, `change`, `delta`, `icon`, `period`,
 * `trend`, `action` y `link`. Con una variación, un periodo, un sparkline o un enlace es una cifra clave (`kpi`): su
 * `<dl>` es el contenedor de su modo compacto, por debajo del ancho de `--container-stat-narrow`. Sus variantes no
 * son props: el componente las decide por su contenido. `color` es el de la variación: `success` si va en la
 * dirección buena, `danger` si no y `neutral` sin cambio.
 *
 * @example
 * ```ts
 * import { statTheme } from '@meekojs/ui/theme'
 *
 * const { base, value } = statTheme({ kpi: true, color: 'success', direction: 'up' })
 * ```
 */
export const statTheme = defineTheme({
	slots: {
		base: [dataList, 'content-start gap-1'],
		label: dataTerm,
		/** The <UIHint> after the label, a space away from its text. */
		hint: 'ms-1',
		value: [dataValue, 'text-2xl font-semibold tracking-tight'],
		detail: dataDetail,
		/** The change and its period, on one line that wraps. */
		change: 'm-0 flex flex-wrap items-baseline gap-x-1.5 text-sm text-text-soft',
		/** The arrow and the signed change, in the colour of its direction. */
		delta: 'inline-flex items-center gap-0.5 self-center font-medium tabular-nums',
		icon: '',
		period: '',
		trend: 'm-0 min-w-0',
		action: 'm-0 text-sm',
		link: ['rounded-xs font-medium text-primary-11 underline decoration-current underline-offset-(--ui-underline-offset) hover:text-text', focusRing],
	},
	variants: {
		/**
		 * A key figure: the <dl> is a container, so its parts follow its width. Its intrinsic width stands in
		 * for that of its content, which a container does not give: in a row of flex items it keeps a size.
		 */
		kpi: {
			false: {},
			true: {
				base: '@container [contain-intrinsic-inline-size:var(--ui-stat-intrinsic-width)]',
				value: '@max-stat-narrow:text-xl',
			},
		},
		/**
		 * With a trend: the sparkline goes beside the value, in a second column as wide as its token; below
		 * --container-stat-narrow it takes a row of its own, under the change, and the empty column takes no space
		 * because the gap is its margin.
		 */
		chart: {
			false: {},
			true: {
				base: 'grid-cols-[minmax(0,1fr)_auto]',
				label: 'col-span-full',
				value: 'col-[1]',
				change: 'col-span-full',
				detail: 'col-span-full',
				trend: [
					'col-[2] row-[2] ms-4 w-(--ui-stat-trend-width) self-center',
					'@max-stat-narrow:col-span-full @max-stat-narrow:row-auto @max-stat-narrow:ms-0 @max-stat-narrow:w-auto',
				],
				action: 'col-span-full',
			},
		},
		/** Good, bad or neither: the direction of the change against the one that is good. */
		color: {
			neutral: { delta: 'text-text' },
			success: { delta: 'text-success-11' },
			danger: { delta: 'text-danger-11' },
		},
		/** The arrow of a flat change points to the end of the line, in either direction of the text. */
		direction: {
			up: {},
			down: {},
			flat: { icon: 'rtl:[scale:-1_1]' },
		},
	},
	defaultVariants: {
		kpi: false,
		chart: false,
		color: 'neutral',
		direction: 'flat',
	},
})

/** Variantes de la receta de `UIStat`, derivadas de `statTheme`. */
export type StatThemeProps = ThemeVariants<typeof statTheme>
