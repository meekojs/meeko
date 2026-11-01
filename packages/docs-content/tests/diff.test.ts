import assert from 'node:assert/strict'
import { test } from 'node:test'

import { diffLines, divergence, mergeThreeWay, unifiedDiff } from '../src/diff'
import { contentHash } from '../src/sources/overlay'

test('diffLines keeps common lines and marks the changed ones', () => {
	assert.deepEqual(diffLines('a\nb\nc\n', 'a\nB\nc\nd\n'), [
		{ type: 'equal', text: 'a' },
		{ type: 'remove', text: 'b' },
		{ type: 'add', text: 'B' },
		{ type: 'equal', text: 'c' },
		{ type: 'add', text: 'd' },
	])
	assert.deepEqual(diffLines('', 'x'), [{ type: 'add', text: 'x' }])
	assert.deepEqual(diffLines('x\r\n', 'x\n'), [{ type: 'equal', text: 'x' }])
})

test('unifiedDiff prints hunks with context, as git does', () => {
	const before = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10'].join('\n')
	const after = ['1', '2', '3', '4', 'cinco', '6', '7', '8', '9', '10', '11'].join('\n')
	assert.equal(unifiedDiff(before, after, { from: 'a/x.md', to: 'b/x.md', context: 1 }), ['--- a/x.md', '+++ b/x.md', '@@ -4,3 +4,3 @@', ' 4', '-5', '+cinco', ' 6', '@@ -10,1 +10,2 @@', ' 10', '+11', ''].join('\n'))
	assert.equal(unifiedDiff('same\n', 'same'), '')
	// Changes closer than twice the context share one hunk.
	assert.equal(unifiedDiff('a\nb\nc\nd', 'A\nb\nc\nD', { context: 1 }).match(/^@@/gm)?.length, 1)
})

test('divergence tells Git, edits, conflicts and missing files apart', () => {
	const git = '# Guía\n\nTexto de Git.\n'
	const hash = contentHash(git)
	assert.deepEqual(divergence({ git, importedHash: hash, published: null }), { state: 'git', importStale: false, added: 0, removed: 0, diff: '' })
	assert.equal(divergence({ git, importedHash: contentHash('antes'), published: null }).importStale, true)
	assert.equal(divergence({ git, importedHash: hash, published: { markdown: git, baseHash: hash } }).state, 'same')

	const edited = divergence({ git, importedHash: hash, published: { markdown: '# Guía\n\nTexto editado.\n', baseHash: hash }, file: 'docs/guia.md' })
	assert.equal(edited.state, 'edited')
	assert.equal(edited.added, 1)
	assert.equal(edited.removed, 1)
	assert.match(edited.diff, /^--- a\/docs\/guia\.md\n\+\+\+ b\/docs\/guia\.md\n/)
	assert.match(edited.diff, /^-Texto de Git\.$/m)
	assert.match(edited.diff, /^\+Texto editado\.$/m)

	// Git changed after the revision was written from an older base.
	const conflict = divergence({ git, importedHash: hash, published: { markdown: 'otro', baseHash: contentHash('base anterior') } })
	assert.equal(conflict.state, 'conflict')
	assert.equal(divergence({ git: null, importedHash: hash, published: { markdown: 'x', baseHash: hash } }).state, 'missing')
})

test('mergeThreeWay joins changes to different lines and refuses overlapping ones', () => {
	const base = 'uno\ndos\ntres\ncuatro\ncinco\nseis\n'
	// Git changed the first line; the revision the last one and added a line in the middle.
	const git = 'UNO\ndos\ntres\ncuatro\ncinco\nseis\n'
	const revision = 'uno\ndos\ntres\nnueva\ncuatro\ncinco\nSEIS\n'
	assert.deepEqual(mergeThreeWay(base, git, revision), { clean: true, text: 'UNO\ndos\ntres\nnueva\ncuatro\ncinco\nSEIS\n' })
	// The same change on both sides counts once.
	assert.deepEqual(mergeThreeWay(base, git, git), { clean: true, text: git })
	// Without changes on one side, the result is the other side.
	assert.deepEqual(mergeThreeWay(base, base, revision), { clean: true, text: revision })
	// Both changed the same line differently, or neighbouring lines: not trivial.
	assert.deepEqual(mergeThreeWay(base, 'UNO\ndos\ntres\ncuatro\ncinco\nseis\n', 'Uno\ndos\ntres\ncuatro\ncinco\nseis\n'), { clean: false, conflicts: 1 })
	assert.deepEqual(mergeThreeWay(base, 'UNO\ndos\ntres\ncuatro\ncinco\nseis\n', 'uno\nDOS\ntres\ncuatro\ncinco\nseis\n'), { clean: false, conflicts: 1 })
	// Two insertions at the same place are a conflict too; CRLF is normalized.
	assert.equal(mergeThreeWay(base, 'uno\nA\ndos\ntres\ncuatro\ncinco\nseis\n', 'uno\nB\ndos\ntres\ncuatro\ncinco\nseis\n').clean, false)
	assert.deepEqual(mergeThreeWay('a\r\nb\r\nc\r\nd\r\n', 'A\nb\nc\nd\n', 'a\nb\nc\nD\n'), { clean: true, text: 'A\nb\nc\nD\n' })
})
