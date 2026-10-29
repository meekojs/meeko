import GithubSlugger from 'github-slugger'
import { readRepositoryFile } from './repository.js'

/*
 * The taxonomy of the API reference: `docs/reference/taxonomy.json`, the groups of the sidebar
 * (components, macros, composables…) with each symbol, in reading order. A symbol is `pending`
 * until its page is written in `docs/reference/<group>/<slug>.md`; tests/reference.test.mjs keeps
 * both in step. See docs/reference/README.md.
 */

/** Path of the taxonomy in the repository. */
export const taxonomyPath = 'docs/reference/taxonomy.json'

/** Folder of the written pages of the reference. */
export const referenceFolder = 'docs/reference'

/** A symbol of the taxonomy, as `taxonomy.json` declares it. */
export interface TaxonomyEntry {
	/** Name shown in the sidebar and as the title of the page, such as `useForm` or `<MeekoLink>`. */
	readonly name: string
	/**
	 * What it documents, by id: `@meekojs/meeko/framework#useForm` (an export of a subpath),
	 * `syntax:meekolink` (the syntax of `.meeko`, by the slug of api-builtins.ts),
	 * `autoimport:useApi` (a generated client), `cli:dev` (a command) or `config:server` (a key of
	 * `meeko.config.ts`). The first one is the symbol of the page.
	 */
	readonly symbols: readonly string[]
	/** `true` while `docs/reference/<group>/<slug>.md` does not exist. */
	readonly pending?: boolean
	/**
	 * Slug of its page when the first symbol has no generated page (a command, a key of the
	 * configuration, a generated client): `meeko-dev`, `config-server`.
	 */
	readonly slug?: string
	/** Where the sidebar links while the page is pending and the first symbol has no generated page. */
	readonly fallback?: string
	/** One line for the index while the page is pending and the sources have no description. */
	readonly description?: string
}

/** A group of the taxonomy. */
export interface TaxonomyGroup {
	/** Folder of its pages under `docs/reference/`, such as `composables`. */
	readonly id: string
	/** Heading, such as "Composables". */
	readonly title: string
	/** Singular label of its symbols on their pages, such as "composable". */
	readonly label: string
	/** Key of its icon, in {@link groupIcons}. */
	readonly icon: string
	/** One sentence of Markdown about the group, for the index. */
	readonly description: string
	readonly entries: readonly TaxonomyEntry[]
	/** Anchor of the group in the index: the slug of its title, such as `reactividad`. */
	readonly anchor: string
}

/**
 * The 16 px stroke icon of each group, as the `d` of a `<path>` drawn with a 1.4 px round stroke
 * (DocsLayout and the index of the reference).
 */
export const groupIcons: Readonly<Record<string, string>> = {
	// A box: the tags that render a piece of interface.
	components: 'M8 1.75 13.75 5v6L8 14.25 2.25 11V5Z M2.25 5 8 8.25 13.75 5 M8 8.25v6',
	// Braces: what the compiler reads in the script.
	macros: 'M5.75 2.75c-1.5 0-2 .6-2 1.9v1.35c0 .9-.5 1.5-1.5 1.5 1 0 1.5.6 1.5 1.5v1.35c0 1.3.5 1.9 2 1.9 M10.25 2.75c1.5 0 2 .6 2 1.9v1.35c0 .9.5 1.5 1.5 1.5-1 0-1.5.6-1.5 1.5v1.35c0 1.3-.5 1.9-2 1.9',
	// Layers: state composed into a component.
	composables: 'M8 2 14 5 8 8 2 5Z M2 8l6 3 6-3 M2 11l6 3 6-3',
	// A spark: a signal that changes.
	reactivity: 'M9 1.75 3.75 9h4l-1 5.25L12.25 7h-4Z',
	// A wrench.
	utils: 'M10.4 2.2a3.25 3.25 0 0 0-4 4.2L2.6 10.2a1.25 1.25 0 0 0 0 1.75l1.45 1.45a1.25 1.25 0 0 0 1.75 0L9.6 9.6a3.25 3.25 0 0 0 4.2-4l-2 2-1.9-.5-.5-1.9Z',
	// Angle brackets: the template.
	syntax: 'M5.25 4.5 1.75 8l3.5 3.5 M10.75 4.5 14.25 8l-3.5 3.5 M9.25 2.75l-2.5 10.5',
	// A rack.
	server: 'M2.75 2.75h10.5v4H2.75Z M2.75 9.25h10.5v4H2.75Z M5 4.75h.01 M5 11.25h.01',
	// A plug.
	adapters: 'M6 1.75v3 M10 1.75v3 M4.25 4.75h7.5v2.5a3.75 3.75 0 0 1-7.5 0Z M8 11v3.25',
	// A terminal.
	commands: 'M2.25 3.25h11.5v9.5H2.25Z M4.75 6.25 6.75 8l-2 1.75 M8.25 10h3',
	// Sliders.
	config: 'M2.5 4.5h6.25 M11.75 4.5h1.75 M2.5 11.5h1.75 M7.25 11.5h6.25 M10.25 3v3 M5.75 10v3',
	// A chip: the pieces underneath.
	advanced: 'M4.25 4.25h7.5v7.5h-7.5Z M6.5 6.5h3v3h-3Z M6 1.75v2.5 M10 1.75v2.5 M6 11.75v2.5 M10 11.75v2.5 M1.75 6h2.5 M1.75 10h2.5 M11.75 6h2.5 M11.75 10h2.5',
	// A list: every export of every module.
	exports: 'M3 2.75h10v10.5H3Z M5.5 5.5h5 M5.5 8h5 M5.5 10.5h3',
}

