import type { ReadonlySignal, Signal } from "../../../core/reactivity.js";
import type { PopoverPlacement } from "../MeekoPopover/types.js";
/**
 * Valor del modelo de `<MeekoSelect>`: la opción elegida o `null` y, con `multiple`, un array de
 * opciones. Se infiere del tipo de `options` y de `multiple`.
 * @since 1.5.0
 * @example
 * ```ts
 * const color = signal<SelectModel<string, false>>(null); // string | null
 * const tags = signal<SelectModel<string, true>>([]);      // string[]
 * ```
 */
export type SelectModel<T, Multiple extends boolean = false> = Multiple extends true ? T[] : T | null;

/**
 * Estado de una opción, el segundo parámetro del snippet `option`.
 * @since 1.5.0
 * @example
 * ```html
 * <snippet name="option" params="user, state">{user.name} <span if:when="state.selected">✓</span></snippet>
 * ```
 */
export interface SelectOptionState {
  /** La opción está elegida. */
  readonly selected: boolean;
  /** Es la opción activa del teclado (`aria-activedescendant`). */
  readonly active: boolean;
  /** No se puede elegir: está deshabilitada o se alcanzó `max`. */
  readonly disabled: boolean;
}

/**
 * Lo que recibe una función `filter` de `<MeekoSelect>` además del texto buscado.
 * @since 1.5.0
 * @example
 * ```ts
 * const search: SelectFilter<User> = (query, { signal }) => api.users.get({ query: { q: query }, signal });
 * ```
 */
export interface SelectFilterContext<T> {
  /** Las opciones de la prop `options`. */
  readonly options: readonly T[];
  /** Se aborta cuando llega otra búsqueda o se cierra el componente: pásela a `fetch`. */
  readonly signal: AbortSignal;
}

/**
 * Búsqueda propia de `<MeekoSelect searchable>`: recibe el texto (nunca vacío; con la búsqueda
 * vacía se muestran `options`) y devuelve las opciones que se muestran, o una promesa de ellas para
 * buscar en el servidor. Mientras la promesa no resuelve, el componente está cargando
 * (`data-loading`, `aria-busy` y el snippet `loading`).
 * @since 1.5.0
 * @example
 * ```ts
 * const byPrefix: SelectFilter<string> = (query, { options }) => options.filter((option) => option.startsWith(query));
 * ```
 */
export type SelectFilter<T> = (query: string, context: SelectFilterContext<T>) => readonly T[] | PromiseLike<readonly T[]>;

/**
 * Snippets de `<MeekoSelect>`, tipados con el tipo de sus opciones.
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoSelect model="user" bind:options="users.value" by="id">
 *   <snippet name="option" params="user, state">{user.name}</snippet>
 *   <snippet name="value" params="user">{user.name}</snippet>
 *   <snippet name="empty">Nadie con ese nombre</snippet>
 * </MeekoSelect>
 * ```
 */
export interface SelectSnippets<T> {
  /** Contenido de cada opción de la lista; sin él, su etiqueta. */
  option?: [option: T, state: SelectOptionState];
  /** Cómo se muestra cada valor elegido en el disparador; sin él, las etiquetas separadas por comas. */
  value?: [option: T];
  /** Encabezado de un grupo de `groupBy`; sin él, su nombre. */
  group?: [name: string];
  /** Lo que se muestra cuando no hay opciones; sin él, «Sin resultados». */
  empty?: [];
  /** Lo que se muestra mientras una búsqueda asíncrona carga. */
  loading?: [];
}

/**
 * Lo que `<MeekoSelect>` lee de `form.field('x')` de `useForm`: el `id`, el `name`, la señal del
 * valor, `invalid` y `describedBy`. Un `FormField` lo cumple.
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoSelect bind:field="form.field('color')" bind:options="colors" />
 * ```
 */
export interface SelectField<Value> {
  /** `id` del disparador, para el `<label for>` del campo. */
  readonly id: string;
  /** `name` de los `<input type="hidden">`. */
  readonly name: string;
  /** La señal del campo, que sustituye al modelo. */
  readonly value: Signal<Value>;
  /** `true` si el campo tiene un error: `aria-invalid="true"`. */
  readonly invalid: ReadonlySignal<boolean>;
  /** `aria-describedby` del disparador, el mensaje de error mientras lo hay. */
  readonly describedBy: ReadonlySignal<string | undefined>;
}

