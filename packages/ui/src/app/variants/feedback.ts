// The look of the messages: <UIAlert>, <UIToast> and the host of the toasts in <UIApp>, <UIEmpty>,
// <UISkeleton> and <UIDisclosure>. Each property is set by one part only. What stays in feedback.css: the
// pseudo-elements of the View Transition that closes a toast, which belong to the document, and the keyframes.
import { tv } from 'tailwind-variants/lite'

import { focusRing } from './focus'

/** No transition or animation when the reader asks for less motion. */
const still = 'ui:motion-reduce:transition-none ui:motion-reduce:duration-0'

/** The box of an alert and a toast: the tone gives the colors. */
const box = [
	'ui:box-border ui:flex ui:[align-items:start] ui:gap-3 ui:p-4',
	'ui:rounded-lg ui:border-(length:--ui-border-width) ui:border-solid',
	'ui:font-sans ui:text-md ui:leading-normal ui:font-regular ui:wrap-anywhere',
]

/** The colors of each tone; the neutral one is the surface, and a toast raises it. */
const tones = {
	neutral: 'ui:border-border ui:bg-surface ui:text-text',
	info: 'ui:border-info-border ui:bg-info-soft ui:text-info-text',
	success: 'ui:border-success-border ui:bg-success-soft ui:text-success-text',
	warning: 'ui:border-warning-border ui:bg-warning-soft ui:text-warning-text',
	danger: 'ui:border-danger-border ui:bg-danger-soft ui:text-danger-text',
}

/** The buttons of the `actions` snippet, under the message. */
const actions = 'ui:mt-3 ui:flex ui:flex-wrap ui:gap-2'

/** The close button of an alert and a toast: a square as tall as a control, centered on the first line, in the color of its message. */
const dismiss = [
	'ui:ms-auto ui:mt-[calc((var(--ui-font-size-md)*var(--ui-line-height-normal)-var(--ui-control-height-md))/2)]',
	'ui:inline-flex ui:size-(--ui-control-height-md) ui:flex-none ui:cursor-pointer ui:items-center ui:justify-center',
	'ui:rounded-md ui:[border:0] ui:bg-transparent ui:text-inherit ui:hover:bg-control-hover ui:hover:text-text',
	focusRing,
]

export const alert = tv({
	slots: {
		// In the text of <UIProse> it is a block of its own, with the space of a paragraph under it unless it ends the text.
		base: [...box, 'ui:[.meeko-ui-prose>&]:mt-0 ui:[.meeko-ui-prose>&:not(:last-child)]:mb-6'],
		/** The icon snippet: a direct <svg> is drawn with lines, as tall as the first line. */
		icon: [
			'ui:inline-flex ui:w-(--ui-icon-size) ui:h-[calc(var(--ui-font-size-md)*var(--ui-line-height-normal))] ui:shrink-0',
			'ui:[&>svg]:size-full ui:[&>svg]:fill-none ui:[&>svg]:stroke-current ui:[&>svg]:[stroke-linecap:round] ui:[&>svg]:[stroke-linejoin:round] ui:[&>svg]:[stroke-width:var(--ui-icon-stroke-width)]',
		],
		content: 'ui:min-w-0 ui:flex-1',
		title: 'ui:m-0 ui:font-semibold',
		description: 'ui:m-0 ui:text-inherit',
		actions,
		dismiss,
	},
	variants: {
		tone: {
			neutral: { base: tones.neutral },
			info: { base: tones.info },
			success: { base: tones.success },
			warning: { base: tones.warning },
			danger: { base: tones.danger },
		},
	},
	defaultVariants: {
		tone: 'neutral',
	},
})

