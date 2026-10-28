/**
 * `<MeekoSelect>`: what `MeekoSelect.meeko` needs besides its template. The pure helpers (labels,
 * comparison with `by`, search with accents removed, grouping, selection with `max`) are tested on
 * their own; `createSelect` keeps the state that the template renders, the same in SSR and
 * hydration, and attaches the keyboard and the pointer in the browser.
 */
import { computed, effect, onCleanup, signal, untrack } from "../reactivity.js";
import type { ReadonlySignal, Signal } from "../reactivity.js";
import { adoptStyle, createTypeahead, listKeyTarget, normalizeText, typeaheadIndex, typeaheadKey } from "./popover.js";
import type { PopoverPlacement } from "./popover.js";

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

/** A value of the record of an object option, or `undefined`. */
function field(option: unknown, key: string): unknown {
  return option !== null && typeof option === "object" ? (option as Record<string, unknown>)[key] : undefined;
}

/** The label of an option: `labelBy`, the text of a primitive, or `label`/`name` of an object. */
export function selectLabel<T>(option: T, labelBy?: SelectSettings<T>["labelBy"]): string {
  if (typeof labelBy === "function") return labelBy(option);
  if (typeof labelBy === "string") return String(field(option, labelBy) ?? "");
  if (option === null || typeof option !== "object") return String(option ?? "");
  const named = field(option, "label") ?? field(option, "name");
  return named === undefined ? String(option) : String(named);
}

/** Whether two options are the same for `by`. */
export function sameOption<T>(a: T, b: T, by?: SelectSettings<T>["by"]): boolean {
  if (typeof by === "function") return by(a, b);
  if (typeof by === "string") return a !== null && b !== null && typeof a === "object" && typeof b === "object" ? Object.is(field(a, by), field(b, by)) : Object.is(a, b);
  return Object.is(a, b);
}

/** The value of an option in a hidden input: its `by` key, the primitive, or its label. */
export function selectValue<T>(option: T, settings: Pick<SelectSettings<T>, "by" | "labelBy">): string {
  if (typeof settings.by === "string" && option !== null && typeof option === "object") return String(field(option, settings.by) ?? "");
  if (option === null || typeof option !== "object") return String(option ?? "");
  return selectLabel(option, settings.labelBy);
}

/** Whether an option is disabled: `disabledBy`, or `disabled: true` on an object. */
export function selectDisabled<T>(option: T, disabledBy?: SelectSettings<T>["disabledBy"]): boolean {
  if (typeof disabledBy === "function") return disabledBy(option);
  return field(option, typeof disabledBy === "string" ? disabledBy : "disabled") === true;
}

/** The group of an option for `groupBy`, or `undefined`. */
export function selectGroupOf<T>(option: T, groupBy?: SelectSettings<T>["groupBy"]): string | undefined {
  if (typeof groupBy === "function") return groupBy(option);
  if (typeof groupBy !== "string") return undefined;
  const value = field(option, groupBy);
  return value === undefined || value === null ? undefined : String(value);
}

/** The default search: the label contains the query, without accents or case. */
export function defaultSelectFilter<T>(options: readonly T[], query: string, label: (option: T) => string): T[] {
  const wanted = normalizeText(query.trim());
  return wanted ? options.filter((option) => normalizeText(label(option)).includes(wanted)) : [...options];
}

/**
 * The options grouped as the list shows them: the groups in the order their first option appears,
 * each with its options in order, and every option with its position in that order.
 */
export function groupOptions<T>(options: readonly T[], settings: Pick<SelectSettings<T>, "groupBy" | "labelBy" | "disabledBy">, listboxId: string): SelectGroup<T>[] {
  const groups = new Map<string, { name: string | undefined; options: T[] }>();
  for (const option of options) {
    const name = selectGroupOf(option, settings.groupBy);
    const key = name === undefined ? "" : `g:${name}`;
    const group = groups.get(key) ?? { name, options: [] };
    group.options.push(option);
    groups.set(key, group);
  }
  let index = 0;
  let count = 0;
  return [...groups].map(([key, group]) => {
    const groupIndex = count++;
    return {
      key: key || "-",
      name: group.name,
      id: group.name === undefined ? undefined : `${listboxId}-g${groupIndex}`,
      entries: group.options.map((option): SelectEntry<T> => {
        const position = index++;
        return {
          option, index: position, key: String(position), id: `${listboxId}-${position}`,
          label: selectLabel(option, settings.labelBy), disabled: selectDisabled(option, settings.disabledBy),
        };
      }),
    };
  });
}

