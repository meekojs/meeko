// The look of <UIDescriptionList>: the list, the term and the value of <UIStat> (./stat.ts), in one column or up
// to three from a `compact` screen.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { dataDetail, dataList, dataTerm, dataValue } from './stat'

/**
 * Receta de `UIDescriptionList`: `columns` (`1`, `2` o `3`), con los slots `base`, `item`, `label`, `value`, `code` y
 * `detail`. Sin ella es una columna.
 *
 * @example
 * ```ts
 * import { descriptionListTheme } from '@meekojs/ui/theme'
 *
 * const { base, item } = descriptionListTheme({ columns: 2 })
 * ```
 */
export const descriptionListTheme = defineTheme({
	slots: {
		base: [dataList, 'gap-5'],
		item: 'grid content-start gap-1',
		label: dataTerm,
		value: dataValue,
		code: 'font-mono text-(length:--ui-prose-code-size) [overflow-wrap:anywhere]',
		detail: dataDetail,
	},
	variants: {
		columns: {
			1: '',
			2: { base: 'compact:grid-cols-2' },
			3: { base: 'compact:grid-cols-3' },
		},
	},
	defaultVariants: {
		columns: 1,
	},
})

/** Variantes de la receta de `UIDescriptionList`, derivadas de `descriptionListTheme`. */
export type DescriptionListThemeProps = ThemeVariants<typeof descriptionListTheme>
