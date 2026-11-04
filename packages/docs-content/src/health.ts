// What the documentation still lacks or links wrong: the pending entries of the reference, the
// exports that no page of the reference names, and the internal links and anchors of the guides
// and the written reference pages that lead nowhere. It reads the repository's files (never the
// published revisions) and renders nothing: the dashboard runs it in a child process, as the
// render, because the API model compiles the package with TypeScript.
import type { Token } from 'markdown-it'

import GithubSlugger from 'github-slugger'
import markdownIt from 'markdown-it'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { apiIndex, apiKinds, apiPage, apiSlugSet } from './content/api'
import { apiGroups, exportsHref, referenceHref } from './content/api-groups'
import { catalog } from './content/catalog'
import { documentHeadings, rewriteHref } from './content/markdown'
import { pageSections, resolvedTaxonomy, writtenPages } from './content/reference'
import { taxonomy, taxonomyPath } from './content/reference-taxonomy'
import { createSourceContext, readGitFile, repositoryPath, repositoryRoot, repositoryUrl, withSourceContext } from './content/repository'

/** An entry of `docs/reference/taxonomy.json` whose written page does not exist yet. */
export interface PendingReference {
	readonly group: string
	readonly groupTitle: string
	readonly name: string
	/** Its first symbol id, such as `@meekojs/meeko/framework#useForm`. */
	readonly symbol: string
	/** Where the site links meanwhile: the generated page or the fallback. */
	readonly href: string
}

/** An export of `@meekojs/meeko` that neither the taxonomy nor a written page names. */
export interface UndocumentedExport {
	/** Its symbol id, such as `@meekojs/meeko/server#defineRpc`. */
	readonly id: string
	readonly specifier: string
	readonly name: string
	readonly kind: string
	/** Plural label of its kind, such as «Funciones». */
	readonly kindLabel: string
	/** Its generated page. */
	readonly href: string
	readonly deprecated: boolean
}

/** Why {@link BrokenLink} leads nowhere. */
export type BrokenLinkReason = 'anchor' | 'file' | 'page'

/** An internal link of a guide or a written page of the reference that leads nowhere. */
export interface BrokenLink {
	/** The Markdown file that has it, from the repository root. */
	readonly file: string
	/** Its line in that file, from 1, or `null` when it comes from the frontmatter or the taxonomy. */
	readonly line: number | null
	/** The link as written. */
	readonly href: string
	/** Where the site sends it. */
	readonly target: string
	readonly reason: BrokenLinkReason
}

/** What {@link documentationHealth} reports. */
export interface DocumentationHealth {
	readonly checkedAt: string
	readonly pendingReferences: readonly PendingReference[]
	readonly undocumentedExports: readonly UndocumentedExport[]
	readonly brokenLinks: readonly BrokenLink[]
	/** How much it read: documents and internal links checked. */
	readonly checked: { readonly guides: number; readonly references: number; readonly links: number }
}

/** A link of a document, with its line from 1. */
export interface DocumentLink {
	readonly href: string
	readonly line: number | null
}

const parser = markdownIt({ html: true, linkify: false, typographer: false })

/** The links of a Markdown text, outside code, with their line. */
export function markdownLinks(text: string): DocumentLink[] {
	const links: DocumentLink[] = []
	const visit = (tokens: readonly Token[], line: number | null) => {
		for (const token of tokens) {
			const at = token.map ? token.map[0] + 1 : line
			if (token.type === 'link_open') {
				const href = token.attrGet('href')
				if (href) links.push({ href: String(href), line: at })
			}
			if (token.children) visit(token.children, at)
		}
	}
	visit(parser.parse(text, {}), null)
	return links
}

/** The anchor ids that the generated sections of a written page add, such as `tipo`. */
function generatedAnchors(): ReadonlySet<string> {
	const slugger = new GithubSlugger()
	return new Set(pageSections.flatMap((section) => section.titles.map((title) => slugger.slug(title))))
}

/** Where the internal links of the site can lead. */
export interface LinkTargets {
	/** The guides by their URL, with their Markdown file. */
	readonly guides: ReadonlyMap<string, string>
	/** Slugs under `/docs/reference/`: generated pages and written ones. */
	readonly references: ReadonlySet<string>
	/** Anchor ids of a guide's file. */
	readonly anchors: (file: string) => Promise<ReadonlySet<string>>
	/** Whether a file of the repository exists, by its path from the root. */
	readonly fileExists: (file: string) => boolean
	/**
	 * Anchor ids of a page of the reference by its URL path: the index (`/docs/reference`), every
	 * export (`/docs/reference/exports`) or one symbol (`/docs/reference/signal`). `undefined` when
	 * they are unknown, and then a fragment of that page is not checked.
	 */
	readonly referenceAnchors?: (path: string) => Promise<ReadonlySet<string> | undefined>
}