let cached: readonly TaxonomyGroup[] | undefined

/** Reads a string property of the taxonomy, or fails naming where. */
function text(value: unknown, where: string): string {
	if (typeof value !== 'string' || !value.trim()) throw new Error(`${taxonomyPath}: ${where} must be a non-empty string`)
	return value
}

/** The groups of the taxonomy in reading order, validated. */
export function taxonomy(): readonly TaxonomyGroup[] {
	if (cached) return cached
	const raw = JSON.parse(readRepositoryFile(taxonomyPath)) as { groups?: unknown }
	if (!Array.isArray(raw.groups)) throw new Error(`${taxonomyPath}: "groups" must be an array`)
	const slugger = new GithubSlugger()
	cached = raw.groups.map((value: Record<string, unknown>, index: number): TaxonomyGroup => {
		const where = `groups[${index}]`
		const icon = text(value.icon, `${where}.icon`)
		if (!groupIcons[icon]) throw new Error(`${taxonomyPath}: ${where}.icon "${icon}" is not one of ${Object.keys(groupIcons).join(', ')}`)
		if (!Array.isArray(value.entries)) throw new Error(`${taxonomyPath}: ${where}.entries must be an array`)
		const title = text(value.title, `${where}.title`)
		return {
			id: text(value.id, `${where}.id`),
			title,
			label: text(value.label, `${where}.label`),
			icon,
			description: text(value.description, `${where}.description`),
			anchor: slugger.slug(title),
			entries: value.entries.map((entry: Record<string, unknown>, position: number): TaxonomyEntry => {
				const at = `${where}.entries[${position}]`
				if (!Array.isArray(entry.symbols) || !entry.symbols.length) throw new Error(`${taxonomyPath}: ${at}.symbols must be a non-empty array`)
				const known = new Set(['name', 'symbols', 'pending', 'slug', 'fallback', 'description'])
				const unknown = Object.keys(entry).filter((key) => !known.has(key))
				if (unknown.length) throw new Error(`${taxonomyPath}: ${at} has unknown keys: ${unknown.join(', ')}`)
				return {
					name: text(entry.name, `${at}.name`),
					symbols: entry.symbols.map((symbol: unknown, item: number) => text(symbol, `${at}.symbols[${item}]`)),
					...(entry.pending === true ? { pending: true } : {}),
					...(entry.slug === undefined ? {} : { slug: text(entry.slug, `${at}.slug`) }),
					...(entry.fallback === undefined ? {} : { fallback: text(entry.fallback, `${at}.fallback`) }),
					...(entry.description === undefined ? {} : { description: text(entry.description, `${at}.description`) }),
				}
			}),
		}
	})
	return cached
}
