import { badgeAppearance, type BadgeAppearance } from '../theme/recipes'
// The look of <UIBadge>, also used by NavigationTree for the label of a featured item. A badge never
// breaks: it is a pill, and inside a table the column grows instead.
import { tv } from '../utils/theme'

export const badge = tv({
	slots: {
		base: [
			'meeko-ui-component',
			'inline-flex items-center gap-1.5 [justify-self:start] align-middle whitespace-nowrap',
			'border-(length:--ui-border-width) px-2 py-0.5',
			'font-sans text-xs leading-snug font-medium',
		],
		dot: 'size-(--ui-badge-dot-size) rounded-full bg-current',
	},
	variants: {
		tone: {
			custom: '',
			neutral: { base: 'rounded-full border-border bg-control text-text-soft' },
			accent: { base: 'rounded-full border-transparent bg-primary-soft text-primary-text' },
			info: { base: 'rounded-full border-transparent bg-info-soft text-info-text' },
			success: { base: 'rounded-full border-transparent bg-success-soft text-success-text' },
			warning: { base: 'rounded-full border-transparent bg-warning-soft text-warning-text' },
			danger: { base: 'rounded-full border-transparent bg-danger-soft text-danger-text' },
		},
	},
	defaultVariants: {
		tone: 'neutral',
	},
})

/** Mantiene el indicador del badge al cambiar su apariencia. */
export function badgeWithAppearance(appearance: BadgeAppearance) {
	return { slots: badge({ tone: 'custom' }), className: badgeAppearance(appearance) }
}
