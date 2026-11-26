import type { descriptionListTheme } from '../theme/components/description-list'
import type { sparklineTheme, UISparklineColor } from '../theme/components/sparkline'
import type { statTheme } from '../theme/components/stat'
import type { UIRouteTarget } from './button'
import type { UIThemeProps } from './theme'

/** Dirección de la variación de `<UIStat>`: sube, baja o se queda igual. @since 1.10.0 @example const direction: UIStatDirection = 'up' */
export type UIStatDirection = 'up' | 'down' | 'flat'

export type { UISparklineColor }

/** `target` y `rel` del enlace de `<UIStat>`, y su texto. */
interface UIStatLinkOptions {
	/** Dónde se abre el enlace. Con `"_blank"` y sin `rel`, añade `rel="noopener noreferrer"`. */
	readonly target?: '_self' | '_blank' | '_parent' | '_top'
	/** Relación con el destino; gana sobre el valor por defecto de `target="_blank"`. */
	readonly rel?: string
	/**
	 * Texto del enlace. Sin él, el mensaje `stat.link` («Ver detalle»), y su nombre accesible añade la etiqueta
	 * del dato (`stat.linkName`: «Ver detalle: Visitas»), para que se distinga en la lista de enlaces. Un texto
	 * propio es el nombre tal cual: hazlo distinguible, como «Ver todas las visitas».
	 */
	readonly linkLabel?: string
}

/** `<UIStat>` sin enlace. */
interface UIStatWithoutLink {
	readonly href?: never
	readonly to?: never
	readonly params?: never
	readonly search?: never
	readonly resolve?: never
	readonly target?: never
	readonly rel?: never
	readonly linkLabel?: never
}

/** `<UIStat href>`: un enlace a cualquier URL. */
interface UIStatAnchorLink extends UIStatLinkOptions {
	/** URL del detalle; pinta un `<a>` con su texto propio. */
	readonly href: string
	readonly to?: never
	readonly params?: never
	readonly search?: never
	readonly resolve?: never
}

/** `<UIStat to>`: una ruta de la aplicación, con `<MeekoLink>`. */
type UIStatRouteLink = UIRouteTarget &
	UIStatLinkOptions & {
		readonly href?: never
		/** Si el `href` pasa por los resolvedores de enlaces de la aplicación; `true` por defecto. */
		readonly resolve?: boolean
	}

/**
 * Dato con etiqueta y detalle opcional. Los snippets `value` y `detail` admiten marcado, como un enlace.
 * `ui` añade clases a sus slots: `base`, `label`, `value` y `detail`; y, en una cifra clave, `change`,
 * `delta`, `icon`, `period`, `trend`, `action` y `link`.
 *
 * Con `change`, `period`, `trend`, `href` o `to` es una cifra clave («KPI»): la variación con su flecha y su
 * tono, el periodo, un sparkline y un enlace al detalle. Su `<dl>` es entonces un contenedor (container query):
 * por debajo del tamaño de contenedor `stat-narrow` del tema (20rem) el valor se reduce y el sparkline baja
 * bajo la variación. Sin esas props, el marcado y las clases son los de siempre.
 *
 * @since 1.10.0 `change`, `changeFormat`, `changeDirection`, `good`, `period`, `trend`, `trendLabel`, `href`, `to`, `linkLabel`, `hint` y el snippet `label`.
 * @example `<UIStat label="Ingresos" hint="Ventas cobradas, sin impuestos" value="12 400 €" />`
 * @example `<UIStat label="Visitas" bind:value="1400" detail="Esta semana" />`
 * @example `<UIStat label="Ingresos" value="12 400 €" bind:change="12.5" period="frente a los 30 días anteriores" bind:trend="[8, 9, 12, 11, 14]" to="/ingresos" />`
 */
