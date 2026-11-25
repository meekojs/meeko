// The look of the messages: <UIAlert>, <UIToast> and the host of the toasts in <UIApp>, <UIEmpty>,
// <UISkeleton> and <UIDisclosure>. Each property is set by one part only. What stays in feedback.css: the
// pseudo-elements of the View Transition that closes a toast, which belong to the document, and the keyframes.
import { tv } from 'tailwind-variants/lite'

import { focusRing } from './focus'

/** No transition or animation when the reader asks for less motion. */
const still = 'motion-reduce:transition-none motion-reduce:duration-0'

/** The box of an alert and a toast: the tone gives the colors. */
const box = [
	'box-border flex [align-items:start] gap-3 p-4',
	'rounded-lg border-(length:--ui-border-width) border-solid',
	'font-sans text-md leading-normal font-regular wrap-anywhere',
]

/** The colors of each tone; the neutral one is the surface, and a toast raises it. */
const tones = {
	neutral: 'border-border bg-surface text-text',
	info: 'border-info-border bg-info-soft text-info-text',
	success: 'border-success-border bg-success-soft text-success-text',
	warning: 'border-warning-border bg-warning-soft text-warning-text',
	danger: 'border-danger-border bg-danger-soft text-danger-text',
}

/** The buttons of the `actions` snippet, under the message. */
const actions = 'mt-3 flex flex-wrap gap-2'

/** The close button of an alert and a toast: a square as tall as a control, centered on the first line, in the color of its message. */
const dismiss = [
	'ms-auto mt-[calc((var(--ui-font-size-md)*var(--ui-line-height-normal)-var(--ui-control-height-md))/2)]',
	'inline-flex size-(--ui-control-height-md) flex-none cursor-pointer items-center justify-center',
	'rounded-md [border:0] bg-transparent text-inherit hover:bg-control-hover hover:text-text',
	focusRing,
]

export const alert = tv({
	slots: {
		// In the text of <UIProse> it is a block of its own, with the space of a paragraph under it unless it ends the text.
		base: [...box, '[.meeko-ui-prose>&]:mt-0 [.meeko-ui-prose>&:not(:last-child)]:mb-6'],
		/** The icon snippet: a direct <svg> is drawn with lines, as tall as the first line. */
		icon: [
			'inline-flex w-(--ui-icon-size) h-[calc(var(--ui-font-size-md)*var(--ui-line-height-normal))] shrink-0',
			'[&>svg]:size-full [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-linejoin:round] [&>svg]:[stroke-width:var(--ui-icon-stroke-width)]',
		],
		content: 'min-w-0 flex-1',
		title: 'm-0 font-semibold',
		description: 'm-0 text-inherit',
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
			'inset-auto end-4 bottom-4 m-0 [box-shadow:var(--ui-shadow-md)]',
			'transition-[opacity,translate] duration-(--ui-duration-slow) ease-out',
			still,
			// A manual popover: closed, it is not painted, whatever `display` the box has.
			'[&[popover]:not(:popover-open)]:hidden',
			// Its exit is a View Transition with a name only during its own type (feedback.css).
			'[html:active-view-transition-type(ui-toast-close)_&[data-meeko-ui-toast-state=closing]]:[view-transition-name:ui-toast]',
		],
		content: 'min-w-0 flex-1',
		message: 'm-0 text-inherit',
		actions,
		dismiss,
	},
	variants: {
		tone: {
			neutral: { base: 'border-border bg-surface-raised text-text' },
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
	hosted: 'static w-full starting:[translate:0_var(--ui-space-2)] starting:opacity-(--ui-opacity-hidden)',
	alone: 'fixed w-[min(var(--ui-toast-width),calc(100%-var(--ui-space-8)))] open:starting:[translate:0_var(--ui-space-2)] open:starting:opacity-(--ui-opacity-hidden)',
}

/** The host of the toasts in <UIApp>: a manual popover in the corner that stacks them and scrolls. */
export const toastHost = [
	'fixed inset-auto end-4 bottom-4 m-0 grid gap-2 p-0',
	'w-[min(var(--ui-toast-width),calc(100%-var(--ui-space-8)))] max-h-[calc(100%-var(--ui-space-8))] overflow-auto',
	'[border:0] bg-transparent',
	'[&:not(:popover-open)]:hidden',
].join(' ')

export const empty = tv({
	slots: {
		base: 'grid justify-items-start gap-2 font-sans text-md leading-normal font-regular text-text',
		title: 'm-0 font-semibold',
		description: 'm-0 text-text-soft',
		actions,
	},
	variants: {
		variant: {
			inline: { base: 'py-4' },
			panel: { base: 'rounded-lg border-(length:--ui-border-width) border-solid border-border bg-surface p-6' },
		},
	},
	defaultVariants: {
		variant: 'inline',
	},
})

export const skeleton = tv({
	slots: {
		base: 'grid gap-3',
		/** A bar that pulses, with the keyframes `ui-skeleton-pulse` of feedback.css. */
		line: [
			'h-4 rounded-sm bg-control-active',
			'animate-[ui-skeleton-pulse_var(--ui-skeleton-duration)_var(--ui-ease-in-out)_infinite_alternate] motion-reduce:animate-none',
		],
	},
})

/** The width of each line of a skeleton, from the scale of the tokens. Not a variant: the prop is `widths`, one per line. */
export const skeletonWidths = {
	full: 'w-full',
	long: 'w-(--ui-skeleton-width-long)',
	short: 'w-(--ui-skeleton-width-short)',
}

export const disclosure = tv({
	slots: {
		base: '',
		/** The summary, without the marker of the browser: the chevron of variants/navigation takes its place. */
		summary: [
			'inline-flex cursor-pointer list-none items-center gap-1 rounded-sm',
			'text-md text-text-soft hover:text-text [&::-webkit-details-marker]:hidden',
			'transition-[color] duration-(--ui-duration-fast)',
			still,
			focusRing,
		],
		body: 'pt-3',
	},
})
