// The look of <UICommandPalette>: a trigger with the look of a search field, and a dialog with a field, a status
// and a list of rows. The dialog is the one of <UIModal> (`modalSurface`), placed higher and wider. The
// `trigger` and `item` snippets are the app's markup: the trigger paints a direct <svg> as the icon, a direct
// <span> with <kbd> as the shortcut and any other direct <span> as the label; a row paints <strong> as the title
// and <small> as the excerpt; the dialog paints every <mark> as what was found.
import { tv } from '../utils/theme'
import { modalSurface } from './modal'

/** The focus ring of the trigger and the close button. */
const focusRing = 'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid'

/** A key of a shortcut, in the trigger and in the close button. */
const kbd = [
	'[&_kbd]:rounded-xs [&_kbd]:border-(length:--ui-border-width) [&_kbd]:border-solid [&_kbd]:border-border [&_kbd]:bg-bg-subtle [&_kbd]:px-1 [&_kbd]:py-0',
	'[&_kbd]:font-mono [&_kbd]:text-xs [&_kbd]:leading-normal [&_kbd]:font-medium',
]

/** The search icon, in the trigger and in the field. */
const icon = 'size-(--ui-command-icon-size) flex-none fill-none stroke-current [stroke-linecap:round] [stroke-width:var(--ui-command-icon-stroke)]'

export const commandPalette = tv({
	slots: {
		/** The trigger: a phone keeps the icon, since the label and the shortcut do not fit and it has no keyboard for them. */
		trigger: [
			'box-border inline-flex min-h-(--ui-control-height-md) min-w-(--ui-command-trigger-width) cursor-pointer items-center gap-2 py-0 pr-1 pl-2',
			'rounded-md border-(length:--ui-border-width) border-solid border-border-strong bg-control hover:bg-control-hover',
			'font-sans text-control-md leading-snug font-regular text-text-soft hover:text-text',
			'transition-[background-color,color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
			focusRing,
			...kbd,
			'[&>svg]:size-(--ui-command-icon-size) [&>svg]:flex-none [&>svg]:fill-none [&>svg]:stroke-current [&>svg]:[stroke-linecap:round] [&>svg]:[stroke-width:var(--ui-command-icon-stroke)]',
			'[&>span:not(:has(kbd))]:flex-1 [&>span:not(:has(kbd))]:text-start [&>span:has(kbd)]:inline-flex [&>span:has(kbd)]:gap-0.5',
			'max-compact:w-(--ui-control-height-md) max-compact:min-w-0 max-compact:justify-center max-compact:border-transparent max-compact:bg-transparent max-compact:p-0',
			'max-compact:[&>span:has(kbd)]:hidden max-compact:[&>span:not(:has(kbd))]:hidden',
		],
		/** The dialog of <UIModal>, near the top of the page; `mark` is what was found. */
		base: [
			...modalSurface,
			'mx-auto mt-(--ui-command-offset) mb-auto',
			'w-[min(var(--ui-command-width),calc(100vw-var(--ui-space-8)))] max-h-[min(var(--ui-command-max-height),calc(100dvh-var(--ui-space-16)))]',
			'[&_mark]:rounded-xs [&_mark]:bg-primary-soft [&_mark]:text-primary-text',
		],
		/** The field has no outline of its own: its line shows where the keyboard is. */
		field: [
			'flex flex-none items-center gap-3 px-4 py-3 text-text-soft',
			'border-b-(length:--ui-border-width) [border-bottom-style:solid] border-b-border has-[input:focus-visible]:border-b-primary',
			'transition-[border-color] duration-(--ui-duration-fast) motion-reduce:transition-none motion-reduce:duration-0',
		],
		icon,
		input: [
			'min-w-0 flex-1 bg-transparent [border:0] [outline:0]',
			'font-sans text-lg leading-normal font-regular text-text caret-primary placeholder:text-text-soft',
			'[&::-webkit-search-cancel-button]:hidden',
		],
		close: ['flex-none cursor-pointer rounded-sm [border:0] bg-transparent p-0', ...kbd, 'hover:[&_kbd]:text-text', focusRing],
		status: 'flex-none text-sm leading-relaxed text-text-soft not-empty:p-4',
		list: 'm-0 min-h-0 flex-1 list-none overflow-y-auto overscroll-contain p-1.5',
		/** A row: indented under its parent, and with the keyboard ring when it is the active one. */
		row: [
			'box-border block w-full cursor-pointer px-3 py-2 data-[depth=1]:ms-4 data-[depth=1]:w-[calc(100%-var(--ui-space-4))]',
			'rounded-sm [border:0] bg-transparent hover:bg-control-active aria-selected:bg-control-active aria-selected:[box-shadow:var(--ui-option-active-ring)]',
			'[font:inherit] text-start text-text [text-decoration:none]',
			'[&_strong]:block [&_strong]:font-medium',
			'[&_small]:mt-0.5 [&_small]:block [&_small]:text-sm [&_small]:leading-normal [&_small]:text-text-soft',
		],
	},
})
