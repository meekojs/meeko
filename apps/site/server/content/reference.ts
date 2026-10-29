import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import type TS from '@typescript/typescript6'
import { trustHtml } from '@meekojs/meeko'
import type { TrustedHtml } from '@meekojs/meeko'
import type { NavLink, NavSection, Pager } from '../../shared/types/docs.js'
import type { ReferenceIndexEntry, ReferenceIndexGroup, ReferencePage, ReferenceRelated } from '../../shared/types/reference.js'
import { apiCodeLinks, apiConfigBlock, apiConfigKeys, apiHref, apiSlugSet, apiSymbolInfo, apiSymbolMarkdown, apiTypeBlocks } from './api.js'
import type { ApiSymbolInfo, ApiTypeBlock } from './api.js'
import { apiGroups, exportsHref, groupHref, referenceHref } from './api-groups.js'
import { createHighlight } from './highlight.js'
import { codeBlockHtml, documentHeadings, escapeHtml, renderInline, renderMarkdown, rewriteHref } from './markdown.js'
import { taxonomy, groupIcons, referenceFolder, taxonomyPath } from './reference-taxonomy.js'
import type { TaxonomyEntry, TaxonomyGroup } from './reference-taxonomy.js'
import { githubUrl, packageFolder, readRepositoryFile, repositoryRoot, repositoryUrl } from './repository.js'

/*
 * The written pages of the API reference and how they merge with what the sources generate.
 *
 * Each symbol of the taxonomy (reference-taxonomy.ts) has a written page in
 * `docs/reference/<group>/<slug>.md`, or is pending. A written page brings the prose: description,
 * usage, parameters, return value, examples, common mistakes and notes. The sources bring what
 * must never drift from the package: the "Tipo" section (the signatures and declarations, through
 * api.ts), the import line, where it is autoimported, its version and its source file. Its URL is
 * the one of the generated page of its first symbol (`/docs/reference/useform`), so the links of
 * the guides and of other sites keep working; a pending symbol links to that generated page.
 */

/** The `##` sections of a written page, in order; "Tipo" and "Relacionado" are generated. */
export const pageSections = [
	{ titles: ['Uso'] },
	{ titles: ['Tipo'], generated: true },
	{ titles: ['Parámetros', 'Props', 'Opciones', 'Atributos'] },
	{ titles: ['Valor devuelto', 'Resultado'] },
	{ titles: ['Ejemplos'] },
	{ titles: ['Errores comunes'] },
	{ titles: ['Notas'] },
	{ titles: ['Relacionado'], generated: true },
] as const

/** The kind of a symbol id: see {@link TaxonomyEntry.symbols}. */
export type SymbolKind = 'export' | 'syntax' | 'autoimport' | 'cli' | 'config'

/** A symbol id of the reference that exists in the package. */
export interface ReferenceSymbol {
	readonly id: string
	readonly kind: SymbolKind
	readonly name: string
	/** Its generated page, or `null` for a command, a key of the configuration or a generated client. */
	readonly info: ApiSymbolInfo | null
}

/** A written page as its file declares it. */
export interface WrittenPage {
	/** Path from the repository root, such as `docs/reference/composables/useform.md`. */
	readonly file: string
	/** Its folder: the id of its group. */
	readonly group: string
	/** Its file name without `.md`: the last segment of its URL. */
	readonly slug: string
	readonly title: string
	readonly since: string
	readonly description: string
	readonly symbols: readonly string[]
	/** More declarations for its "Tipo" section, as symbol ids. */
	readonly types: readonly string[]
	/** Symbol ids and guide sections (`docs/framework.md#anchor`) of its "Relacionado" section. */
	readonly related: readonly string[]
	/** `signature: first`: "Tipo" shows only the first overload of the first symbol. */
	readonly firstSignature: boolean
	/** The Markdown after the frontmatter. */
	readonly body: string
}

/** A symbol of the taxonomy with its page. */
export interface ResolvedEntry {
	readonly group: TaxonomyGroup
	readonly entry: TaxonomyEntry
	/** The slug its written page must have: the generated page of its first symbol, or `entry.slug`. */
	readonly slug: string | null
	readonly page: WrittenPage | undefined
	/** Where the sidebar and the index link: the written page, the generated one or the fallback. */
	readonly href: string
	/** One line of Markdown about it. */
	readonly description: string
}

