import type { ElementAttributes, Snippet } from '@meekojs/meeko'

import type { alertTheme, UIMessageColor, UIMessageVariant } from '../theme/components/alert'
import type { disclosureTheme } from '../theme/components/disclosure'
import type { emptyTheme } from '../theme/components/empty'
import type { skeletonTheme } from '../theme/components/skeleton'
import type { toastTheme } from '../theme/components/toast'
import type { UIThemeProps } from './theme'

/**
 * Aviso con acciones y cierre opcionales, con la receta `alertTheme` de `@meekojs/ui/theme`: tratamiento (`variant`) y
 * color semántico (`color`). Sin ellas es `soft` y `neutral`, la superficie de la página con su borde.
 *
 * @since 1.11.0 `variant` y `color` sustituyen a `tone`.
 * @example `<UIAlert color="warning" title="Sin conexión" description="Vuelve a intentarlo." />`
 */
export type UIAlertProps = Omit<ElementAttributes<'section'>, 'title' | 'role' | 'class'> &
	UIThemeProps<
		typeof alertTheme,
		{
			/** Tratamiento visual: `soft`, `surface`, `outline` o `solid`; `"soft"` por defecto. */
			variant?: UIMessageVariant
			/** Color semántico: `primary`, `secondary`, `neutral`, `success`, `info`, `warning` o `danger`; `"neutral"` por defecto. */
			color?: UIMessageColor
			/** Título visible. */
			title?: string
			/** Contenido breve del aviso. */
			description?: string
			/** Snippet de icono decorativo, sin depender de una biblioteca. */
			icon?: Snippet<[]>
			/** Permite cerrar el aviso y emite `dismiss`. */
			dismiss?: boolean
			/** Nombre accesible del cierre; usa los mensajes de UI por defecto. */
			closeLabel?: string
			/** Semántica; el color `danger` usa alert y los demás note por defecto. `none`, dentro de una región viva que ya existía. */
			role?: 'alert' | 'status' | 'note' | 'none'
			/** Clases adicionales del elemento raíz; equivale a `ui.base`. */
			class?: string
		}
	>

/**
 * Contenido plegable con `<details>` nativo: se abre con el teclado y sin JavaScript. Su contenido se
 * conserva en el documento, así que un formulario envía sus campos aunque esté plegado.
 *
 * @since 1.8.0
 * @example
 * ```html
 * <UIDisclosure summary="Añadir un comentario" bind:open="Boolean(comment.value)">
 * 	<UITextarea model="comment" />
 * </UIDisclosure>
 * ```
 */
export type UIDisclosureProps = UIThemeProps<
	typeof disclosureTheme,
	{
		/** Texto del elemento que lo abre. */
		summary: string
		/** Abierto; el lector puede cambiarlo después. */
		open?: boolean
		/** Clases adicionales del elemento raíz; equivale a `ui.base`. */
		class?: string
	}
>

/** Estado vacío con snippet de acciones. @example `<UIEmpty title="Sin resultados" variant="panel" />` */
export type UIEmptyProps = UIThemeProps<
	typeof emptyTheme,
	{
		/** Título; usa los mensajes de UI por defecto. */
		title?: string
		/** Ayuda para continuar. */
		description?: string
		/** Presentación dentro de contenido o como panel. */
		variant?: 'inline' | 'panel'
		/** Clases adicionales del elemento raíz; equivale a `ui.base`. */
		class?: string
	}
>

/** Marcador de carga decorativo; el estado se anuncia una vez. @example `<UISkeleton bind:lines="3" bind:widths="['full', 'long', 'short']" />` */
export type UISkeletonProps = UIThemeProps<
	typeof skeletonTheme,
	{
		/** Número de líneas; tres por defecto. */
		lines?: number
		/** Anchos de la escala UI por línea, sin CSS arbitrario. */
		widths?: readonly ('full' | 'long' | 'short')[]
		/** Nombre accesible; usa los mensajes de UI por defecto. */
		label?: string
		/** Clases adicionales del elemento raíz; equivale a `ui.base`. */
		class?: string
	}
>

// <UIStat> and <UIDescriptionList> have their props in types/data, beside their variants.
export type { UIDescriptionItem, UIDescriptionListProps, UISparklineColor, UISparklineProps, UIStatDirection, UIStatProps } from './data'

/**
 * Notificación breve presentada por el host de UIApp, con los `variant` y `color` de `UIAlert` (receta `toastTheme`).
 * Sin ellos es `soft` y `neutral`, la superficie elevada.
 *
 * @since 1.11.0 `variant` y `color` sustituyen a `tone`.
 * @example `<UIToast text="Cambios guardados" color="success" />`
 */
export type UIToastProps = UIThemeProps<
	typeof toastTheme,
	{
		/** Mensaje de la notificación. */
		text: string
		/** Acciones opcionales del aviso. */
		actions?: Snippet<[]>
		/** Tratamiento visual: `soft`, `surface`, `outline` o `solid`; `"soft"` por defecto. */
		variant?: UIMessageVariant
		/** Color semántico; `"neutral"` por defecto. `danger` se anuncia con `role="alert"`. */
		color?: UIMessageColor
		/** Milisegundos hasta cerrar; cero conserva el aviso. Se pausa con hover o foco. */
		duration?: number
		/** Nombre accesible del cierre. */
		closeLabel?: string
	}
>

/** Entrada del host de notificaciones. @example const entry: UIToastEntry = { id: 1, text: 'Guardado' } */
export interface UIToastEntry extends UIToastProps {
	/** Identidad estable asignada por el host. */
	id: number
}

/** Acciones de notificación dentro de UIApp. @example const id = useToast().add({ text: 'Guardado' }) */
export interface UIToastContext {
	/** Añade una notificación; devuelve su ID. */
	add(props: UIToastProps): number
	/** Cierra una notificación. */
	remove(id: number): void
	/** Cierra todas las notificaciones. */
	clear(): void
}

export type { UIMessageColor, UIMessageVariant }
