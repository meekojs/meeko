import type { ElementAttributes } from '@meekojs/meeko'

import type { badge } from '../variants/badge'
import type { checkbox, radioGroup, toggle } from '../variants/choice'
import type { field } from '../variants/field'
import type { input, textarea } from '../variants/input'
import type { slider } from '../variants/slider'
import type { UIThemeProps } from './theme'

/** Densidad de controles y superficies. @example const density: UIDensity = 'compact' */
export type UIDensity = 'compact' | 'normal' | 'comfortable'

/** Estado semántico de un mensaje. @example const tone: UITone = 'warning' */
export type UITone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/** Campo de texto nativo; el valor se enlaza con `model`. @example `<UIInput type="date" name="date" />` */
export type UIInputProps = Omit<ElementAttributes<'input'>, 'type' | 'value' | 'class'> &
	UIThemeProps<
		typeof input,
		{
			/** Tipo nativo del campo. */
			type?: 'text' | 'email' | 'password' | 'search' | 'url' | 'tel' | 'date' | 'datetime-local'
			/** Marca el campo como inválido. */
			invalid?: boolean
			/** Identificadores de los mensajes de ayuda. */
			describedBy?: string
			/** Clases adicionales. */
			class?: string
		}
	>

/** Área de texto nativa con `model`. @example `<UITextarea name="comment" rows="4" />` */
export type UITextareaProps = Omit<ElementAttributes<'textarea'>, 'value' | 'class'> &
	UIThemeProps<
		typeof textarea,
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
export type UICheckboxProps = Omit<ElementAttributes<'input'>, 'type' | 'checked' | 'class'> & UIThemeProps<typeof checkbox, UIChoiceOwnProps>

/**
 * Interruptor con el mismo contrato booleano que Checkbox. `ui` añade clases a sus slots: `base`, `input`,
 * `content` y `description`.
 * @example `<UISwitch label="Notificaciones" />`
 */
export type UISwitchProps = Omit<ElementAttributes<'input'>, 'type' | 'checked' | 'class'> & UIThemeProps<typeof toggle, UIChoiceOwnProps>

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
		typeof radioGroup,
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

/**
 * Rango nativo con `model` numérico. `ui` añade clases a sus slots: `base` (el `<label>`) e `input`.
 * @example `<UISlider label="Volumen" min="0" max="100" step="1" />`
 */
export type UISliderProps = Omit<ElementAttributes<'input'>, 'type' | 'value' | 'class'> &
	UIThemeProps<
		typeof slider,
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
	typeof field,
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
 * Props de una etiqueta de estado. `ui` añade clases a sus slots: `base` y `dot`.
 * @example `<UIBadge tone="success" dot>Publicado</UIBadge>`
 */
export type UIBadgeProps = UIThemeProps<
	typeof badge,
	{
		/** Color semántico. */
		tone?: UITone | 'accent'
		/** Indicador circular decorativo. */
		dot?: boolean
		/** Clases adicionales del elemento raíz; equivale a `ui.base`. */
		class?: string
	}
>
