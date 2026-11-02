import type { ElementAttributes, Snippet } from '@meekojs/meeko'

import type { UITone } from './forms'

/** Aviso con acciones y cierre opcionales. @example `<UIAlert tone="warning" title="Sin conexión" description="Vuelve a intentarlo." />` */
export type UIAlertProps = Omit<ElementAttributes<'section'>, 'title' | 'role' | 'class'> & {
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
	/** Clases adicionales. */
	class?: string
}

/**
 * Contenido plegable con `<details>` nativo: se abre con el teclado y sin JavaScript. Su contenido se
 * conserva en el documento, así que un formulario envía sus campos aunque esté plegado.
 *
 * @since 0.2.0
 * @example
 * ```html
 * <UIDisclosure summary="Añadir un comentario" bind:open="Boolean(comment.value)">
 * 	<UITextarea model="comment" />
 * </UIDisclosure>
 * ```
 */
export interface UIDisclosureProps {
	/** Texto del elemento que lo abre. */
	summary: string
	/** Abierto; el lector puede cambiarlo después. */
	open?: boolean
	/** Clases adicionales. */
	class?: string
}

/** Estado vacío con snippet de acciones. @example `<UIEmpty title="Sin resultados" variant="panel" />` */
export interface UIEmptyProps {
	/** Título; usa los mensajes de UI por defecto. */
	title?: string
	/** Ayuda para continuar. */
	description?: string
	/** Presentación dentro de contenido o como panel. */
	variant?: 'inline' | 'panel'
	/** Clases adicionales. */
	class?: string
}

/** Marcador de carga decorativo; el estado se anuncia una vez. @example `<UISkeleton bind:lines="3" bind:widths="['full', 'long', 'short']" />` */
export interface UISkeletonProps {
	/** Número de líneas; tres por defecto. */
	lines?: number
	/** Anchos de la escala UI por línea, sin CSS arbitrario. */
	widths?: readonly ('full' | 'long' | 'short')[]
	/** Nombre accesible; usa los mensajes de UI por defecto. */
	label?: string
	/** Clases adicionales. */
	class?: string
}

/**
 * Dato con etiqueta y detalle opcional. Los snippets `value` y `detail` admiten marcado, como un enlace.
 *
 * @example `<UIStat label="Visitas" bind:value="1400" detail="Esta semana" />`
 */
export interface UIStatProps {
	/** Nombre del dato. */
	label: string
	/** Valor presentado por la aplicación; el snippet `value` lo sustituye. */
	value?: string | number
	/** Contexto del valor; el snippet `detail` lo sustituye. */
	detail?: string
	/** Clases adicionales. */
	class?: string
}

/** Elemento de una lista de descripciones. @example const item: UIDescriptionItem = { label: 'Estado', value: 'Activo' } */
export interface UIDescriptionItem {
	/** Término, único dentro de la lista. */
	label: string
	/** Valor presentado por la aplicación. */
	value: string | number
	/** Contexto del valor. */
	detail?: string
	/** El valor es código o una ruta: se pinta en `<code>`, en monoespaciada. */
	code?: boolean
	/** Con `code`, texto de ayuda del valor, como un hash completo tras uno abreviado. */
	title?: string
	/** `lang` de la etiqueta, si está en otro idioma que el valor. */
	labelLang?: string
}

/** Lista semántica de datos. @example `<UIDescriptionList bind:items="facts" bind:columns="2" />` */
export interface UIDescriptionListProps {
	/** Datos en orden de lectura. */
	items: readonly UIDescriptionItem[]
	/** Columnas en espacios amplios; una en móvil. */
	columns?: 1 | 2 | 3
	/** Clases adicionales. */
	class?: string
}

/** Notificación breve presentada por el host de UIApp. @example `<UIToast text="Cambios guardados" tone="success" />` */
export interface UIToastProps {
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