// ---------------------------------------------------------------------------------------------
// Frontmatter

/** Text of a YAML scalar: without its quotes. */
function scalar(value: string): string {
	const trimmed = value.trim()
	if (/^".*"$/.test(trimmed)) return JSON.parse(trimmed) as string
	if (/^'.*'$/.test(trimmed)) return trimmed.slice(1, -1).replaceAll("''", "'")
	return trimmed
}

/**
 * The frontmatter of a page and its body. The frontmatter is the subset of YAML that the pages
 * use: `key: value`, `key: [a, b]` and a list of `- item` lines under `key:`.
 */
export function parseFrontmatter(text: string, file: string): { data: Map<string, string | string[]>; body: string } {
	const match = /^---\n([\s\S]*?)\n---\n?/.exec(text)
	if (!match) throw new Error(`${file}: the page must start with a frontmatter between --- lines`)
	const data = new Map<string, string | string[]>()
	let list: string[] | undefined
	for (const [index, line] of match[1]!.split('\n').entries()) {
		if (!line.trim() || line.trim().startsWith('#')) continue
		const item = /^\s+-\s+(.*)$/.exec(line)
		if (item) {
			if (!list) throw new Error(`${file}: line ${index + 2} of the frontmatter is a list item without a key`)
			list.push(scalar(item[1]!))
			continue
		}
		const pair = /^([A-Za-z][\w-]*):(?:\s+(.*))?$/.exec(line)
		if (!pair) throw new Error(`${file}: line ${index + 2} of the frontmatter is not "key: value"`)
		const [, key, value = ''] = pair
		if (data.has(key!)) throw new Error(`${file}: the frontmatter repeats ${key}`)
		if (!value.trim()) {
			list = []
			data.set(key!, list)
		} else if (/^\[.*\]$/.test(value.trim())) {
			list = undefined
			data.set(key!, value.trim().slice(1, -1).split(',').map(scalar).filter(Boolean))
		} else {
			list = undefined
			data.set(key!, scalar(value))
		}
	}
	return { data, body: text.slice(match[0].length) }
}

const frontmatterKeys = new Set(['title', 'group', 'since', 'description', 'symbols', 'types', 'related', 'signature'])

/** Reads and checks the frontmatter of a page file. */
function readPage(file: string): WrittenPage {
	const { data, body } = parseFrontmatter(readRepositoryFile(file), file)
	const unknown = [...data.keys()].filter((key) => !frontmatterKeys.has(key))
	if (unknown.length) throw new Error(`${file}: unknown frontmatter keys: ${unknown.join(', ')}`)
	const one = (key: string): string => {
		const value = data.get(key)
		if (typeof value !== 'string' || !value) throw new Error(`${file}: the frontmatter needs ${key}: <text>`)
		return value
	}
	const many = (key: string, required: boolean): string[] => {
		const value = data.get(key)
		if (value === undefined && !required) return []
		if (!Array.isArray(value) || (required && !value.length)) throw new Error(`${file}: the frontmatter needs ${key} as a list`)
		return value
	}
	const signature = data.get('signature')
	if (signature !== undefined && signature !== 'first') throw new Error(`${file}: signature only admits "first"`)
	const parts = file.split('/')
	return {
		file,
		group: parts[parts.length - 2]!,
		slug: parts[parts.length - 1]!.replace(/\.md$/, ''),
		title: one('title'),
		since: one('since'),
		description: one('description'),
		symbols: many('symbols', true),
		types: many('types', false),
		related: many('related', false),
		firstSignature: signature === 'first',
		body,
	}
}

let pagesCache: readonly WrittenPage[] | undefined