/**
 * The selection after choosing `option`: the option itself in a single select; in a multiple one,
 * the list without it if it was chosen, or with it at the end unless `max` is reached. `undefined`
 * when nothing changes.
 */
export function toggleSelection<T>(selected: readonly T[], option: T, options: { multiple: boolean; max?: number | undefined; by?: SelectSettings<T>["by"] }): T[] | undefined {
  const chosen = selected.some((value) => sameOption(value, option, options.by));
  if (!options.multiple) return chosen && selected.length === 1 ? undefined : [option];
  if (chosen) return selected.filter((value) => !sameOption(value, option, options.by));
  if (options.max !== undefined && selected.length >= options.max) return undefined;
  return [...selected, option];
}

/** Rules of `<MeekoSelect>` that the page adds once, in the `meeko` cascade layer: a list that scrolls. */
export const selectStyle = "@layer meeko{[data-meeko-select] [data-meeko-popover]{max-height:min(20rem,60vh);overflow:auto;box-sizing:border-box}}";

/** Whether a value is a promise or another thenable. */
function thenable<T>(value: unknown): value is PromiseLike<T> {
  return value !== null && (typeof value === "object" || typeof value === "function") && typeof (value as { then?: unknown }).then === "function";
}

/** What the template of `<MeekoSelect>` reads and the component runs. */
export function createSelect<T>(props: SelectSettings<T>, model: Signal<unknown>, id: string, emit: (value: unknown) => void) {
  const listboxId = `${id}-listbox`;
  const triggerId = computed(() => props.id ?? props.field?.id ?? `${id}-trigger`);
  const multiple = computed(() => props.multiple === true);
  /** The signal that holds the value: the form field's, or the model. */
  const target = (): { value: unknown } => props.field?.value ?? model;
  const open = signal(false);
  const active = signal(-1);
  const query = signal("");
  const typing = signal(false);
  const results = signal<readonly T[] | null>(null);
  const loading = signal(false);
  /** A required select that the form found empty, until it gets a value. */
  const failed = signal(false);

  const label = (option: T): string => selectLabel(option, props.labelBy);
  const selected = computed((): readonly T[] => {
    const value = target().value;
    if (Array.isArray(value)) return value as T[];
    if (value === null || value === undefined) return [];
    // `""`, the usual initial value of a form field, is no choice unless an option is `""`.
    if (value === "" && !props.options.some((option) => sameOption(option, "" as T, props.by))) return [];
    return [value as T];
  });
  const shown = computed(() => results.value ?? props.options);
  const groups = computed(() => groupOptions(shown.value, props, listboxId));
  const entries = computed(() => groups.value.flatMap((group) => group.entries));
  const atMax = computed(() => multiple.value && props.max !== undefined && selected.value.length >= props.max);
  const isSelected = (entry: SelectEntry<T>): boolean => selected.value.some((value) => sameOption(value, entry.option, props.by));
  const isBlocked = (entry: SelectEntry<T>): boolean => entry.disabled || (atMax.value && !isSelected(entry));
  const stateOf = (entry: SelectEntry<T>): SelectOptionState => ({ selected: isSelected(entry), active: active.value === entry.index, disabled: isBlocked(entry) });
  const selectedEntries = computed(() => selected.value.map((option, index) => ({ option, key: `${index}:${selectValue(option, props)}`, label: label(option) })));
  const valueText = computed(() => selected.value.map(label).join(", "));
  const inputText = computed(() => typing.value ? query.value : multiple.value ? "" : valueText.value);
  const activeId = computed(() => open.value && active.value >= 0 ? entries.value[active.value]?.id : undefined);
  const hiddenValues = computed(() => props.name === undefined && props.field === undefined ? []
    : multiple.value ? selected.value.map((option) => selectValue(option, props))
    : [selected.value[0] === undefined ? "" : selectValue(selected.value[0], props)]);
  const name = computed(() => props.name ?? props.field?.name);
  const invalid = computed(() => props.invalid === true || props.field?.invalid.value === true || (failed.value && selected.value.length === 0) ? "true" : undefined);
  const describedBy = computed(() => props.describedBy ?? props.field?.describedBy.value);

  /** The first option that is not disabled, from `from` in a direction; `-1` if none. */
  const firstEnabled = (from = 0, direction: 1 | -1 = 1): number => {
    const list = entries.value;
    for (let index = from; index >= 0 && index < list.length; index += direction) if (!list[index]!.disabled) return index;
    return -1;
  };
  const selectedIndex = (): number => entries.value.findIndex((entry) => isSelected(entry) && !entry.disabled);

  // The list closes: no active option, no search. It opens: the chosen option, or the first.
  effect(() => {
    const isOpen = open.value;
    untrack(() => {
      if (!isOpen) {
        if (active.value !== -1) active.value = -1;
        if (typing.value) typing.value = false;
        if (query.value) query.value = "";
      } else if (active.value < 0) {
        const chosen = selectedIndex();
        active.value = chosen >= 0 ? chosen : firstEnabled();
      }
    });
  });
  // A search moves the active option to the first result.
  effect(() => {
    const list = entries.value;
    untrack(() => {
      if (!open.value) return;
      if (typing.value || active.value >= list.length) active.value = firstEnabled();
    });
  });
  // The search: nothing with an empty query, the default filter, or the component's own, perhaps async.
  let controller: AbortController | undefined;
  effect(() => {
    const wanted = typing.value ? query.value.trim() : "";
    const options = props.options;
    const filter = props.filter;
    untrack(() => {
      controller?.abort();
      controller = undefined;
      if (!wanted) {
        results.value = null;
        loading.value = false;
        return;
      }
      if (!filter) {
        results.value = defaultSelectFilter(options, wanted, label);
        return;
      }
      const current = new AbortController();
      controller = current;
      const found = filter(wanted, { options, signal: current.signal });
      if (!thenable<readonly T[]>(found)) {
        results.value = found;
        loading.value = false;
        return;
      }
      loading.value = true;
      Promise.resolve(found).then((list) => {
        if (current.signal.aborted) return;
        results.value = list;
        loading.value = false;
      }, (error: unknown) => {
        if (current.signal.aborted) return;
        loading.value = false;
        results.value = [];
        queueMicrotask(() => { throw error; });
      });
    });
  });
  onCleanup(() => controller?.abort());

  const openList = (where: "selected" | "first" | "last" = "selected"): void => {
    if (props.disabled) return;
    if (where !== "selected") active.value = where === "first" ? firstEnabled() : firstEnabled(entries.value.length - 1, -1);
    open.value = true;
  };
  const close = (): void => {
    open.value = false;
  };
  const choose = (index: number): void => {
    const entry = entries.value[index];
    if (!entry || isBlocked(entry)) return;
    const next = toggleSelection(selected.value, entry.option, { multiple: multiple.value, max: props.max, by: props.by });
    if (next) {
      const value = multiple.value ? next : next[0] ?? null;
      target().value = value;
      failed.value = false;
      emit(value);
    }
    if (multiple.value) {
      if (typing.value) { typing.value = false; query.value = ""; }
      active.value = entries.value.findIndex((candidate) => candidate.key === entry.key);
    } else close();
  };

  const typeahead = createTypeahead();
  /** Enter or Space handled by the key: the click that the button would also fire is not a toggle. */
  let keyClick = false;
  const keydown = (event: KeyboardEvent): void => {
    if (props.disabled) return;
    const key = event.key;
    const searchable = props.searchable === true;
    if (!open.value) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || (key === " " && !searchable)) {
        event.preventDefault();
        keyClick = key === "Enter" || key === " ";
        openList(key === "ArrowUp" && selected.value.length === 0 ? "last" : "selected");
      } else if (!searchable && (key === "Home" || key === "End")) {
        event.preventDefault();
        openList(key === "Home" ? "first" : "last");
      } else if (!searchable && typeaheadKey(event)) {
        const index = typeaheadIndex(entries.value.map((entry) => entry.label), typeahead.push(key), selectedIndex(), (candidate) => entries.value[candidate]!.disabled);
        openList();
        if (index >= 0) active.value = index;
      }
      return;
    }
    if (key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (key === "Tab") {
      close();
      return;
    }
    if (key === "Enter" || (key === " " && !searchable)) {
      event.preventDefault();
      keyClick = true;
      if (active.value >= 0) choose(active.value);
      return;
    }
    if (key === "ArrowUp" && event.altKey) {
      event.preventDefault();
      if (active.value >= 0 && !multiple.value) choose(active.value);
      else close();
      return;
    }
    if (searchable && (key === "Home" || key === "End")) return;
    const target = listKeyTarget(key, active.value, entries.value.length, (index) => entries.value[index]!.disabled, false);
    if (target !== undefined) {
      event.preventDefault();
      if (target >= 0) active.value = target;
      return;
    }
    if (!searchable && typeaheadKey(event)) {
      const index = typeaheadIndex(entries.value.map((entry) => entry.label), typeahead.push(key), active.value, (candidate) => entries.value[candidate]!.disabled);
      if (index >= 0) active.value = index;
    }
  };
  const keyup = (event: KeyboardEvent): void => {
    // A button fires its click on the keyup of Space: the keydown already handled it.
    if (event.key === " " && keyClick) event.preventDefault();
    if (event.key === " " || event.key === "Enter") queueMicrotask(() => { keyClick = false; });
  };
  const triggerClick = (): void => {
    if (keyClick) { keyClick = false; return; }
    if (open.value) close();
    else openList();
  };
  const inputClick = (): void => {
    if (!open.value) openList();
  };
  const input = (event: Event): void => {
    query.value = (event.currentTarget as HTMLInputElement).value;
    typing.value = true;
    openList();
  };
  const optionOf = (event: Event): number | undefined => {
    const option = (event.target as Element | null)?.closest?.("[role=option]");
    const index = option?.getAttribute("data-index");
    return index === null || index === undefined ? undefined : Number(index);
  };
  /** A press on the list keeps the focus on the trigger or the input, as `aria-activedescendant` needs. */
  const keepFocus = (event: Event): void => event.preventDefault();
  const optionClick = (event: Event): void => {
    const index = optionOf(event);
    if (index !== undefined) choose(index);
  };
  const optionHover = (event: Event): void => {
    const index = optionOf(event);
    if (index !== undefined && index !== active.value && !entries.value[index]?.disabled) active.value = index;
  };
  /** The required input found no value: the trigger shows the error and takes the focus. */
  const reportInvalid = (event: Event): void => {
    event.preventDefault();
    failed.value = true;
    const root = (event.currentTarget as Element).closest("[data-meeko-select]");
    root?.querySelector<HTMLElement>("[data-meeko-select-trigger]")?.focus();
  };

  /** In the browser: the list's style, dismissal outside the component and the active option in view. */
  const mount = (root: HTMLElement | null): (() => void) => {
    if (!root) return () => {};
    const document = root.ownerDocument;
    adoptStyle(document, "select", selectStyle);
    // Nodes of this document; `instanceof Node` would need the global of its window.
    const node = (target: EventTarget | null): Node | undefined => target !== null && typeof (target as Node).nodeType === "number" ? target as Node : undefined;
    const outside = (event: Event): void => {
      const target = node(event.target);
      if (open.value && target && !root.contains(target)) close();
    };
    const focusout = (event: Event): void => {
      const next = node((event as FocusEvent).relatedTarget);
      if (open.value && next && !root.contains(next)) close();
    };
    document.addEventListener("pointerdown", outside, true);
    root.addEventListener("focusout", focusout);
    const stop = effect(() => {
      const current = activeId.value;
      if (current === undefined) return;
      const option = document.getElementById(current);
      if (option && typeof option.scrollIntoView === "function") option.scrollIntoView({ block: "nearest" });
    });
    return () => {
      stop();
      document.removeEventListener("pointerdown", outside, true);
      root.removeEventListener("focusout", focusout);
      typeahead.clear();
    };
  };

  return {
    listboxId, triggerId, multiple, open, active, loading, groups, entries, selected, selectedEntries, valueText, inputText, activeId,
    hiddenValues, name, invalid, describedBy, isSelected, isBlocked, stateOf, keydown, keyup, triggerClick, inputClick, input,
    keepFocus, optionClick, optionHover, reportInvalid, mount, openList, close, choose,
  };
}
