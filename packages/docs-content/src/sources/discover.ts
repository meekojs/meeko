import { readdirSync } from 'node:fs'
import { join } from 'node:path'

import type { DocsLocale } from '../locale'

import { apiHref } from '../content/api'
import { catalog, catalogLabel } from '../content/catalog'
import { readTranslation, translationFile } from '../content/i18n'
import { parseFrontmatter } from '../content/reference'
import { referenceFolder } from '../content/reference-taxonomy'
import { gitFileExists, readGitFile, repositoryPath, repositoryRoot } from '../content/repository'
import { parseNavigation } from './navigation'

/** A public web of the documentation. */
export type DocsSite = 'i18n' | 'site' | 'ui'

/** What a source is: a guide or a reference page of `site` (Markdown), or a `.meeko` page. */
export type SourceKind = 'guide' | 'page' | 'reference'

/** A page of a site as the repository has it, before it is stored in `docs_sources`. */
export interface SourceEntry {
	readonly site: DocsSite
	/** Its URL path in its site, such as `/docs/framework` or `/installation`. */
	readonly path: string
	readonly kind: SourceKind
	readonly title: string
	/** Its Markdown file from the repository root, or `null` for a `.meeko` page. */
	readonly file: string | null
	/** The Markdown of Git, or `null` for a `.meeko` page. */
	readonly markdown: string | null
	/** Its language: Spanish (the original) by default. */
	readonly locale?: DocsLocale
	/**
	 * For a translation, the `source-hash` of its frontmatter: the hash of the Spanish original it
	 * was made from, or `null` when it does not declare one. Absent for an original.
	 */
	readonly sourceHash?: string | null
}

/** The navigation modules of the sites made of `.meeko` pages. */
export const navigationFiles: Readonly<Record<Exclude<DocsSite, 'site'>, string>> = {
	ui: 'apps/ui/app/utils/navigation.ts',
	i18n: 'apps/i18n/app/utils/navigation.ts',
}

/** Text of the first `#` heading outside code blocks, without inline markup. */
export function firstHeading(markdown: string): string | undefined {
	let fence: string | undefined
	for (const line of markdown.split('\n')) {
		const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)
		if (marker) {
			if (!fence) fence = marker[1]![0]!.repeat(marker[1]!.length)
			else if (marker[1]!.startsWith(fence)) fence = undefined
			continue
		}
		if (fence) continue
		const heading = /^ {0,3}#[ \t]+(.+?)[ \t#]*$/.exec(line)
		if (heading) return heading[1]!.replace(/[`*_]/g, '').trim()
	}
	return undefined
}

/** The guides of the site, from its catalog. */
export function guideSources(): SourceEntry[] {
	return catalog.map((entry) => {
		const markdown = readGitFile(entry.source)
		const shown = entry.transform ? entry.transform(markdown) : markdown
		return { site: 'site', path: entry.href, kind: 'guide', title: firstHeading(shown) ?? entry.label, file: repositoryPath(entry.source), markdown }
	})
}

/** The written pages of the API reference: `docs/reference/<group>/<slug>.md`. */
export function referenceSources(): SourceEntry[] {
	const folder = join(repositoryRoot(), ...referenceFolder.split('/'))
	const sources: SourceEntry[] = []
	for (const group of readdirSync(folder, { withFileTypes: true })) {
		if (!group.isDirectory()) continue
		for (const name of readdirSync(join(folder, group.name)).sort()) {
			if (!name.endsWith('.md')) continue
			const file = `${referenceFolder}/${group.name}/${name}`
			const markdown = readGitFile(file)
			const title = parseFrontmatter(markdown, file).data.get('title')
			const slug = name.slice(0, -'.md'.length)
			sources.push({ site: 'site', path: apiHref(slug), kind: 'reference', title: typeof title === 'string' && title ? title : slug, file, markdown })
		}
	}
	return sources
}

/**
 * The translations in `locale` of the Markdown sources `originals` that exist in Git
 * (`docs/en/**`): same site, path and kind, the translation's file and Markdown as Git has them,
 * and the `source-hash` they declare. The title is the one of the translation: its first heading
 * (a guide) or its `title` (a reference page), else the original's.
 */
export function translationSources(originals: readonly SourceEntry[], locale: DocsLocale): SourceEntry[] {
	const sources: SourceEntry[] = []
	for (const original of originals) {
		if (original.file === null || (original.locale ?? 'es') !== 'es') continue
		const file = translationFile(original.file, locale)
		if (file === null || !gitFileExists(file)) continue
		const markdown = readGitFile(file)
		const { text, sourceHash } = readTranslation(markdown)
		let title: string | undefined
		if (original.kind === 'reference') {
			const value = parseFrontmatter(text, file).data.get('title')
			title = typeof value === 'string' && value ? value : undefined
		} else {
			const entry = catalog.find((candidate) => candidate.href === original.path)
			title = firstHeading(entry?.transform ? entry.transform(text) : text) ?? (entry ? catalogLabel(entry, locale) : undefined)
		}
		sources.push({ ...original, locale, title: title ?? original.title, file, markdown, sourceHash })
	}
	return sources
}

/** The `.meeko` pages of `apps/ui` or `apps/i18n`, from their navigation. */
export async function pageSources(site: Exclude<DocsSite, 'site'>): Promise<SourceEntry[]> {
	const file = navigationFiles[site]
	if (!gitFileExists(file)) throw new Error(`${file} does not exist`)
	const pages = await parseNavigation(readGitFile(file), file)
	return pages.map((page) => ({ site, path: page.href, kind: 'page', title: page.label, file: null, markdown: null }))
}

/**
 * Every public page of the three sites as Git has them: guides and reference pages of `site` with
 * their Markdown, in Spanish and in each translation of `docs/en/**`, and the pages of `ui` and
 * `i18n` without it. Published revisions are ignored.
 */
export async function collectRepositorySources(sites: readonly DocsSite[] = ['site', 'ui', 'i18n']): Promise<SourceEntry[]> {
	const sources: SourceEntry[] = []
	if (sites.includes('site')) {
		const originals = [...guideSources(), ...referenceSources()]
		sources.push(...originals, ...translationSources(originals, 'en'))
	}
	if (sites.includes('ui')) sources.push(...(await pageSources('ui')))
	if (sites.includes('i18n')) sources.push(...(await pageSources('i18n')))
	const seen = new Set<string>()
	for (const source of sources) {
		const key = `${source.site}:${source.locale ?? 'es'}:${source.path}`
		if (seen.has(key)) throw new Error(`Two sources for ${source.site} ${source.locale ?? 'es'} ${source.path}`)
		seen.add(key)
	}
	return sources
}