/** Every written page: `docs/reference/<group>/<slug>.md`. */
export function writtenPages(): readonly WrittenPage[] {
	if (pagesCache) return pagesCache
	const folder = join(repositoryRoot(), ...referenceFolder.split('/'))
	const pages: WrittenPage[] = []
	if (existsSync(folder)) {
		for (const entry of readdirSync(folder, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue
			for (const file of readdirSync(join(folder, entry.name))) {
				if (file.endsWith('.md')) pages.push(readPage(`${referenceFolder}/${entry.name}/${file}`))
			}
		}
	}
	pagesCache = pages
	return pages
}

// ---------------------------------------------------------------------------------------------
// Symbols that are not exports: commands, keys of the configuration and generated clients

let commandsCache: ReadonlyMap<string, string> | undefined

/**
 * The commands of the CLI and their usage line, from the help text of `src/cli.ts`: `dev` →
 * `meeko dev [directorio]`, `auth hash` → `meeko auth hash`.
 */
export function cliCommands(): ReadonlyMap<string, string> {
	if (commandsCache) return commandsCache
	const path = `${packageFolder}/src/cli.ts`
	const literal = /const usage = ("(?:[^"\\]|\\.)*")/.exec(readRepositoryFile(path))
	if (!literal) throw new Error(`${path}: the usage text was not found; update apps/site/server/content/reference.ts`)
	const commands = new Map<string, string>()
	for (const line of (JSON.parse(literal[1]!) as string).split('\n')) {
		const usage = /meeko\s+(.*)$/.exec(line.replace(/^Uso:\s*/, '').trim())
		if (!usage) continue
		const words: string[] = []
		for (const word of usage[1]!.split(/\s+/)) {
			if (!/^[a-z][\w-]*$/.test(word)) break
			words.push(word)
		}
		if (words.length) commands.set(words.join(' '), `meeko ${usage[1]!.replace(/\s{2,}\(.*\)$/, '')}`.trim())
	}
	if (!commands.size) throw new Error(`${path}: no command found in the usage text; update apps/site/server/content/reference.ts`)
	commandsCache = commands
	return commands
}

let autoImportCache: Promise<ReadonlySet<string>> | undefined

/**
 * The names of the built-in autoimports of `src/autoimports.ts`, generated clients included
 * (`api`, `useApi`, `useRpcQuery`…): the strings of each `[...].map((name) => …)` and
 * `for (const name of [...])`, and each `name: "…"` of a literal entry.
 */
export function autoImportNames(): Promise<ReadonlySet<string>> {
	autoImportCache ??= (async () => {
		const ts = (await import('@typescript/typescript6')).default
		const path = `${packageFolder}/src/autoimports.ts`
		const file = ts.createSourceFile(path, readRepositoryFile(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
		const names = new Set<string>()
		const strings = (node: TS.Expression): string[] => {
			while (ts.isAsExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression
			return ts.isArrayLiteralExpression(node) ? node.elements.filter(ts.isStringLiteral).map((element) => element.text) : []
		}
		const visit = (node: TS.Node): void => {
			if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'map') {
				const callback = node.arguments[0]
				const parameter = callback && ts.isArrowFunction(callback) ? callback.parameters[0]?.name.getText() : undefined
				if (parameter === 'name') for (const name of strings(node.expression.expression)) names.add(name)
			} else if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer) && node.initializer.declarations[0]?.name.getText() === 'name') {
				for (const name of strings(node.expression)) names.add(name)
			} else if (ts.isPropertyAssignment(node) && node.name.getText() === 'name' && ts.isStringLiteral(node.initializer)) {
				names.add(node.initializer.text)
			}
			ts.forEachChild(node, visit)
		}
		const builtins = file.statements.find((statement): statement is TS.FunctionDeclaration => ts.isFunctionDeclaration(statement) && statement.name?.text === 'builtins')
		if (!builtins) throw new Error(`${path}: function builtins not found; update apps/site/server/content/reference.ts`)
		visit(builtins)
		return names
	})()
	return autoImportCache
}

