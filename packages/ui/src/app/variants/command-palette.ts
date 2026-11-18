// The look of <UICommandPalette>: a trigger with the look of a search field, and a dialog with a field, a status
// and a list of rows. The dialog is the one of <UIModal> (`meeko-ui-modal`), placed higher and wider. The
// `trigger` and `item` snippets are the app's markup: the trigger paints a direct <svg> as the icon, a direct
// <span> with <kbd> as the shortcut and any other direct <span> as the label; a row paints <strong> as the title
// and <small> as the excerpt; the dialog paints every <mark> as what was found.
import { tv } from 'tailwind-variants/lite'

/** The focus ring of the trigger and the close button. */
const focusRing = 'ui:focus-visible:outline-(length:--ui-focus-ring-width) ui:focus-visible:outline-focus ui:focus-visible:outline-offset-(--ui-focus-ring-offset) ui:focus-visible:outline-solid'

/** A key of a shortcut, in the trigger and in the close button. */
const kbd = [
	'ui:[&_kbd]:rounded-xs ui:[&_kbd]:border-(length:--ui-border-width) ui:[&_kbd]:border-solid ui:[&_kbd]:border-border ui:[&_kbd]:bg-bg-subtle ui:[&_kbd]:px-1 ui:[&_kbd]:py-0',
	'ui:[&_kbd]:font-mono ui:[&_kbd]:text-xs ui:[&_kbd]:leading-normal ui:[&_kbd]:font-medium',
]

/** The search icon, in the trigger and in the field. */
const icon = 'ui:size-(--ui-command-icon-size) ui:flex-none ui:fill-none ui:stroke-current ui:[stroke-linecap:round] ui:[stroke-width:var(--ui-command-icon-stroke)]'

export const commandPalette = tv({
	slots: {
		/** The trigger: a phone keeps the icon, since the label and the shortcut do not fit and it has no keyboard for them. */
		trigger: [
			'ui:box-border ui:inline-flex ui:min-h-(--ui-control-height-md) ui:min-w-(--ui-command-trigger-width) ui:cursor-pointer ui:items-center ui:gap-2 ui:py-0 ui:pr-1 ui:pl-2',
			'ui:rounded-md ui:border-(length:--ui-border-width) ui:border-solid ui:border-border-strong ui:bg-control ui:hover:bg-control-hover',
			'ui:font-sans ui:text-control-md ui:leading-snug ui:font-regular ui:text-text-soft ui:hover:text-text',
			'ui:transition-[background-color,color] ui:duration-(--ui-duration-fast) ui:motion-reduce:transition-none ui:motion-reduce:duration-0',
			focusRing,
			...kbd,
			'ui:[&>svg]:size-(--ui-command-icon-size) ui:[&>svg]:flex-none ui:[&>svg]:fill-none ui:[&>svg]:stroke-current ui:[&>svg]:[stroke-linecap:round] ui:[&>svg]:[stroke-width:var(--ui-command-icon-stroke)]',
			'ui:[&>span:not(:has(kbd))]:flex-1 ui:[&>span:not(:has(kbd))]:text-start ui:[&>span:has(kbd)]:inline-flex ui:[&>span:has(kbd)]:gap-0.5',
			'ui:max-tablet:w-(--ui-control-height-md) ui:max-tablet:min-w-0 ui:max-tablet:justify-center ui:max-tablet:border-transparent ui:max-tablet:bg-transparent ui:max-tablet:p-0',
			'ui:max-tablet:[&>span:has(kbd)]:hidden ui:max-tablet:[&>span:not(:has(kbd))]:hidden',
		],
		/** The dialog of <UIModal>, near the top of the page; `mark` is what was found. */
		base: [
			'ui:mx-auto ui:mt-(--ui-command-offset) ui:mb-auto',
			'ui:w-[min(var(--ui-command-width),calc(100vw-var(--ui-space-8)))] ui:max-h-[min(var(--ui-command-max-height),calc(100dvh-var(--ui-space-16)))]',
			'ui:[&_mark]:rounded-xs ui:[&_mark]:bg-primary-soft ui:[&_mark]:text-primary-text',
		],
		/** The field has no outline of its own: its line shows where the keyboard is. */
		field: [
			'ui:flex ui:flex-none ui:items-center ui:gap-3 ui:px-4 ui:py-3 ui:text-text-soft',
			'ui:border-b-(length:--ui-border-width) ui:[border-bottom-style:solid] ui:border-b-border ui:has-[input:focus-visible]:border-b-primary',
			'ui:transition-[border-color] ui:duration-(--ui-duration-fast) ui:motion-reduce:transition-none ui:motion-reduce:duration-0',
		],
		icon,
		input: [
			'ui:min-w-0 ui:flex-1 ui:bg-transparent ui:[border:0] ui:[outline:0]',
			'ui:font-sans ui:text-lg ui:leading-normal ui:font-regular ui:text-text ui:caret-primary ui:placeholder:text-text-soft',
			'ui:[&::-webkit-search-cancel-button]:hidden',
		],
		close: ['ui:flex-none ui:cursor-pointer ui:rounded-sm ui:[border:0] ui:bg-transparent ui:p-0', ...kbd, 'ui:hover:[&_kbd]:text-text', focusRing],
		status: 'ui:flex-none ui:text-sm ui:leading-relaxed ui:text-text-soft ui:not-empty:p-4',
		list: 'ui:m-0 ui:min-h-0 ui:flex-1 ui:list-none ui:overflow-y-auto ui:overscroll-contain ui:p-1.5',
		/** A row: indented under its parent, and with the keyboard ring when it is the active one. */
		row: [
			'ui:box-border ui:block ui:w-full ui:cursor-pointer ui:px-3 ui:py-2 ui:data-[depth=1]:ms-4 ui:data-[depth=1]:w-[calc(100%-var(--ui-space-4))]',
			'ui:rounded-sm ui:[border:0] ui:bg-transparent ui:hover:bg-control-active ui:aria-selected:bg-control-active ui:aria-selected:[box-shadow:var(--ui-option-active-ring)]',
			'ui:[font:inherit] ui:text-start ui:text-text ui:[text-decoration:none]',
			'ui:[&_strong]:block ui:[&_strong]:font-medium',
			'ui:[&_small]:mt-0.5 ui:[&_small]:block ui:[&_small]:text-sm ui:[&_small]:leading-normal ui:[&_small]:text-text-soft',
		],
	},
})
