// Each render reads the repository in its own source context: neither its overlay nor its caches
// reach another render or a reader outside it, and a later render sees the working tree again.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'

import type { SnapshotPage } from '../src/db/snapshots'

import { documentHeadings, renderSource } from '../src/content/markdown'
import { parseWrittenPage, writtenPages } from '../src/content/reference'
import { createSourceContext, currentOverlay, readGitFile, readRepositoryFile, refreshSources, repositoryRoot, withSourceContext, withSourceOverlay } from '../src/content/repository'
import { buildSnapshotPages } from '../src/snapshot'
import { createOverlay, emptyOverlay } from '../src/sources/overlay'

const reference = 'docs/reference/reactivity/signal.md'
const guide = 'docs/doctor.md'

/**
 * Makes the working tree return `change(text)` for `file` until the returned function runs, as an
 * edit on disk would, without writing anything: the readers import `readFileSync` from `node:fs`.
 */
function changeOnDisk(file: string, change: (text: string) => string): () => void {
	const target = resolve(repositoryRoot(), file).toLowerCase()
	const original = fs.readFileSync
	const patched = ((path: fs.PathOrFileDescriptor, options?: unknown) => {
		const text = original(path, options as BufferEncoding)
		return typeof path === 'string' && resolve(path).toLowerCase() === target ? change(String(text)) : text
	}) as typeof fs.readFileSync
	fs.readFileSync = patched
	syncBuiltinESMExports()
	return () => {
		fs.readFileSync = original
		syncBuiltinESMExports()
	}
}

const retitle = (title: string) => (text: string) => text.replace(/^title: .*$/m, `title: ${title}`)

function signalTitle(): string | undefined {
	return writtenPages().find((page) => page.file === reference)?.title
}

function pageAt<T>(pages: readonly SnapshotPage[], path: string): T {
	const page = pages.find((candidate) => candidate.path === path)
	assert.ok(page, path)
	return page.payload as T
}

test('two renders without revisions read the working tree again', async () => {
	const before = await buildSnapshotPages()
	assert.equal(pageAt<{ written: { title: string } }>(before, '/docs/reference/signal').written.title, 'signal')
	const restore = changeOnDisk(reference, retitle('Título cambiado en disco'))
	const restoreGuide = changeOnDisk(guide, (text) => text.replace(/^# .*$/m, '# Doctor en disco'))
	try {
		const after = await buildSnapshotPages()
		assert.equal(pageAt<{ written: { title: string } }>(after, '/docs/reference/signal').written.title, 'Título cambiado en disco', 'the written pages are read again')
		assert.equal(pageAt<{ doc: { title: string } }>(after, '/docs/doctor').doc.title, 'Doctor en disco')
		assert.match(pageAt<{ text: string }>(after, '/llms.txt').text, /Doctor en disco/)
	} finally {
		restoreGuide()
		restore()
	}
	// The second render refreshed the caches of callers outside a render: they read Git again.
	assert.equal(signalTitle(), 'signal')
})

test('a context reads each file once, so a render sees one version of the working tree', async () => {
	await withSourceOverlay(emptyOverlay, async () => {
		const first = signalTitle()
		const restore = changeOnDisk(reference, retitle('Cambio a mitad del render'))
		try {
			assert.equal(readRepositoryFile(reference), readRepositoryFile(reference))
			assert.equal(signalTitle(), first, 'the pages of this render stay as it read them')
			assert.match(readGitFile(reference), /Cambio a mitad del render/, 'Git itself did change')
		} finally {
			restore()
		}
	})
})

test('concurrent contexts and readers outside them do not see each other', async () => {
	const original = await renderSource(guide)
	const gitHeadings = [...(await documentHeadings(guide)).keys()]
	let release!: () => void
	const gate = new Promise<void>((resolve) => {
		release = resolve
	})
	const reader = (name: string) =>
		withSourceOverlay(
			createOverlay([
				{ file: guide, markdown: `# Doctor ${name}\n\n## Sección ${name}\n` },
				{ file: reference, markdown: retitle(`signal ${name}`)(readGitFile(reference)) },
			]),
			async () => {
				const early = { text: readRepositoryFile(guide), title: signalTitle() }
				await gate
				return {
					early,
					text: readRepositoryFile(guide),
					title: signalTitle(),
					doc: (await renderSource(guide)).title,
					headings: [...(await documentHeadings(guide)).keys()],
					overlay: [...currentOverlay().keys()].sort(),
				}
			},
		)
	const one = reader('uno')
	const two = reader('dos')
	// Both renders are suspended inside their context: a reader outside sees Git only.
	await new Promise((resolve) => setImmediate(resolve))
	assert.equal(currentOverlay().size, 0)
	assert.equal(readRepositoryFile(guide), readGitFile(guide))
	assert.equal((await renderSource(guide)).title, original.title)
	assert.deepEqual([...(await documentHeadings(guide)).keys()], gitHeadings)
	assert.equal(signalTitle(), 'signal')
	release()
	const [first, second] = await Promise.all([one, two])
	for (const [result, name] of [
		[first, 'uno'],
		[second, 'dos'],
	] as const) {
		assert.equal(result.early.text, result.text, name)
		assert.match(result.text, new RegExp(`^# Doctor ${name}`))
		assert.equal(result.title, `signal ${name}`)
		assert.equal(result.early.title, result.title)
		assert.equal(result.doc, `Doctor ${name}`)
		assert.deepEqual(result.headings, [`doctor-${name}`, `sección-${name}`])
		assert.deepEqual(result.overlay, [guide, reference])
	}
})

test('withSourceContext shares one context across calls, apart from callers outside it', async () => {
	const context = createSourceContext()
	const [first, second] = await withSourceContext(context, async () => [writtenPages(), await Promise.resolve().then(writtenPages)])
	assert.equal(first, second, 'the pages are derived once per context')
	assert.notEqual(writtenPages(), first, 'callers outside it have their own caches')
	assert.notEqual(await withSourceOverlay(emptyOverlay, async () => writtenPages()), first, 'and every new context its own')
})

test('outside a render, values derive from Git until refreshSources', () => {
	refreshSources()
	const first = writtenPages()
	assert.equal(writtenPages(), first, 'callers outside a render share them')
	const restore = changeOnDisk(reference, retitle('Título nuevo'))
	try {
		assert.equal(signalTitle(), 'signal', 'until they are refreshed')
		refreshSources()
		assert.equal(signalTitle(), 'Título nuevo')
	} finally {
		restore()
		refreshSources()
	}
	assert.equal(signalTitle(), 'signal')
})

test('the frontmatter validator is the one the render uses', () => {
	const text = readGitFile(reference)
	assert.equal(parseWrittenPage(text, reference).title, 'signal')
	assert.throws(() => parseWrittenPage('---\ntitle: signal\n---\nCuerpo\n', reference), /needs since/)
	assert.throws(() => parseWrittenPage(text.replace(/^---\n/, '---\nauthor: ana\n'), reference), /unknown frontmatter keys: author/)
	assert.throws(() => parseWrittenPage('sin frontmatter', reference), /must start with a frontmatter/)
})
