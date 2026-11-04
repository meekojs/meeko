import type { ReadonlySignal, Signal } from '@meekojs/meeko'

import type { PopoverPlacement } from './popover'

/**
 * Valor del modelo de `<UISelect>`: la opción elegida o `null`. Se infiere del tipo de `options`.
 * @since 1.8.0
 * @example
 * ```ts
 * const color = signal<SelectModel<string>>(null); // string | null
 * ```
 */
export type SelectModel<T> = T | null

/**
 * Estado de una opción de `<UISelect>`, el segundo parámetro del snippet `option`.
 * @since 1.8.0
 * @example
 * ```html
 * <snippet name="option" params="user, state">{user.name} <span if:when="state.selected">✓</span></snippet>
 * ```
 */
export interface SelectOptionState {
	/** La opción está elegida. */
	readonly selected: boolean
	/** No se puede elegir. */
	readonly disabled: boolean
}

/**
 * Snippets de `<UISelect>`, tipados con el tipo de sus opciones.
 * @since 1.8.0
 * @example
 * ```html
 * <UISelect model="user" bind:options="users.value" by="id">
 *   <snippet name="option" params="user">{user.name}</snippet>
 *   <snippet name="value" params="user">{user.name}</snippet>
 * </UISelect>
 * ```
 */
export interface SelectSnippets<T> {
	/** Contenido de cada opción de la lista; sin él, su etiqueta. */
	option?: [option: T, state: SelectOptionState]
	/** Cómo se muestra el valor elegido en el disparador; sin él, su etiqueta. Firefox muestra siempre el texto de la opción. */
	value?: [option: T]
	/** Encabezado de un grupo de `groupBy`; sin él, su nombre. Firefox muestra siempre el nombre. */
	group?: [name: string]
}

/**
 * Lo que `<UISelect>` y `<UICombobox>` leen de `form.field('x')` de `useForm`: el `id`, el `name`, la señal del
 * valor, `invalid` y `describedBy`. Un `FormField` lo cumple.
 * @since 1.8.0
 * @example
 * ```html
 * <UISelect bind:field="form.field('color')" bind:options="colors" />
 * ```
 */
export interface SelectField<Value> {
	/** `id` del disparador, para el `<label for>` del campo. */
	readonly id: string
	/** `name` con el que se envía al `<form>`. */
	readonly name: string
	/** La señal del campo, que sustituye al modelo. */
	readonly value: Signal<Value>
	/** `true` si el campo tiene un error: `aria-invalid="true"`. */
	readonly invalid: ReadonlySignal<boolean>
	/** `aria-describedby` del disparador, el mensaje de error mientras lo hay. */
	readonly describedBy: ReadonlySignal<string | undefined>
}

/** Clave de texto de un tipo de objeto; `never` para un primitivo. */
export type SelectKey<T> = T extends object ? keyof T & string : never

/**
 * Lo que `<UISelect>` y `<UICombobox>` tienen en común.
 * @since 1.8.0
 * @example
 * ```ts
 * const shared: SelectBaseProps<string> = { options: ['a', 'b'], placeholder: 'Elige', clearable: true }
 * ```
 */
