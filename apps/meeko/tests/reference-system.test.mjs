import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { after, before, test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let vite
let reference
let api
let apiGroups

before(async () => {
	vite = await createServer({ root: site, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
	reference = await vite.ssrLoadModule('meeko-docs-content/content/reference')
	api = await vite.ssrLoadModule('meeko-docs-content/content/api')
	apiGroups = await vite.ssrLoadModule('meeko-docs-content/content/api-groups')
})

after(async () => {
	await vite?.close()
})

test('generated type follows usage and ignores headings inside fences', () => {
	const body = '## Uso\n\n```md\n## Falso\n~~~\n```\n\n### Ejemplo\n\n## Parámetros\n\nTexto'
	const result = reference.withGeneratedSections(body)
	assert.ok(result.indexOf('### Ejemplo') < result.indexOf('## Tipo'))
	assert.ok(result.indexOf('## Tipo') < result.indexOf('## Parámetros'))
	assert.equal((result.match(/## Tipo/g) ?? []).length, 1)
})

test('the curated index and compact navigation link to the taxonomy and exports', async () => {
	const taxonomy = await reference.resolvedTaxonomy()
	const index = await reference.referenceIndex()
	const navigation = await reference.referenceNavigation()
	assert.equal(index.length, taxonomy.groups.length)
	assert.equal(
		index.reduce((count, group) => count + group.entries.length, 0),
		taxonomy.entries.length,
	)
	assert.ok(index.every((group) => group.entries.every((entry) => entry.href.startsWith('/docs/'))))
	assert.ok(navigation.some((section) => section.links.some((link) => link.href === '/docs/reference/exports')))
	assert.ok(navigation.some((section) => section.links.some((link) => link.href === '/docs/reference')))
	assert.ok(navigation.every((section) => section.links.length <= taxonomy.groups.length + 1))
})

test('the exhaustive index covers every public export group with working reference paths', async () => {
	const groups = await api.apiIndex()
	const known = new Set(apiGroups.apiGroups().map((group) => group.id))
	assert.ok(groups.length > 0)
	assert.ok(groups.every((group) => known.has(group.id)))
	const items = groups.flatMap((group) => group.sections.flatMap((section) => section.items))
	assert.ok(items.length > 0)
	assert.ok(items.every((item) => item.href.startsWith('/docs/reference/')))
	assert.equal(new Set(items.map((item) => item.href)).size, items.length)
})
