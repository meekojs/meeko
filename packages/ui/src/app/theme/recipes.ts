import type { ThemeVariants } from '../utils/theme'

import { defineTheme } from '../utils/theme'
import { appearance } from './base/appearance'

const inputSizes = {
	sm: 'min-h-(--ui-control-height-sm)',
	md: 'min-h-(--ui-control-height-md)',
	lg: 'min-h-(--ui-control-height-lg)',
} as const

/** Apariencia opcional de UIBadge. */
export const badgeAppearance = defineTheme({
	...appearance({
		variant: ['solid', 'soft', 'outline', 'surface'],
		color: true,
		radius: ['sm', 'md', 'full'],
	}),
	defaultVariants: { variant: 'soft', color: 'neutral', radius: 'full' },
})

const inputSelection = appearance({
	variant: ['outline', 'surface', 'ghost', 'soft'],
	color: ['neutral', 'primary', 'success', 'danger'],
	radius: true,
})

/** Apariencia opcional de UIInput. El campo conserva su foco y la indicación de error. */
export const inputAppearance = defineTheme({
	variants: { ...inputSelection.variants, size: inputSizes },
	compoundVariants: inputSelection.compoundVariants,
	defaultVariants: { variant: 'outline', color: 'neutral', radius: 'md', size: 'md' },
})

/** Opciones de apariencia de UIBadge. */
export type BadgeAppearance = ThemeVariants<typeof badgeAppearance>
/** Opciones de apariencia de UIInput, incluido el tamaño específico del campo. */
export type InputAppearance = ThemeVariants<typeof inputAppearance>