/** The symbol of an id, or `undefined` if the package has none: what the frontmatter may name. */
export async function referenceSymbol(id: string): Promise<ReferenceSymbol | undefined> {
	const separator = id.indexOf(':')
	const prefix = separator > 0 && !id.startsWith('@') ? id.slice(0, separator) : ''
	const name = prefix ? id.slice(separator + 1) : id
	if (prefix === 'cli') return cliCommands().has(name) ? { id, kind: 'cli', name: `meeko ${name}`, info: null } : undefined
	if (prefix === 'config') return (await apiConfigKeys()).some((key) => key.name === name) ? { id, kind: 'config', name, info: null } : undefined
	if (prefix === 'autoimport') return (await autoImportNames()).has(name) ? { id, kind: 'autoimport', name, info: null } : undefined
	if (prefix && prefix !== 'syntax') return undefined
	const info = await apiSymbolInfo(id)
	return info ? { id, kind: prefix ? 'syntax' : 'export', name: info.name, info } : undefined
}

// ---------------------------------------------------------------------------------------------
// The taxonomy with its pages

interface ResolvedTaxonomy {
	readonly groups: ReadonlyArray<{ readonly group: TaxonomyGroup; readonly entries: readonly ResolvedEntry[] }>
	readonly entries: readonly ResolvedEntry[]
}

let resolvedCache: Promise<ResolvedTaxonomy> | undefined

/** The first sentence of a description: up to the first period followed by a space. */
function firstSentence(text: string): string {
	const sentence = /^[\s\S]*?\.(?=\s|$)/.exec(text.replace(/\s+/g, ' ').trim())
	return (sentence?.[0] ?? text).trim()
}

/** Each symbol of the taxonomy with its page, its link and its line for the index. */
export function resolvedTaxonomy(): Promise<ResolvedTaxonomy> {
	resolvedCache ??= (async () => {
		const pages = writtenPages()
		const configKeys = await apiConfigKeys()
		const groups = []
		const all: ResolvedEntry[] = []
		for (const group of taxonomy()) {
			const entries: ResolvedEntry[] = []
			for (const entry of group.entries) {
				const symbols = await Promise.all(entry.symbols.map(referenceSymbol))
				const missing = entry.symbols.filter((_, index) => !symbols[index])
				if (missing.length) throw new Error(`${taxonomyPath}: ${entry.name} names symbols that the package does not have: ${missing.join(', ')}`)
				const generated = symbols.find((symbol) => symbol?.info)?.info ?? null
				const first = symbols[0]!
				const slug = entry.slug ?? first.info?.slug ?? null
				const page = slug ? pages.find((candidate) => candidate.group === group.id && candidate.slug === slug) : undefined
				const configKey = first.kind === 'config' ? configKeys.find((key) => key.name === first.name) : undefined
				const href = page ? apiHref(page.slug) : (generated?.href ?? configKey?.href ?? entry.fallback)
				if (!href) throw new Error(`${taxonomyPath}: ${entry.name} has no page yet and no generated page; give it a "fallback" URL`)
				const description = page?.description ?? (generated?.summary || (configKey ? firstSentence(configKey.description) : '') || entry.description || '')
				const resolved = { group, entry, slug, page, href, description }
				entries.push(resolved)
				all.push(resolved)
			}
			groups.push({ group, entries })
		}
		return { groups, entries: all }
	})()
	resolvedCache.catch(() => {
		resolvedCache = undefined
	})
	return resolvedCache
}

/** Slugs of the written pages that have no generated page (commands, configuration), for `prerenderEntries`. */
export async function referenceOnlySlugs(): Promise<string[]> {
	const generated = await apiSlugSet()
	return writtenPages()
		.map((page) => page.slug)
		.filter((slug) => !generated.has(slug))
}

/** The entry of the taxonomy whose sidebar link is `href`, if any. */
export async function referenceEntryAt(href: string): Promise<ResolvedEntry | undefined> {
	return (await resolvedTaxonomy()).entries.find((entry) => entry.href === href)
}

// ---------------------------------------------------------------------------------------------
// Navigation

/**
 * The sidebar of the reference: one section per group of the taxonomy with its icon, then every
 * export by module, the exhaustive reference generated from the sources.
 */
