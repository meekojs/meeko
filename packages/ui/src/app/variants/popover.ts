// The look of <UIPopover> and <UITooltip>: a content in the top layer, anchored to its trigger with CSS anchor
// positioning (a browser without it opens the content unanchored, and it still works). The content slides out
// of its trigger on the side it opens: --popover-from is where it starts, and the script of ../utils/popover.ts
// gives --popover-offset, the only free number. Each property is set by one part only: the padding, the
// shadow, the radius and the text change with the role, so they live in `role` and not in the base.
import { tv } from '../utils/theme'

/** The focus ring of the trigger. */
const focusRing = 'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid'

/** The look of the content, the element with `popover`. */
export const popover = tv({
	base: [
		// Its place: on its trigger, flipped to the other side when it does not fit.
		'm-0 box-border inset-auto [position-anchor:auto] [position-try-fallbacks:flip-block,flip-inline]',
		// It fades and slides in from --popover-from, and back out; with reduced motion it only appears.
		'[translate:var(--popover-from,0_calc(var(--ui-space-1)*-1))] opacity-(--ui-opacity-hidden) open:[translate:0] open:opacity-(--ui-opacity-visible)',
		'starting:open:[translate:var(--popover-from,0_calc(var(--ui-space-1)*-1))] starting:open:opacity-(--ui-opacity-hidden)',
		'transition-[opacity,translate,display,overlay] transition-discrete duration-(--ui-duration-base) ease-out',
		'motion-reduce:[translate:none] motion-reduce:transition-none motion-reduce:duration-0',
		'border-(length:--ui-border-width) border-solid border-border bg-surface-raised font-sans text-text',
	],
	variants: {
		/** The ARIA pattern of the content: `none` for a list that names its own role, such as <UICombobox>. */
		role: {
			none: 'max-h-(--ui-popover-max-height) overflow-auto rounded-lg p-1 text-md [box-shadow:var(--ui-shadow-md)]',
			menu: 'max-h-(--ui-popover-max-height) min-w-(--ui-page-aside-width) overflow-auto rounded-lg p-1 text-md [box-shadow:var(--ui-shadow-md)]',
			dialog: 'max-h-(--ui-popover-max-height) w-[min(var(--ui-floating-panel-width),calc(100vw-var(--ui-space-8)))] overflow-auto rounded-lg p-4 text-md [box-shadow:var(--ui-shadow-md)]',
			// A tooltip is smaller than a panel, and its text wraps instead of scrolling.
			tooltip: 'max-h-(--ui-popover-max-height) max-w-(--ui-tooltip-max-width) overflow-visible rounded-md px-2 py-1 text-sm leading-snug [box-shadow:var(--ui-shadow-sm)]',
		},
		/** Where it opens: the side gives the margin and where it slides from, the alignment its `position-area`. */
		placement: {
			top: '[--popover-from:0_var(--ui-space-1)] [margin-block-end:var(--popover-offset,0)] [position-area:top]',
			'top-start': '[--popover-from:0_var(--ui-space-1)] [margin-block-end:var(--popover-offset,0)] [position-area:top_span-right]',
			'top-end': '[--popover-from:0_var(--ui-space-1)] [margin-block-end:var(--popover-offset,0)] [position-area:top_span-left]',
			bottom: '[--popover-from:0_calc(var(--ui-space-1)*-1)] [margin-block-start:var(--popover-offset,0)] [position-area:bottom]',
			'bottom-start': '[--popover-from:0_calc(var(--ui-space-1)*-1)] [margin-block-start:var(--popover-offset,0)] [position-area:bottom_span-right]',
			'bottom-end': '[--popover-from:0_calc(var(--ui-space-1)*-1)] [margin-block-start:var(--popover-offset,0)] [position-area:bottom_span-left]',
			left: '[--popover-from:var(--ui-space-1)_0] [margin-inline-end:var(--popover-offset,0)] [position-area:left]',
			'left-start': '[--popover-from:var(--ui-space-1)_0] [margin-inline-end:var(--popover-offset,0)] [position-area:left_span-bottom]',
			'left-end': '[--popover-from:var(--ui-space-1)_0] [margin-inline-end:var(--popover-offset,0)] [position-area:left_span-top]',
			right: '[--popover-from:calc(var(--ui-space-1)*-1)_0] [margin-inline-start:var(--popover-offset,0)] [position-area:right]',
			'right-start': '[--popover-from:calc(var(--ui-space-1)*-1)_0] [margin-inline-start:var(--popover-offset,0)] [position-area:right_span-bottom]',
			'right-end': '[--popover-from:calc(var(--ui-space-1)*-1)_0] [margin-inline-start:var(--popover-offset,0)] [position-area:right_span-top]',
		},
		/** At least as wide as its trigger; a menu keeps its own minimum. */
		matchWidth: {
			true: '',
			false: '',
		},
	},
	compoundVariants: [{ role: ['none', 'dialog', 'tooltip'], matchWidth: true, class: 'min-w-[anchor-size(width)]' }],
	defaultVariants: {
		role: 'none',
		placement: 'bottom-start',
		matchWidth: false,
	},
})

/** The trigger that <UIPopover> paints, with the look of a control; `triggerClass` adds to it. */
export const popoverTrigger = tv({
	base: [
		'inline-flex min-h-(--ui-control-height-md) cursor-pointer items-center p-(--ui-control-padding-md)',
		'rounded-md border-(length:--ui-border-width) border-solid border-border-strong',
		'bg-control hover:bg-control-hover aria-expanded:bg-control-hover',
		'font-sans text-control-md leading-tight font-control tracking-snug text-text',
		'transition-[background-color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
		focusRing,
	],
})

/** The trigger that <UITooltip> paints: it keeps the text around it, and the pointer says there is help. */
export const tooltipTrigger = tv({
	base: ['cursor-help [border:0] bg-transparent p-0 [color:inherit] [font:inherit]', focusRing],
})

/**
 * The look of <UIHint>: an ⓘ of the size of the text around it, in a heading as in a paragraph, that sits on
 * its line like a letter. Its hit area reaches a little beyond the icon without moving the text around it.
 */
export const hint = tv({
	slots: {
		base: [
			'relative m-0 inline-flex cursor-help items-center justify-center rounded-full [border:0] bg-transparent p-0 align-(--ui-icon-text-align)',
			'text-text-soft hover:text-text [font:inherit] leading-none',
			'transition-[color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
			'before:absolute before:-inset-(--ui-hint-hit-area) before:rounded-full',
			focusRing,
		],
		icon: '',
		tooltip: '',
	},
})
