import type { UIButtonColor, UIButtonSize, UIButtonVariant } from '../theme/components/button'
import type { menu } from '../variants/menu'
import type { UILinkTarget } from './navigation'
import type { PopoverPlacement, PopoverTrigger } from './popover'
import type { UIThemeProps } from './theme'

/**
 * Lo que comparten la acción y el enlace de un menú: texto, tono, estado, icono y atajo.
 * @since 1.10.0
 */
interface UIMenuItemBase {
	/** Texto visible, que también sirve para saltar al ítem escribiendo su primera letra. */
	readonly label: string
	/** Identificador libre del ítem, para reconocerlo en el evento `select`. */
	readonly value?: string
	/** `"danger"` para una acción destructiva o que no se puede deshacer; `"neutral"` por defecto. */
	readonly tone?: 'neutral' | 'danger'
	/** Desactiva el ítem: se ve, pero las flechas lo saltan y no se puede elegir. */
	readonly disabled?: boolean
	/** Trazo SVG de un icono decorativo, en una rejilla de 16 por 16. */
	readonly icon?: string
	/**
	 * Atajo de teclado que se muestra tras el texto, como recordatorio. El menú no lo escucha: es la
	 * aplicación quien lo implementa.
	 */
	readonly shortcut?: string
	readonly separator?: never
}

/**
 * Una acción de `<UIMenu>`: un `<button role="menuitem">` que llama a `onSelect` al elegirse.
 * @since 1.10.0
 * @example
 * ```ts
 * const rename: UIMenuAction = { label: 'Renombrar', shortcut: 'F2', onSelect: () => startRename() }
 * ```
 */
export type UIMenuAction = UIMenuItemBase & {
	/** Se llama al elegir la acción, antes del evento `select`, con el propio ítem. */
	readonly onSelect?: (item: UIMenuItem) => void
	readonly href?: never
	readonly to?: never
}

/**
 * Un enlace de `<UIMenu>`: un `<a role="menuitem">` con `href`, o con `to` para una ruta de la aplicación,
 * que navega con `<MeekoLink>`. Funciona sin JavaScript.
 * @since 1.10.0
 * @example
 * ```ts
 * const settings: UIMenuLink = { label: 'Ajustes', to: '/settings' }
 * const docs: UIMenuLink = { label: 'Documentación', href: 'https://meekojs.com', target: '_blank' }
 * ```
 */
export type UIMenuLink = UIMenuItemBase &
	UILinkTarget & {
		readonly onSelect?: never
	}

/**
 * Un ítem elegible de `<UIMenu>`: una acción o un enlace.
 * @since 1.10.0
 * @example
 * ```ts
 * const remove: UIMenuItem = { label: 'Eliminar', tone: 'danger', onSelect: () => removeRow() }
 * ```
 */
export type UIMenuItem = UIMenuAction | UIMenuLink

/**
 * Una línea entre dos grupos de ítems, con `role="separator"`.
 * @since 1.10.0
 * @example
 * ```ts
 * const line: UIMenuSeparator = { separator: true }
 * ```
 */
export interface UIMenuSeparator {
	readonly separator: true
}

/**
 * Una entrada de `items` de `<UIMenu>`: un ítem o un separador.
 * @since 1.10.0
 * @example
 * ```ts
 * const items: UIMenuEntry[] = [{ label: 'Duplicar', onSelect: duplicate }, { separator: true }, { label: 'Eliminar', tone: 'danger', onSelect: remove }]
 * ```
 */
export type UIMenuEntry = UIMenuItem | UIMenuSeparator

/**
 * Snippets de `<UIMenu>`: `trigger` es el contenido del botón disparador, `anchor` lo sustituye por un
 * disparador propio (como en `<UIPopover>`), `item` pinta el interior de cada ítem de `items` y `default`
 * añade ítems propios tras los de `items`, con `role="menuitem"`.
 * @since 1.10.0
 * @example
 * ```html
 * <UIMenu bind:items="items">
 *   <snippet name="item" params="item"><strong>{item.label}</strong></snippet>
 *   <button type="button" role="menuitem">Otra acción</button>
 * </UIMenu>
 * ```
 */
export interface MenuSnippets {
	/** Ítems propios tras los de `items`: elementos con `role="menuitem"` o `role="separator"`. */
	default?: []
	/** El contenido del botón disparador, en lugar de `triggerLabel` o del icono de puntos. */
	trigger?: []
	/** Un disparador propio: recibe sus atributos en {@link PopoverTrigger}. */
	anchor?: [trigger: PopoverTrigger]
	/** El interior de un ítem de `items`, en lugar de su icono, su texto y su atajo. */
	item?: [item: UIMenuItem]
}

/**
 * Props de `<UIMenu>`, un menú de acciones con el patrón *Menu Button* del APG: un botón disparador con
 * `aria-haspopup="menu"` y una lista con `role="menu"` en la capa superior, la de `<UIPopover role="menu">`.
 * Las flechas recorren los ítems, `Inicio` y `Fin` van a los extremos, una letra salta al ítem que empieza
 * por ella, `Esc` cierra, `Tab` sale y el foco vuelve al disparador al cerrar. El modelo por defecto es la
 * apertura. Sin `triggerLabel` ni snippet `trigger`, el disparador es un botón de sólo icono, con tres puntos,
 * para el menú de una fila. `ui` añade clases a sus slots: `base` (la lista), `trigger`, `chevron`, `item`,
 * `icon`, `label`, `shortcut` y `separator`.
 * @since 1.10.0
 * @example
 * ```html
 * <UIMenu triggerLabel="Acciones" bind:items="[
 *   { label: 'Renombrar', onSelect: rename },
 *   { label: 'Ajustes', to: '/settings' },
 *   { separator: true },
 *   { label: 'Eliminar', tone: 'danger', onSelect: remove },
 * ]" on:select="(item) => log(item.label)" />
 * ```
 */
export type UIMenuProps = Omit<
	UIThemeProps<
		typeof menu,
		{
			/** Ítems y separadores, en orden; los del snippet `default` van detrás. */
			readonly items?: readonly UIMenuEntry[]
			/** Texto del botón disparador, seguido de un chevron. */
			readonly triggerLabel?: string
			/**
			 * Nombre accesible del disparador. Sin `triggerLabel` ni snippet `trigger`, por defecto el texto
			 * `menu.trigger` de los mensajes («Más acciones»).
			 */
			readonly ariaLabel?: string
			/** `aria-label` de la lista. Sin ella, el menú se nombra con su disparador. */
			readonly label?: string
			/** Tratamiento del disparador, el de `<UIButton>`: `"surface"` por defecto, `"ghost"` en el de sólo icono. */
			readonly variant?: UIButtonVariant
			/** Color del disparador, el de `<UIButton>`; `"neutral"` por defecto. */
			readonly color?: UIButtonColor
			/** Tamaño del disparador; `"md"` por defecto. */
			readonly size?: UIButtonSize
			/** Desactiva el disparador. */
			readonly disabled?: boolean
			/** Dónde se abre respecto al disparador; `"bottom-start"` por defecto. */
			readonly placement?: PopoverPlacement
			/** Separación en píxeles entre el disparador y la lista; `4` por defecto. */
			readonly offset?: number
			/** `id` del disparador; por defecto, uno de `useId`. Con el snippet `anchor`, el `id` que lleva. */
			readonly triggerId?: string
			/** Clases adicionales de la lista, el elemento con `popover`; equivale a `ui.base`. */
			readonly class?: string
		}
	>,
	'tone'
>
