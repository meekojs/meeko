// The look of <UITextarea>: the field of always (./input.ts) as a box of text that the user can make taller.
import type { ThemeVariants } from '../../utils/theme'

import { defineTheme } from '../../utils/theme'
import { fieldBox, fieldDisabled, fieldEnd, fieldLook, fieldStart } from './input'

/**
 * Receta de `UITextarea`: el campo de siempre de `UIInput`, con el fondo y el borde de los controles, como una caja
 * de texto que el usuario puede alargar. No tiene variantes.
 *
 * @example
 * ```ts
 * import { textareaTheme } from '@meekojs/ui/theme'
 *
 * const classes = textareaTheme({ class: 'min-h-40' })
 * ```
 */
export const textareaTheme = defineTheme({ base: [...fieldLook, fieldStart, fieldBox, fieldEnd, fieldDisabled] })

/** Variantes de la receta de `UITextarea`, derivadas de `textareaTheme`: ninguna. */
export type TextareaThemeProps = ThemeVariants<typeof textareaTheme>
