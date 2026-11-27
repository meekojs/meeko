// What <UICopyButton> adds to the look of <UIButton> or of <UIIconButton>, which it paints: the color of the
// result of the last copy, read from `data-copy-state` and its tokens (`--ui-copy-button-copied-color`,
// `-failed-color`), only where the text is not on a solid; and the announcement for screen readers, which takes
// no room. Its variants are those of <UIIconButton>, without classes of their own, so that `ui.defaults.copyButton`
// accepts the same values: the component passes them on to the button it paints.
import type { ThemeVariants } from '../../utils/theme'
import type { AppearanceColor, AppearanceRadius, AppearanceSize } from '../base/types'

import { defineTheme } from '../../utils/theme'
import { variants } from '../base/variants'
import { iconButtonVariants } from './icon-button'

/** The values of a variant that only chooses: the button it reaches paints them. */
const blank = <K extends string>(keys: readonly K[]): Record<K, ''> => Object.fromEntries(keys.map((key) => [key, ''])) as Record<K, ''>

/**
 * Receta de `UICopyButton`: los slots `base` (el botón) y `status` (el aviso para lectores de pantalla), y los
 * colores del resultado de la copia. Sin `variant` es `surface` con texto y `ghost` con `iconOnly`.
 */
export const copyButtonTheme = defineTheme({
	slots: {
		base: '',
		status: 'sr-only',
	},
	variants: {
		variant: blank(iconButtonVariants),
		color: blank(Object.keys(variants.color) as AppearanceColor[]),
		size: blank(Object.keys(variants.size) as AppearanceSize[]),
		radius: blank(Object.keys(variants.radius) as AppearanceRadius[]),
	},
	compoundVariants: [
		{
			variant: iconButtonVariants.filter((variant) => variant !== 'solid'),
			class: { base: 'data-[copy-state=copied]:[color:var(--ui-copy-button-copied-color)] data-[copy-state=failed]:[color:var(--ui-copy-button-failed-color)]' },
		},
	],
})

/** Variantes de la receta de `UICopyButton`, derivadas de `copyButtonTheme`. */
export type CopyButtonThemeProps = ThemeVariants<typeof copyButtonTheme>

/** A copy button that needs the script waits for it hidden, keeping its place: without JavaScript it could not copy. */
export const copyButtonWaiting = 'invisible'
