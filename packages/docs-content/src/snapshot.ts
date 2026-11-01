import type { SnapshotPage } from './db/snapshots'
import type { SourceOverlay } from './sources/overlay'

import { apiHref, apiIndex, apiKinds, apiPage, apiPager, apiSlugs } from './content/api'
import { apiGroups, exportsHref, groupHref, referenceHref } from './content/api-groups'
import { catalog, navigation, pager } from './content/catalog'
import { createHighlight, createTokenizer } from './content/highlight'
import { codeBlockHtml, escapeHtml, renderSource } from './content/markdown'
import { llmsFull, llmsIndex, referenceEntryAt, referenceIndex, referenceNavigation, referenceOnlySlugs, referencePage, referencePager } from './content/reference'
import { groupIcons, taxonomyPath } from './content/reference-taxonomy'
import { createSourceContext, githubUrl, readRepositoryFile, refreshSources, siteOrigin, withSourceContext } from './content/repository'
import { emptyOverlay } from './sources/overlay'

/** Options of {@link buildSnapshotPages}. */
export interface BuildSnapshotOptions {
	/**
	 * Published revisions to render instead of the files of the repository, by path from its root.
	 * Without it, every page comes from Git.
	 */
	readonly overlay?: SourceOverlay
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
 * Every page of the public site, rendered from the repository and, with `overlay`, from the
 * published revisions: the home page, the guides, the API reference, `llms.txt` and
 * `llms-full.txt`. The result is what {@link publishSnapshot} stores; nothing is written.
 *
 * Each call renders in a new source context: it reads the working tree again, and neither its
 * overlay nor its caches reach other callers. It also refreshes the caches of callers outside a
 * render, so after a publication they read the repository again too. Calls of one process run one
 * after another only to bound memory, since each builds its own TypeScript program.
 */
export function buildSnapshotPages(options: BuildSnapshotOptions = {}): Promise<SnapshotPage[]> {
	refreshSources()
	const context = createSourceContext(options.overlay ?? emptyOverlay)
	const run = renders.then(() => withSourceContext(context, renderPages))
	renders = run.catch(() => undefined)
	return run
}

async function renderPages(): Promise<SnapshotPage[]> {
	const pages: SnapshotPage[] = []
	const add = (path: string, payload: unknown): void => {
		pages.push({ path, payload })
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
	const command = 'pnpm exec meeko init-framework mi-app'
	const highlight = await createHighlight()
	add('/', {
		demo,
		editorLines: demoLines.slice(9, 17).map((line, index) => ({ html: line.html, number: index + 10, count: 'mark' in line && line.mark === 'count' })),
		command,
		quickStart: codeBlockHtml('terminal', highlight([command, 'cd mi-app', 'npm install', 'npm run dev'].join('\n'), 'shellscript')),
		version: (JSON.parse(readRepositoryFile('package.json')) as { version: string }).version,
		head: {
			title: 'Meeko · Componentes .meeko tipados, SSR e hidratación para TypeScript',
			description: 'Meeko es un motor de componentes para TypeScript y un framework full-stack: archivos .meeko tipados, signals, SSR con hidratación, API y RPC tipados y despliegue en Node, Bun, Deno y Cloudflare.',
		},
	})

	const guides = await Promise.all(
		catalog.map(async (entry) => {
			const doc = await renderSource(entry.source, entry.transform)
			const transform = entry.transform ?? ((text: string): string => text)
			return { entry, doc, markdown: transform(readRepositoryFile(entry.source)) }
		}),
	)
	const sections = [...new Set(guides.map(({ entry }) => entry.section))].map((title) => ({
		title,
		docs: guides.filter(({ entry }) => entry.section === title).map(({ entry, doc }) => ({ href: entry.href, section: entry.section, title: doc.title, description: doc.description })),
	}))
	add('/docs', { sections })
	for (const { entry, doc } of guides) {
		add(entry.href, {
			doc,
			nav: navigation(),
			pages: pager(entry.href),
			current: entry.href,
			head: { title: `${doc.title} · Meeko`, description: doc.description },
		})
	}

	const groups = await referenceIndex()
	const firstEntry = groups[0]?.entries[0]
	add(referenceHref, {
		groups,
		total: groups.reduce((sum, group) => sum + group.entries.length, 0),
		modules: apiGroups().map((group) => ({ id: group.id, label: group.specifier ?? group.title, href: groupHref(group), code: group.specifier !== null })),
		exportsIcon: groupIcons.exports,
		exportsLink: exportsHref,
		nav: await referenceNavigation(),
		current: referenceHref,
		toc: [...groups.map((group) => ({ id: group.anchor, text: group.title, level: 2 })), { id: 'todos-los-exports', text: 'Todos los exports', level: 2 }],
		pages: { previous: { href: '/docs/api', label: 'Componentes y API' }, next: firstEntry ? { href: firstEntry.href, label: firstEntry.name } : null },
		source: taxonomyPath,
		editUrl: githubUrl(taxonomyPath, 'edit'),
		head: {
			title: 'Referencia de la API · Meeko',
			description: 'Cada componente, macro, composable, función de reactividad, utilidad, directiva, API de servidor, adaptador, comando y opción de configuración de Meeko, con su tipo exacto, ejemplos y errores comunes.',
		},
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
		pages: { previous: { href: referenceHref, label: 'Referencia de la API' }, next: firstExport ? { href: firstExport.href, label: firstExport.name } : null },
		index: referenceHref,
		source: exportSource,
		editUrl: githubUrl(exportSource, 'edit'),
		head: {
			title: 'Todos los exports · Referencia de la API · Meeko',
			description: 'Una página por cada export público de @meekojs/meeko y por cada macro, etiqueta y directiva de los componentes .meeko, generada desde el código fuente.',
		},
	})

	for (const symbol of new Set([...(await apiSlugs()), ...(await referenceOnlySlugs())])) {
		const href = apiHref(symbol)
		const written = (await referencePage(symbol)) ?? null
		const page = written ? null : ((await apiPage(symbol)) ?? null)
		if (!written && !page) throw new Error(`Missing reference page: ${symbol}`)
		const entry = await referenceEntryAt(href)
		const title = written?.title ?? page?.name ?? symbol
		add(href, {
			written,
			page,
			nav: await referenceNavigation(),
			current: entry ? entry.href : (page?.group.href ?? referenceHref),
			pages: (await referencePager(href)) ?? (await apiPager(symbol)),
			toc: written?.toc ?? page?.toc ?? [],
			editUrl: written?.editUrl ?? page?.editUrl ?? '',
			editPath: written?.editPath ?? page?.editPath ?? '',
			index: referenceHref,
			searchTitle: `title:${title} · ${written ? written.kindLabel : (page?.specifier ?? 'sintaxis de .meeko')}`,
			head: {
				title: `${title} · Referencia de la API · Meeko`,
				description: written?.description ?? (page ? page.summary || `${page.name}, ${page.kindLabel} de ${page.specifier ?? 'los componentes .meeko'}.` : ''),
			},
		})
	}

	add('/llms.txt', {
		text: await llmsIndex(
			siteOrigin,
			guides.map(({ entry, doc }) => ({ title: doc.title, href: entry.href, description: doc.description })),
		),
	})
	add('/llms-full.txt', {
		text: await llmsFull(
			siteOrigin,
			guides.map(({ entry, doc, markdown }) => ({ title: doc.title, href: entry.href, markdown })),
		),
	})
	return pages
}
