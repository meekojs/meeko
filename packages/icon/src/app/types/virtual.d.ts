/** Contrato privado del registro que genera el módulo: iconos de `icon.include` y tamaño por defecto. */
declare module 'virtual:meeko-icon' {
	import type { IconData } from '../../index'

	export const icons: Readonly<Record<string, IconData>>
	export const size: string
	export const dev: boolean
}
