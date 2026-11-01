/**
 * En qué punto está la búsqueda de `<UICommandPalette>`. El componente no busca: quien lo usa cambia
 * `status` y `results` según su fuente, ya sea un índice local, Pagefind o un servidor.
 * @since 0.2.0
 * @example
 * ```ts
 * const status = signal<CommandPaletteStatus>('idle')
 * ```
 */
export type CommandPaletteStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'unavailable'

/**
 * Estado de una fila, el segundo parámetro del snippet `item`.
 * @since 0.2.0
 * @example
 * ```html
 * <snippet name="item" params="item, state"><strong if:when="state.depth === 0">{item.title}</strong></snippet>
 * ```
 */
export interface CommandPaletteItemState {
	/** Es la fila activa del teclado. */
	readonly active: boolean
	/** Nivel de la fila: `0` en `results` y `1` o más en lo que devuelve `childrenBy`. */
	readonly depth: number
	/** Posición en el orden en que se recorre: el valor del modelo `active`. */
	readonly index: number
}

/**
 * Snippets de `<UICommandPalette>`.
 * @since 0.2.0
 * @example
 * ```html
 * <UICommandPalette bind:results="found.value">
 *   <snippet name="item" params="page"><strong>{page.title}</strong><span class="meeko-ui-command-excerpt" html="page.excerpt" /></snippet>
 *   <snippet name="status" params="status, query">Nada para {query}</snippet>
 * </UICommandPalette>
 * ```
 */
export interface CommandPaletteSnippets<T> {
	/** Contenido de cada fila; sin él, su etiqueta. `<strong>` es el título, la clase `meeko-ui-command-excerpt` el extracto y `<mark>` lo encontrado. */
	item?: [item: T, state: CommandPaletteItemState]
	/** Contenido del botón que abre la paleta; recibe la tecla modificadora, `Ctrl` o `⌘`. */
	trigger?: [modifier: string]
	/** El aviso de cada estado salvo `ready`; sin él, los textos de `commandPalette` en `ui.messages`. */
	status?: [status: CommandPaletteStatus, query: string]
}

/** Clave de texto de un tipo de objeto; `never` para un primitivo. */
type CommandPaletteKey<T> = T extends object ? keyof T & string : never

/**
 * Props de `<UICommandPalette>`, un diálogo de búsqueda con teclado. No sabe de dónde salen los
 * resultados: el padre lee el modelo `query`, busca donde quiera y le pasa `results` y `status`.
 * El modelo por defecto es la apertura; `query` y `active` son modelos con nombre.
 * @since 0.2.0
 * @example
 * ```html
 * <UICommandPalette
 *   model:query="query"
 *   bind:results="results.value"
 *   bind:status="status.value"
 *   hrefBy="url"
 *   labelBy="title"
 *   childrenBy="sections"
 *   on:open="preload"
 * />
 * ```
 */
export interface UICommandPaletteProps<T> {
	/** Las filas de primer nivel, en orden. */
	readonly results: readonly T[]
	/** Estado de la búsqueda; sin él, `ready` con resultados e `idle` sin ellos. */
	readonly status?: CommandPaletteStatus
	/** Texto de cada fila: una clave o una función; por defecto, el primitivo o `label`/`name` del objeto. */
	readonly labelBy?: CommandPaletteKey<T> | ((item: T) => string)
	/** Enlace de una fila: una clave o una función. Sin él, la fila es un botón y sólo emite `choose`. */
	readonly hrefBy?: CommandPaletteKey<T> | ((item: T) => string | undefined)
	/** Filas anidadas bajo cada una, como las secciones de una página: una clave o una función. */
	readonly childrenBy?: CommandPaletteKey<T> | ((item: T) => readonly T[] | undefined)
	/** `aria-label` del diálogo y del botón que lo abre; por defecto, `commandPalette.label` de `ui.messages`. */
	readonly label?: string
	/** `aria-label` del campo; por defecto, `commandPalette.input` de `ui.messages`. */
	readonly inputLabel?: string
	/** Texto de ejemplo del campo; por defecto, `commandPalette.placeholder` de `ui.messages`. */
	readonly placeholder?: string
	/** `aria-label` del botón de cierre; por defecto, `commandPalette.close` de `ui.messages`. */
	readonly closeLabel?: string
	/** `id` del campo. */
	readonly inputId?: string
	/** `name` del campo. */
	readonly inputName?: string
	/** Con `false`, no pinta el botón que abre la paleta: se abre con el modelo o con el teclado. */
	readonly trigger?: boolean
	/** Con `false`, ni `Ctrl` o `⌘` + `K` ni `/` abren la paleta. */
	readonly shortcut?: boolean
	/** Clases del diálogo. */
	readonly class?: string
	/** Clases del botón que abre la paleta. */
	readonly triggerClass?: string
}
