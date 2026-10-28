import type { TrustedHtml } from '@meekojs/meeko'
import type { TocEntry } from './docs.js'

/** What a page of the API reference documents. */
export type ApiKind = 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum' | 'macro' | 'tag' | 'directive' | 'block'

/** A link to a page of the API reference. */
export interface ApiLink {
	readonly name: string
	readonly href: string
	readonly kind: ApiKind
}

/** A symbol in the index of the reference. */
export interface ApiIndexItem extends ApiLink {
	/** First sentence of its description, as inline HTML without links. */
	readonly summary: TrustedHtml
	readonly deprecated: boolean
}

/** The symbols of a group of the index that share a kind. */
export interface ApiIndexSection {
	readonly kind: ApiKind
	/** Plural heading, such as "Funciones". */
	readonly title: string
	readonly items: readonly ApiIndexItem[]
}

/** A group of the index: the template syntax or one public subpath of the package. */
export interface ApiIndexGroup {
	readonly id: string
	readonly title: string
	/** Module specifier, such as `@meekojs/meeko/server`; `null` for the template syntax. */
	readonly specifier: string | null
	readonly description: TrustedHtml
	readonly sections: readonly ApiIndexSection[]
}

/** A parameter, type parameter or attribute, with its rendered description. */
export interface ApiParameter {
	readonly name: string
	/** HTML of its type, with links to the pages of the types; empty when it has none. */
	readonly type: TrustedHtml
	readonly optional: boolean
	readonly description: TrustedHtml
}

/** A member of a class or interface, or an attribute of a tag or directive. */
export interface ApiMember {
	readonly id: string
	readonly name: string
	/** Label such as "método" or "propiedad". */
	readonly kind: string
	/** Highlighted signature lines. */
	readonly signature: TrustedHtml
	readonly description: TrustedHtml
	readonly since: string | null
	readonly deprecated: TrustedHtml | null
	readonly flags: readonly string[]
}

/** One signature of a function, with its own description when it is an overload. */
export interface ApiSignature {
	/** Highlighted code block. */
	readonly code: TrustedHtml
	readonly description: TrustedHtml | null
}

/** A thrown error: its type and when. */
export interface ApiThrow {
	readonly type: TrustedHtml
	readonly description: TrustedHtml
}

/** A rendered page of the API reference: every HTML field comes from trusted repository text. */
export interface ApiPage {
	readonly name: string
	readonly slug: string
	readonly href: string
	readonly kind: ApiKind
	/** Singular label of the kind, such as "función". */
	readonly kindLabel: string
	readonly group: { readonly id: string; readonly title: string; readonly href: string }
	readonly specifier: string | null
	/** Plain text of its first sentence, for `<meta name="description">`. */
	readonly summary: string
	/** Highlighted code block with the import, or `null` where there is nothing to import. */
	readonly importCode: TrustedHtml | null
	readonly description: TrustedHtml
	readonly since: string | null
	/** HTML of the deprecation note; empty when the tag has no text, `null` when it is not deprecated. */
	readonly deprecated: TrustedHtml | null
	/** HTML of where it is available without an import, or `null`. */
	readonly autoImport: TrustedHtml | null
	/** Heading of the signatures: "Firma", "Declaración", "Sintaxis" or their plural. */
	readonly signatureTitle: string
	readonly signatures: readonly ApiSignature[]
	readonly typeParameters: readonly ApiParameter[]
	readonly parameters: readonly ApiParameter[]
	readonly returns: { readonly type: TrustedHtml; readonly description: TrustedHtml } | null
	readonly throws: readonly ApiThrow[]
	readonly examples: readonly TrustedHtml[]
	readonly membersTitle: string
	readonly members: readonly ApiMember[]
	/** HTML of each "see also" entry. */
	readonly see: readonly TrustedHtml[]
	/** Pages of the types and symbols it references. */
	readonly related: readonly ApiLink[]
	readonly sourceUrl: string | null
	readonly sourceLabel: string | null
	readonly editUrl: string
	readonly editPath: string
	readonly toc: readonly TocEntry[]
}