export const toast = tv({
	slots: {
		base: [
			...box,
			'ui:inset-auto ui:end-4 ui:bottom-4 ui:m-0 ui:[box-shadow:var(--ui-shadow-md)]',
			'ui:transition-[opacity,translate] ui:duration-(--ui-duration-slow) ui:ease-out',
			still,
			// A manual popover: closed, it is not painted, whatever `display` the box has.
			'ui:[&[popover]:not(:popover-open)]:hidden',
			// Its exit is a View Transition with a name only during its own type (feedback.css).
			'ui:[html:active-view-transition-type(ui-toast-close)_&[data-meeko-ui-toast-state=closing]]:[view-transition-name:ui-toast]',
		],
		content: 'ui:min-w-0 ui:flex-1',
		message: 'ui:m-0 ui:text-inherit',
		actions,
		dismiss,
	},
	variants: {
		tone: {
			neutral: { base: 'ui:border-border ui:bg-surface-raised ui:text-text' },
			info: { base: tones.info },
			success: { base: tones.success },
			warning: { base: tones.warning },
			danger: { base: tones.danger },
		},
	},
	defaultVariants: {
		tone: 'neutral',
	},
})

/**
 * Where a toast is: in the host of <UIApp>, which places it, or alone, as a popover in the corner. Not a
 * variant, so that it is no prop of the public type: only the host decides it.
 */
export const toastPlacement = {
	// It enters from a little lower, and transparent: in the host as soon as it is added, alone as it opens.
	hosted: 'ui:static ui:w-full ui:starting:[translate:0_var(--ui-space-2)] ui:starting:opacity-(--ui-opacity-hidden)',
	alone: 'ui:fixed ui:w-[min(var(--ui-toast-width),calc(100%-var(--ui-space-8)))] ui:open:starting:[translate:0_var(--ui-space-2)] ui:open:starting:opacity-(--ui-opacity-hidden)',
}

/** The host of the toasts in <UIApp>: a manual popover in the corner that stacks them and scrolls. */
export const toastHost = [
	'ui:fixed ui:inset-auto ui:end-4 ui:bottom-4 ui:m-0 ui:grid ui:gap-2 ui:p-0',
	'ui:w-[min(var(--ui-toast-width),calc(100%-var(--ui-space-8)))] ui:max-h-[calc(100%-var(--ui-space-8))] ui:overflow-auto',
	'ui:[border:0] ui:bg-transparent',
	'ui:[&:not(:popover-open)]:hidden',
].join(' ')

export const empty = tv({
	slots: {
		base: 'ui:grid ui:justify-items-start ui:gap-2 ui:font-sans ui:text-md ui:leading-normal ui:font-regular ui:text-text',
		title: 'ui:m-0 ui:font-semibold',
		description: 'ui:m-0 ui:text-text-soft',
		actions,
	},
	variants: {
		variant: {
			inline: { base: 'ui:py-4' },
			panel: { base: 'ui:rounded-lg ui:border-(length:--ui-border-width) ui:border-solid ui:border-border ui:bg-surface ui:p-6' },
		},
	},
	defaultVariants: {
		variant: 'inline',
	},
})

export const skeleton = tv({
	slots: {
		base: 'ui:grid ui:gap-3',
		/** A bar that pulses, with the keyframes `ui-skeleton-pulse` of feedback.css. */
		line: [
			'ui:h-4 ui:rounded-sm ui:bg-control-active',
			'ui:animate-[ui-skeleton-pulse_var(--ui-skeleton-duration)_var(--ui-ease-in-out)_infinite_alternate] ui:motion-reduce:animate-none',
		],
	},
})

/** The width of each line of a skeleton, from the scale of the tokens. Not a variant: the prop is `widths`, one per line. */
export const skeletonWidths = {
	full: 'ui:w-full',
	long: 'ui:w-(--ui-skeleton-width-long)',
	short: 'ui:w-(--ui-skeleton-width-short)',
}

export const disclosure = tv({
	slots: {
		base: '',
		/** The summary, without the marker of the browser: the chevron of variants/navigation takes its place. */
		summary: [
			'ui:inline-flex ui:cursor-pointer ui:list-none ui:items-center ui:gap-1 ui:rounded-sm',
			'ui:text-md ui:text-text-soft ui:hover:text-text ui:[&::-webkit-details-marker]:hidden',
			'ui:transition-[color] ui:duration-(--ui-duration-fast)',
			still,
			focusRing,
		],
		body: 'ui:pt-3',
	},
})
