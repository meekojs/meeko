import type { ElementAttributes } from '@meekojs/meeko'

/** Densidad de controles y superficies. @example const density: UIDensity = 'compact' */
export type UIDensity = 'compact' | 'normal' | 'comfortable'

/** Estado semántico de un mensaje. @example const tone: UITone = 'warning' */
export type UITone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'

/** Campo de texto nativo; el valor se enlaza con `model`. @example `<UIInput type="date" name="date" />` */
export type UIInputProps = Omit<ElementAttributes<'input'>, 'type' | 'value' | 'class'> & {
	/** Tipo nativo del campo. */
	type?: 'text' | 'email' | 'password' | 'search' | 'url' | 'tel' | 'date' | 'datetime-local'
	/** Marca el campo como inválido. */
	invalid?: boolean
	/** Identificadores de los mensajes de ayuda. */
	describedBy?: string
	/** Clases adicionales. */
	class?: string
}

/** Área de texto nativa con `model`. @example `<UITextarea name="comment" rows="4" />` */
export type UITextareaProps = Omit<ElementAttributes<'textarea'>, 'value' | 'class'> & {
	/** Estado de validación. */
	invalid?: boolean
	/** Identificadores de ayuda. */
	describedBy?: string
	/** Clases adicionales. */
	class?: string
}

/** Casilla o interruptor nativo con modelo booleano. @example `<UICheckbox label="Aceptar" name="accepted" />` */
export type UICheckboxProps = Omit<ElementAttributes<'input'>, 'type' | 'checked' | 'class'> & {
	/** Etiqueta visible y accesible. */
	label: string
	/** Ayuda asociada al control. */
	description?: string
	/** Estado de validación. */
	invalid?: boolean
	/** Identificadores de ayuda adicionales. */
	describedBy?: string
	/** Clases adicionales. */
	class?: string
}

/** Interruptor con el mismo contrato booleano que Checkbox. @example `<UISwitch label="Notificaciones" />` */
export type UISwitchProps = UICheckboxProps

/** Opción de un grupo de radios. @example const option: UIRadioOption = { value: 'week', label: 'Semana' } */
export interface UIRadioOption {
	/** Valor enviado por el formulario. */
	value: string
	/** Etiqueta visible. */
	label: string
	/** Desactiva esta opción. */
	disabled?: boolean
}

/** Grupo de radios nativos, con `model` y navegación de flechas del navegador. @example `<UIRadioGroup legend="Periodo" bind:options="periods" variant="segmented" />` */
export type UIRadioGroupProps = Omit<ElementAttributes<'fieldset'>, 'class'> & {
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
	/** Clases adicionales. */
	class?: string
}

/** Rango nativo con `model` numérico. @example `<UISlider label="Volumen" min="0" max="100" step="1" />` */
export type UISliderProps = Omit<ElementAttributes<'input'>, 'type' | 'value' | 'class'> & {
	/** Nombre visible del rango. */
	label: string
	/** Clases adicionales. */
	class?: string
}

/** Etiqueta, ayuda, error y contador de un campo. @example `<UIField id="comment" label="Comentario" hint="Opcional" counter="10/200" />` */
export interface UIFieldProps {
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
	/** Clases adicionales. */
	class?: string
}

/** Props de una etiqueta de estado. @example `<UIBadge tone="success" dot>Publicado</UIBadge>` */
export interface UIBadgeProps {
	/** Color semántico. */
	tone?: UITone | 'accent'
	/** Indicador circular decorativo. */
	dot?: boolean
	/** Clases adicionales. */
	class?: string
}
