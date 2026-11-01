import type { SnapshotPage } from './db/snapshots'
import type { DocsLocale, PageLocale } from './locale'
import type { SourceOverlay } from './sources/overlay'

import { apiHref, apiIndex, apiKinds, apiPage, apiPager, apiSlugs } from './content/api'
import { apiGroups, exportsHref, groupHref, referenceHref } from './content/api-groups'
import { catalog, catalogLabel, catalogSection, navigation, pager } from './content/catalog'
import { createHighlight, createTokenizer } from './content/highlight'
import { codeBlockHtml, escapeHtml, renderSource } from './content/markdown'
import { messages } from './content/messages'
import { llmsFull, llmsIndex, referenceEntryAt, referenceIndex, referenceNavigation, referenceOnlySlugs, referencePage, referencePager, writtenPages } from './content/reference'
import { groupIcons, taxonomyPath } from './content/reference-taxonomy'
import { createSourceContext, currentLocale, githubUrl, pageLocale, readRepositoryFile, refreshSources, siteOrigin, withSourceContext } from './content/repository'
import { docsLocales, localizedPath } from './locale'
import { emptyOverlay } from './sources/overlay'

/** Options of {@link buildSnapshotPages}. */
export interface BuildSnapshotOptions {
	/**
	 * Published revisions to render instead of the files of the repository, by path from its root.
	 * Without it, every page comes from Git.
	 */
	readonly overlay?: SourceOverlay
	/**
	 * The languages to render, each in a context of its own with the same overlay: every language
	 * of the documentation by default. A translated language reads `docs/en/**` and falls back to
	 * the Spanish original page by page.
	 */
	readonly locales?: readonly DocsLocale[]
}

/** The source of the generated index of every export, shown on its page. */
const exportSource = 'packages/docs-content/src/content/api-groups.ts'

/** The component the home page runs. */
const exampleFile = 'examples/counter/Counter.meeko'

