import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { documentHeadings, renderSource } from '../src/content/markdown'
import { writtenPages } from '../src/content/reference'
import { readGitFile, readRepositoryFile, withSourceOverlay } from '../src/content/repository'
import { collectRepositorySources, firstHeading } from '../src/sources/discover'
import { findGitVersion } from '../src/sources/history'
import { parseNavigation } from '../src/sources/navigation'
import { contentHash, createOverlay } from '../src/sources/overlay'

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
	const originals = sources.filter((source) => (source.locale ?? 'es') === 'es')
	const guide = originals.find((source) => source.site === 'site' && source.path === '/docs/inicio-rapido')
	assert.equal(guide?.kind, 'guide')
	assert.equal(guide?.file, 'docs/inicio-rapido.md')
	assert.equal(guide?.title, 'Inicio rápido', 'the title is the heading the site shows')
	assert.equal(guide?.markdown, readGitFile('docs/inicio-rapido.md'))
	const reference = originals.filter((source) => source.kind === 'reference')
	assert.equal(reference.length, writtenPages().length)
	assert.ok(reference.every((source) => source.path.startsWith('/docs/reference/') && source.file?.startsWith('docs/reference/')))
	for (const site of ['ui', 'i18n'] as const) {
		const pages = sources.filter((source) => source.site === site)
		assert.ok(pages.length > 3, site)
		assert.ok(pages.every((page) => page.kind === 'page' && page.file === null && page.markdown === null))
		assert.ok(pages.some((page) => page.path === '/installation'))
	}
})

test('findGitVersion finds the versions of a file from before it was renamed', () => {
	const cwd = mkdtempSync(join(tmpdir(), 'meeko-history-'))
	try {
		const git = (...args: string[]): string => {
			const result = spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', windowsHide: true })
			assert.equal(result.status, 0, result.stderr)
			return result.stdout.trim()
		}
		const commit = (file: string, text: string, message: string): string => {
			writeFileSync(join(cwd, file), text)
			git('add', '-A')
			git('commit', '-q', '-m', message)
			return git('rev-parse', 'HEAD')
		}
		git('init', '-q')
		mkdirSync(join(cwd, 'packages'))
		mkdirSync(join(cwd, 'docs'))
		const body = 'Texto suficiente para que Git reconozca el archivo al moverlo.\n'.repeat(5)
		const first = commit('packages/guía.md', `# Uno\n\n${body}`, 'first')
		commit('packages/guía.md', `# Dos\n\n${body}`, 'second')
		git('mv', 'packages/guía.md', 'docs/guía.md')
		git('commit', '-q', '-m', 'move')
		// The newest commit with a text wins: the move still has the second version.
		const moved = git('rev-parse', 'HEAD')
		const third = commit('docs/guía.md', `# Tres\n\n${body}`, 'third')

		for (const [title, sha] of [
			['Uno', first],
			['Dos', moved],
			['Tres', third],
		] as const) {
			const text = `# ${title}\n\n${body}`
			assert.deepEqual(findGitVersion('docs/guía.md', contentHash(text), { cwd }), { commit: sha, text }, title)
		}
		assert.equal(findGitVersion('docs/guía.md', contentHash('nunca existió\n'), { cwd }), null)
	} finally {
		rmSync(cwd, { recursive: true, force: true })
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
