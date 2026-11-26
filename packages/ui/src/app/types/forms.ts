import type { ElementAttributes } from '@meekojs/meeko'

import type { badgeTheme, UIBadgeColor, UIBadgeRadius, UIBadgeVariant } from '../theme/components/badge'
import type { checkboxTheme } from '../theme/components/checkbox'
import type { fieldTheme } from '../theme/components/field'
import type { inputTheme, UIInputColor, UIInputRadius, UIInputSize, UIInputVariant } from '../theme/components/input'
import type { radioGroupTheme } from '../theme/components/radio-group'
import type { segmentedControlTheme } from '../theme/components/segmented-control'
import type { sliderTheme } from '../theme/components/slider'
import type { switchTheme } from '../theme/components/switch'
import type { textareaTheme } from '../theme/components/textarea'
import type { UIThemeProps } from './theme'

/** Densidad de controles y superficies. @example const density: UIDensity = 'compact' */
export type UIDensity = 'compact' | 'normal' | 'comfortable'

export type { UIBadgeColor, UIBadgeRadius, UIBadgeVariant, UIInputColor, UIInputRadius, UIInputSize, UIInputVariant }

/**
 * Campo de texto nativo; el valor se enlaza con `model`. Con `type="password"` y `reveal`, un botón al final
 * del campo muestra u oculta la contraseña. Su aspecto es la receta `inputTheme` de `@meekojs/ui/theme`:
 * `variant`, `color`, `size` y `radius`, y sin ellas (ni `ui.defaults.input`) es el campo de siempre, `outline` y
 * `neutral`, de tamaño `md` y radio `md`. El borde es siempre el de los controles, salvo con `invalid`.
 * @example `<UIInput type="date" name="date" />`
 * @example `<UIInput type="password" name="password" autocomplete="current-password" reveal />`
 * @example `<UIInput name="q" variant="soft" color="primary" size="lg" radius="full" />`
 */
export type UIInputProps = Omit<ElementAttributes<'input'>, 'type' | 'value' | 'class'> &
	UIThemeProps<
		typeof inputTheme,
		{
			/**
			 * Tipo nativo del campo. Con `number`, `time` y `month`, el modelo sigue siendo el texto del control
			 * (`'42'`, `'09:30'`, `'2026-11'`, o `''` vacío o a medio escribir), como el `model` de un `<input>`:
			 * conviértelo donde lo uses. `min`, `max`, `step` e `inputmode` son los atributos nativos.
			 *
			 * @since 1.10.0 admite `number`, `time` y `month`.
			 */
			type?: 'text' | 'email' | 'password' | 'search' | 'url' | 'tel' | 'number' | 'date' | 'datetime-local' | 'time' | 'month'
			/**
			 * Tratamiento visual: `outline` (el campo de siempre), `surface`, `soft` o `ghost` (sólo la línea inferior);
			 * `"outline"` por defecto.
			 */
			variant?: UIInputVariant
			/**
			 * Color semántico del fondo y del texto: `primary`, `secondary`, `neutral`, `success`, `info`, `warning` o
			 * `danger`; `"neutral"` por defecto. El borde sigue siendo el de los controles.
			 */
			color?: UIInputColor
			/**
			 * Alto y relleno del control, de `xs` a `xl`, sobre los tokens `--ui-control-*`; `"md"` por defecto.
			 */
			size?: UIInputSize
			/**
			 * Radio del contorno, de `none` a `full`; `"md"` por defecto.
			 */
			radius?: UIInputRadius
			/** Marca el campo como inválido. */
			invalid?: boolean
			/** Identificadores de los mensajes de ayuda. */
			describedBy?: string
			/**
			 * Con `type="password"`, un botón (`type="button"`, con `aria-pressed`) al final del campo que lo cambia
			 * entre contraseña y texto. Espera invisible hasta hidratar. Con otro `type` no hace nada.
			 *
			 * @since 1.10.0
			 */
			reveal?: boolean
			/**
			 * Nombre accesible del botón de `reveal` con la contraseña oculta; por defecto, el mensaje `input.show`.
			 *
			 * @since 1.10.0
			 */
			showLabel?: string
			/**
			 * Nombre accesible del botón de `reveal` con la contraseña a la vista; por defecto, el mensaje `input.hide`.
			 *
			 * @since 1.10.0
			 */
			hideLabel?: string
			/** Clases adicionales del `<input>`. */
			class?: string
		}
	>

