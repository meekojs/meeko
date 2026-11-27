// The look of <UIThemeToggle>: a button that moves to the next theme (`cycle`) or a group of radios
// (`select`). The `<head>` rule of the core shows the icon of the current choice; this only centres it.
// Each property is set by one part only: the border, the background and the height of a button change
// with the mode, so they live in `mode` and not in the base.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'

export const themeToggleTheme = defineTheme({
	slots: {
		base: 'font-sans',
		/** The button of `cycle` and each radio of `select`. */
		button: [
			'inline-flex cursor-pointer items-center justify-center px-2 py-1',
			'rounded-md border-(length:--ui-border-width) border-solid text-sm/[inherit] text-text',
			'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid',
		],
		/** The radio group of `select`. */
		group: 'inline-flex gap-1 rounded-lg border-(length:--ui-border-width) border-solid border-border p-0.5',
		/** An icon sits on the middle of the button, not on the baseline of a line of text. */
		icon: '[&>svg]:block',
	},
	variants: {
		mode: {
			cycle: {
				button: 'min-h-(--ui-control-height-md) border-border bg-control hover:bg-control-hover',
			},
			// The radios are flat until the pointer is over them; the chosen one stands out.
			select: {
				button: 'min-h-(--ui-control-height-sm) border-transparent bg-transparent hover:bg-control-hover aria-checked:border-border-strong aria-checked:bg-control-active aria-checked:font-semibold',
			},
		},
	},
	defaultVariants: {
		mode: 'cycle',
	},
})

/** Variantes de la receta `themeToggleTheme`, derivadas de ella. */
export type ThemeToggleThemeProps = ThemeVariants<typeof themeToggleTheme>
