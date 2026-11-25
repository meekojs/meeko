// The look of <UIModal>: a native modal <dialog> in the middle of the screen. It enters with @starting-style
// and leaves with a View Transition (modal.css keeps its pseudo-elements and keyframes). utils/modal-dialog
// writes the stack: `--ui-modal-depth`, `data-meeko-ui-modal-top`, `-behind` and `-state`. Each property is set
// by one part only.
import { tv } from '../utils/theme'
import { focusRing } from './focus'

/**
 * The dialog without its place or its size, which <UICommandPalette> shares: the surface, the stack, the
 * entrance, the backdrop and the exit. A dialog behind another one steps back and does not take the pointer;
 * only the top one darkens the page.
 */
export const modalSurface = [
	'box-border max-w-none overflow-hidden p-0 open:flex open:flex-col',
	'rounded-xl border-(length:--ui-border-width) border-solid border-border bg-surface-raised [box-shadow:var(--ui-shadow-lg)]',
	'font-sans text-md text-text',
	'[translate:0_calc(var(--ui-modal-depth,0)*var(--ui-modal-stack-offset)*-1)] [scale:calc(1-var(--ui-modal-depth,0)*var(--ui-modal-stack-scale))]',
	'data-meeko-ui-modal-behind:pointer-events-none data-[meeko-ui-modal-state=closing]:pointer-events-none',
	// The entrance is CSS: it does not block the page, and WebKit does not paint a modal that opens inside a
	// View Transition. No `display` or `overlay allow-discrete`: they would keep the closing dialog in the new
	// capture of its exit.
	'open:starting:[translate:0_var(--ui-space-4)] open:starting:[scale:calc(1-var(--ui-modal-stack-scale))] open:starting:opacity-(--ui-opacity-hidden)',
	'transition-[opacity,scale,translate] duration-(--ui-duration-slow) ease-out',
	'backdrop:bg-transparent data-meeko-ui-modal-top:backdrop:bg-overlay open:starting:backdrop:opacity-(--ui-opacity-hidden)',
	'backdrop:transition-[opacity] backdrop:duration-(--ui-duration-slow) backdrop:ease-linear',
	'motion-reduce:transition-none motion-reduce:duration-0 motion-reduce:backdrop:transition-none motion-reduce:backdrop:duration-0',
	// The exit has a name only during its own type: any other transition, such as a navigation with a modal
	// open, neither captures the modal nor plays its animation again.
	'[html:active-view-transition-type(ui-modal-close)_&[data-meeko-ui-modal-state=closing]]:[view-transition-name:ui-modal]',
	// Neither a dialog nor its ::backdrop reach the gutter kept for the scrollbar, which only takes the
	// background of the root: the root takes the color of the overlay, and the body covers the screen so that
	// the overlay does not darken the root twice. <UIDrawer> does the same in variants/drawer.
	'[:root:has(&:modal)]:bg-overlay-solid [:root:has(&:modal)_body]:[min-block-size:100dvh]',
	'[:root:has(&:modal)]:transition-[background-color] [:root:has(&:modal)]:duration-(--ui-duration-slow) [:root:has(&:modal)]:ease-linear motion-reduce:[:root:has(&:modal)]:transition-none motion-reduce:[:root:has(&:modal)]:duration-0',
]

export const modal = tv({
	slots: {
		base: ['m-auto max-h-[calc(100dvh-var(--ui-space-8))]', ...modalSurface],
		heading: 'flex flex-none items-start justify-between gap-4 px-5 pt-5 max-phone:px-4 max-phone:pt-4',
		title: 'm-0 text-xl leading-snug font-semibold tracking-tight',
		description: 'mx-0 mt-1.5 mb-0 leading-normal text-text-soft',
		close: [
			'-mt-2 -mr-2 mb-0 ml-0 inline-flex size-(--ui-control-height-md) flex-none cursor-pointer items-center justify-center p-0',
			'rounded-md [border:0] bg-transparent text-text-soft hover:bg-control-active hover:text-text',
			focusRing,
		],
		body: 'min-h-0 overflow-auto overscroll-contain p-5 max-phone:p-4',
		footer: [
			'flex flex-none flex-wrap justify-end gap-2 px-5 py-3 max-phone:px-4 max-phone:py-4',
			'border-t-(length:--ui-border-width) [border-top-style:solid] border-t-border',
		],
	},
	variants: {
		size: {
			sm: { base: 'w-[min(var(--ui-modal-width-sm),calc(100vw-var(--ui-space-8)))]' },
			md: { base: 'w-[min(var(--ui-modal-width-md),calc(100vw-var(--ui-space-8)))]' },
			lg: { base: 'w-[min(var(--ui-modal-width-lg),calc(100vw-var(--ui-space-8)))]' },
		},
	},
	defaultVariants: {
		size: 'md',
	},
})

/** Without a body (a confirmation: a title, its description and the actions), the heading keeps the space the body gave. */
export const modalHeadingAlone = 'pb-5 max-phone:pb-4'
