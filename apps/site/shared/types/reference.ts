import type { TrustedHtml } from '@meekojs/meeko'
import type { TocEntry } from './docs.js'

/** A group of the API reference as its index shows it: one per kind of symbol. */
export interface ReferenceIndexGroup {
	/** Anchor of the group in the index, such as `componentes`. */
	readonly anchor: string
	readonly title: string
	/** `d` of its 16 px stroke icon. */
	readonly icon: string
	readonly description: TrustedHtml
	/** The page of its first symbol, where the group starts. */
	readonly href: string
	readonly entries: readonly ReferenceIndexEntry[]
}

/** A symbol of the taxonomy: its page and one line about it. */
export interface ReferenceIndexEntry {
	readonly name: string
	readonly href: string
	/** One line of inline HTML without links. */
	readonly description: TrustedHtml
	/** Whether the page is written (docs/reference) or still the one generated from the JSDoc. */
	readonly written: boolean
}

/** A link of the "Relacionado" section of a written page. */
export interface ReferenceRelated {
	readonly label: string
	readonly href: string
	/** Whether the label is a symbol, shown as code, or the title of a guide. */
	readonly code: boolean
	/** One line about it, plain text; empty when there is none. */
	readonly note: string
}

/**
 * A written page of the API reference (docs/reference/<group>/<slug>.md), merged with what the
 * sources generate. Every HTML field is trusted: it comes from the repository.
 */
export interface ReferencePage {
	readonly title: string
	readonly slug: string
	readonly href: string
	readonly group: { readonly title: string; readonly href: string; readonly icon: string }
	/** Singular label of its group, such as "composable". */
	readonly kindLabel: string
	/** Plain text of `description`, for `<meta name="description">` and the lead. */
	readonly description: string
	readonly since: string | null
	readonly specifier: string | null
	readonly autoImport: TrustedHtml | null
	readonly importCode: TrustedHtml | null
	readonly sourceUrl: string | null
	readonly sourceLabel: string | null
	/** The body: the written sections with "Tipo" and "Relacionado" generated in their place. */
	readonly body: TrustedHtml
	readonly toc: readonly TocEntry[]
	readonly editUrl: string
	readonly editPath: string
}
