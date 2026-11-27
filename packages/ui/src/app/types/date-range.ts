import type { dateRangeTheme } from '../theme/components/date-range'
import type { UIThemeProps } from './theme'

/**
 * Un rango de fechas: dos fechas `YYYY-MM-DD`, o `''` si falta alguna.
 *
 * @since 1.11.0
 * @example const range: UIDateRangeValue = { from: '2026-11-01', to: '2026-11-24' }
 */
export interface UIDateRangeValue {
	/** Primera fecha del rango, incluida; `''` si falta. */
	readonly from: string
	/** Última fecha del rango, incluida; `''` si falta. */
	readonly to: string
}

/**
 * Un atajo de `<UIDateRange>`: un botón que fija el rango. `range` recibe «hoy» (`YYYY-MM-DD`) y devuelve el
 * rango; se llama sólo cuando se conoce «hoy» (la prop `today` o, sin ella, la fecha local tras montar).
 *
 * @since 1.11.0
 * @example
 * ```ts
 * const yesterday: UIDateRangePreset = {
 * 	label: 'Ayer',
 * 	range: (today) => {
 * 		const day = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10)
 * 		return { from: day, to: day }
 * 	},
 * }
 * ```
 */
export interface UIDateRangePreset {
	/** Texto del botón. */
	readonly label: string
	/** El rango del atajo para el día `today` (`YYYY-MM-DD`). */
	readonly range: (today: string) => UIDateRangeValue
}

/**
 * Por qué un rango completo no es válido: `order`, la primera fecha va después de la última; `length`, el rango
 * tiene más días que `maxDays`; `min` y `max`, una fecha queda fuera de esos límites.
 *
 * @since 1.11.0
 * @example const issue: UIDateRangeIssue = 'length'
 */
export type UIDateRangeIssue = 'order' | 'length' | 'min' | 'max'

/** Lo que nombra el grupo: una leyenda visible o un `aria-label`; sin ninguno, la etiqueta de `UIField` o el mensaje `dateRange.label`. */
type UIDateRangeName =
	| {
			/** Leyenda visible del grupo, su nombre accesible. */
			label?: string
			ariaLabel?: never
	  }
	| {
			/** Nombre accesible del grupo sin leyenda visible: el `aria-label` del `<fieldset>`. */
			ariaLabel?: string
			label?: never
	  }

/**
 * Dos fechas nativas, «Desde» y «Hasta», con atajos y validación. Los valores se enlazan con `model:from` y
 * `model:to` (`Signal<string>`, `YYYY-MM-DD` o `''`) y reflejan lo que escribe el usuario; `change` sólo se
 * emite cuando el usuario deja un rango completo y válido distinto del anterior. `ui` añade clases a sus slots:
 * `base` (el `<fieldset>`), `legend`, `presets`, `preset`, `fields`, `field`, `fieldLabel`, `input` y `error`.
 *
 * @since 1.11.0
 * @example `<UIDateRange label="Periodo" model:from="from" model:to="to" fromName="desde" toName="hasta" bind:maxDays="366" on:change="load" />`
 */
export type UIDateRangeProps = UIThemeProps<
	typeof dateRangeTheme,
	{
		/**
		 * `id` del `<fieldset>`. Dentro de `UIField`, pásale el `id` del snippet: el grupo toma su nombre de la
		 * etiqueta del campo (`aria-labelledby="<id>-label"`).
		 */
		id?: string
		/** Texto de la primera fecha; por defecto, el mensaje `dateRange.from` («Desde»). */
		fromLabel?: string
		/** Texto de la última fecha; por defecto, el mensaje `dateRange.to` («Hasta»). */
		toLabel?: string
		/** `name` de la primera fecha en el formulario. */
		fromName?: string
		/** `name` de la última fecha en el formulario. */
		toName?: string
		/** `form` de las dos fechas, si el grupo no está dentro de su formulario. */
		form?: string
		/** Las dos fechas son obligatorias. */
		required?: boolean
		/** Deshabilita el grupo entero: fechas y atajos. */
		disabled?: boolean
		/** Primera fecha admitida (`YYYY-MM-DD`): el `min` de los dos campos y un límite de la validación. */
		min?: string
		/** Última fecha admitida (`YYYY-MM-DD`): el `max` de los dos campos y un límite de la validación. */
		max?: string
		/** Días que puede tener el rango, contando el primero y el último: con `366` cabe un año bisiesto entero. */
		maxDays?: number
		/**
		 * «Hoy» (`YYYY-MM-DD`) para los atajos. Pásalo desde el servidor para que el HTML ya los traiga activos y
		 * coincida con la hidratación. Sin él, el componente nunca lee el reloj al pintar: los atajos esperan
		 * deshabilitados y se activan al montar, con la fecha local del navegador.
		 */
		today?: string
		/**
		 * Atajos en orden; por defecto «Hoy», «7 días», «Este mes» y «Mes anterior». `[]` los quita. El que
		 * coincide con el rango lleva `aria-pressed="true"`.
		 */
		presets?: readonly UIDateRangePreset[]
		/** Marca las dos fechas como inválidas, por una validación propia (por ejemplo, el `error` de `UIField`). */
		invalid?: boolean
		/** Identificadores de ayuda de las dos fechas, como el `describedBy` de `UIField`. */
		describedBy?: string
		/** Clases adicionales del `<fieldset>`; equivale a `ui.base`. */
		class?: string
	}
> &
	UIDateRangeName
