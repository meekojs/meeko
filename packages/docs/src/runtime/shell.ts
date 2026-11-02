import type { PublicAnnouncement } from 'meeko-docs-content/moderation/shared'

/**
 * Un enlace de la barra lateral de `<DocsShell>`.
 *
 * @example
 * ```ts
 * const item: DocsShellNavigationItem = { label: 'useSignal', href: '/reference/use-signal', code: true }
 * ```
 */
export interface DocsShellNavigationItem {
	/** Texto del enlace. */
	readonly label: string
	/** Destino, ya localizado. */
	readonly href: string
	/** Descripción de la página; `<DocsSiteShell>` filtra también por ella. */
	readonly description?: string
	/** Trazo SVG del icono, en una rejilla de 16 por 16. */
	readonly icon?: string
	/** El texto es código: se pinta en monoespaciada. */
	readonly code?: boolean
	/** Añade la etiqueta de destacado. */
	readonly featured?: boolean
	/** Otras rutas para las que este enlace también es el actual. */
	readonly aliases?: readonly string[]
}

/**
 * Lo que `<DocsShell>` pinta: sólo datos ya resueltos. El Shell no lee la base de datos, ni la moderación,
 * ni las rutas; cada web construye su vista: `<DocsSiteShell>` en UI e i18n, y un adaptador del snapshot en el
 * framework. Lo que el lector cambia sale en eventos (`queryChange`, `dismissAnnouncement`, `stayLocale`).
 *
 * @example
 * ```ts
 * const view: DocsShellView = {
 * 	product: { name: 'UI', packageName: '@meekojs/ui', repository: 'https://github.com/meekojs/meeko', homeHref: '/' },
 * 	current: '/installation',
 * 	navigation: [{ title: 'Empezar', items: [{ label: 'Instalación', href: '/installation' }] }],
 * 	locale: { requested: 'es', content: 'es', fallback: false },
 * 	locales: [{ code: 'es', label: 'Español', href: '/installation', current: true }],
 * 	announcements: [],
 * 	search: { mode: 'filter', query: '' },
 * }
 * ```
 */
export interface DocsShellView {
	/** Identidad de la web y enlaces de la cabecera. */
	readonly product: {
		/** Nombre del producto, tras «Meeko» en la marca. */
		readonly name: string
		/** Paquete npm, enlazado bajo la navegación. */
		readonly packageName?: string
		/** URL del repositorio. */
		readonly repository: string
		/** Portada, ya localizada. */
		readonly homeHref: string
		/** Marca que sustituye a «Meeko» más el producto, como en la web del framework. */
		readonly brandName?: string
		/** Enlaces principales de la cabecera. */
		readonly links?: readonly { readonly label: string; readonly href: string }[]
	}
	/** Ruta actual, para marcar su enlace. */
	readonly current: string
	/** Grupos de la barra lateral, ya filtrados y moderados. */
	readonly navigation: readonly { readonly title: string; readonly icon?: string; readonly items: readonly DocsShellNavigationItem[] }[]
	/** Índice de la página, en la columna lateral y plegable en pantallas estrechas. */
	readonly toc?: readonly { readonly id: string; readonly text: string; readonly level: number }[]
	/** Página anterior y siguiente. */
	readonly pager?: {
		readonly previous?: { readonly label: string; readonly href: string }
		readonly next?: { readonly label: string; readonly href: string }
	}
	/** Enlace para editar la página y ruta de su fuente en el repositorio. */
	readonly edit?: { readonly href: string; readonly source: string }
	/** Idioma pedido y el del contenido. Con `fallback`, el Shell avisa y marca el contenido con su `lang`. */
	readonly locale: {
		readonly requested: string
		readonly content: string
		readonly fallback: boolean
		/** Enlace al original, en la nota de una página sin traducir. */
		readonly originalHref?: string | undefined
		/** Idioma que se sugiere al lector, calculado tras hidratar; sin él no hay sugerencia. */
		readonly suggested?: string | undefined
	}
	/** Esta página en cada idioma; con menos de dos no se pinta el selector. */
	readonly locales: readonly { readonly code: string; readonly label: string; readonly href: string; readonly current: boolean }[]
	/** Avisos, bajo la cabecera. */
	readonly announcements: readonly PublicAnnouncement[]
	/**
	 * Búsqueda. `filter` pinta el filtro de la barra lateral con `query` y emite `queryChange`; `dialog`
	 * pinta en la cabecera el snippet `searchResults`, donde la web monta su `<UICommandPalette>`.
	 */
	readonly search?: { readonly mode: 'filter' | 'dialog'; readonly query: string }
}
