// The look of <UIToast> and of the host of the toasts in <UIApp>: the box, the actions and the close button of
// <UIAlert> (./alert.ts), raised and in the corner. What stays in feedback.css: the pseudo-elements of the View
// Transition that closes a toast, which belong to the document, and the keyframes.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { messageActions, messageBox, messageCompounds, messageDismiss, messageSelection } from './alert'

/**
 * Receta de `UIToast`: los `variant` y `color` de `UIAlert`, con los slots `base`, `content`, `message`, `actions` y
 * `dismiss`. Sin ellas es `soft` y `neutral`: la superficie elevada, con su sombra.
 *
 * @example
 * ```ts
 * import { toastTheme } from '@meekojs/ui/theme'
 *
 * const { base, message } = toastTheme({ color: 'success' })
 * ```
 */
export const toastTheme = defineTheme({
	slots: {
		base: [
			...messageBox,
			'inset-auto end-4 bottom-4 m-0 [box-shadow:var(--ui-shadow-md)]',
			'transition-[opacity,translate] duration-(--ui-duration-slow) ease-out',
			'motion-reduce:transition-none motion-reduce:duration-0',
			// A manual popover: closed, it is not painted, whatever `display` the box has.
			'[&[popover]:not(:popover-open)]:hidden',
			// Its exit is a View Transition with a name only during its own type (feedback.css).
			'[html:active-view-transition-type(ui-toast-close)_&[data-meeko-ui-toast-state=closing]]:[view-transition-name:ui-toast]',
		],
		content: 'min-w-0 flex-1',
		message: 'm-0 text-inherit',
		actions: messageActions,
		dismiss: messageDismiss,
	},
	variants: messageSelection.variants,
	compoundVariants: messageCompounds('border-border bg-surface-raised text-text'),
	defaultVariants: { variant: 'soft', color: 'neutral' },
})

/** Variantes de la receta de `UIToast`, derivadas de `toastTheme`. */
export type ToastThemeProps = ThemeVariants<typeof toastTheme>

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
