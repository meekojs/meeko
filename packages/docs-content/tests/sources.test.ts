import assert from 'node:assert/strict'
import { test } from 'node:test'

import { documentHeadings, renderSource } from '../src/content/markdown'
import { writtenPages } from '../src/content/reference'
import { readGitFile, readRepositoryFile, withSourceOverlay } from '../src/content/repository'
import { collectRepositorySources, firstHeading } from '../src/sources/discover'
import { parseNavigation } from '../src/sources/navigation'
import { createOverlay } from '../src/sources/overlay'

test('firstHeading skips code blocks and inline markup', () => {
	assert.equal(firstHeading('```md\n# Not this\n```\n\n# The `real` title\n'), 'The real title')
	assert.equal(firstHeading('No heading\n## Second level\n'), undefined)
	assert.equal(firstHeading('~~~\n# hidden\n~~~\n#   Spaced #\n'), 'Spaced')
})

test('the navigation of a .meeko site is read from its syntax', async () => {
	const pages = await parseNavigation(
		`export const navigation = [
			{ title: 'Uno', items: [{ label: 'Inicio', href: '/', description: 'Portada' }, { label: 'Lab', href: '/lab', aliases: ['/es/lab'] }] },
			{ title: 'Dos', items: [{ label: 'Otra vez', href: '/lab' }] },
		] as const`,
		'navigation.ts',
	)
	assert.deepEqual(pages, [
		{ href: '/', label: 'Inicio', description: 'Portada', section: 'Uno' },
		{ href: '/lab', label: 'Lab', description: null, section: 'Uno' },
	])
	await assert.rejects(parseNavigation('export const navigation = [{ title: "x", items: [{ label: "y", href: base }] }]', 'nav.ts'), /plain literal/)
	await assert.rejects(parseNavigation('export const other = []', 'nav.ts'), /no "navigation" constant/)
	await assert.rejects(parseNavigation('export const navigation = [{ title: "x", items: [{ label: "y", href: "relative" }] }]', 'nav.ts'), /must be a path/)
})

test('the repository has Markdown sources for the site and pages for ui and i18n', async () => {
	const sources = await collectRepositorySources()
	const guide = sources.find((source) => source.site === 'site' && source.path === '/docs/inicio-rapido')
	assert.equal(guide?.kind, 'guide')
	assert.equal(guide?.file, 'packages/meeko/README.md')
	assert.equal(guide?.title, 'Inicio rápido', 'the title is the heading the site shows')
	assert.equal(guide?.markdown, readGitFile('README.md'))
	const reference = sources.filter((source) => source.kind === 'reference')
	assert.equal(reference.length, writtenPages().length)
	assert.ok(reference.every((source) => source.path.startsWith('/docs/reference/') && source.file?.startsWith('docs/reference/')))
	for (const site of ['ui', 'i18n'] as const) {
		const pages = sources.filter((source) => source.site === site)
		assert.ok(pages.length > 3, site)
		assert.ok(pages.every((page) => page.kind === 'page' && page.file === null && page.markdown === null))
		assert.ok(pages.some((page) => page.path === '/installation'))
	}
})

test('a render reads the published revision over Git and forgets it afterwards', async () => {
	const file = 'docs/doctor.md'
	const original = await renderSource(file)
	const headings = await documentHeadings(file)
	const overlay = createOverlay([{ file, markdown: '# Doctor editado\n\nTexto publicado desde el panel.\n\n## Sección nueva\n' }])
	const edited = await withSourceOverlay(overlay, async () => ({
		text: readRepositoryFile(file),
		doc: await renderSource(file),
		headings: await documentHeadings(file),
	}))
	assert.match(edited.text, /^# Doctor editado/)
	assert.equal(edited.doc.title, 'Doctor editado')
	assert.match(edited.doc.html, /Texto publicado desde el panel/)
	assert.deepEqual([...edited.headings.keys()], ['doctor-editado', 'sección-nueva'])
	// Without the overlay the cached headings of Git come back, not those of the revision.
	assert.equal(readRepositoryFile(file), readGitFile(file))
	assert.equal((await renderSource(file)).title, original.title)
	assert.deepEqual([...(await documentHeadings(file)).keys()], [...headings.keys()])
})
