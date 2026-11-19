// The look of <UIDrawer>: a native modal <dialog> against one edge of the screen. Closed, the UA hides it;
// it enters by sliding from its edge with @starting-style, and leaves with the View Transition of <UIModal>
// (navigation.css). Each property is set by one part only.
import { tv } from 'tailwind-variants/lite'

import { focusRing } from './focus'

/**
 * Where it slides from: off its edge while closed and as it opens, in its place once open. The edge is
 * `--drawer-shift`, which each side sets for both directions of the text.
 */
const slide = [
	'ui:[translate:var(--drawer-shift)_0] ui:open:[translate:0_0] ui:open:starting:[translate:var(--drawer-shift)_0]',
	'ui:transition-[translate] ui:duration-(--ui-duration-slow) ui:ease-out',
	'ui:backdrop:bg-transparent ui:open:backdrop:bg-overlay ui:open:starting:backdrop:bg-transparent',
	'ui:backdrop:transition-[background-color] ui:backdrop:duration-(--ui-duration-slow) ui:backdrop:ease-out',
	'ui:motion-reduce:transition-none ui:motion-reduce:duration-0 ui:motion-reduce:backdrop:transition-none ui:motion-reduce:backdrop:duration-0',
]

/**
 * While it is open the page does not scroll, until its exit ends: changing the overflow of the root inside
 * a View Transition crashes WebKit 27.2. With the width of the gutter of the scrollbar measured
 * (utils/scrollbar-gutter), the gutter goes back to the viewport and the root takes that width as padding on
 * its side, so the page does not move and the panel and its ::backdrop reach the edge of the window. Without
 * it, as before the hydration, the gutter stays, and only the background of the root reaches it: the root
 * takes the color of what touches it, and the body covers the screen so that the overlay does not darken
 * the root twice.
 */
const root = [
	'ui:[:root:has(&:is([open],[data-meeko-ui-modal-state=closing]))]:overflow-hidden ui:[:root:has(&:is([open],[data-meeko-ui-modal-state=closing]))]:[scrollbar-gutter:stable]',
	'ui:[:root[data-meeko-ui-scrollbar-gutter]:has(&:is([open],[data-meeko-ui-modal-state=closing]))]:[scrollbar-gutter:auto]',
	'ui:[:root[data-meeko-ui-scrollbar-gutter=right]:has(&:is([open],[data-meeko-ui-modal-state=closing]))]:pr-(--ui-scrollbar-gutter) ui:[:root[data-meeko-ui-scrollbar-gutter=left]:has(&:is([open],[data-meeko-ui-modal-state=closing]))]:pl-(--ui-scrollbar-gutter)',
	'ui:[:root:has(&:modal)]:transition-[background-color] ui:[:root:has(&:modal)]:duration-(--ui-duration-slow) ui:[:root:has(&:modal)]:ease-linear ui:motion-reduce:[:root:has(&:modal)]:transition-none ui:motion-reduce:[:root:has(&:modal)]:duration-0',
	'ui:[:root:has(&:modal)_body]:[min-block-size:100dvh]',
]

/** The name of the panel during the exit of <UIModal>, by the edge it leaves through. */
const leaves = {
	left: 'ui:[html:active-view-transition-type(ui-modal-close)_&[data-meeko-ui-modal-state=closing]]:[view-transition-name:ui-drawer-left]',
	right: 'ui:[html:active-view-transition-type(ui-modal-close)_&[data-meeko-ui-modal-state=closing]]:[view-transition-name:ui-drawer-right]',
	rtlLeft: 'ui:[html:active-view-transition-type(ui-modal-close)_&[data-meeko-ui-modal-state=closing]:dir(rtl)]:[view-transition-name:ui-drawer-left]',
	rtlRight: 'ui:[html:active-view-transition-type(ui-modal-close)_&[data-meeko-ui-modal-state=closing]:dir(rtl)]:[view-transition-name:ui-drawer-right]',
}

export const drawer = tv({
	slots: {
		base: [
			'ui:fixed ui:inset-y-0 ui:m-0 ui:h-dvh ui:max-h-none ui:w-[min(var(--ui-drawer-width),calc(100vw-var(--ui-space-12)))] ui:max-w-none ui:p-0',
			'ui:[border-block:0] ui:bg-surface-raised ui:font-sans ui:text-md ui:text-text ui:[box-shadow:var(--ui-shadow-lg)]',
			...slide,
			...root,
		],
		// The button that opens it is an outline button of variants/button: `ui.trigger` adds to it.
		trigger: '',
		panel: 'ui:flex ui:h-full ui:flex-col',
		heading: 'ui:flex ui:flex-none ui:items-center ui:justify-between ui:gap-3 ui:border-b-(length:--ui-border-width) ui:border-b-border ui:px-4 ui:py-3',
		title: 'ui:m-0 ui:text-lg ui:leading-snug ui:font-semibold ui:tracking-tight',
		close: [
			'ui:inline-flex ui:size-(--ui-control-height-md) ui:flex-none ui:cursor-pointer ui:items-center ui:justify-center',
			'ui:rounded-md ui:[border:0] ui:bg-transparent ui:text-text-soft ui:hover:bg-control-hover ui:hover:text-text',
			focusRing,
		],
		body: 'ui:min-h-0 ui:flex-1 ui:overflow-y-auto ui:overscroll-contain ui:p-4',
		footer: 'ui:flex ui:flex-none ui:flex-wrap ui:gap-2 ui:border-t-(length:--ui-border-width) ui:border-t-border ui:px-4 ui:py-3',
	},
	variants: {
		side: {
			start: {
				base: [
					'ui:start-0 ui:end-auto ui:[border-inline-start:0] ui:[border-inline-end:var(--ui-border-width)_solid_var(--ui-color-border)]',
					'ui:[--drawer-shift:-100%] ui:rtl:[--drawer-shift:100%]',
					'ui:[:root:not([data-meeko-ui-scrollbar-gutter]):has(&:modal)]:bg-overlay-solid',
					leaves.left,
					leaves.rtlRight,
				],
			},
			end: {
				base: [
					'ui:start-auto ui:end-0 ui:[border-inline-end:0] ui:[border-inline-start:var(--ui-border-width)_solid_var(--ui-color-border)]',
					'ui:[--drawer-shift:100%] ui:rtl:[--drawer-shift:-100%]',
					// Where the gutter stays, the panel touches it: the root takes its color.
					'ui:[:root:not([data-meeko-ui-scrollbar-gutter]):has(&:modal)]:bg-surface-raised',
					leaves.right,
					leaves.rtlLeft,
				],
			},
		},
	},
	defaultVariants: {
		side: 'start',
	},
})
