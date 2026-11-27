// The look of the trigger of <UITooltip>: it keeps the text around it, and the pointer says there is help. Its
// content is the `tooltip` role of the popover (./popover.ts).
import { defineTheme } from '../../utils/theme'
import { triggerFocusRing } from './popover'

/**
 * Receta del disparador que pinta `UITooltip`: conserva el texto que lo rodea y el puntero de ayuda. Su contenido
 * es el rol `tooltip` de `popoverTheme`.
 *
 * @example
 * ```ts
 * import { tooltipTriggerTheme } from '@meekojs/ui/theme'
 *
 * const classes = tooltipTriggerTheme({ class: 'underline' })
 * ```
 */
export const tooltipTriggerTheme = defineTheme({
	base: ['cursor-help [border:0] bg-transparent p-0 [color:inherit] [font:inherit]', triggerFocusRing],
})
