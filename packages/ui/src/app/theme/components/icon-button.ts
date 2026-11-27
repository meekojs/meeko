// The look of <UIIconButton>: the structure of a button (./button.ts) as a square of the height of its size,
// with the pair of `variant` and `color` of the catalog on its `base` slot, the pressed state of a toggle and the
// slots of its icon and of its tooltip. The pressed state is read from `aria-pressed`, so it needs no class of
// its own: a deeper solid, or the soft background of the color with its border, which the pointer keeps.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { appearance } from '../base/appearance'
import { buttonBase, controlBorder, pressedSoft, pressedSolid } from './button'

/** Los tratamientos de un botón salvo `link`: un icono no tiene texto que subrayar. */
export const iconButtonVariants = ['solid', 'soft', 'surface', 'outline', 'subtle', 'ghost'] as const

const selection = appearance({ variant: iconButtonVariants, color: true, radius: true, elevation: true }, { slot: 'base' })

/** Every treatment but `solid`: the pressed state of these is the soft background of their color. */
const unfilled = iconButtonVariants.filter((variant) => variant !== 'solid')

/**
 * Receta de `UIIconButton`: los `variant` (salvo `link`), `color`, `size`, `radius` y `elevation` de `UIButton` sobre un
 * cuadrado del alto de su tamaño, con los slots `base`, `icon` y `tooltip`. Sin ellas es `ghost` y `neutral`.
 *
 * @example
 * ```ts
 * import { iconButtonTheme } from '@meekojs/ui/theme'
 *
 * const { base } = iconButtonTheme({ variant: 'outline', size: 'sm' })
 * ```
 */
export const iconButtonTheme = defineTheme({
	slots: {
		base: [...buttonBase, 'p-0 [&>svg]:size-(--ui-icon-size) [&>svg]:flex-none aria-busy:*:hidden'],
		icon: '',
		tooltip: '',
	},
	variants: {
		...selection.variants,
		size: {
			xs: { base: 'min-h-(--ui-control-height-xs) min-w-(--ui-control-height-xs) text-control-xs' },
			sm: { base: 'min-h-(--ui-control-height-sm) min-w-(--ui-control-height-sm) text-control-sm' },
			md: { base: 'min-h-(--ui-control-height-md) min-w-(--ui-control-height-md) text-control-md' },
			lg: { base: 'min-h-(--ui-control-height-lg) min-w-(--ui-control-height-lg) text-control-lg' },
			xl: { base: 'min-h-(--ui-control-height-xl) min-w-(--ui-control-height-xl) text-control-xl' },
		},
	},
	compoundVariants: [
		...selection.compoundVariants,
		{ ...controlBorder, class: { base: controlBorder.class } },
		// The line height of every size; a `text-*` of the consumer keeps it (see `themeMergeConfig`).
		{ size: ['xs', 'sm', 'md', 'lg', 'xl'], class: { base: 'leading-tight' } },
		// Pressed: a deeper solid, or the soft background of the color with its border (see ./button.ts).
		...pressedSolid.map((pressed) => ({ color: pressed.color, variant: 'solid' as const, class: { base: pressed.class } })),
		...pressedSoft.map((pressed) => ({ color: pressed.color, variant: unfilled, class: { base: pressed.class } })),
	],
	defaultVariants: { variant: 'ghost', color: 'neutral', size: 'md', radius: 'md' },
})

/** Variantes de la receta de `UIIconButton`, derivadas de `iconButtonTheme`. */
export type IconButtonThemeProps = ThemeVariants<typeof iconButtonTheme>
