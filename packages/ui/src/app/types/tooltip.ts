import type { PopoverPlacement, PopoverTrigger } from './popover'

/**
 * Snippets de `<UITooltip>`: `trigger` es el contenido del botón que pinta Meeko, `anchor` lo sustituye
 * por un elemento propio, que debe poder recibir el foco, y `default` es un contenido con formato en
 * lugar de `text`.
 * @since 1.8.0
 * @example
 * ```html
 * <UITooltip text="Guardar los cambios">
 *   <snippet name="anchor" params="trigger"><UIButton bind="trigger">Guardar</UIButton></snippet>
 * </UITooltip>
 * ```
 */
export interface TooltipSnippets {
	/** Contenido con formato, en lugar de `text`. */
	default?: []
	/** Contenido del `<button>` disparador que pinta Meeko. */
	trigger?: []
	/** Un disparador propio: recibe en {@link PopoverTrigger} su `id` y su `aria-describedby`. */
	anchor?: [trigger: PopoverTrigger]
}

/**
 * Props de `<UITooltip>`, un texto breve que describe a su disparador: se abre con el puntero y con el
 * foco, `Esc` lo cierra, no roba el foco y se asocia con `aria-describedby`. No pongas en él nada
 * imprescindible ni interactivo: en táctil sólo aparece al enfocar.
 * @since 1.8.0
 * @example
 * ```html
 * <UITooltip text="Se publica al guardar" placement="right"><snippet name="trigger">?</snippet></UITooltip>
 * ```
 */
export interface UITooltipProps {
	/** El texto; o el snippet `default`, para un contenido con formato. */
	readonly text?: string
	/** Dónde se abre respecto al disparador; `"top"` por defecto. */
	readonly placement?: PopoverPlacement
	/** Separación en píxeles entre el disparador y el tooltip; `6` por defecto. */
	readonly offset?: number
	/** Milisegundos que el puntero espera sobre el disparador antes de abrir; `300` por defecto. */
	readonly delay?: number
	/** Milisegundos antes de cerrar al salir el puntero; `150` por defecto. */
	readonly closeDelay?: number
	/** Clases del tooltip. */
	readonly class?: string
	/** Clases del `<button>` disparador que pinta Meeko. */
	readonly triggerClass?: string
	/** `id` del disparador; por defecto, uno de `useId`. */
	readonly triggerId?: string
}
