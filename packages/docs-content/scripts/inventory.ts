// Regenera el inventario público desde el mismo snapshot que consume la web.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { apiHref, apiSlugs } from '../src/content/api'
import { catalogEntry } from '../src/content/catalog'
import { referenceSymbol, resolvedTaxonomy } from '../src/content/reference'
import { repositoryRoot } from '../src/content/repository'
import { buildSnapshotPages } from '../src/snapshot'
import { localizedPath } from '../src/locale'

function object(value: unknown): Record<string, unknown> {
	return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function string(value: unknown): string {
	return typeof value === 'string' ? value : ''
}

function links(html: string): string[] {
	const found = new Set<string>()
	for (const match of html.matchAll(/\bhref="([^"]+)"/g)) {
		const href = match[1]!.replaceAll('&amp;', '&')
		if (href.startsWith('/')) found.add(href)
	}
	return [...found].sort()
}

const pages = await buildSnapshotPages()
const curatedEntries = (await resolvedTaxonomy()).entries
const curated = new Set(curatedEntries.map((entry) => entry.href))
const deprecated = new Set(
	(await Promise.all(curatedEntries.map(async (entry) => ({ href: entry.href, deprecated: (await referenceSymbol(entry.entry.symbols[0]!))?.info?.deprecated })))).filter((entry) => entry.deprecated).map((entry) => entry.href),
)
const generated = new Set((await apiSlugs()).map(apiHref))
const shared = [...curated].filter((href) => generated.has(href)).length
const indexMetadata = Object.fromEntries(
	(['es', 'en'] as const).map((locale) => {
		const file = resolve(repositoryRoot(), `apps/meeko/app/locales/${locale}/docs.json`)
		const catalog = JSON.parse(readFileSync(file, 'utf8')) as { docs: { index: { headTitle: string; description: string } } }
		return [locale, catalog.docs.index]
	}),
)
const routes = pages
	.map((page) => {
		const payload = object(page.payload)
		const doc = object(payload.doc)
		const written = object(payload.written)
		const generatedPage = object(payload.page)
		const head = object(payload.head)
		const guide = page.path.startsWith('/docs/') ? catalogEntry(page.path.slice('/docs/'.length)) : undefined
		const kind = guide ? 'guide' : curated.has(page.path) ? 'curated-reference' : generated.has(page.path) ? 'generated-reference' : page.path === '/docs/reference' ? 'reference-index' : page.path === '/docs/reference/exports' ? 'exports-index' : page.path === '/docs' ? 'documentation-map' : page.path === '/' ? 'home' : 'other'
		const content = string(doc.html) || string(written.body) || string(generatedPage.html)
		const locale = page.locale ?? 'es'
		return {
			path: localizedPath(page.path, locale),
			kind,
			audience: kind === 'generated-reference' || kind === 'exports-index' ? 'expert' : kind === 'curated-reference' || kind === 'reference-index' ? 'developer' : 'learner',
			source: guide?.source ?? (string(doc.source) || string(written.editPath) || string(generatedPage.editPath) || (page.path === '/' ? 'apps/meeko/app/pages/index.meeko' : page.path === '/docs' ? 'apps/meeko/app/pages/docs/index.meeko' : 'packages/docs-content/src/snapshot.ts')),
			locale,
			translation: page.translation ?? (locale === 'es' ? 'original' : 'generated'),
			status: guide?.slug.startsWith('migration-') || guide?.slug === 'benchmarks' ? 'historical' : deprecated.has(page.path) || Boolean(generatedPage.deprecated) ? 'deprecated' : 'current',
			title: string(head.title) || string(doc.title) || string(written.title) || string(generatedPage.name) || (page.path === '/docs' ? indexMetadata[locale]?.headTitle : ''),
			purpose: string(head.description) || string(doc.description) || string(written.description) || string(generatedPage.summary) || (page.path === '/docs' ? indexMetadata[locale]?.description : ''),
			links: links(content),
			anchors: [...content.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]!),
		}
	})
	.sort((a, b) => a.path.localeCompare(b.path))

const inventory = {
	summary: {
		locales: [...new Set(routes.map((route) => route.locale))],
		routes: routes.length,
		guideSources: [...new Set(routes.filter((route) => route.kind === 'guide').map((route) => route.source))].length,
		curatedSymbols: curated.size,
		generatedSymbols: generated.size,
		sharedSymbols: shared,
		distinctReferenceDestinations: new Set([...curated, ...generated]).size,
	},
	routes,
}
const target = resolve(repositoryRoot(), process.argv[2] ?? 'docs/public-routes.generated.json')
writeFileSync(target, JSON.stringify(inventory, null, 2) + '\n')
console.log(JSON.stringify({ file: target, ...inventory.summary }))