/** What a line of the demo does with its signals. */
function markOf(line: string): 'count' | 'doubled' | 'render' | undefined {
	if (/\bsignal\(/.test(line)) return 'count'
	if (/\bcomputed\(/.test(line)) return 'doubled'
	if (/\{count\.value\}/.test(line)) return 'render'
	return undefined
}

let renders: Promise<unknown> = Promise.resolve()

/**
 * Every page of the public site in every language, rendered from the repository and, with
 * `overlay`, from the published revisions: the home page, the guides, the API reference,
 * `llms.txt` and `llms-full.txt`. The result is what {@link publishSnapshot} stores; nothing is
 * written. Each page carries its `locale`; its path has no language prefix, and in a translated
 * language the links of its payload do ({@link localizePayload}) and its `i18n` says whether it is
 * translated or a fallback.
 *
 * Each call renders each language in a new source context: it reads the working tree again, and
 * neither its overlay nor its caches reach other callers. It also refreshes the caches of callers
 * outside a render, so after a publication they read the repository again too. Calls of one
 * process run one after another only to bound memory, since each builds its own TypeScript program.
 */
export function buildSnapshotPages(options: BuildSnapshotOptions = {}): Promise<SnapshotPage[]> {
	refreshSources()
	const overlay = options.overlay ?? emptyOverlay
	const locales = [...new Set(options.locales ?? docsLocales)]
	const run = renders.then(async () => {
		const pages: SnapshotPage[] = []
		for (const locale of locales) pages.push(...(await withSourceContext(createSourceContext(overlay, locale), renderPages)))
		return pages
	})
	renders = run.catch(() => undefined)
	return run
}

/** An internal URL of the site: `/`, `/docs…` or the llms files, with its query and fragment. */
const siteUrl = /^\/(?:docs(?=$|[/?#])[^\s"]*|llms(?:-full)?\.txt(?=$|[?#])[^\s"]*|[?#][^\s"]*)?$/

/**
 * `payload` with every internal link in `locale`: each string that is an internal URL
 * (`/docs/api`, `/`) and each `href="…"` of its HTML get the prefix of the language (`/en/docs/api`).
 * Spanish is returned as it is. Links to GitHub and other sites never change.
 */
export function localizePayload<T>(payload: T, locale: DocsLocale): T {
	if (locale === 'es') return payload
	const localize = (value: unknown): unknown => {
		if (typeof value === 'string') {
			if (siteUrl.test(value)) return localizedPath(value, locale)
			return value.includes('href="/') ? value.replace(/\bhref="(\/[^"]*)"/g, (whole, href: string) => (siteUrl.test(href) ? `href="${localizedPath(href, locale)}"` : whole)) : value
		}
		if (Array.isArray(value)) return value.map(localize)
		if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, localize(item)]))
		return value
	}
	return localize(JSON.parse(JSON.stringify(payload)) as unknown) as T
}

/** Renders every page in the language of the current context. */
async function renderPages(): Promise<SnapshotPage[]> {
	const locale = currentLocale()
	const text = messages()
	const pages: SnapshotPage[] = []
	/**
	 * Adds a page. `original` is the Markdown file its content comes from, `null` for content that is
	 * never translated (a page generated from the JSDoc) and `undefined` for a page with nothing to
	 * translate (the home page, an index, the llms files).
	 */
	const add = (path: string, payload: unknown, original?: string | null): void => {
		const i18n: PageLocale = original === undefined ? { locale, status: null, fallback: false } : pageLocale(original)
		const content = localizePayload(payload, locale)
		pages.push({ path, locale, translation: i18n.status, payload: content && typeof content === 'object' && !Array.isArray(content) ? { ...content, i18n } : content })
	}

	const tokenize = await createTokenizer()
	const exampleText = readRepositoryFile(exampleFile).trim()
	const exampleLines = exampleText.split('\n')
	const demoLines = tokenize(exampleText, 'meeko').map((tokens, index) => {
		const html = tokens.map((token) => `<span style="${escapeHtml(token.style)}">${escapeHtml(token.content)}</span>`).join('')
		const mark = markOf(exampleLines[index] ?? '')
		return mark ? { html, mark } : { html }
	})
	const demo = {
		file: exampleFile,
		url: githubUrl(exampleFile),
		lines: demoLines,
		countLine: exampleLines.findIndex((line) => markOf(line) === 'count') + 1,
		doubledLine: exampleLines.findIndex((line) => markOf(line) === 'doubled') + 1,
	}
	const command = `pnpm exec meeko init-framework ${text.appName}`
	const highlight = await createHighlight()
	add('/', {
		demo,
		editorLines: demoLines.slice(9, 17).map((line, index) => ({ html: line.html, number: index + 10, count: 'mark' in line && line.mark === 'count' })),
		command,
		quickStart: codeBlockHtml('terminal', highlight([command, `cd ${text.appName}`, 'npm install', 'npm run dev'].join('\n'), 'shellscript')),
		version: (JSON.parse(readRepositoryFile('package.json')) as { version: string }).version,
		head: { title: text.homeTitle, description: text.homeDescription },
	})

	const guides = await Promise.all(
		catalog.map(async (entry) => {
			const doc = await renderSource(entry.source, entry.transform)
			const transform = entry.transform ?? ((text: string): string => text)
			return { entry, doc, markdown: transform(readRepositoryFile(entry.source)) }
		}),
	)
	const sections = [...new Set(guides.map(({ entry }) => entry.section))].map((title) => ({
		title: catalogSection(title),
		docs: guides.filter(({ entry }) => entry.section === title).map(({ entry, doc }) => ({ href: entry.href, section: entry.section, title: doc.title, description: doc.description })),
	}))
	add('/docs', { sections })
	for (const { entry, doc } of guides) {
		add(
			entry.href,
			{
				doc,
				nav: navigation(),
				pages: pager(entry.href),
				current: entry.href,
				head: { title: `${doc.title} · Meeko`, description: doc.description },
			},
			entry.source,
		)
	}

	const groups = await referenceIndex()
	const firstEntry = groups[0]?.entries[0]
	const apiGuide = catalog.find((entry) => entry.href === '/docs/api')
	add(referenceHref, {
		groups,
		total: groups.reduce((sum, group) => sum + group.entries.length, 0),
		modules: apiGroups().map((group) => ({ id: group.id, label: group.specifier ?? group.title, href: groupHref(group), code: group.specifier !== null })),
		exportsIcon: groupIcons.exports,
		exportsLink: exportsHref,
		nav: await referenceNavigation(),
		current: referenceHref,
		toc: [...groups.map((group) => ({ id: group.anchor, text: group.title, level: 2 })), { id: 'todos-los-exports', text: text.allExports, level: 2 }],
		pages: { previous: { href: '/docs/api', label: apiGuide ? catalogLabel(apiGuide) : 'API' }, next: firstEntry ? { href: firstEntry.href, label: firstEntry.name } : null },
		source: taxonomyPath,
		editUrl: githubUrl(taxonomyPath, 'edit'),
		head: { title: `${text.reference} · Meeko`, description: text.referenceDescription },
	})

	const exportGroups = await apiIndex()
	const items = exportGroups.flatMap((group) => group.sections.flatMap((section) => section.items))
	const firstExport = exportGroups[0]?.sections[0]?.items[0]
	add(exportsHref, {
		groups: exportGroups,
		total: items.length,
		kinds: apiKinds()
			.map((entry) => ({ ...entry, count: items.filter((item) => item.kind === entry.kind).length }))
			.filter((entry) => entry.count > 0),
		nav: await referenceNavigation(),
		current: exportsHref,
		toc: exportGroups.map((group) => ({ id: group.id, text: group.specifier ?? group.title, level: 2 })),
		pages: { previous: { href: referenceHref, label: text.reference }, next: firstExport ? { href: firstExport.href, label: firstExport.name } : null },
		index: referenceHref,
		source: exportSource,
		editUrl: githubUrl(exportSource, 'edit'),
		head: { title: `${text.allExports} · ${text.reference} · Meeko`, description: text.exportsDescription },
	})

	for (const symbol of new Set([...(await apiSlugs()), ...(await referenceOnlySlugs())])) {
		const href = apiHref(symbol)
		const written = (await referencePage(symbol)) ?? null
		const page = written ? null : ((await apiPage(symbol)) ?? null)
		if (!written && !page) throw new Error(`Missing reference page: ${symbol}`)
		const entry = await referenceEntryAt(href)
		const title = written?.title ?? page?.name ?? symbol
		add(
			href,
			{
				written,
				page,
				nav: await referenceNavigation(),
				current: entry ? entry.href : (page?.group.href ?? referenceHref),
				pages: (await referencePager(href)) ?? (await apiPager(symbol)),
				toc: written?.toc ?? page?.toc ?? [],
				editUrl: written?.editUrl ?? page?.editUrl ?? '',
				editPath: written?.editPath ?? page?.editPath ?? '',
				index: referenceHref,
				searchTitle: `title:${title} · ${written ? written.kindLabel : (page?.specifier ?? text.meekoSyntax)}`,
				head: {
					title: `${title} · ${text.reference} · Meeko`,
					description: written?.description ?? (page ? page.summary || text.kindOf(page.name, page.kindLabel, page.specifier ?? text.meekoComponents) : ''),
				},
			},
			written ? (writtenPages().find((candidate) => candidate.slug === written.slug)?.file ?? null) : null,
		)
	}

	const origin = `${siteOrigin}${locale === 'es' ? '' : `/${locale}`}`
	add('/llms.txt', {
		text: await llmsIndex(
			origin,
			guides.map(({ entry, doc }) => ({ title: doc.title, href: entry.href, description: doc.description })),
		),
	})
	add('/llms-full.txt', {
		text: await llmsFull(
			origin,
			guides.map(({ entry, doc, markdown }) => ({ title: doc.title, href: entry.href, markdown })),
		),
	})
	return pages
}