/** Área de texto nativa con `model`. @example `<UITextarea name="comment" rows="4" />` */
export type UITextareaProps = Omit<ElementAttributes<'textarea'>, 'value' | 'class'> &
	UIThemeProps<
		typeof textareaTheme,
		{
			/** Estado de validación. */
			invalid?: boolean
			/** Identificadores de ayuda. */
			describedBy?: string
			/** Clases adicionales. */
			class?: string
		}
	>

/** Props propias de una casilla y de un interruptor. */
interface UIChoiceOwnProps {
	/** Etiqueta visible y accesible. */
	label: string
	/** Ayuda asociada al control. */
	description?: string
	/** Estado de validación. */
	invalid?: boolean
	/** Identificadores de ayuda adicionales. */
	describedBy?: string
	/** Clases adicionales del elemento raíz (`<label>`); equivale a `ui.base`. */
	class?: string
}

/**
 * Casilla nativa con modelo booleano. `ui` añade clases a sus slots: `base`, `input`, `content` y `description`.
 * @example `<UICheckbox label="Aceptar" name="accepted" />`
 */
export type UICheckboxProps = Omit<ElementAttributes<'input'>, 'type' | 'checked' | 'class'> & UIThemeProps<typeof checkboxTheme, UIChoiceOwnProps>

/**
 * Interruptor con el mismo contrato booleano que Checkbox. `ui` añade clases a sus slots: `base`, `input`,
 * `content` y `description`.
 * @example `<UISwitch label="Notificaciones" />`
 */
export type UISwitchProps = Omit<ElementAttributes<'input'>, 'type' | 'checked' | 'class'> & UIThemeProps<typeof switchTheme, UIChoiceOwnProps>

/** Opción de un grupo de radios. @example const option: UIRadioOption = { value: 'week', label: 'Semana' } */
export interface UIRadioOption {
	/** Valor enviado por el formulario. */
	value: string
	/** Etiqueta visible. */
	label: string
	/** Desactiva esta opción. */
	disabled?: boolean
}

/**
 * Grupo de radios nativos, con `model` y navegación de flechas del navegador. `ui` añade clases a sus slots:
 * `base` (el `<fieldset>`), `legend`, `options`, `option` (cada `<label>`) e `input`.
 * @example `<UIRadioGroup legend="Periodo" bind:options="periods" variant="segmented" />`
 */
export type UIRadioGroupProps = Omit<ElementAttributes<'fieldset'>, 'class'> &
	UIThemeProps<
		typeof radioGroupTheme,
		{
			/** Etiqueta del grupo. */
			legend: string
			/** Opciones en orden de lectura. */
			options: readonly UIRadioOption[]
			/** Nombre común; se genera uno si falta. */
			name?: string
			/** Selección obligatoria. */
			required?: boolean
			/** Presentación simple o segmentada. */
			variant?: 'default' | 'segmented'
			/** Clases adicionales del `<fieldset>`; equivale a `ui.base`. */
			class?: string
		}
	>

/** Lo que nombra a un `<UISegmentedControl>`: una leyenda, visible u oculta, o un `aria-label`. */
type UISegmentedControlName =
	| {
			/** Leyenda del grupo, su nombre accesible. Con `hideLegend`, sólo la leen los lectores de pantalla. */
			legend: string
			/** Oculta la leyenda a la vista sin quitársela a los lectores de pantalla; `false` por defecto. */
			hideLegend?: boolean
			ariaLabel?: never
	  }
	| {
			/** Nombre accesible del grupo cuando no tiene leyenda: el `aria-label` del `<fieldset>`. */
			ariaLabel: string
			legend?: never
			hideLegend?: never
	  }

