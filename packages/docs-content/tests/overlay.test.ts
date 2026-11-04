import assert from 'node:assert/strict'
import { test } from 'node:test'

import { contentHash, createOverlay, emptyOverlay, normalizeSourcePath, normalizeText, overlayReader, overlaySignature } from '../src/sources/overlay'

test('source paths are normalized and cannot leave the repository', () => {
	assert.equal(normalizeSourcePath('docs/api.md'), 'docs/api.md')
	assert.equal(normalizeSourcePath('/docs//./api.md'), 'docs/api.md')
	assert.equal(normalizeSourcePath('docs\\reference\\utils\\x.md'), 'docs/reference/utils/x.md')
	assert.throws(() => normalizeSourcePath('docs/../../secret.md'), /cannot leave/)
	assert.throws(() => normalizeSourcePath('./'), /cannot be empty/)
})

test('an overlay maps the published revisions by file, with \\n line endings', () => {
	const overlay = createOverlay([
		{ file: '/docs/api.md', markdown: '# API\r\n\r\nEditado.\r\n' },
		{ file: 'packages/meeko/README.md', markdown: '# Inicio\n' },
	])
	assert.deepEqual([...overlay.keys()], ['docs/api.md', 'packages/meeko/README.md'])
	assert.equal(overlay.get('docs/api.md'), '# API\n\nEditado.\n')
	assert.throws(
		() =>
			createOverlay([
				{ file: 'docs/api.md', markdown: 'a' },
				{ file: './docs/api.md', markdown: 'b' },
			]),
		/Two published revisions for docs\/api\.md/,
	)
})

test('the reader returns a revision over its file and Git for the rest', () => {
	const git = new Map([
		['docs/api.md', 'git api'],
		['docs/ui.md', 'git ui'],
		['packages/meeko/README.md', 'git readme'],
	])
	const read = (path: string): string => git.get(path) ?? assert.fail(`unexpected read of ${path}`)
	const overlay = createOverlay([{ file: 'packages/meeko/README.md', markdown: 'edited readme' }])
	// The site names the package README `README.md`; resolve maps it to its repository path.
	const resolve = (path: string): string => (path === 'README.md' ? 'packages/meeko/README.md' : normalizeSourcePath(path))
	const reader = overlayReader((path) => read(resolve(path)), overlay, resolve)
	assert.equal(reader('README.md'), 'edited readme')
	assert.equal(reader('docs/api.md'), 'git api')
	assert.equal(overlayReader(read, emptyOverlay), read, 'an empty overlay keeps the reader as is')
})

test('hashes and signatures depend on the content, not on line endings or order', () => {
	assert.equal(contentHash('a\r\nb'), contentHash('a\nb'))
	assert.match(contentHash(''), /^[0-9a-f]{64}$/)
	assert.equal(normalizeText('a\rb\r\nc'), 'a\nb\nc')
	const one = createOverlay([
		{ file: 'docs/a.md', markdown: 'A' },
		{ file: 'docs/b.md', markdown: 'B' },
	])
	const same = createOverlay([
		{ file: 'docs/b.md', markdown: 'B' },
		{ file: 'docs/a.md', markdown: 'A' },
	])
	const other = createOverlay([
		{ file: 'docs/a.md', markdown: 'A' },
		{ file: 'docs/b.md', markdown: 'B2' },
	])
	assert.equal(overlaySignature(one), overlaySignature(same))
	assert.notEqual(overlaySignature(one), overlaySignature(other))
	assert.equal(overlaySignature(emptyOverlay), '')
})