export async function referenceNavigation(): Promise<NavSection[]> {
	const { groups } = await resolvedTaxonomy()
	const sections: NavSection[] = [
		{ title: 'Referencia de la API', links: [{ href: referenceHref, label: 'Índice de la API' }] },
		...groups.map(({ group, entries }) => ({
			title: group.title,
			icon: groupIcons[group.icon]!,
			links: entries.map((entry): NavLink => ({ href: entry.href, label: entry.entry.name, code: true })),
		})),
		{
			title: 'Todos los exports',
			icon: groupIcons.exports!,
			links: [{ href: exportsHref, label: 'Índice por módulo' }, ...apiGroups().map((group) => ({ href: groupHref(group), label: group.specifier ?? group.title, code: group.specifier !== null }))],
		},
	]
	return sections
}

/** Previous and next symbols of `href` inside its group of the taxonomy, or `null` outside it. */
export async function referencePager(href: string): Promise<Pager | null> {
	const { groups } = await resolvedTaxonomy()
	for (const { entries } of groups) {
		const index = entries.findIndex((entry) => entry.href === href)
		if (index < 0) continue
		const link = (entry: ResolvedEntry | undefined): NavLink | null => (entry ? { href: entry.href, label: entry.entry.name } : null)
		return { previous: link(entries[index - 1]), next: link(entries[index + 1]) }
	}
	return null
}

