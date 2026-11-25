import type { VariantProps } from 'tailwind-variants/lite'

import { tv } from 'tailwind-variants/lite'

import { appearance } from './base/appearance'

const inputSizes = {
	sm: 'min-h-(--ui-control-height-sm)',
	md: 'min-h-(--ui-control-height-md)',
	lg: 'min-h-(--ui-control-height-lg)',
} as const

/** Apariencia opcional de UIButton. La receta estructural conserva la semántica nativa. */
export const buttonAppearance = tv({
	...appearance({
		variant: ['solid', 'soft', 'outline', 'ghost', 'link'],
		color: true,
		radius: true,
		size: true,
		width: ['auto', 'full'],
		elevation: true,
	}),
	defaultVariants: { variant: 'solid', color: 'neutral', size: 'md', radius: 'md' },
})

/** Apariencia opcional de UIBadge. */
export const badgeAppearance = tv({
	...appearance({
		variant: ['solid', 'soft', 'outline', 'surface'],
		color: true,
		radius: ['sm', 'md', 'full'],
	}),
	defaultVariants: { variant: 'soft', color: 'neutral', radius: 'full' },
})

/** Apariencia opcional de UIInput. El campo conserva su foco y la indicación de error. */
export const inputAppearance = tv({
	variants: {
		...appearance({
			variant: ['outline', 'surface', 'ghost', 'soft'],
			color: ['neutral', 'primary', 'success', 'error'],
			radius: true,
		}).variants,
		size: inputSizes,
	},
	defaultVariants: { variant: 'outline', color: 'neutral', radius: 'md', size: 'md' },
})

/** Apariencia opcional de UICard. La densidad de su contenido sigue el padding de los slots. */
export const cardAppearance = tv({
	...appearance({
		variant: ['surface', 'outline', 'glass', 'plain'],
		color: ['neutral', 'primary'],
		radius: true,
		elevation: true,
	}),
	defaultVariants: { variant: 'surface', color: 'neutral', radius: 'lg', elevation: 'none' },
})

/** Opciones de apariencia de UIButton. */
export type ButtonAppearance = VariantProps<typeof buttonAppearance>
/** Opciones de apariencia de UIBadge. */
export type BadgeAppearance = VariantProps<typeof badgeAppearance>
/** Opciones de apariencia de UIInput, incluido el tamaño específico del campo. */
export type InputAppearance = VariantProps<typeof inputAppearance>
/** Opciones de apariencia de UICard. */
export type CardAppearance = VariantProps<typeof cardAppearance>
