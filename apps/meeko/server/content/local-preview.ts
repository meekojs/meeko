import type { DocsLocale } from 'meeko-docs-content/locale'

import { catalog, catalogEntry, catalogSection, docsIndexSlugs, navigation, pager } from 'meeko-docs-content/content/catalog'
import { createHighlight } from 'meeko-docs-content/content/highlight'
import { codeBlockHtml, renderSource } from 'meeko-docs-content/content/markdown'
import { messages } from 'meeko-docs-content/content/messages'
import { referenceNavigation } from 'meeko-docs-content/content/reference'
import { createSourceContext, pageLocale, withSourceContext } from 'meeko-docs-content/content/repository'
import { localizePayload } from 'meeko-docs-content/render'
import { readPage as readSnapshotPage } from 'meeko-docs-content/snapshots'

/** Render a guide from the working tree for local development without publishing a database snapshot. */
export function localGuide<T>(path: string, locale: DocsLocale): Promise<T | null> {
	const entry = path.startsWith('/docs/') ? catalogEntry(path.slice('/docs/'.length)) : undefined
	return withSourceContext(createSourceContext(undefined, locale), async () => {
		if (path === '/') {
			const previous = await readSnapshotPage<Record<string, unknown>>('/', { locale })
			if (!previous) return null
			const text = messages()
			const command = `npm exec --yes --package=@meekojs/meeko@1.9.0 -- meeko init-framework ${text.appName}`
			const highlight = await createHighlight()
			return {
				...previous,
				command,
				quickStart: codeBlockHtml('terminal', highlight([command, `cd ${text.appName}`, 'npm install', 'npm run dev'].join('\n'), 'shellscript')),
				version: '1.9.0',
				head: { title: text.homeTitle, description: text.homeDescription },
			} as T
		}
		if (path === '/docs') {
			const guides = await Promise.all(catalog.filter((item) => docsIndexSlugs.has(item.slug)).map(async (item) => ({ entry: item, doc: await renderSource(item.source, item.transform) })))
			const sections = [...new Set(guides.map(({ entry: item }) => item.section))].map((title) => ({
				title: catalogSection(title),
				docs: guides.filter(({ entry: item }) => item.section === title).map(({ entry: item, doc }) => ({ href: item.href, section: item.section, title: doc.title, description: doc.description })),
			}))
			return localizePayload({ sections }, locale) as T
		}
		if (path === '/docs/reference' || path.startsWith('/docs/reference/')) {
			const previous = await readSnapshotPage<Record<string, unknown>>(path, { locale })
			return previous ? ({ ...previous, nav: await referenceNavigation(path, String(previous.head && (previous.head as { title?: string }).title || path)), current: path } as T) : null
		}
		if (!entry) return null
		const doc = await renderSource(entry.source, entry.transform)
		return localizePayload(
			{
				doc,
				nav: navigation(),
				pages: pager(entry.href),
				current: entry.href,
				head: { title: `${doc.title} · Meeko`, description: doc.description },
				i18n: pageLocale(entry.source),
			},
			locale,
		) as T
	})
}