export type UIStatProps = (UIStatWithoutLink | UIStatAnchorLink | UIStatRouteLink) &
	Omit<
		UIThemeProps<
			typeof statTheme,
			{
				/**
				 * Nombre del dato. El snippet `label` sustituye su texto en pantalla (por ejemplo, con un icono); el nombre
				 * sigue sirviendo para el enlace y el sparkline.
				 */
				label: string
				/**
				 * Ayuda junto a la etiqueta: un `UIHint` (ⓘ) con este texto, que se abre con el puntero, el foco o al
				 * pulsarlo. Su clase extra va en `ui.hint`.
				 * @since 1.10.0
				 */
				hint?: string
				/** Valor presentado por la aplicación; el snippet `value` lo sustituye. */
				value?: string | number
				/** Contexto del valor; el snippet `detail` lo sustituye. */
				detail?: string
				/**
				 * Variación del valor. Un número se formatea con `Intl.NumberFormat` en el idioma del documento, con
				 * signo y según `changeFormat`: `12.5` es «+12,5 %». Un texto ya formateado se pinta tal cual, y su
				 * signo inicial da la dirección (`-` o `−` baja, `+` o cualquier cifra distinta de cero sube); si no
				 * basta, usa `changeDirection`. Pinta una flecha y un texto accesible («Sube 12,5 %»).
				 *
				 * @since 1.10.0
				 */
				change?: number | string
				/**
				 * Cómo se formatea un `change` numérico: `"percent"` (por defecto), en puntos porcentuales sobre 100
				 * (`12.5` es «12,5 %»), o `"number"`, el número tal cual.
				 *
				 * @since 1.10.0
				 */
				changeFormat?: 'percent' | 'number'
				/**
				 * Dirección de la variación cuando su signo no la dice, como en un texto sin signo; gana sobre el signo.
				 *
				 * @since 1.10.0
				 */
				changeDirection?: UIStatDirection
				/**
				 * Qué dirección es buena: `"up"` (por defecto) o `"down"`, como en un tiempo de respuesta. Con la
				 * dirección de `change` da el tono: la buena, de éxito; la otra, de peligro; sin cambio, neutro.
				 *
				 * @since 1.10.0
				 */
				good?: 'up' | 'down'
				/**
				 * Periodo de la comparación, tras la variación: «frente a los 30 días anteriores».
				 *
				 * @since 1.10.0
				 */
				period?: string
				/**
				 * Serie para un `<UISparkline>` junto al valor, de la más antigua a la más reciente. Toma el tono de
				 * `change` (sin él, el de acento) y su resumen accesible.
				 *
				 * @since 1.10.0
				 */
				trend?: readonly number[]
				/**
				 * Nombre accesible del sparkline, en lugar del resumen del mensaje `sparkline.label`.
				 *
				 * @since 1.10.0
				 */
				trendLabel?: string
				/** Clases adicionales del elemento raíz; equivale a `ui.base`. */
				class?: string
			}
		>,
		// Set by the component from its content: they are not props.
		'kpi' | 'chart' | 'color' | 'direction'
	>

/**
 * Una serie de números dibujada como línea, con un área opcional, en un `<svg>` sin dependencias. Ocupa el
 * ancho de su contenedor y la altura de `--ui-sparkline-height`, sin depender de JavaScript: el trazo no
 * se deforma al estirarse. Es una imagen (`role="img"`) cuyo nombre resume la serie (mínimo, máximo y
 * último valor, con el formato del idioma del documento) o es `label`. La línea se dibuja una vez al
 * aparecer, salvo con `prefers-reduced-motion`. `ui` añade clases a sus slots: `base`, `area` y `line`.
 *
 * @since 1.10.0
 * @since 1.11.0 `color` sustituye a `tone` (`accent` es `color="primary"`).
 * @example `<UISparkline bind:values="[3, 5, 4, 8, 7]" area color="success" />`
 */
export type UISparklineProps = UIThemeProps<
	typeof sparklineTheme,
	{
		/** Valores en orden, del más antiguo al más reciente; los que no son números finitos se omiten. */
		values: readonly number[]
		/** Rellena el área bajo la línea, en el mismo color con poca opacidad. */
		area?: boolean
		/** Color semántico de la línea, el paso 11 de su escala (`neutral`, el texto suave); sin él, `currentColor`. */
		color?: UISparklineColor
		/** Mínimo del eje vertical, como `0`; por defecto, el menor valor. */
		min?: number
		/** Máximo del eje vertical; por defecto, el mayor valor. */
		max?: number
		/** Nombre accesible; por defecto, el resumen del mensaje `sparkline.label`. */
		label?: string
		/** Formato de los números del resumen, como `{ style: 'currency', currency: 'EUR' }`. */
		format?: Intl.NumberFormatOptions
		/** Clases adicionales del `<svg>`; equivale a `ui.base`. */
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
	typeof descriptionListTheme,
	{
		/** Datos en orden de lectura. */
		items: readonly UIDescriptionItem[]
		/** Columnas en espacios amplios; una en móvil. */
		columns?: 1 | 2 | 3
		/** Clases adicionales del elemento raíz; equivale a `ui.base`. */
		class?: string
	}
>
