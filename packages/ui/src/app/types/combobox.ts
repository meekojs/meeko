import type { SelectBaseProps, SelectField } from './select'

/**
 * Valor del modelo de `<UICombobox>`: la opción elegida o `null` y, con `multiple`, un array de
 * opciones. Se infiere del tipo de `options` y de `multiple`.
 * @since 1.8.0
 * @example
 * ```ts
 * const color = signal<ComboboxModel<string, false>>(null); // string | null
 * const tags = signal<ComboboxModel<string, true>>([]);      // string[]
 * ```
 */
export type ComboboxModel<T, Multiple extends boolean = false> = Multiple extends true ? T[] : T | null

/**
 * Estado de una opción de `<UICombobox>`, el segundo parámetro del snippet `option`.
 * @since 1.8.0
 * @example
 * ```html
 * <snippet name="option" params="user, state">{user.name} <span if:when="state.selected">✓</span></snippet>
 * ```
 */
export interface ComboboxOptionState {
	/** La opción está elegida. */
	readonly selected: boolean
	/** Es la opción activa del teclado (`aria-activedescendant`). */
	readonly active: boolean
	/** No se puede elegir: está deshabilitada o se alcanzó `max`. */
	readonly disabled: boolean
}

/**
 * Lo que recibe una función `filter` de `<UICombobox>` además del texto buscado.
 * @since 1.8.0
 * @example
 * ```ts
 * const search: ComboboxFilter<User> = (query, { signal }) => api.users.get({ query: { q: query }, signal });
 * ```
 */
export interface ComboboxFilterContext<T> {
	/** Las opciones de la prop `options`. */
	readonly options: readonly T[]
	/** Se aborta cuando llega otra búsqueda o se cierra el componente: pásela a `fetch`. */
	readonly signal: AbortSignal
}

/**
 * Búsqueda propia de `<UICombobox searchable>`: recibe el texto (nunca vacío; con la búsqueda
 * vacía se muestran `options`) y devuelve las opciones que se muestran, o una promesa de ellas para
 * buscar en el servidor. Mientras la promesa no resuelve, el componente está cargando
 * (`data-loading`, `aria-busy` y el snippet `loading`).
 * @since 1.8.0
 * @example
 * ```ts
 * const byPrefix: ComboboxFilter<string> = (query, { options }) => options.filter((option) => option.startsWith(query));
 * ```
 */
export type ComboboxFilter<T> = (query: string, context: ComboboxFilterContext<T>) => readonly T[] | PromiseLike<readonly T[]>

/**
 * Snippets de `<UICombobox>`, tipados con el tipo de sus opciones.
 * @since 1.8.0
 * @example
 * ```html
 * <UICombobox model="user" searchable bind:options="users.value" by="id">
 *   <snippet name="option" params="user, state">{user.name}</snippet>
 *   <snippet name="value" params="user">{user.name}</snippet>
 *   <snippet name="empty">Nadie con ese nombre</snippet>
 * </UICombobox>
 * ```
 */
export interface ComboboxSnippets<T> {
	/** Contenido de cada opción de la lista; sin él, su etiqueta. */
	option?: [option: T, state: ComboboxOptionState]
	/** Cómo se muestra cada valor elegido en el disparador; sin él, las etiquetas separadas por comas. */
	value?: [option: T]
	/** Encabezado de un grupo de `groupBy`; sin él, su nombre. */
	group?: [name: string]
	/** Lo que se muestra cuando no hay opciones; sin él, `select.empty` de `ui.messages` («Sin resultados» en español). */
	empty?: []
	/** Lo que se muestra mientras una búsqueda asíncrona carga. */
	loading?: []
}

/**
 * Props de la etiqueta propia `<UICombobox>`, una lista propia sobre `<UIPopover>` para lo que el
 * `<select>` nativo de `<UISelect>` no cubre: buscar, filtrar en un servidor y elegir varias opciones.
 * `T` es el tipo de cada opción y `Multiple`, si se eligen varias; los dos se infieren de la etiqueta.
 * Se autoimporta en `app/`.
 * @since 1.8.0
 * @example
 * ```html
 * <UICombobox model="tags" multiple searchable bind:options="tags" groupBy="category" bind:max="3" />
 * ```
 */
export interface UIComboboxProps<T, Multiple extends boolean = false> extends SelectBaseProps<T> {
	/** Con `true`, el modelo es un array y cada opción se alterna. */
	readonly multiple?: Multiple
	/** Convierte el disparador en un campo de texto que filtra las opciones. */
	readonly searchable?: boolean
	/** Búsqueda propia, síncrona o asíncrona; por defecto, la etiqueta contiene el texto, sin distinguir acentos ni mayúsculas. */
	readonly filter?: ComboboxFilter<T>
	/** Con `multiple`, cuántas opciones se pueden elegir como mucho. */
	readonly max?: number
	/** El campo de `useForm` (`form.field('x')`): su `id`, su `name`, su valor, `aria-invalid` y `aria-describedby`. */
	readonly field?: SelectField<ComboboxModel<T, Multiple>>
}

/** The props as the controller reads them: the field's value of any type. */
export type ComboboxSettings<T> = Omit<UIComboboxProps<T, boolean>, 'field'> & {
	readonly field?: Omit<SelectField<unknown>, 'value'> & { readonly value: { value: unknown } }
}
