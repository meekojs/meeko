// The look of <UIIconButton>: the structure of a button (./button.ts) as a square of the height of its size,
// with the pair of `variant` and `color` of the catalog on its `base` slot, the pressed state of a toggle and the
// slots of its icon and of its tooltip. The pressed state is read from `aria-pressed`, so it needs no class of
// its own: a deeper solid, or the soft background of the color with its border, which the pointer keeps.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { appearance } from '../base/appearance'
import { buttonBase, controlBorder } from './button'

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
		// Pressed: a deeper solid.
		{ variant: 'solid', color: 'primary', class: { base: 'aria-pressed:bg-primary-10 aria-pressed:not-disabled:hover:bg-primary-10' } },
		{ variant: 'solid', color: 'secondary', class: { base: 'aria-pressed:bg-secondary-10 aria-pressed:not-disabled:hover:bg-secondary-10' } },
		{ variant: 'solid', color: 'neutral', class: { base: 'aria-pressed:bg-neutral-10 aria-pressed:not-disabled:hover:bg-neutral-10' } },
		{ variant: 'solid', color: 'success', class: { base: 'aria-pressed:bg-success-10 aria-pressed:not-disabled:hover:bg-success-10' } },
		{ variant: 'solid', color: 'info', class: { base: 'aria-pressed:bg-info-10 aria-pressed:not-disabled:hover:bg-info-10' } },
		{ variant: 'solid', color: 'warning', class: { base: 'aria-pressed:bg-warning-10 aria-pressed:not-disabled:hover:bg-warning-10' } },
		{ variant: 'solid', color: 'danger', class: { base: 'aria-pressed:bg-danger-10 aria-pressed:not-disabled:hover:bg-danger-10' } },
		// Pressed: the soft background of the color with its border. A neutral toggle takes the primary accent. The
		// pointer keeps the border: without `aria-pressed:not-disabled:hover:`, the hover border of `outline` and
		// `surface` (`not-disabled:hover:border-*`, more specific than `aria-pressed:`) would replace it.
		{ variant: unfilled, color: ['neutral', 'primary'], class: { base: 'aria-pressed:border-primary-7 aria-pressed:not-disabled:hover:border-primary-7 aria-pressed:bg-primary-3 aria-pressed:text-primary-11 aria-pressed:not-disabled:hover:bg-primary-4' } },
		{ variant: unfilled, color: 'secondary', class: { base: 'aria-pressed:border-secondary-7 aria-pressed:not-disabled:hover:border-secondary-7 aria-pressed:bg-secondary-3 aria-pressed:text-secondary-11 aria-pressed:not-disabled:hover:bg-secondary-4' } },
		{ variant: unfilled, color: 'success', class: { base: 'aria-pressed:border-success-7 aria-pressed:not-disabled:hover:border-success-7 aria-pressed:bg-success-3 aria-pressed:text-success-11 aria-pressed:not-disabled:hover:bg-success-4' } },
		{ variant: unfilled, color: 'info', class: { base: 'aria-pressed:border-info-7 aria-pressed:not-disabled:hover:border-info-7 aria-pressed:bg-info-3 aria-pressed:text-info-11 aria-pressed:not-disabled:hover:bg-info-4' } },
		{ variant: unfilled, color: 'warning', class: { base: 'aria-pressed:border-warning-7 aria-pressed:not-disabled:hover:border-warning-7 aria-pressed:bg-warning-3 aria-pressed:text-warning-11 aria-pressed:not-disabled:hover:bg-warning-4' } },
		{ variant: unfilled, color: 'danger', class: { base: 'aria-pressed:border-danger-7 aria-pressed:not-disabled:hover:border-danger-7 aria-pressed:bg-danger-3 aria-pressed:text-danger-11 aria-pressed:not-disabled:hover:bg-danger-4' } },
	],
	defaultVariants: { variant: 'ghost', color: 'neutral', size: 'md', radius: 'md' },
})

/** Variantes de la receta de `UIIconButton`, derivadas de `iconButtonTheme`. */
export type IconButtonThemeProps = ThemeVariants<typeof iconButtonTheme>