/** Clave de texto de un tipo de objeto; `never` para un primitivo. */
type SelectKey<T> = T extends object ? keyof T & string : never;

/**
 * Props de la etiqueta propia `<MeekoSelect>`, un select accesible sobre `<MeekoPopover>`. `T` es
 * el tipo de cada opción y `Multiple`, si se eligen varias; los dos se infieren de la etiqueta. Se
 * autoimporta en `app/`.
 * @since 1.5.0
 * @example
 * ```html
 * <MeekoSelect model="color" bind:options="colors" placeholder="Elige un color" name="color" />
 * <MeekoSelect model="tags" multiple searchable bind:options="tags" groupBy="category" bind:max="3" />
 * ```
 */
export interface MeekoSelectProps<T, Multiple extends boolean = false> {
  /** Las opciones, primitivos u objetos. Es reactiva: una lista nueva actualiza la lista abierta. */
  readonly options: readonly T[];
  /** Con `true`, el modelo es un array y cada opción se alterna. */
  readonly multiple?: Multiple;
  /** Cómo se comparan las opciones con el valor: una clave (`by="id"`) o una función; por defecto, `Object.is`. */
  readonly by?: SelectKey<T> | ((a: T, b: T) => boolean);
  /** Etiqueta de cada opción: una clave o una función; por defecto, el texto del primitivo o `label`/`name` del objeto. */
  readonly labelBy?: SelectKey<T> | ((option: T) => string);
  /** Qué opciones están deshabilitadas: una clave o una función; por defecto, las que tienen `disabled: true`. */
  readonly disabledBy?: SelectKey<T> | ((option: T) => boolean);
  /** Grupo de cada opción, con un encabezado por grupo: una clave (`groupBy="category"`) o una función. */
  readonly groupBy?: SelectKey<T> | ((option: T) => string | undefined);
  /** Texto del disparador sin valor elegido. */
  readonly placeholder?: string;
  /** `name` de los `<input type="hidden">` que se envían con el `<form>`, uno por valor. */
  readonly name?: string;
  /** Exige un valor al enviar el `<form>`. */
  readonly required?: boolean;
  /** Deshabilita el disparador; los `<input type="hidden">` no se envían. */
  readonly disabled?: boolean;
  /** Convierte el disparador en un combobox con `<input>` que filtra las opciones. */
  readonly searchable?: boolean;
  /** Búsqueda propia, síncrona o asíncrona; por defecto, la etiqueta contiene el texto, sin distinguir acentos ni mayúsculas. */
  readonly filter?: SelectFilter<T>;
  /** Con `multiple`, cuántas opciones se pueden elegir como mucho. */
  readonly max?: number;
  /** El campo de `useForm` (`form.field('x')`): su `id`, su `name`, su valor, `aria-invalid` y `aria-describedby`. */
  readonly field?: SelectField<SelectModel<T, Multiple>>;
  /** `id` del disparador, para un `<label for>`; por defecto, el del campo o uno de `useId`. */
  readonly id?: string;
  /** `aria-label` del disparador y de la lista, sin `<label>`. */
  readonly label?: string;
  /** `aria-describedby` del disparador. */
  readonly describedBy?: string;
  /** Marca el disparador con `aria-invalid="true"`. */
  readonly invalid?: boolean;
  /** Clases del elemento raíz. */
  readonly class?: string;
  /** Clases de la lista, el elemento con `popover`. */
  readonly listClass?: string;
  /** Dónde se abre la lista; `"bottom-start"` por defecto. */
  readonly placement?: PopoverPlacement;
  /** Separación en píxeles entre el disparador y la lista. */
  readonly offset?: number;
}

/** The props as the controller reads them: the field's value of any type. */
export type SelectSettings<T> = Omit<MeekoSelectProps<T, boolean>, "field"> & {
  readonly field?: Omit<SelectField<unknown>, "value"> & { readonly value: { value: unknown } };
};

/** An option as the list renders it. */
export interface SelectEntry<T> {
  readonly option: T;
  /** Position in the list as shown, grouped: the index that the keyboard moves. */
  readonly index: number;
  readonly key: string;
  readonly id: string;
  readonly label: string;
  readonly disabled: boolean;
}

/** A group of the list; the one of the options without a group has no name. */
export interface SelectGroup<T> {
  readonly key: string;
  readonly name: string | undefined;
  readonly id: string | undefined;
  readonly entries: readonly SelectEntry<T>[];
}

