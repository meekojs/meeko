// The look of <UICheckbox>, and what it shares with <UISwitch> (./switch.ts), <UIRadioGroup> (./radio-group.ts) and
// <UISegmentedControl> (./segmented-control.ts): a label that holds a native input and its text. The browser's own
// box has a border of its own colour, and only --ui-color-control-border reaches 3:1 in both themes: the inputs
// drop their appearance and draw the box, except in forced colours, where the native control keeps every state
// visible. Each property is set by one part only.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'

/** The label: the whole row takes the click, and dims when its input is disabled. */
export const choiceLabelLayout = 'group flex items-center gap-2'
export const choiceLabelState = 'cursor-pointer has-disabled:cursor-not-allowed has-disabled:opacity-(--ui-opacity-disabled)'
export const choiceLabel = [choiceLabelLayout, 'font-sans text-md leading-normal font-regular text-text', choiceLabelState]

/** A row as tall as a control, and as a large one under a coarse pointer. */
export const choiceRow = 'min-h-(--ui-control-height-md) pointer-coarse:min-h-(--ui-control-height-lg)'

/** What every input of a choice shares. */
export const choiceInput = [
	'm-0 box-border shrink-0 appearance-none accent-primary cursor-[inherit]',
	'transition-[background-color,border-color] duration-(--ui-duration-fast) ease-[ease] motion-reduce:transition-none motion-reduce:duration-0',
	'focus-visible:outline-(length:--ui-focus-ring-width) focus-visible:outline-focus focus-visible:outline-offset-(--ui-focus-ring-offset) focus-visible:outline-solid',
	'forced-colors:appearance-auto forced-colors:before:hidden',
]

/** The box of a checkbox or a radio: filled when checked, with a mark drawn by ::before. */
export const choiceBox = 'inline-grid place-content-center bg-control group-hover:not-disabled:not-checked:bg-control-hover checked:bg-primary checked:before:bg-primary-contrast'

/** The border of a visible box: the checked colour wins over the invalid one. */
export const choiceBoxBorder = 'size-4 border-(length:--ui-border-width) border-solid border-control-border checked:border-primary aria-[invalid=true]:not-checked:border-danger'

/** The tick of a checkbox. */
const tick = 'rounded-xs checked:before:size-3 checked:before:[clip-path:polygon(14%_52%,0_66%,38%_100%,100%_20%,85%_6%,36%_72%)]'

/** The text next to the input, and its description in soft text. */
export const choiceText = {
	content: 'grid gap-0.5',
	description: 'text-sm/[inherit] text-text-soft',
}

/**
 * Receta de `UICheckbox`, con los slots `base` (el `<label>`), `input`, `content` y `description`. No tiene
 * variantes: la casilla marcada lleva el color primario y una inválida, el borde de peligro.
 *
 * @example
 * ```ts
 * import { checkboxTheme } from '@meekojs/ui/theme'
 *
 * const { base, input } = checkboxTheme()
 * ```
 */
export const checkboxTheme = defineTheme({
	slots: {
		base: [...choiceLabel, choiceRow],
		input: [...choiceInput, choiceBox, choiceBoxBorder, tick],
		...choiceText,
	},
})

/** Variantes de la receta de `UICheckbox`, derivadas de `checkboxTheme`: ninguna. */
export type CheckboxThemeProps = ThemeVariants<typeof checkboxTheme>
