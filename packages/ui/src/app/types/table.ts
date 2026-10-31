/** Valor de presentación de una celda; null y undefined se muestran vacíos. */
export type TableCellValue = string | number | boolean | null | undefined

/** Columna vinculada a una propiedad real de la fila, con formateador del tipo de esa propiedad. */
export type TableColumn<T extends object> = {
	[K in Extract<keyof T, string>]-?: {
		key: K
		label: string
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