/** The {@link LinkTargets} of the repository as it is in the working tree. */
export async function repositoryLinkTargets(): Promise<LinkTargets> {
	const references = new Set(await apiSlugSet())
	const pages = writtenPages()
	for (const page of pages) references.add(page.slug)
	const root = repositoryRoot()
	const anchors = async (file: string) => new Set((await documentHeadings(file)).keys())
	const generated = generatedAnchors()
	const known = new Map<string, Promise<ReadonlySet<string> | undefined>>()
	// The ids that the reference's routes render (apps/meeko/app/pages/docs/reference/*.meeko).
	const referenceAnchors = async (path: string): Promise<ReadonlySet<string> | undefined> => {
		if (path === referenceHref) return new Set([...taxonomy().map((group) => group.anchor), 'todos-los-exports', ...apiGroups().map((group) => group.id)])
		if (path === exportsHref) return new Set(['api-filter', ...(await apiIndex()).map((group) => group.id)])
		const slug = path.slice(referenceHref.length + 1)
		const written = pages.find((page) => page.slug === slug)
		if (written) return new Set([...(await anchors(written.file)), ...generated])
		return (await apiPage(slug))?.toc.map((entry) => entry.id).reduce((set, id) => set.add(id), new Set<string>())
	}
	return {
		guides: new Map(catalog.map((entry) => [entry.href, entry.source])),
		references,
		anchors,
		fileExists: (file) => existsSync(join(root, ...file.split('/'))),
		referenceAnchors: (path) => {
			let found = known.get(path)
			if (!found) known.set(path, (found = referenceAnchors(path)))
			return found
		},
	}
}

const blob = `${repositoryUrl}/blob/main/`
const tree = `${repositoryUrl}/tree/main/`

/**
 * Why a link of `file` leads nowhere, or `null` when it does or is not internal. `ownAnchors` are
 * the anchors of `file` itself, for `#…` links.
 */
export async function checkLink(href: string, file: string, ownAnchors: ReadonlySet<string>, targets: LinkTargets): Promise<{ readonly target: string; readonly reason: BrokenLinkReason } | null> {
	const target = rewriteHref(href, file)
	const hashAt = target.indexOf('#')
	const beforeHash = hashAt < 0 ? target : target.slice(0, hashAt)
	// The query string never names a page or an anchor: `/docs/guia?modo=x#uso` is `/docs/guia#uso`.
	const searchAt = beforeHash.indexOf('?')
	const path = searchAt < 0 ? beforeHash : beforeHash.slice(0, searchAt)
	const anchor = hashAt < 0 ? '' : safeDecode(target.slice(hashAt + 1))
	if (path === '') return anchor && !ownAnchors.has(anchor) ? { target, reason: 'anchor' } : null
	if (target.startsWith(blob) || target.startsWith(tree)) {
		const repositoryFile = safeDecode(path.slice((target.startsWith(blob) ? blob : tree).length)).replace(/\/$/, '')
		return targets.fileExists(repositoryFile) ? null : { target, reason: 'file' }
	}
	if (!path.startsWith('/')) return null
	const guide = targets.guides.get(path)
	if (guide) return anchor && !(await targets.anchors(guide)).has(anchor) ? { target, reason: 'anchor' } : null
	if (path === '/' || path === '/docs') return null
	const reference = path === referenceHref || path === exportsHref || (path.startsWith(`${referenceHref}/`) && targets.references.has(path.slice(referenceHref.length + 1)))
	if (reference) {
		if (!anchor || !targets.referenceAnchors) return null
		const ids = await targets.referenceAnchors(path)
		return ids && !ids.has(anchor) ? { target, reason: 'anchor' } : null
	}
	return path.startsWith('/docs') ? { target, reason: 'page' } : null
}

function safeDecode(text: string): string {
	try {
		return decodeURIComponent(text)
	} catch {
		return text
	}
}

/**
 * The broken links of one document: its Markdown `text`, read from `file`. `firstLine` is the line
 * of the file where `text` starts, such as the body of a written page after its frontmatter.
 */
