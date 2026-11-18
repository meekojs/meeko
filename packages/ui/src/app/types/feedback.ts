import type { ElementAttributes, Snippet } from '@meekojs/meeko'

import type { alert, disclosure, empty, skeleton, toast } from '../variants/feedback'
import type { UITone } from './forms'
import type { UIThemeProps } from './theme'

/** Aviso con acciones y cierre opcionales. @example `<UIAlert tone="warning" title="Sin conexión" description="Vuelve a intentarlo." />` */
export type UIAlertProps = Omit<ElementAttributes<'section'>, 'title' | 'role' | 'class'> &
	UIThemeProps<
		typeof alert,
		{
			/** Estado semántico. */
			tone?: UITone
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
			/** Semántica; danger usa alert y los demás note por defecto. `none`, dentro de una región viva que ya existía. */
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
	typeof disclosure,
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
	typeof empty,
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
	typeof skeleton,
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
export type { UIDescriptionItem, UIDescriptionListProps, UIStatProps } from './data'

/** Notificación breve presentada por el host de UIApp. @example `<UIToast text="Cambios guardados" tone="success" />` */
export type UIToastProps = UIThemeProps<
	typeof toast,
	{
		/** Mensaje de la notificación. */
		text: string
		/** Acciones opcionales del aviso. */
		actions?: Snippet<[]>
		/** Estado semántico. */
		tone?: UITone
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
