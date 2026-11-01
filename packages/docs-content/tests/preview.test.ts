// The preview of one source with a draft's text: the real render, in a context of its own.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readGitFile, readRepositoryFile } from '../src/content/repository'
import { renderSourcePreview } from '../src/preview'

test('a guide renders with the draft text and reports its broken anchors', { timeout: 120_000 }, async () => {
	const markdown = `${readGitFile('docs/doctor.md')}\nUna línea de la vista previa.\n\n[roto](#no-existe) y [bien](/docs/framework)\n`
	const preview = await renderSourcePreview({ file: 'docs/doctor.md', kind: 'guide', markdown })
	assert.equal(preview.complete, true)
	assert.match(preview.html, /Una línea de la vista previa/)
	assert.ok(preview.title)
	assert.deepEqual(
		preview.issues.map((issue) => [issue.kind, issue.line]),
		[['link', markdown.split('\n').findIndex((line) => line.includes('#no-existe')) + 1]],
	)
	// Nothing outside the preview sees the draft.
	assert.doesNotMatch(readRepositoryFile('docs/doctor.md'), /Una línea de la vista previa/)
})

test('a reference page renders with its generated sections, and an incomplete frontmatter is reported', { timeout: 120_000 }, async () => {
	const file = 'docs/reference/reactivity/signal.md'
	const text = readGitFile(file)
	const valid = await renderSourcePreview({ file, kind: 'reference', markdown: text.replace('## Uso', '## Uso\n\nTexto del borrador.') })
	assert.equal(valid.complete, true)
	assert.deepEqual(valid.issues, [])
	assert.match(valid.html, /Texto del borrador/)
	assert.match(valid.html, /id="tipo"/, 'the generated «Tipo» section is there')

	const incomplete = await renderSourcePreview({ file, kind: 'reference', markdown: text.replace(/^since:.*\n/m, '') })
	assert.equal(incomplete.complete, false)
	assert.deepEqual(
		incomplete.issues.map((issue) => issue.kind),
		['frontmatter'],
	)
	assert.match(incomplete.issues[0]!.message, /needs since/)
	assert.match(incomplete.html, /<h2/, 'the prose still renders')

	// A symbol the package does not export passes the frontmatter check but not the render.
	const unknown = await renderSourcePreview({ file, kind: 'reference', markdown: text.replace('  - "@meekojs/meeko#signal"', '  - "@meekojs/meeko#noExiste"') })
	assert.equal(unknown.complete, false)
	assert.deepEqual(
		unknown.issues.map((issue) => issue.kind),
		['render'],
	)
	assert.match(unknown.issues[0]!.message, /noExiste/)
})

test('a preview refuses files that are not sources of its kind and paths that leave the repository', async () => {
	await assert.rejects(renderSourcePreview({ file: 'docs/releasing.md', kind: 'guide', markdown: '# x' }), /not a guide/)
	await assert.rejects(renderSourcePreview({ file: 'docs/doctor.md', kind: 'reference', markdown: '# x' }), /not a written page/)
	await assert.rejects(renderSourcePreview({ file: '../secret.md', kind: 'guide', markdown: '# x' }), /cannot leave the repository/)
})
