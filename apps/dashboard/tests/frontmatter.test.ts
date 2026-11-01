// The fields of the frontmatter over the real pages of `docs/`: reading and writing back a key that
// does not change never moves a byte, and a change touches only that key.
import { splitMarkdownSource } from '@meekojs/ui/editor'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { headLineCount, lineRange, readFrontmatter, writeFrontmatter } from '../app/utils/frontmatter'

const docs = fileURLToPath(new URL('../../../docs/', import.meta.url))
const pages = (readdirSync(docs, { recursive: true }) as string[]).filter((file) => file.endsWith('.md')).map((file) => join(docs, file))
const head = '---\ntitle: signal\nsince: 1.0.0\nsymbols:\n  - "@meekojs/meeko#signal"\n  - docs/api.md#reactividad\n---\n\n'

test('every frontmatter of docs/ reads as fields whose lines are the whole frontmatter', () => {
	let withFields = 0
	assert.ok(pages.length > 300)
	for (const page of pages) {
		const { head: frontmatter } = splitMarkdownSource(readFileSync(page, 'utf8'))
		const fields = readFrontmatter(frontmatter)
		assert.ok(fields, `${page} needs the text form`)
		if (!frontmatter) continue
		withFields++
		assert.equal(`---\n${fields.flatMap((field) => field.lines).join('\n')}\n---\n`, frontmatter.replace(/\s*$/, '\n'), page)
		for (const field of fields) assert.equal(writeFrontmatter(frontmatter, field.key, field.kind, field.value), frontmatter, `${page}: ${field.key} is rewritten without a change`)
	}
	assert.ok(withFields > 300)
})

test('a change touches only its key, and an empty value removes it', () => {
	const changed = writeFrontmatter(head, 'since', 'text', '1.2.0')
	assert.equal(changed, head.replace('since: 1.0.0', 'since: 1.2.0'))
	assert.equal(writeFrontmatter(head, 'since', 'text', ''), head.replace('since: 1.0.0\n', ''))
	assert.equal(writeFrontmatter(head, 'symbols', 'list', ''), '---\ntitle: signal\nsince: 1.0.0\n---\n\n')
	assert.equal(writeFrontmatter('---\nsource-hash: abc\n---\n\n', 'source-hash', 'text', ''), '')
})

test('the items of a list keep their quotes, new ones are quoted only when they need it', () => {
	const items = '@meekojs/meeko#signal\ndocs/api.md#reactividad\n@meekojs/meeko#computed\nsyntax:model'
	assert.equal(writeFrontmatter(head, 'symbols', 'list', items), head.replace('  - docs/api.md#reactividad\n', '  - docs/api.md#reactividad\n  - "@meekojs/meeko#computed"\n  - syntax:model\n'))
})

test('a new key goes at the end, and a value that would read as YAML is quoted', () => {
	assert.equal(writeFrontmatter(head, 'description', 'text', 'Crea: un valor'), head.replace('\n---\n\n', '\ndescription: "Crea: un valor"\n---\n\n'))
	assert.equal(writeFrontmatter(head, 'description', 'text', 'Crea un valor'), head.replace('\n---\n\n', '\ndescription: Crea un valor\n---\n\n'))
})

test('what the fields could not write back as it was stays as text', () => {
	assert.equal(readFrontmatter('---\n# comment\ntitle: a\n---\n'), null)
	assert.equal(readFrontmatter('---\ntitle: a\ntitle: b\n---\n'), null)
	assert.equal(readFrontmatter('---\nsymbols: [a, b]\n---\n'), null)
	assert.equal(readFrontmatter('---\ntitle: a\n  - b\n---\n'), null)
	assert.deepEqual(readFrontmatter(''), [])
})

test('a line of the file is found in the head or in the body', () => {
	const [symbols] = (readFrontmatter(head) ?? []).filter((field) => field.key === 'symbols')
	assert.equal(symbols?.line, 4)
	assert.equal(headLineCount(head), 8)
	assert.equal(headLineCount(''), 0)
	assert.deepEqual(lineRange('uno\ndos\ntres', 2), [4, 7])
	assert.deepEqual(lineRange('uno', 9), [0, 3])
})
