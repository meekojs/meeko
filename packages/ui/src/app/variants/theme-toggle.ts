// The look of <UIThemeToggle>: a button that moves to the next theme (`cycle`) or a group of radios
// (`select`). The `<head>` rule of the core shows the icon of the current choice; this only centres it.
// Each property is set by one part only: the border, the background and the height of a button change
// with the mode, so they live in `mode` and not in the base.
import { tv } from 'tailwind-variants/lite'

export const themeToggle = tv({
	slots: {
		base: 'ui:font-sans',
		/** The button of `cycle` and each radio of `select`. */
		button: [
			'ui:inline-flex ui:cursor-pointer ui:items-center ui:justify-center ui:px-2 ui:py-1',
			'ui:rounded-md ui:border-(length:--ui-border-width) ui:border-solid ui:text-sm ui:text-text',
			'ui:focus-visible:outline-(length:--ui-focus-ring-width) ui:focus-visible:outline-focus ui:focus-visible:outline-offset-(--ui-focus-ring-offset) ui:focus-visible:outline-solid',
		],
		/** The radio group of `select`. */
		group: 'ui:inline-flex ui:gap-1 ui:rounded-lg ui:border-(length:--ui-border-width) ui:border-solid ui:border-border ui:p-0.5',
		/** An icon sits on the middle of the button, not on the baseline of a line of text. */
		icon: 'ui:[&>svg]:block',
	},
	variants: {
		mode: {
			cycle: {
				button: 'ui:min-h-(--ui-control-height-md) ui:border-border ui:bg-control ui:hover:bg-control-hover',
			},
			// The radios are flat until the pointer is over them; the chosen one stands out.
			select: {
				button: 'ui:min-h-(--ui-control-height-sm) ui:border-transparent ui:bg-transparent ui:hover:bg-control-hover ui:aria-checked:border-border-strong ui:aria-checked:bg-control-active ui:aria-checked:font-semibold',
			},
		},
	},
	defaultVariants: {
		mode: 'cycle',
	},
})
