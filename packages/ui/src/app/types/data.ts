import type { descriptionList, stat } from '../variants/data'
import type { UIThemeProps } from './theme'

/**
 * Dato con etiqueta y detalle opcional. Los snippets `value` y `detail` admiten marcado, como un enlace.
 * `ui` añade clases a sus slots: `base`, `label`, `value` y `detail`.
 *
 * @example `<UIStat label="Visitas" bind:value="1400" detail="Esta semana" />`
 */
export type UIStatProps = UIThemeProps<
	typeof stat,
	{
		/** Nombre del dato. */
		label: string
		/** Valor presentado por la aplicación; el snippet `value` lo sustituye. */
		value?: string | number
		/** Contexto del valor; el snippet `detail` lo sustituye. */
		detail?: string
		/** Clases adicionales del elemento raíz; equivale a `ui.base`. */
		class?: string
	}
>

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

/**
 * Lista semántica de datos. `ui` añade clases a sus slots: `base`, `item`, `label`, `value`, `code` y `detail`.
 *
 * @example `<UIDescriptionList bind:items="facts" bind:columns="2" />`
 */
export type UIDescriptionListProps = UIThemeProps<
	typeof descriptionList,
	{
		/** Datos en orden de lectura. */
		items: readonly UIDescriptionItem[]
		/** Columnas en espacios amplios; una en móvil. */
		columns?: 1 | 2 | 3
		/** Clases adicionales del elemento raíz; equivale a `ui.base`. */
		class?: string
	}
>
