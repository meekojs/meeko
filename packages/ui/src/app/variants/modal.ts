// The look of <UIModal>: a native modal <dialog> in the middle of the screen. It enters with @starting-style
// and leaves with a View Transition (modal.css keeps its pseudo-elements and keyframes). utils/modal-dialog
// writes the stack: `--ui-modal-depth`, `data-meeko-ui-modal-top`, `-behind` and `-state`. Each property is set
// by one part only.
import { tv } from 'tailwind-variants/lite'

import { focusRing } from './focus'

/**
 * The dialog without its place or its size, which <UICommandPalette> shares: the surface, the stack, the
 * entrance, the backdrop and the exit. A dialog behind another one steps back and does not take the pointer;
 * only the top one darkens the page.
 */
export const modalSurface = [
	'ui:box-border ui:max-w-none ui:overflow-hidden ui:p-0 ui:open:flex ui:open:flex-col',
	'ui:rounded-xl ui:border-(length:--ui-border-width) ui:border-solid ui:border-border ui:bg-surface-raised ui:[box-shadow:var(--ui-shadow-lg)]',
	'ui:font-sans ui:text-md ui:text-text',
	'ui:[translate:0_calc(var(--ui-modal-depth,0)*var(--ui-modal-stack-offset)*-1)] ui:[scale:calc(1-var(--ui-modal-depth,0)*var(--ui-modal-stack-scale))]',
	'ui:data-meeko-ui-modal-behind:pointer-events-none ui:data-[meeko-ui-modal-state=closing]:pointer-events-none',
	// The entrance is CSS: it does not block the page, and WebKit does not paint a modal that opens inside a
	// View Transition. No `display` or `overlay allow-discrete`: they would keep the closing dialog in the new
	// capture of its exit.
	'ui:open:starting:[translate:0_var(--ui-space-4)] ui:open:starting:[scale:calc(1-var(--ui-modal-stack-scale))] ui:open:starting:opacity-(--ui-opacity-hidden)',
	'ui:transition-[opacity,scale,translate] ui:duration-(--ui-duration-slow) ui:ease-out',
	'ui:backdrop:bg-transparent ui:data-meeko-ui-modal-top:backdrop:bg-overlay ui:open:starting:backdrop:opacity-(--ui-opacity-hidden)',
	'ui:backdrop:transition-[opacity] ui:backdrop:duration-(--ui-duration-slow) ui:backdrop:ease-linear',
	'ui:motion-reduce:transition-none ui:motion-reduce:duration-0 ui:motion-reduce:backdrop:transition-none ui:motion-reduce:backdrop:duration-0',
	// The exit has a name only during its own type: any other transition, such as a navigation with a modal
	// open, neither captures the modal nor plays its animation again.
	'ui:[html:active-view-transition-type(ui-modal-close)_&[data-meeko-ui-modal-state=closing]]:[view-transition-name:ui-modal]',
	// Neither a dialog nor its ::backdrop reach the gutter kept for the scrollbar, which only takes the
	// background of the root: the root takes the color of the overlay, and the body covers the screen so that
	// the overlay does not darken the root twice. <UIDrawer> does the same in variants/drawer.
	'ui:[:root:has(&:modal)]:bg-overlay-solid ui:[:root:has(&:modal)_body]:[min-block-size:100dvh]',
	'ui:[:root:has(&:modal)]:transition-[background-color] ui:[:root:has(&:modal)]:duration-(--ui-duration-slow) ui:[:root:has(&:modal)]:ease-linear ui:motion-reduce:[:root:has(&:modal)]:transition-none ui:motion-reduce:[:root:has(&:modal)]:duration-0',
]

export const modal = tv({
	slots: {
		base: ['ui:m-auto ui:max-h-[calc(100dvh-var(--ui-space-8))]', ...modalSurface],
		heading: 'ui:flex ui:flex-none ui:items-start ui:justify-between ui:gap-4 ui:px-5 ui:pt-5 ui:max-phone:px-4 ui:max-phone:pt-4',
		title: 'ui:m-0 ui:text-xl ui:leading-snug ui:font-semibold ui:tracking-tight',
		description: 'ui:mx-0 ui:mt-1.5 ui:mb-0 ui:leading-normal ui:text-text-soft',
		close: [
			'ui:-mt-2 ui:-mr-2 ui:mb-0 ui:ml-0 ui:inline-flex ui:size-(--ui-control-height-md) ui:flex-none ui:cursor-pointer ui:items-center ui:justify-center ui:p-0',
			'ui:rounded-md ui:[border:0] ui:bg-transparent ui:text-text-soft ui:hover:bg-control-active ui:hover:text-text',
			focusRing,
		],
		body: 'ui:min-h-0 ui:overflow-auto ui:overscroll-contain ui:p-5 ui:max-phone:p-4',
		footer: [
			'ui:flex ui:flex-none ui:flex-wrap ui:justify-end ui:gap-2 ui:px-5 ui:py-3 ui:max-phone:px-4 ui:max-phone:py-4',
			'ui:border-t-(length:--ui-border-width) ui:[border-top-style:solid] ui:border-t-border',
		],
	},
	variants: {
		size: {
			sm: { base: 'ui:w-[min(var(--ui-modal-width-sm),calc(100vw-var(--ui-space-8)))]' },
			md: { base: 'ui:w-[min(var(--ui-modal-width-md),calc(100vw-var(--ui-space-8)))]' },
			lg: { base: 'ui:w-[min(var(--ui-modal-width-lg),calc(100vw-var(--ui-space-8)))]' },
		},
	},
	defaultVariants: {
		size: 'md',
	},
})

/** Without a body (a confirmation: a title, its description and the actions), the heading keeps the space the body gave. */
export const modalHeadingAlone = 'ui:pb-5 ui:max-phone:pb-4'