export interface SelectBaseProps<T> {
	/** Las opciones, primitivos u objetos. Es reactiva: una lista nueva actualiza la lista abierta. */
	readonly options: readonly T[]
	/** Cómo se comparan las opciones con el valor: una clave (`by="id"`) o una función; por defecto, `Object.is`. */
	readonly by?: SelectKey<T> | ((a: T, b: T) => boolean)
	/** Etiqueta de cada opción: una clave o una función; por defecto, el texto del primitivo o `label`/`name` del objeto. */
	readonly labelBy?: SelectKey<T> | ((option: T) => string)
	/** Qué opciones están deshabilitadas: una clave o una función; por defecto, las que tienen `disabled: true`. */
	readonly disabledBy?: SelectKey<T> | ((option: T) => boolean)
	/** Grupo de cada opción, con un encabezado por grupo: una clave (`groupBy="category"`) o una función. */
	readonly groupBy?: SelectKey<T> | ((option: T) => string | undefined)
	/** Texto del disparador sin valor elegido. */
	readonly placeholder?: string
	/** `name` con el que se envía al `<form>`. */
	readonly name?: string
	/** Exige un valor al enviar el `<form>`. */
	readonly required?: boolean
	/** Deshabilita el control; no se envía con el `<form>`. */
	readonly disabled?: boolean
	/**
	 * Añade un botón junto al disparador que quita la selección y devuelve el foco al disparador. Sólo se
	 * muestra mientras hay algo elegido.
	 */
	readonly clearable?: boolean
	/** `aria-label` del botón de `clearable`; por defecto, `select.clear` de `ui.messages` («Quitar selección» en español). */
	readonly clearLabel?: string
	/** `id` del disparador, para un `<label for>`; por defecto, el del campo o uno de `useId`. */
	readonly id?: string
	/** `aria-label` del disparador y de la lista, sin `<label>`. */
	readonly label?: string
	/** `aria-describedby` del disparador. */
	readonly describedBy?: string
	/** Marca el disparador con `aria-invalid="true"`. */
	readonly invalid?: boolean
	/** Clases del elemento raíz. */
	readonly class?: string
	/** Clases de la lista. En `<UISelect>` van en el `<select>`: `.mi-clase::picker(select)`. */
	readonly listClass?: string
	/** Dónde se abre la lista; `"bottom-start"` por defecto. */
	readonly placement?: PopoverPlacement
	/** Separación en píxeles entre el disparador y la lista. */
	readonly offset?: number
}

/** The message of the type error for a prop of `<UICombobox>` on `<UISelect>`: a string nobody passes by chance. */
type OnlyInCombobox<Prop extends string> = `UISelect es un <select> nativo y no admite ${Prop}: usa <UICombobox ${Prop}>`

/**
 * Props de la etiqueta propia `<UISelect>`, un `<select>` nativo con `appearance: base-select`: el
 * navegador trae su lista, su teclado y su valor de formulario. `T` es el tipo de cada opción y se infiere
 * de la etiqueta. Para buscar, filtrar en un servidor o elegir varias opciones, usa `<UICombobox>`: esas
 * props aquí son un error de tipos. Se autoimporta en `app/`.
 * @since 1.8.0
 * @example
 * ```html
 * <UISelect model="color" bind:options="colors" placeholder="Elige un color" name="color" />
 * ```
 */
export interface UISelectProps<T> extends SelectBaseProps<T> {
	/** El campo de `useForm` (`form.field('x')`): su `id`, su `name`, su valor, `aria-invalid` y `aria-describedby`. */
	readonly field?: SelectField<SelectModel<T>>
	/** No existe aquí: usa `<UICombobox multiple>`. */
	readonly multiple?: OnlyInCombobox<'multiple'>
	/** No existe aquí: usa `<UICombobox searchable>`. */
	readonly searchable?: OnlyInCombobox<'searchable'>
	/** No existe aquí: usa `<UICombobox filter>`. */
	readonly filter?: OnlyInCombobox<'filter'>
	/** No existe aquí: usa `<UICombobox multiple max>`. */
	readonly max?: OnlyInCombobox<'max'>
	/** No existe aquí: el estado de carga es de `<UICombobox filter>`. */
	readonly loading?: OnlyInCombobox<'filter'>
}

/** The props as the controller reads them: the field's value of any type. */
export type SelectSettings<T> = Omit<UISelectProps<T>, 'field'> & {
	readonly field?: Omit<SelectField<unknown>, 'value'> & { readonly value: { value: unknown } }
}

/** What the helpers of the options read. */
export type SelectOptionSettings<T> = Pick<SelectBaseProps<T>, 'by' | 'labelBy' | 'disabledBy' | 'groupBy'>

/** An option as the list renders it. */
export interface SelectEntry<T> {
	readonly option: T
	/** Position in the list as shown, grouped: the index that the keyboard moves. */
	readonly index: number
	readonly key: string
	readonly id: string
	readonly label: string
	readonly disabled: boolean
}

/** A group of the list; the one of the options without a group has no name. */
export interface SelectGroup<T> {
	readonly key: string
	readonly name: string | undefined
	readonly id: string | undefined
	readonly entries: readonly SelectEntry<T>[]
}
