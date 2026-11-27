// The look of <UIAvatar>: a square box of the size of `--ui-avatar-size-*`, painted by the pair of `variant` and
// `color` of the shared catalog (`appearance()`) and rounded by `radius`. An avatar is not a control, so it drops
// the pointer states of the catalog. The image fills and clips it; the initials and the glyph are centered.
// `defineTheme` merges the classes with Tailwind Merge, so the `class` of the consumer wins over the one of the recipe.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { appearance } from '../base/appearance'

/** Tratamientos que admite un avatar: los rellenos y los de borde del catálogo. */
export const avatarVariants = ['soft', 'solid', 'surface', 'outline'] as const

const selection = appearance({ variant: avatarVariants, color: true, radius: true }, { slot: 'base' })

/** The classes of a pair without the pointer states: an avatar does not react to the pointer. */
const still = (classes: string): string =>
	classes
		.split(' ')
		.filter((name) => !name.startsWith('not-disabled:'))
		.join(' ')

/** The pairs of the catalog for a static box, still aimed at `base`. */
const stillCompounds = selection.compoundVariants.map((entry) => ({ ...entry, class: { base: still(entry.class.base) } }))

/**
 * Receta de `UIAvatar`: `variant`, `color`, `radius` y `size`, con los slots `base`, `image` y `glyph`. Sin ellas es
 * un círculo (`radius` `full`) `soft` y `primary` de tamaño `md`.
 *
 * @example
 * ```ts
 * import { avatarTheme } from '@meekojs/ui/theme'
 *
 * const { base } = avatarTheme({ size: 'lg', radius: 'md', color: 'neutral' })
 * ```
 */
export const avatarTheme = defineTheme({
	slots: {
		base: [
			'relative inline-flex flex-none items-center justify-center overflow-hidden align-middle select-none',
			'font-sans leading-none font-semibold whitespace-nowrap',
		],
		/** La foto: llena la caja y se recorta sin deformarse. */
		image: 'block size-full object-cover',
		/** La persona genérica, sin imagen ni nombre: proporcional a la caja. */
		glyph: 'size-3/5 flex-none fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:var(--ui-icon-stroke-width)]',
	},
	variants: {
		...selection.variants,
		size: {
			sm: { base: 'size-(--ui-avatar-size-sm) text-(length:--ui-avatar-font-size-sm)' },
			md: { base: 'size-(--ui-avatar-size-md) text-(length:--ui-avatar-font-size-md)' },
			lg: { base: 'size-(--ui-avatar-size-lg) text-(length:--ui-avatar-font-size-lg)' },
		},
	},
	compoundVariants: stillCompounds,
	defaultVariants: { variant: 'soft', color: 'primary', radius: 'full', size: 'md' },
})

/** Variantes de la receta de `UIAvatar`, derivadas de `avatarTheme`. */
export type AvatarThemeProps = ThemeVariants<typeof avatarTheme>

/** Tratamiento visual de un avatar: `soft`, `solid`, `surface` u `outline`. */
export type UIAvatarVariant = NonNullable<AvatarThemeProps['variant']>
/** Color semántico de un avatar: `primary`, `secondary`, `neutral`, `success`, `info`, `warning` o `danger`. */
export type UIAvatarColor = NonNullable<AvatarThemeProps['color']>
/** Radio de un avatar, de `none` a `full`: `full` es un círculo. */
export type UIAvatarRadius = NonNullable<AvatarThemeProps['radius']>
/** Lado de un avatar: `sm`, `md` o `lg`. */
export type UIAvatarSize = NonNullable<AvatarThemeProps['size']>
