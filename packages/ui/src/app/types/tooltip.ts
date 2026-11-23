import type { hint } from '../variants/popover'
import type { PopoverPlacement, PopoverTrigger } from './popover'
import type { UIThemeProps } from './theme'

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
	/** Un disparador propio: recibe en {@link PopoverTrigger} su `id`, su `aria-describedby` y su `interestfor`. */
	anchor?: [trigger: PopoverTrigger]
}

/**
 * Props de `<UITooltip>`, un texto breve que describe a su disparador: se abre con el puntero y con el
 * foco, `Esc` lo cierra, no roba el foco y se asocia con `aria-describedby`. No pongas en él nada
 * imprescindible ni interactivo: en táctil no es fiable. Según el navegador, aparece al tocar, sólo
 * mientras se mantiene pulsado o no aparece.
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

/**
 * Snippets de `<UIHint>`: `default` es una ayuda con formato, en lugar de `text`.
 * @since 1.10.0
 * @example
 * ```html
 * <UIHint>Se calcula con los pedidos <strong>pagados</strong>.</UIHint>
 * ```
 */
export interface HintSnippets {
	/** Contenido con formato del tooltip, en lugar de `text`. */
	default?: []
}

/**
 * Props de `<UIHint>`, un icono ⓘ con una ayuda breve en un tooltip, para ponerlo junto a un texto o dentro de
 * un encabezado: `<h2>Ingresos <UIHint text="Sin impuestos" /></h2>`. Es contenido de frase, toma el tamaño y el
 * color del texto que lo rodea y se alcanza con el teclado. Es un `<button>` que se nombra con `label` («Más
 * información» por defecto, en el idioma del documento) y se describe con la ayuda (`aria-describedby`); el
 * tooltip se abre con el puntero, con el foco y al pulsarlo, también en táctil. Como en `<UITooltip>`, no
 * pongas en él nada imprescindible ni interactivo. `ui` añade clases a sus slots: `base` (el botón; equivale a
 * `class`), `icon` y `tooltip`.
 * @since 1.10.0
 * @example
 * ```html
 * <h2>Ingresos <UIHint text="Importe cobrado, sin impuestos ni devoluciones." /></h2>
 * <p>Margen <UIHint label="Qué es el margen" placement="right">Ingresos menos <em>costes directos</em>.</UIHint></p>
 * ```
 */
export type UIHintProps = UIThemeProps<
	typeof hint,
	{
		/** El texto de la ayuda; o el snippet `default`, para un contenido con formato. */
		readonly text?: string
		/** Nombre accesible del botón; por defecto, el texto `hint.label` de los mensajes de UI. */
		readonly label?: string
		/** Dónde se abre la ayuda respecto al icono; `"top"` por defecto. */
		readonly placement?: PopoverPlacement
		/** `id` del botón; por defecto, uno de `useId`. */
		readonly id?: string
		/** Clases adicionales del botón; equivale a `ui.base`. */
		readonly class?: string
	}
>
