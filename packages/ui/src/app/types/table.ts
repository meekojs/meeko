import type { table } from '../variants/table'
import type { UIDensity } from './forms'
import type { UIThemeProps } from './theme'

/**
 * Props de una tabla semántica. `ui` añade clases a sus slots: `base` (el contenedor que la desplaza), `table`,
 * `caption`, `section`, `row`, `bodyRow`, `headerCell`, `cell`, `footerCell` y `empty`.
 *
 * @example const props: UITableProps<{ id: number }> = { rows: [], columns: [{ key: 'id', label: 'ID', numeric: true }], rowKey: 'id' }
 */
export type UITableProps<T extends object> = Omit<
	UIThemeProps<
		typeof table,
		{
			/** Filas de datos. */
			rows: readonly T[]
			/** Columnas correlacionadas con la fila. */
			columns: readonly TableColumn<T>[]
			/** Identidad estable de cada fila. */
			rowKey: TableRowKey<T>
			/** Densidad de celdas. */
			density?: UIDensity
			/** Layout nativo o subgrid progresivo. */
			layout?: 'grid' | 'native'
			/** Plantilla de columnas para el layout grid. */
			gridColumns?: string
			/** Nombre visible y accesible de la tabla. */
			caption?: string
			/** Oculta el título a la vista, cuando un encabezado ya lo dice; sigue nombrando la tabla y su región. */
			hideCaption?: boolean
			/** Oculta la fila de cabeceras. */
			hideHeader?: boolean
			/** Texto sin filas. */
			emptyText?: string
			/** Clases adicionales de la `<table>`; las del contenedor que la desplaza van en `ui.base`. */
			class?: string
		}
	>,
	// Each column decides them.
	'numeric' | 'rowHeader'
>

/** Valor de presentación de una celda; null y undefined se muestran vacíos. */
export type TableCellValue = string | number | boolean | null | undefined

/** Columna vinculada a una propiedad real de la fila, con formateador del tipo de esa propiedad. */
export type TableColumn<T extends object> = {
	[K in Extract<keyof T, string>]-?: {
		key: K
		label: string
		/** Alinea datos numéricos al extremo final. */
		numeric?: boolean
		/** Usa esta columna como encabezado de fila. */
		rowHeader?: boolean
		format?: (value: T[K], row: T) => TableCellValue
		footer?: TableCellValue | ((rows: readonly T[]) => TableCellValue)
	}
}[Extract<keyof T, string>]

/** Identidad estable de cada fila: una propiedad string/number o una función. */
export type TableRowKey<T extends object> =
	| {
			[K in Extract<keyof T, string>]-?: T[K] extends string | number ? K : never
	  }[Extract<keyof T, string>]
	| ((row: T) => string | number)
