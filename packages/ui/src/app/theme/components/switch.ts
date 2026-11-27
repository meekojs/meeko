// The look of <UISwitch>: the label of a choice (./checkbox.ts) around a track whose thumb, drawn by ::before,
// travels to the end when checked.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { choiceInput, choiceLabel, choiceRow, choiceText } from './checkbox'

/**
 * Receta de `UISwitch`, con los slots `base` (el `<label>`), `input` (la pista), `content` y `description`. No
 * tiene variantes: activado, la pista lleva el color primario; inválido, el borde de peligro, también activado.
 *
 * @example
 * ```ts
 * import { switchTheme } from '@meekojs/ui/theme'
 *
 * const { base, input } = switchTheme()
 * ```
 */
export const switchTheme = defineTheme({
	slots: {
		base: [...choiceLabel, choiceRow],
		input: [
			...choiceInput,
			'h-(--ui-switch-height) w-(--ui-switch-width) rounded-full',
			// Unlike the box, an invalid switch keeps the danger border when checked.
			'border-(length:--ui-border-width) border-solid border-control-border checked:border-primary aria-[invalid=true]:border-danger',
			'bg-control group-hover:not-disabled:not-checked:bg-control-hover checked:bg-primary',
			'before:m-0.5 before:block before:size-(--ui-switch-thumb) before:rounded-full before:bg-text-soft checked:before:bg-primary-contrast',
			'checked:before:[translate:var(--ui-switch-travel)] [&:dir(rtl)]:checked:before:[translate:calc(-1*var(--ui-switch-travel))]',
			'before:transition-[translate] before:duration-(--ui-duration-fast) before:ease-out motion-reduce:before:transition-none motion-reduce:before:duration-0',
		],
		...choiceText,
	},
})

/** Variantes de la receta de `UISwitch`, derivadas de `switchTheme`: ninguna. */
export type SwitchThemeProps = ThemeVariants<typeof switchTheme>
