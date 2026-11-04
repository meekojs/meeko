/**
 * Una pestaña de `<UITabs>`.
 * @since 1.8.0
 * @example
 * ```ts
 * const items: UITabsItem<'account' | 'team'>[] = [{ value: 'account', label: 'Cuenta' }, { value: 'team', label: 'Equipo', disabled: true }]
 * ```
 */
export interface UITabsItem<Value extends string = string> {
	/** Identifica la pestaña: es el valor del modelo y el nombre de su snippet, `panel-<value>`. */
	readonly value: Value
	/** Texto de la pestaña, salvo que el snippet `tab` pinte otra cosa. */
	readonly label: string
	/** No se puede elegir, y las flechas la saltan. */
	readonly disabled?: boolean
}

/**
 * Snippets de `<UITabs>`: `panel-<value>` es el contenido de una pestaña y `panel`, el de las que no
 * tienen el suyo. `tab` sustituye el texto de cada pestaña.
 * @since 1.8.0
 * @example
 * ```html
 * <UITabs bind:items="items"><snippet name="panel-account">Tu cuenta</snippet></UITabs>
 * ```
 */
export interface TabsSnippets<Value extends string = string> {
	/** El contenido de la pestaña con ese `value`. */
	[panel: `panel-${string}`]: []
	/** Contenido de las pestañas sin su propio `panel-<value>`. */
	panel?: [item: UITabsItem<Value>]
	/** Contenido de cada pestaña; sin él, su `label`. */
	tab?: [item: UITabsItem<Value>]
}

/**
 * Props de `<UITabs>`, pestañas que cambian un panel de la misma página: `tablist`, `tab` y `tabpanel`,
 * con flechas, `Inicio` y `Fin`. El modelo por defecto es el `value` elegido; sin él, la primera pestaña
 * habilitada. Para pestañas que cambian de ruta, usa `<UINavigationTabs>`, que son enlaces.
 * @since 1.8.0
 * @example
 * ```html
 * <UITabs model="tab" label="Ajustes" bind:items="[{ value: 'account', label: 'Cuenta' }, { value: 'team', label: 'Equipo' }]">
 *   <snippet name="panel-account">Tu cuenta</snippet>
 *   <snippet name="panel-team">Tu equipo</snippet>
 * </UITabs>
 * ```
 */
export interface UITabsProps<Value extends string = string> {
	/** Las pestañas, en orden. */
	readonly items: readonly UITabsItem<Value>[]
	/** `aria-label` de la lista de pestañas. */
	readonly label?: string
	/** `aria-labelledby` de la lista de pestañas, si un título visible ya la nombra. */
	readonly labelledBy?: string
	/** Clases del elemento raíz. */
	readonly class?: string
	/** `id` del elemento raíz. */
	readonly id?: string
}