export async function documentBrokenLinks(text: string, file: string, ownAnchors: ReadonlySet<string>, targets: LinkTargets, firstLine = 1): Promise<BrokenLink[]> {
	const broken: BrokenLink[] = []
	for (const link of markdownLinks(text)) {
		const found = await checkLink(link.href, file, ownAnchors, targets)
		if (found) broken.push({ file: repositoryPath(file), line: link.line === null ? null : link.line + firstLine - 1, href: link.href, ...found })
	}
	return broken
}

/** Pending entries of the taxonomy, in its order. */
export async function pendingReferences(): Promise<PendingReference[]> {
	const { entries } = await resolvedTaxonomy()
	return entries.filter((resolved) => resolved.entry.pending).map((resolved) => ({ group: resolved.group.id, groupTitle: resolved.group.title, name: resolved.entry.name, symbol: resolved.entry.symbols[0]!, href: resolved.href }))
}

/** Exports of the package that neither the taxonomy nor the frontmatter of a written page names. */
export async function undocumentedExports(): Promise<UndocumentedExport[]> {
	const named = new Set<string>()
	for (const group of taxonomy()) for (const entry of group.entries) for (const id of entry.symbols) named.add(id)
	for (const page of writtenPages()) for (const id of [...page.symbols, ...page.types]) named.add(id)
	const labels = new Map(apiKinds().map(({ kind, label }) => [kind as string, label]))
	const missing: UndocumentedExport[] = []
	for (const group of await apiIndex()) {
		if (group.specifier === null) continue
		for (const section of group.sections) {
			for (const item of section.items) {
				const id = `${group.specifier}#${item.name}`
				if (!named.has(id)) missing.push({ id, specifier: group.specifier, name: item.name, kind: item.kind, kindLabel: labels.get(item.kind) ?? item.kind, href: item.href, deprecated: item.deprecated })
			}
		}
	}
	return missing
}

/**
 * The fallback URLs of the taxonomy and the guide sections that written pages relate to, which the
 * site links from the sidebar and the «Relacionado» section: the checks of
 * `apps/meeko/tests/reference.test.mjs`, as a list instead of an assertion.
 */
export async function referenceTargetLinks(targets: LinkTargets): Promise<BrokenLink[]> {
	const broken: BrokenLink[] = []
	for (const group of taxonomy()) {
		for (const entry of group.entries) {
			if (!entry.fallback) continue
			const found = await checkLink(entry.fallback, taxonomyPath, new Set(), targets)
			if (found) broken.push({ file: taxonomyPath, line: null, href: entry.fallback, ...found })
		}
	}
	for (const page of writtenPages()) {
		for (const item of page.related) {
			const guide = /^([\w./-]+\.md)(?:#(.+))?$/.exec(item)
			if (!guide) continue
			const [, file, anchor] = guide
			if (!targets.fileExists(file!)) broken.push({ file: page.file, line: null, href: item, target: item, reason: 'file' })
			else if (anchor && !(await targets.anchors(file!)).has(anchor)) broken.push({ file: page.file, line: null, href: item, target: item, reason: 'anchor' })
		}
	}
	return broken
}

/** Everything {@link DocumentationHealth} reports, from the working tree. */
export function documentationHealth(): Promise<DocumentationHealth> {
	// One source context for the whole check: the API model and the pages are derived once.
	return withSourceContext(createSourceContext(), checkHealth)
}

async function checkHealth(): Promise<DocumentationHealth> {
	const targets = await repositoryLinkTargets()
	const brokenLinks: BrokenLink[] = []
	let links = 0
	for (const entry of catalog) {
		const text = readGitFile(entry.source)
		links += markdownLinks(text).length
		brokenLinks.push(...(await documentBrokenLinks(text, entry.source, await targets.anchors(entry.source), targets)))
	}
	const generated = generatedAnchors()
	const pages = writtenPages()
	for (const page of pages) {
		links += markdownLinks(page.body).length
		const own = new Set([...(await targets.anchors(page.file)), ...generated])
		// The body is the end of the file: its first line follows the frontmatter.
		const firstLine = readGitFile(page.file).split('\n').length - page.body.split('\n').length + 1
		brokenLinks.push(...(await documentBrokenLinks(page.body, page.file, own, targets, firstLine)))
	}
	brokenLinks.push(...(await referenceTargetLinks(targets)))
	return {
		checkedAt: new Date().toISOString(),
		pendingReferences: await pendingReferences(),
		undocumentedExports: await undocumentedExports(),
		brokenLinks,
		checked: { guides: catalog.length, references: pages.length, links },
	}
}