/**
 * Selección única compacta, como un periodo de 7, 30 o 90 días: radios nativos con el aspecto de un control
 * segmentado, así que las flechas, el envío del formulario y la validación son los del navegador, también sin
 * JavaScript. El valor se enlaza con `model`. Si las opciones no caben, el control se desplaza en horizontal
 * dentro de su ancho, sin partir ninguna opción ni ensanchar la página. Necesita un nombre: `legend` (que
 * `hideLegend` deja sólo para lectores de pantalla) o `ariaLabel`. `ui` añade clases a sus slots: `base` (el
 * `<fieldset>`), `legend`, `options` (la pista que se desplaza), `option` (cada `<label>`) e `input`.
 * @since 1.10.0
 * @example `<UISegmentedControl legend="Periodo" hideLegend size="sm" model="days" bind:options="[{ value: '7', label: '7 días' }, { value: '30', label: '30 días' }, { value: '90', label: '90 días' }]" />`
 */
export type UISegmentedControlProps = Omit<ElementAttributes<'fieldset'>, 'class' | 'aria-label'> &
	UIThemeProps<
		typeof segmentedControlTheme,
		{
			/** Opciones en orden de lectura. */
			options: readonly UIRadioOption[]
			/** Nombre común de los radios en el formulario; se genera uno si falta. */
			name?: string
			/** Selección obligatoria. */
			required?: boolean
			/** Altura y texto, los de un control de ese tamaño; `"md"` por defecto. */
			size?: 'sm' | 'md'
			/** Clases adicionales del `<fieldset>`; equivale a `ui.base`. */
			class?: string
		}
	> &
	UISegmentedControlName

/**
 * Rango nativo con `model` numérico. `ui` añade clases a sus slots: `base` (el `<label>`) e `input`.
 * @example `<UISlider label="Volumen" min="0" max="100" step="1" />`
 */
export type UISliderProps = Omit<ElementAttributes<'input'>, 'type' | 'value' | 'class'> &
	UIThemeProps<
		typeof sliderTheme,
		{
			/** Nombre visible del rango. */
			label: string
			/** Clases adicionales del `<label>`; equivale a `ui.base`. */
			class?: string
		}
	>

/**
 * Etiqueta, ayuda, error y contador de un campo. `ui` añade clases a sus slots: `base`, `label`,
 * `description`, `error`, `meta` (la fila de ayuda y contador), `hint` y `counter`.
 * @example `<UIField id="comment" label="Comentario" hint="Opcional" counter="10/200" />`
 */
export type UIFieldProps = UIThemeProps<
	typeof fieldTheme,
	{
		/** ID del control. */
		id: string
		/** Etiqueta visible. */
		label: string
		/** Descripción del campo. */
		description?: string
		/** Ayuda adicional, conservada al mostrar un error. */
		hint?: string
		/** Contador presentado por la aplicación. */
		counter?: string | number
		/** Mensaje de validación. */
		error?: string
		/** Indicación visual de obligatoriedad. */
		required?: boolean
		/** Clases adicionales del elemento raíz; equivale a `ui.base`. */
		class?: string
	}
>

/**
 * Props de una etiqueta de estado, con la receta `badgeTheme` de `@meekojs/ui/theme`: tratamiento (`variant`),
 * color semántico (`color`) y radio. Sin ellas, se usan los valores de `ui.defaults` y, después, una píldora
 * `soft` y `neutral` de radio `full`. `ui` añade clases a sus slots: `base` y `dot`.
 *
 * @since 2.0.0 `variant`, `color` y `radius` sustituyen a `tone` (`accent` es `color="primary"`) y a `appearance`.
 * @example `<UIBadge color="success" dot>Publicado</UIBadge>`
 */
export type UIBadgeProps = UIThemeProps<
	typeof badgeTheme,
	{
		/** Tratamiento visual: `soft`, `solid`, `surface` u `outline`; `"soft"` por defecto. */
		variant?: UIBadgeVariant
		/** Color semántico: `primary`, `secondary`, `neutral`, `success`, `info`, `warning` o `danger`; `"neutral"` por defecto. */
		color?: UIBadgeColor
		/** Radio del contorno, de `none` a `full`; `"full"` por defecto. */
		radius?: UIBadgeRadius
		/** Indicador circular decorativo. */
		dot?: boolean
		/** Clases adicionales del elemento raíz; equivale a `ui.base`. */
		class?: string
	}
>
