/**
 * Textos que los componentes de `@meekojs/ui` pintan por su cuenta, sin que los pase la aplicación.
 * El paquete los trae en español e inglés; `ui.messages` los sobrescribe o añade otros idiomas, y
 * una prop o un snippet del componente siempre ganan sobre ellos.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import type { UIMessages } from '@meekojs/ui'
 *
 * const empty: UIMessages['table']['empty'] = 'Nothing here yet.'
 * ```
 */
export interface UIMessages {
	/** Avisos, notificaciones y estados vacíos o de carga. */
	readonly feedback: {
		/** Nombre accesible de los botones de cierre. */
		readonly close: string
		/** Título de estado vacío. */
		readonly empty: string
		/** Nombre accesible de carga. */
		readonly loading: string
	}
	/** `<UIModal>`. */
	readonly modal: {
		/** `aria-label` del botón de cierre, si no se pasa `closeLabel`. */
		readonly close: string
		/**
		 * Botón que acepta en `useModal().confirm()`, si no se pasa `confirmLabel`.
		 *
		 * @since 1.10.0
		 */
		readonly confirm: string
		/**
		 * Botón que rechaza en `useModal().confirm()`, si no se pasa `cancelLabel`.
		 *
		 * @since 1.10.0
		 */
		readonly cancel: string
	}
	/** `<UITable>`. */
	readonly table: {
		/** Mensaje sin filas, si no se pasa `emptyText` ni el snippet `empty`. */
		readonly empty: string
	}
	/** `<UISelect>` y `<UICombobox>`. */
	readonly select: {
		/** `<UICombobox>`: mensaje sin opciones, si no se pasa el snippet `empty`. */
		readonly empty: string
		/** `aria-label` del botón de `clearable`, si no se pasa `clearLabel`. */
		readonly clear: string
	}
	/** `<UIThemeToggle>`. */
	readonly themeToggle: {
		/** Nombre de cada elección (`light`, `dark`, `system` o un tema propio), si no se pasa `labels`. */
		readonly labels: Readonly<Record<string, string>>
		/** `aria-label` del botón cuando el HTML no conoce la elección. */
		readonly unknown: string
		/** `aria-label` del grupo de radios. */
		readonly group: string
		/**
		 * `aria-label` del botón: `{current}` y `{next}` son las etiquetas de la elección y de la
		 * siguiente, en minúsculas. `messages.cycle`, la prop, las recibe tal cual.
		 */
		readonly cycle: string
	}
	/** `<UIPage>`. */
	readonly page: {
		/** Texto del enlace para saltar al contenido, si no se pasa `skipLabel`. */
		readonly skip: string
	}
	/** `<UIHeader>`. */
	readonly header: {
		/** `aria-label` de la navegación principal, si no se pasa `label`. */
		readonly label: string
		/** `aria-label` del botón del menú en pantallas estrechas, si no se pasa `menuLabel`. */
		readonly menu: string
	}
	/** `<UIFooter>`. */
	readonly footer: {
		/** `aria-label` de la navegación del pie, si no se pasa `label`. */
		readonly label: string
	}
	/** `<UIDrawer>`. */
	readonly drawer: {
		/** `aria-label` del botón de cierre, si no se pasa `closeLabel`. */
		readonly close: string
	}
	/** `<UINavigationTree>`. */
	readonly navigationTree: {
		/** `aria-label` de la navegación, si no se pasa `label`. */
		readonly label: string
		/** Etiqueta de un elemento con `featured`, si no se pasa `featuredLabel`. */
		readonly featured: string
		/** Mensaje sin grupos, si no se pasa `emptyText` ni el snippet `empty`. */
		readonly empty: string
	}
	/** `<UINavigationTabs>`. */
	readonly navigationTabs: {
		/** `aria-label` de la navegación, si no se pasa `label`. */
		readonly label: string
	}
	/** `<UIBreadcrumb>`. */
	readonly breadcrumb: {
		/** `aria-label` de la ruta, si no se pasa `label`. */
		readonly label: string
	}
	/** `<UIPageNavigation>`. */
	readonly pageNavigation: {
		/** `aria-label` de la navegación, si no se pasa `label`. */
		readonly label: string
		/** Texto sobre el enlace anterior, si no se pasa `previousLabel`. */
		readonly previous: string
		/** Texto sobre el enlace siguiente, si no se pasa `nextLabel`. */
		readonly next: string
	}
	/** `<UIPagination>`. */
	readonly pagination: {
		/** `aria-label` de la navegación, si no se pasa `label`. */
		readonly label: string
		/** Recuento con `shown` y `total`: `{shown}` y `{total}` son los números ya formateados. */
		readonly count: string
		/** Recuento sólo con `total`: `{total}` es el número ya formateado. */
		readonly total: string
		/** Texto de la acción, si no se pasa `loadMoreLabel`. */
		readonly loadMore: string
		/** Texto de la acción con `busy`, si no se pasa `loadingLabel`. */
		readonly loading: string
		/**
		 * Modo numerado: recuento con `total` y `pageSize`; `{from}`, `{to}` y `{total}` son los números ya formateados.
		 *
		 * @since 1.10.0
		 */
		readonly range: string
		/**
		 * Modo numerado: nombre accesible del botón o enlace de una página; `{page}` es su número ya formateado.
		 *
		 * @since 1.10.0
		 */
		readonly page: string
		/**
		 * Modo numerado: nombre accesible de la página anterior.
		 *
		 * @since 1.10.0
		 */
		readonly previous: string
		/**
		 * Modo numerado: nombre accesible de la página siguiente.
		 *
		 * @since 1.10.0
		 */
		readonly next: string
		/**
		 * Modo numerado con `edges`: nombre accesible de la primera página.
		 *
		 * @since 1.10.0
		 */
		readonly first: string
		/**
		 * Modo numerado con `edges`: nombre accesible de la última página.
		 *
		 * @since 1.10.0
		 */
		readonly last: string
	}
	/** `<UITableOfContents>`. */
	readonly tableOfContents: {
		/** Título y `aria-label` del índice, si no se pasa `label`. */
		readonly label: string
	}
	/** `<UILocaleSwitcher>` y `<UILocaleSuggestion>`. */
	readonly language: {
		/** `aria-label` del selector, si no se pasa `label`. */
		readonly label: string
		/** `aria-label` de la sugerencia, en el idioma que ofrece. */
		readonly suggestion: string
		/** Texto de la sugerencia, en el idioma que ofrece: `{language}` es la etiqueta de ese idioma. */
		readonly message: string
		/** Enlace de la sugerencia, en el idioma que ofrece: `{language}` es la etiqueta de ese idioma. */
		readonly go: string
		/** Botón para quedarse, en el idioma actual: `{language}` es la etiqueta de ese idioma. */
		readonly stay: string
	}
	/** `<UICodeBlock>` y los bloques de código dentro de `<UIProse>`. */
	readonly code: {
		/** Nombre accesible del bloque sin `label` ni `lang`. */
		readonly label: string
		/** Nombre accesible del registro en `mode="log"` sin `label`. */
		readonly log: string
		/** Texto del botón de copiar, si no se pasa `copyLabel`. */
		readonly copy: string
		/** Texto tras copiar, si no se pasa `copiedLabel`. */
		readonly copied: string
		/** Texto si la copia falla, si no se pasa `copyFailedLabel`. */
		readonly copyFailed: string
		/** Veredicto `good`, si no se pasa `verdictLabel`. */
		readonly good: string
		/** Veredicto `bad`, si no se pasa `verdictLabel`. */
		readonly bad: string
	}
	/** `<UIDiff>`. */
	readonly diff: {
		/** Mensaje sin cambios, si no se pasa `emptyText`. */
		readonly empty: string
		/** Texto para lectores de pantalla ante una línea añadida, si no se pasa `lineLabels.add`. */
		readonly added: string
		/** Texto para lectores de pantalla ante una línea eliminada, si no se pasa `lineLabels.remove`. */
		readonly removed: string
	}
	/** `<UIMarkdownEditor>`, de `@meekojs/ui/editor`, con los menús de Crepe. */
	readonly markdownEditor: {
		/** Mientras llega el editor, en el marcador del primer pintado. */
		readonly loading: string
		/** `aria-label` del conmutador. */
		readonly mode: string
		readonly visual: string
		readonly code: string
		/** Documento que el modo visual no podría guardar sin reescribir bloques ajenos. */
		readonly unsafe: string
		/** El chunk del editor no se pudo cargar. */
		readonly failed: string
		/** Documento vacío, si no se pasa `placeholder`. */
		readonly placeholder: string
		readonly groupText: string
		readonly text: string
		/** Título de cada nivel del menú: se le añade el número. */
		readonly heading: string
		readonly quote: string
		readonly divider: string
		readonly groupList: string
		readonly bulletList: string
		readonly orderedList: string
		readonly taskList: string
		readonly groupAdvanced: string
		readonly codeBlock: string
		readonly table: string
		readonly bold: string
		readonly italic: string
		readonly strikethrough: string
		readonly inlineCode: string
		readonly link: string
		readonly linkPlaceholder: string
		readonly languageSearch: string
		readonly languageEmpty: string
		readonly copy: string
	}
	/** `<UICommandPalette>`. */
	readonly commandPalette: {
		/** `aria-label` del diálogo y texto del botón que lo abre, si no se pasa `label`. */
		readonly label: string
		/** `aria-label` del campo, si no se pasa `inputLabel`. */
		readonly input: string
		/** Texto de ejemplo del campo, si no se pasa `placeholder`. */
		readonly placeholder: string
		/** `aria-label` del botón de cierre, si no se pasa `closeLabel`. */
		readonly close: string
		/** Aviso antes de escribir; vacío, no se muestra nada. */
		readonly idle: string
		/** Aviso mientras se busca. */
		readonly loading: string
		/** Aviso sin resultados: `{query}` es el texto buscado. */
		readonly empty: string
		/** Aviso si la búsqueda falla. */
		readonly unavailable: string
	}
	/**
	 * `<UIHint>`.
	 *
	 * @since 1.10.0
	 */
	readonly hint: {
		/** `aria-label` del botón, si no se pasa `label`. */
		readonly label: string
	}
	/**
	 * Menú de acciones (`<UIMenu>`).
	 * @since 1.10.0
	 */
	readonly menu: {
		/** `aria-label` del disparador de sólo icono, si no se pasa `ariaLabel`. */
		readonly trigger: string
	}
	/**
	 * `<UIStat>` con `change`, `href` o `to`.
	 *
	 * @since 1.10.0
	 */
	readonly stat: {
		/** Texto accesible de una subida; `{change}` es la variación sin signo, como `12,5 %`. */
		readonly up: string
		/** Texto accesible de una bajada; `{change}` es la variación sin signo. */
		readonly down: string
		/** Texto accesible de una variación nula; admite `{change}`. */
		readonly flat: string
		/** Texto del enlace, si no se pasa `linkLabel`. */
		readonly link: string
		/** Nombre accesible del enlace con el texto por defecto: `{link}` es ese texto y `{label}`, la etiqueta del dato. */
		readonly linkName: string
	}
	/**
	 * `<UISparkline>`, también dentro de `<UIStat trend>`.
	 *
	 * @since 1.10.0
	 */
	readonly sparkline: {
		/** Resumen accesible de la serie, si no se pasa `label`: `{min}`, `{max}` y `{last}`, ya formateados. */
		readonly label: string
		/** Nombre accesible de una serie sin valores. */
		readonly empty: string
	}
	/**
	 * `<UICopyButton>`.
	 *
	 * @since 1.10.0
	 */
	readonly copyButton: {
		/** Texto o nombre accesible del botón, si no se pasa `label`. */
		readonly copy: string
		/** Texto y aviso tras copiar, si no se pasa `copiedLabel`. */
		readonly copied: string
		/** Texto y aviso si la copia falla, si no se pasa `failedLabel`. */
		readonly failed: string
	}
	/**
	 * `<UIInput type="password" reveal>`.
	 *
	 * @since 1.10.0
	 */
	readonly input: {
		/** Nombre accesible del botón que muestra la contraseña, si no se pasa `showLabel`. */
		readonly show: string
		/** Nombre accesible del botón con la contraseña a la vista, si no se pasa `hideLabel`. */
		readonly hide: string
	}
}

/**
 * Lo que `ui.messages` sobrescribe en un idioma: cualquier sección y cualquiera de sus textos. Lo que
 * falta se toma del idioma base (`pt` para `pt-BR`), de `ui.locale` y, por último, del español.
 *
 * @since 1.8.0
 * @example
 * ```ts
 * import type { UIMessageOverrides } from '@meekojs/ui'
 *
 * const fr: UIMessageOverrides = { modal: { close: 'Fermer' }, table: { empty: 'Aucune donnée.' } }
 * ```
 */
export type UIMessageOverrides = { readonly [Section in keyof UIMessages]?: Partial<UIMessages[Section]> }

/** Lo que el plugin del módulo publica para los componentes; se serializa, sólo contiene texto. */
export interface UIMessagesConfig {
	readonly locale?: string
	readonly messages?: Readonly<Record<string, UIMessageOverrides>>
}
