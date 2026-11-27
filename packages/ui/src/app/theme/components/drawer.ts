// The look of <UIDrawer>: a native modal <dialog> against one edge of the screen. Closed, the UA hides it;
// it enters by sliding from its edge with @starting-style, and leaves with the View Transition of <UIModal>
// (navigation.css). Each property is set by one part only.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { focusRing } from '../base/focus'

/**
 * Where it slides from: off its edge while closed and as it opens, in its place once open. The edge is
 * `--drawer-shift`, which each side sets for both directions of the text.
 */
const slide = [
	'[translate:var(--drawer-shift)_0] open:[translate:0_0] open:starting:[translate:var(--drawer-shift)_0]',
	'transition-[translate] duration-(--ui-duration-slow) ease-out',
	'backdrop:bg-transparent open:backdrop:bg-overlay open:starting:backdrop:bg-transparent',
	'backdrop:transition-[background-color] backdrop:duration-(--ui-duration-slow) backdrop:ease-out',
	'motion-reduce:transition-none motion-reduce:duration-0 motion-reduce:backdrop:transition-none motion-reduce:backdrop:duration-0',
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
	'[:root:has(&:is([open],[data-meeko-ui-modal-state=closing]))]:overflow-hidden [:root:has(&:is([open],[data-meeko-ui-modal-state=closing]))]:[scrollbar-gutter:stable]',
	'[:root[data-meeko-ui-scrollbar-gutter]:has(&:is([open],[data-meeko-ui-modal-state=closing]))]:[scrollbar-gutter:auto]',
	'[:root[data-meeko-ui-scrollbar-gutter=right]:has(&:is([open],[data-meeko-ui-modal-state=closing]))]:pr-(--ui-scrollbar-gutter) [:root[data-meeko-ui-scrollbar-gutter=left]:has(&:is([open],[data-meeko-ui-modal-state=closing]))]:pl-(--ui-scrollbar-gutter)',
	'[:root:has(&:modal)]:transition-[background-color] [:root:has(&:modal)]:duration-(--ui-duration-slow) [:root:has(&:modal)]:ease-linear motion-reduce:[:root:has(&:modal)]:transition-none motion-reduce:[:root:has(&:modal)]:duration-0',
	'[:root:has(&:modal)_body]:[min-block-size:100dvh]',
]

/** The name of the panel during the exit of <UIModal>, by the edge it leaves through. */
const leaves = {
	left: '[html:active-view-transition-type(ui-modal-close)_&[data-meeko-ui-modal-state=closing]]:[view-transition-name:ui-drawer-left]',
	right: '[html:active-view-transition-type(ui-modal-close)_&[data-meeko-ui-modal-state=closing]]:[view-transition-name:ui-drawer-right]',
	rtlLeft: '[html:active-view-transition-type(ui-modal-close)_&[data-meeko-ui-modal-state=closing]:dir(rtl)]:[view-transition-name:ui-drawer-left]',
	rtlRight: '[html:active-view-transition-type(ui-modal-close)_&[data-meeko-ui-modal-state=closing]:dir(rtl)]:[view-transition-name:ui-drawer-right]',
}

/**
 * Receta de `UIDrawer`: `side` (`start` o `end`), con los slots `base` (el `<dialog>`), `trigger`, `panel`,
 * `heading`, `title`, `close`, `body` y `footer`. Sin ella se abre desde el inicio de la línea.
 *
 * @example
 * ```ts
 * import { drawerTheme } from '@meekojs/ui/theme'
 *
 * const { base, body } = drawerTheme({ side: 'end' })
 * ```
 */
export const drawerTheme = defineTheme({
	slots: {
		base: [
			'fixed inset-y-0 m-0 h-dvh max-h-none w-[min(var(--ui-drawer-width),calc(100vw-var(--ui-space-12)))] max-w-none p-0',
			'[border-block:0] bg-surface-raised font-sans text-md text-text [box-shadow:var(--ui-shadow-lg)]',
			...slide,
			...root,
		],
		// The button that opens it is a neutral outline button of ./button.ts: `ui.trigger` adds to it.
		trigger: '',
		panel: 'flex h-full flex-col',
		heading: 'flex flex-none items-center justify-between gap-3 border-b-(length:--ui-border-width) border-b-border px-4 py-3',
		title: 'm-0 text-lg leading-snug font-semibold tracking-tight',
		close: [
			'inline-flex size-(--ui-control-height-md) flex-none cursor-pointer items-center justify-center',
			'rounded-md [border:0] bg-transparent text-text-soft hover:bg-control-hover hover:text-text',
			focusRing,
		],
		body: 'min-h-0 flex-1 overflow-y-auto overscroll-contain p-4',
		footer: 'flex flex-none flex-wrap gap-2 border-t-(length:--ui-border-width) border-t-border px-4 py-3',
	},
	variants: {
		side: {
			start: {
				base: [
					'start-0 end-auto [border-inline-start:0] [border-inline-end:var(--ui-border-width)_solid_var(--ui-color-border)]',
					'[--drawer-shift:-100%] rtl:[--drawer-shift:100%]',
					'[:root:not([data-meeko-ui-scrollbar-gutter]):has(&:modal)]:bg-overlay-solid',
					leaves.left,
					leaves.rtlRight,
				],
			},
			end: {
				base: [
					'start-auto end-0 [border-inline-end:0] [border-inline-start:var(--ui-border-width)_solid_var(--ui-color-border)]',
					'[--drawer-shift:100%] rtl:[--drawer-shift:-100%]',
					// Where the gutter stays, the panel touches it: the root takes its color.
					'[:root:not([data-meeko-ui-scrollbar-gutter]):has(&:modal)]:bg-surface-raised',
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

/** Variantes de la receta de `UIDrawer`, derivadas de `drawerTheme`. */
export type DrawerThemeProps = ThemeVariants<typeof drawerTheme>
