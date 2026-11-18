// The look of <UIPopover> and <UITooltip>: a content in the top layer, anchored to its trigger with CSS anchor
// positioning (a browser without it opens the content unanchored, and it still works). The content slides out
// of its trigger on the side it opens: --popover-from is where it starts, and the script of ../utils/popover.ts
// gives --popover-offset, the only free number. Each property is set by one part only: the padding, the
// shadow, the radius and the text change with the role, so they live in `role` and not in the base.
import { tv } from 'tailwind-variants/lite'

/** The focus ring of the trigger. */
const focusRing = 'ui:focus-visible:outline-(length:--ui-focus-ring-width) ui:focus-visible:outline-focus ui:focus-visible:outline-offset-(--ui-focus-ring-offset) ui:focus-visible:outline-solid'

/** The look of the content, the element with `popover`. */
export const popover = tv({
	base: [
		// Its place: on its trigger, flipped to the other side when it does not fit.
		'ui:m-0 ui:box-border ui:inset-auto ui:[position-anchor:auto] ui:[position-try-fallbacks:flip-block,flip-inline]',
		// It fades and slides in from --popover-from, and back out; with reduced motion it only appears.
		'ui:[translate:var(--popover-from,0_calc(var(--ui-space-1)*-1))] ui:opacity-(--ui-opacity-hidden) ui:open:[translate:0] ui:open:opacity-(--ui-opacity-visible)',
		'ui:starting:open:[translate:var(--popover-from,0_calc(var(--ui-space-1)*-1))] ui:starting:open:opacity-(--ui-opacity-hidden)',
		'ui:transition-[opacity,translate,display,overlay] ui:transition-discrete ui:duration-(--ui-duration-base) ui:ease-out',
		'ui:motion-reduce:[translate:none] ui:motion-reduce:transition-none ui:motion-reduce:duration-0',
		'ui:border-(length:--ui-border-width) ui:border-solid ui:border-border ui:bg-surface-raised ui:font-sans ui:text-text',
	],
	variants: {
		/** The ARIA pattern of the content: `none` for a list that names its own role, such as <UICombobox>. */
		role: {
			none: 'ui:max-h-(--ui-popover-max-height) ui:overflow-auto ui:rounded-lg ui:p-1 ui:text-md ui:[box-shadow:var(--ui-shadow-md)]',
			menu: 'ui:max-h-(--ui-popover-max-height) ui:min-w-(--ui-page-aside-width) ui:overflow-auto ui:rounded-lg ui:p-1 ui:text-md ui:[box-shadow:var(--ui-shadow-md)]',
			dialog: 'ui:max-h-(--ui-popover-max-height) ui:w-[min(var(--ui-floating-panel-width),calc(100vw-var(--ui-space-8)))] ui:overflow-auto ui:rounded-lg ui:p-4 ui:text-md ui:[box-shadow:var(--ui-shadow-md)]',
			// A tooltip is smaller than a panel, and its text wraps instead of scrolling.
			tooltip: 'ui:max-h-(--ui-popover-max-height) ui:max-w-(--ui-tooltip-max-width) ui:overflow-visible ui:rounded-md ui:px-2 ui:py-1 ui:text-sm ui:leading-snug ui:[box-shadow:var(--ui-shadow-sm)]',
		},
		/** Where it opens: the side gives the margin and where it slides from, the alignment its `position-area`. */
		placement: {
			top: 'ui:[--popover-from:0_var(--ui-space-1)] ui:[margin-block-end:var(--popover-offset,0)] ui:[position-area:top]',
			'top-start': 'ui:[--popover-from:0_var(--ui-space-1)] ui:[margin-block-end:var(--popover-offset,0)] ui:[position-area:top_span-right]',
			'top-end': 'ui:[--popover-from:0_var(--ui-space-1)] ui:[margin-block-end:var(--popover-offset,0)] ui:[position-area:top_span-left]',
			bottom: 'ui:[--popover-from:0_calc(var(--ui-space-1)*-1)] ui:[margin-block-start:var(--popover-offset,0)] ui:[position-area:bottom]',
			'bottom-start': 'ui:[--popover-from:0_calc(var(--ui-space-1)*-1)] ui:[margin-block-start:var(--popover-offset,0)] ui:[position-area:bottom_span-right]',
			'bottom-end': 'ui:[--popover-from:0_calc(var(--ui-space-1)*-1)] ui:[margin-block-start:var(--popover-offset,0)] ui:[position-area:bottom_span-left]',
			left: 'ui:[--popover-from:var(--ui-space-1)_0] ui:[margin-inline-end:var(--popover-offset,0)] ui:[position-area:left]',
			'left-start': 'ui:[--popover-from:var(--ui-space-1)_0] ui:[margin-inline-end:var(--popover-offset,0)] ui:[position-area:left_span-bottom]',
			'left-end': 'ui:[--popover-from:var(--ui-space-1)_0] ui:[margin-inline-end:var(--popover-offset,0)] ui:[position-area:left_span-top]',
			right: 'ui:[--popover-from:calc(var(--ui-space-1)*-1)_0] ui:[margin-inline-start:var(--popover-offset,0)] ui:[position-area:right]',
			'right-start': 'ui:[--popover-from:calc(var(--ui-space-1)*-1)_0] ui:[margin-inline-start:var(--popover-offset,0)] ui:[position-area:right_span-bottom]',
			'right-end': 'ui:[--popover-from:calc(var(--ui-space-1)*-1)_0] ui:[margin-inline-start:var(--popover-offset,0)] ui:[position-area:right_span-top]',
		},
		/** At least as wide as its trigger; a menu keeps its own minimum. */
		matchWidth: {
			true: '',
			false: '',
		},
	},
	compoundVariants: [{ role: ['none', 'dialog', 'tooltip'], matchWidth: true, class: 'ui:min-w-[anchor-size(width)]' }],
	defaultVariants: {
		role: 'none',
		placement: 'bottom-start',
		matchWidth: false,
	},
})

/** The trigger that <UIPopover> paints, with the look of a control; `triggerClass` adds to it. */
export const popoverTrigger = tv({
	base: [
		'ui:inline-flex ui:min-h-(--ui-control-height-md) ui:cursor-pointer ui:items-center ui:p-(--ui-control-padding-md)',
		'ui:rounded-md ui:border-(length:--ui-border-width) ui:border-solid ui:border-border-strong',
		'ui:bg-control ui:hover:bg-control-hover ui:aria-expanded:bg-control-hover',
		'ui:font-sans ui:text-control-md ui:leading-tight ui:font-control ui:tracking-snug ui:text-text',
		'ui:transition-[background-color] ui:duration-(--ui-duration-fast) ui:motion-reduce:transition-none ui:motion-reduce:duration-0',
		focusRing,
	],
})

/** The trigger that <UITooltip> paints: it keeps the text around it, and the pointer says there is help. */
export const tooltipTrigger = tv({
	base: ['ui:cursor-help ui:[border:0] ui:bg-transparent ui:p-0 ui:[color:inherit] ui:[font:inherit]', focusRing],
})