/** The index of the reference: each group with its symbols and one line about each. */
export async function referenceIndex(): Promise<ReferenceIndexGroup[]> {
	const { groups } = await resolvedTaxonomy()
	return Promise.all(
		groups.map(async ({ group, entries }) => ({
			anchor: group.anchor,
			title: group.title,
			icon: groupIcons[group.icon]!,
			description: await renderInline(group.description),
			href: entries[0]?.href ?? referenceHref,
			entries: await Promise.all(
				entries.map(
					async (entry): Promise<ReferenceIndexEntry> => ({
						name: entry.entry.name,
						href: entry.href,
						description: await renderInline(entry.description.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')),
						written: entry.page !== undefined,
					}),
				),
			),
		})),
	)
}

// ---------------------------------------------------------------------------------------------
// A written page

/** Where "Tipo" and "Relacionado" go in the rendered body. */
const typeMarker = '<!--meeko:type-->'
const relatedMarker = '<!--meeko:related-->'

/** The body with the generated sections: "Tipo" after "Uso" and "Relacionado" at the end. */
function withGeneratedSections(body: string): string {
	const lines = body.replace(/\s+$/, '').split('\n')
	let fenced = false
	let inUsage = false
	let at = lines.length
	for (const [index, line] of lines.entries()) {
		if (/^(`{3,}|~{3,})/.test(line)) fenced = !fenced
		if (fenced || !line.startsWith('## ')) continue
		if (inUsage) {
			at = index
			break
		}
		inUsage = line.trim() === '## Uso'
	}
	lines.splice(at, 0, '## Tipo', '', typeMarker, '')
	return `${lines.join('\n')}\n\n## Relacionado\n\n${relatedMarker}\n`
}

let highlight: Promise<(code: string, lang: string) => TrustedHtml> | undefined

/** The declarations of the "Tipo" section of a page. */
async function typeBlocks(page: WrittenPage): Promise<ApiTypeBlock[]> {
	const blocks: ApiTypeBlock[] = []
	const exported: string[] = []
	const flush = async (): Promise<void> => {
		if (!exported.length) return
		blocks.push(...(await apiTypeBlocks(exported.splice(0), page.slug, { firstOnly: page.firstSignature ? [page.symbols[0]!] : [] })))
	}
	for (const id of [...page.symbols, ...page.types]) {
		const symbol = await referenceSymbol(id)
		if (!symbol) throw new Error(`${page.file}: ${id} is not a symbol of the package`)
		if (symbol.kind === 'export' || symbol.kind === 'syntax') {
			exported.push(id)
			continue
		}
		await flush()
		if (symbol.kind === 'config') {
			const block = await apiConfigBlock(symbol.name, page.slug)
			if (block) blocks.push(block)
		} else if (symbol.kind === 'cli') {
			highlight ??= createHighlight()
			const usage = cliCommands().get(id.slice('cli:'.length))!
			blocks.push({ name: symbol.name, href: apiHref(page.slug), code: codeBlockHtml('sh', (await highlight)(usage, 'shellscript')), source: usage, lang: 'sh' })
		}
	}
	await flush()
	return blocks
}

/** HTML of the "Tipo" section: each declaration under the name of its page. */
function typeHtml(blocks: readonly ApiTypeBlock[], own: string): string {
	return blocks
		.map((block) => {
			const label = block.href === apiHref(own) ? '' : `<p class="type-of"><a href="${escapeHtml(block.href)}"><code>${escapeHtml(block.name)}</code></a></p>`
			return `<div class="type-block">${label}${block.code}</div>`
		})
		.join('\n')
}

/** The links of the "Relacionado" section of a page. */
async function relatedLinks(page: WrittenPage): Promise<ReferenceRelated[]> {
	const { entries } = await resolvedTaxonomy()
	const links: ReferenceRelated[] = []
	for (const item of page.related) {
		const guide = /^([\w./-]+\.md)(?:#(.+))?$/.exec(item)
		if (guide) {
			const [, path, anchor] = guide
			const heading = anchor ? (await documentHeadings(path!)).get(anchor) : undefined
			if (anchor && !heading) throw new Error(`${page.file}: related ${item} is not a heading of ${path}`)
			// From the repository root, as GitHub URLs are: `docs/framework.md#…` → `/docs/framework#…`.
			const href = rewriteHref(`${repositoryUrl}/blob/main/${path}${anchor ? `#${anchor}` : ''}`, page.file)
			const title = readRepositoryFile(path!).match(/^# (.+)$/m)?.[1] ?? path!
			links.push({ label: heading ?? title, href, code: false, note: heading ? title.replace(/`/g, '') : '' })
			continue
		}
		const symbol = await referenceSymbol(item)
		if (!symbol) throw new Error(`${page.file}: related ${item} is not a symbol of the package`)
		const entry = entries.find((candidate) => candidate.entry.symbols[0] === item)
		const href = entry?.href ?? symbol.info?.href
		if (!href) throw new Error(`${page.file}: related ${item} has no page`)
		const note = entry?.description ?? symbol.info?.summary ?? ''
		links.push({ label: entry?.entry.name ?? symbol.name, href, code: true, note: note.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`/g, '') })
	}
	return links
}

/** HTML of the "Relacionado" section. */
function relatedHtml(links: readonly ReferenceRelated[]): string {
	const items = links.map((link) => {
		const label = link.code ? `<code>${escapeHtml(link.label)}</code>` : escapeHtml(link.label)
		const note = link.note ? `<span class="related-note">${escapeHtml(link.note)}</span>` : ''
		return `<li><a href="${escapeHtml(link.href)}">${label}</a>${note}</li>`
	})
	return `<ul class="related-list">\n${items.join('\n')}\n</ul>`
}

/** The written page of a slug, merged with what the sources generate, or `undefined`. */
export async function referencePage(slug: string): Promise<ReferencePage | undefined> {
	const page = writtenPages().find((candidate) => candidate.slug === slug)
	if (!page) return undefined
	const { groups } = await resolvedTaxonomy()
	const owner = groups.find(({ entries }) => entries.some((entry) => entry.page === page))
	if (!owner) throw new Error(`${page.file}: no symbol of ${taxonomyPath} has this page; add it to the taxonomy`)
	const symbols = await Promise.all(page.symbols.map(referenceSymbol))
	const primary = symbols.find((symbol) => symbol?.info)?.info ?? null
	const links = await apiCodeLinks()
	const own = apiHref(page.slug)
	const doc = await renderMarkdown(withGeneratedSections(page.body), page.file, {
		codeLinks: (code) => {
			const href = links(code)
			return href === own ? undefined : href
		},
	})
	const body = doc.html.replace(typeMarker, typeHtml(await typeBlocks(page), page.slug)).replace(relatedMarker, relatedHtml(await relatedLinks(page)))
	return {
		title: page.title,
		slug: page.slug,
		href: own,
		group: { title: owner.group.title, href: `${referenceHref}#${owner.group.anchor}`, icon: groupIcons[owner.group.icon]! },
		kindLabel: owner.group.label,
		description: page.description.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/`/g, ''),
		since: page.since,
		specifier: primary?.specifier ?? null,
		autoImport: primary?.autoImport ?? null,
		importCode: primary?.importCode ?? null,
		sourceUrl: primary?.sourceUrl ?? null,
		sourceLabel: primary?.sourceLabel ?? null,
		body: trustHtml(body),
		toc: doc.toc,
		editUrl: githubUrl(page.file, 'edit'),
		editPath: page.file,
	}
}

// ---------------------------------------------------------------------------------------------
// For language models: /llms.txt and /llms-full.txt

/** The Markdown of a written page: its prose with the generated "Tipo" and "Relacionado". */
async function pageMarkdown(page: WrittenPage, origin: string): Promise<string> {
	const types = (await typeBlocks(page)).map((block) => ['```' + block.lang, block.source, '```'].join('\n')).join('\n\n')
	const related = (await relatedLinks(page)).map((link) => `- [${link.code ? `\`${link.label}\`` : link.label}](${origin}${link.href})${link.note ? `: ${link.note}` : ''}`).join('\n')
	return withGeneratedSections(page.body).replace(typeMarker, types).replace(relatedMarker, related).trim()
}

/** Text of `/llms.txt`: the site and every page of the guides and the reference, with one line each. */
export async function llmsIndex(origin: string, guides: ReadonlyArray<{ title: string; href: string; description: string }>): Promise<string> {
	const { groups } = await resolvedTaxonomy()
	const lines = [
		'# Meeko',
		'',
		'> Meeko es un motor de componentes `.meeko` tipados con SSR, hidratación y señales, y un framework full-stack (rutas, API y RPC tipados, sesiones, WebSocket) para Node, Bun, Deno y Cloudflare Workers. Documentación en español.',
		'',
		`Cada página de la referencia explica un símbolo con su tipo exacto, generado desde el código fuente, sus parámetros, ejemplos y errores comunes. [${origin}/llms-full.txt](${origin}/llms-full.txt) reúne en un solo archivo las guías y la referencia en Markdown.`,
		'',
		'## Guías',
		'',
		...guides.map((guide) => `- [${guide.title}](${origin}${guide.href})${guide.description ? `: ${guide.description}` : ''}`),
	]
	for (const { group, entries } of groups) {
		lines.push('', `## Referencia: ${group.title}`, '', ...entries.map((entry) => `- [${entry.entry.name}](${origin}${entry.href})${entry.description ? `: ${entry.description.replace(/\s+/g, ' ')}` : ''}`))
	}
	lines.push('', '## Optional', '', `- [Todos los exports](${origin}${exportsHref}): índice de cada export de cada módulo de @meekojs/meeko, generado desde su JSDoc.`)
	return `${lines.join('\n')}\n`
}

/**
 * Text of `/llms-full.txt`: every guide and every symbol of the reference as plain Markdown, the
 * written pages with their generated types and the pending symbols with their JSDoc.
 */
export async function llmsFull(origin: string, guides: ReadonlyArray<{ title: string; href: string; markdown: string }>): Promise<string> {
	const { groups } = await resolvedTaxonomy()
	const parts = ['# Meeko: guías y referencia de la API', '', `Fuente: ${origin}. Cada sección empieza con la URL de su página.`]
	for (const guide of guides) parts.push('', '---', '', `<!-- ${origin}${guide.href} -->`, '', guide.markdown.trim())
	for (const { group, entries } of groups) {
		for (const entry of entries) {
			const page = entry.page
			let markdown: string | undefined
			if (page) markdown = await pageMarkdown(page, origin)
			else {
				const id = entry.entry.symbols.find((symbol) => !/^(?:cli|config|autoimport):/.test(symbol))
				markdown = id ? await apiSymbolMarkdown(id) : entry.description
			}
			const title = page?.title ?? entry.entry.name
			const intro = page ? `${page.description}\n\n` : ''
			parts.push('', '---', '', `<!-- ${origin}${entry.href} -->`, '', `# ${title} (${group.title})`, '', `${intro}${markdown ?? ''}`.trim())
		}
	}
	return `${parts.join('\n')}\n`
}
