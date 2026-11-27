// The look of the internal <Icon>: the icons of the package, lines of the current color, of a size of the tokens.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'

/**
 * Receta de los iconos del paquete: `size` (`md`, `sm` o `text`, el tamaño del texto que los rodea). Sin ella es `md`.
 *
 * @example
 * ```ts
 * import { iconTheme } from '@meekojs/ui/theme'
 *
 * const classes = iconTheme({ size: 'text' })
 * ```
 */
export const iconTheme = defineTheme({
	base: 'flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:var(--ui-icon-stroke-width)]',
	variants: {
		size: {
			md: 'size-(--ui-icon-size)',
			sm: 'size-(--ui-icon-size-sm)',
			// The size of the text around it, for an icon inside a sentence or a heading.
			text: 'size-(--ui-icon-size-text)',
		},
	},
	defaultVariants: {
		size: 'md',
	},
})

/** Variantes de la receta de los iconos, derivadas de `iconTheme`. */
export type IconThemeProps = ThemeVariants<typeof iconTheme>
