// The look of <UIBadge>, also used by NavigationTree for the label of a featured item. A badge never
// breaks: it is a pill, and inside a table the column grows instead.
import { tv } from 'tailwind-variants/lite'

export const badge = tv({
	slots: {
		base: [
			'ui:inline-flex ui:items-center ui:gap-1.5 ui:[justify-self:start] ui:align-middle ui:whitespace-nowrap',
			'ui:rounded-full ui:border-(length:--ui-border-width) ui:px-2 ui:py-0.5',
			'ui:font-sans ui:text-xs ui:leading-snug ui:font-medium',
		],
		dot: 'ui:size-(--ui-badge-dot-size) ui:rounded-full ui:bg-current',
	},
	variants: {
		tone: {
			neutral: { base: 'ui:border-border ui:bg-control ui:text-text-soft' },
			accent: { base: 'ui:border-transparent ui:bg-primary-soft ui:text-primary-text' },
			info: { base: 'ui:border-transparent ui:bg-info-soft ui:text-info-text' },
			success: { base: 'ui:border-transparent ui:bg-success-soft ui:text-success-text' },
			warning: { base: 'ui:border-transparent ui:bg-warning-soft ui:text-warning-text' },
			danger: { base: 'ui:border-transparent ui:bg-danger-soft ui:text-danger-text' },
		},
	},
	defaultVariants: {
		tone: 'neutral',
	},
})
