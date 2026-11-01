/**
 * Textos que los componentes de `@meekojs/ui` pintan por su cuenta, sin que los pase la aplicación.
 * El paquete los trae en español e inglés; `ui.messages` los sobrescribe o añade otros idiomas, y
 * una prop o un snippet del componente siempre ganan sobre ellos.
 *
 * @since 0.2.0
 * @example
 * ```ts
 * import type { UIMessages } from '@meekojs/ui'
 *
 * const empty: UIMessages['table']['empty'] = 'Nothing here yet.'
 * ```
 */
export interface UIMessages {
	/** `<UIModal>`. */
	readonly modal: {
		/** `aria-label` del botón de cierre, si no se pasa `closeLabel`. */
		readonly close: string
	}
	/** `<UITable>`. */
	readonly table: {
		/** Mensaje sin filas, si no se pasa `emptyText` ni el snippet `empty`. */
		readonly empty: string
	}
	/** `<UISelect>`. */
	readonly select: {
		/** Mensaje sin opciones, si no se pasa el snippet `empty`. */
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
}

/**
 * Lo que `ui.messages` sobrescribe en un idioma: cualquier sección y cualquiera de sus textos. Lo que
 * falta se toma del idioma base (`pt` para `pt-BR`), de `ui.locale` y, por último, del español.
 *
 * @since 0.2.0
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
