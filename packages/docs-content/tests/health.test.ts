import assert from 'node:assert/strict'
import { test } from 'node:test'

import type { LinkTargets } from '../src/health'

import { repositoryUrl } from '../src/content/repository'
import { checkLink, documentBrokenLinks, markdownLinks, repositoryLinkTargets } from '../src/health'

/** A site with one guide, `/docs/guia` (`docs/guia.md`, anchor `uso`), and one reference page. */
const targets: LinkTargets = {
	guides: new Map([['/docs/guia', 'docs/guia.md']]),
	references: new Set(['signal']),
	anchors: async (file) => new Set(file === 'docs/guia.md' ? ['uso'] : []),
	fileExists: (file) => file === 'docs/guia.md' || file === 'packages/ui/README.md',
}

test('markdownLinks finds the links outside code, with their line', () => {
	const text = ['# Título', '', 'Ver [la guía](/docs/guia#uso) y [otra](#abajo).', '', '```md', '[no](/docs/x)', '```', '', '- [en lista](https://example.com)'].join('\n')
	assert.deepEqual(markdownLinks(text), [
		{ href: '/docs/guia#uso', line: 3 },
		{ href: '#abajo', line: 3 },
		{ href: 'https://example.com', line: 9 },
	])
})

test('checkLink tells missing pages, anchors and files from links that work', async () => {
	const own = new Set(['propia'])
	const ok = async (href: string) => assert.equal(await checkLink(href, 'docs/otra.md', own, targets), null, href)
	await ok('/docs/guia')
	await ok('/docs/guia#uso')
	await ok('#propia')
	await ok('/docs/reference/signal')
	await ok('/docs/reference')
	await ok('https://example.com/docs/nada')
	await ok(`${repositoryUrl}/blob/main/packages/ui/README.md`)
	assert.deepEqual(await checkLink('/docs/guia#nada', 'docs/otra.md', own, targets), { target: '/docs/guia#nada', reason: 'anchor' })
	assert.deepEqual(await checkLink('#nada', 'docs/otra.md', own, targets), { target: '#nada', reason: 'anchor' })
	assert.deepEqual(await checkLink('/docs/reference/effect', 'docs/otra.md', own, targets), { target: '/docs/reference/effect', reason: 'page' })
	assert.deepEqual(await checkLink('/docs/inexistente', 'docs/otra.md', own, targets), { target: '/docs/inexistente', reason: 'page' })
	assert.equal((await checkLink(`${repositoryUrl}/blob/main/packages/nada.md`, 'docs/otra.md', own, targets))?.reason, 'file')
})

test('documentBrokenLinks reports each broken link with its file and line', async () => {
	const text = ['Intro.', '', '[bien](/docs/guia#uso)', '', '[mal](/docs/guia#falta)'].join('\n')
	assert.deepEqual(await documentBrokenLinks(text, 'docs/otra.md', new Set(), targets, 10), [{ file: 'docs/otra.md', line: 14, href: '/docs/guia#falta', target: '/docs/guia#falta', reason: 'anchor' }])
})

test('checkLink ignores the query string and checks the fragment by the page', async () => {
	const own = new Set<string>()
	assert.equal(await checkLink('/docs/guia?modo=x#uso', 'docs/otra.md', own, targets), null)
	assert.equal(await checkLink('/docs/guia?modo=x', 'docs/otra.md', own, targets), null)
	assert.deepEqual(await checkLink('/docs/guia?modo=x#falta', 'docs/otra.md', own, targets), { target: '/docs/guia?modo=x#falta', reason: 'anchor' })
	assert.deepEqual(await checkLink('/docs/nada?modo=x', 'docs/otra.md', own, targets), { target: '/docs/nada?modo=x', reason: 'page' })
})

test('checkLink checks the anchors of the reference pages and of its indexes', async () => {
	const own = new Set<string>()
	const withAnchors: LinkTargets = {
		...targets,
		referenceAnchors: async (path) => (path === '/docs/reference/signal' ? new Set(['uso', 'tipo']) : path === '/docs/reference' ? new Set(['reactividad']) : path === '/docs/reference/exports' ? new Set(['meeko']) : undefined),
	}
	for (const href of ['/docs/reference/signal#uso', '/docs/reference/signal#tipo', '/docs/reference#reactividad', '/docs/reference/exports#meeko', '/docs/reference/signal']) assert.equal(await checkLink(href, 'docs/otra.md', own, withAnchors), null, href)
	for (const href of ['/docs/reference/signal#no-existe', '/docs/reference#no-existe', '/docs/reference/exports#no-existe']) assert.deepEqual(await checkLink(href, 'docs/otra.md', own, withAnchors), { target: href, reason: 'anchor' }, href)
	// Without the anchors of a page, its fragments are not checked.
	assert.equal(await checkLink('/docs/reference/signal#no-existe', 'docs/otra.md', own, targets), null)
})

test('the repository targets know the anchors of written and generated reference pages and of the indexes', { timeout: 120_000 }, async () => {
	const repository = await repositoryLinkTargets()
	const own = new Set<string>()
	const check = (href: string) => checkLink(href, 'docs/api.md', own, repository)
	// Written page: its headings and the generated «Tipo» and «Relacionado».
	assert.equal(await check('/docs/reference/signal#uso'), null)
	assert.equal(await check('/docs/reference/signal#tipo'), null)
	assert.equal(await check('/docs/reference/signal#relacionado'), null)
	assert.equal((await check('/docs/reference/signal#no-existe'))?.reason, 'anchor')
	// Indexes.
	assert.equal(await check('/docs/reference#todos-los-exports'), null)
	assert.equal((await check('/docs/reference#no-existe'))?.reason, 'anchor')
	assert.equal((await check('/docs/reference/exports#no-existe'))?.reason, 'anchor')
	// A generated page: one without a written page, with its rendered sections.
	const { apiSlugs, apiPage } = await import('../src/content/api')
	const written = new Set((await import('../src/content/reference')).writtenPages().map((page) => page.slug))
	const slug = (await apiSlugs()).find((candidate) => !written.has(candidate))!
	const page = (await apiPage(slug))!
	const first = page.toc[0]
	if (first) assert.equal(await check(`/docs/reference/${slug}#${first.id}`), null)
	assert.equal((await check(`/docs/reference/${slug}#no-existe`))?.reason, 'anchor')
})
