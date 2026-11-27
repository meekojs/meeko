// The look of <UIBadge>, also used by NavigationTree for the label of a featured item. A badge never breaks: it
// is a pill, and inside a table the column grows instead. The color comes from the shared catalog
// (`appearance()`), aimed at the `base` slot: each pair of `variant` and `color` is one compound variant with the
// steps of its scale. A badge is not a control, so it drops the pointer states of the catalog
// (`not-disabled:hover:*`, `not-disabled:active:*`), which a <span> would match. `defineTheme` merges the classes
// with Tailwind Merge, so the `class` of the consumer wins over the one of the recipe.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { appearance } from '../base/appearance'

/** Tratamientos que admite un badge: los rellenos y los de borde del catálogo. */
export const badgeVariants = ['soft', 'solid', 'surface', 'outline'] as const

const selection = appearance({ variant: badgeVariants, color: true, radius: true }, { slot: 'base' })

/** The classes of a pair without the pointer states: a badge does not react to the pointer. */
const still = (classes: string): string =>
	classes
		.split(' ')
		.filter((name) => !name.startsWith('not-disabled:'))
		.join(' ')

/** The pairs of the catalog for a static label, still aimed at `base`. */
const stillCompounds = selection.compoundVariants.map((entry) => ({ ...entry, class: { base: still(entry.class.base) } }))

/**
 * The neutral soft badge, the default one, reads the semantic tokens of the page with a border of their own, as
 * before the catalog: the background of a control, the soft text and the border of the surfaces. `ui.tokens`
 * (`border`, `textSoft`) only sets the semantic ones.
 */
const neutralSoft = { variant: 'soft', color: 'neutral', class: { base: 'border-border bg-control text-text-soft' } } as const

/**
 * Receta de `UIBadge`: `variant`, `color` y `radius`, con los slots `base` y `dot`. Sin ellas es una píldora
 * `soft` y `neutral` de radio `full`.
 *
 * @example
 * ```ts
 * import { badgeTheme } from '@meekojs/ui/theme'
 *
 * const { base, dot } = badgeTheme({ variant: 'solid', color: 'success' })
 * const classes = base({ class: 'ms-auto' })
 * ```
 */
export const badgeTheme = defineTheme({
	slots: {
		base: [
			'meeko-ui-component',
			'inline-flex items-center gap-1.5 [justify-self:start] align-middle whitespace-nowrap',
			'border-(length:--ui-border-width) border-transparent px-2 py-0.5',
			'font-sans text-xs leading-snug font-medium',
		],
		dot: 'size-(--ui-badge-dot-size) rounded-full bg-current',
	},
	variants: selection.variants,
	compoundVariants: [...stillCompounds, neutralSoft],
	defaultVariants: { variant: 'soft', color: 'neutral', radius: 'full' },
})

/** Variantes de la receta de `UIBadge`, derivadas de `badgeTheme`. */
export type BadgeThemeProps = ThemeVariants<typeof badgeTheme>

/** Tratamiento visual de un badge: `soft`, `solid`, `surface` u `outline`. */
export type UIBadgeVariant = NonNullable<BadgeThemeProps['variant']>
/** Color semántico de un badge: `primary`, `secondary`, `neutral`, `success`, `info`, `warning` o `danger`. */
export type UIBadgeColor = NonNullable<BadgeThemeProps['color']>
/** Radio del contorno de un badge, de `none` a `full`. */
export type UIBadgeRadius = NonNullable<BadgeThemeProps['radius']>
