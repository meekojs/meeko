// The real documents of `docs/` and what both tests of the editor ask of an edit.
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import { unified } from 'unified'

const root = fileURLToPath(new URL('../../../../', import.meta.url))
const docs = join(root, 'docs')

/** Every Markdown document of `docs/`, as `{ file, source }`, with `file` relative to the repository. */
export const documents = () =>
	readdirSync(docs, { recursive: true })
		.filter((file) => file.endsWith('.md'))
		.sort()
		.map((file) => ({ file: relative(root, join(docs, file)).replaceAll('\\', '/'), source: readFileSync(join(docs, file), 'utf8') }))

export const readDocument = (file) => readFileSync(join(root, file), 'utf8')

const processor = unified().use(remarkParse).use(remarkGfm)

/** The parser of the tests: remark with GFM, as Milkdown's. */
export const parse = (markdown) => processor.parse(markdown)

/** The range of `after` that differs from `before`, with what they share at both ends set aside. */
export function changedRange(before, after) {
	let start = 0
	while (start < before.length && start < after.length && before[start] === after[start]) start++
	let endBefore = before.length
	let endAfter = after.length
	while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
		endBefore--
		endAfter--
	}
	return { start, endBefore, endAfter }
}

/**
 * An edit changed at most one block: what differs in the file falls inside a single top-level block
 * of the original, or between two of them, and every other block keeps its bytes in the result.
 */
export function assertOneBlockChanged(before, after, message) {
	assert.notEqual(after, before, `${message}: nothing changed`)
	const body = before.replace(/\r\n?/g, '\n')
	const { start, endBefore } = changedRange(body, after)
	const blocks = parse(body).children.map((node) => ({ start: node.position.start.offset, end: node.position.end.offset }))
	const touched = blocks.filter((block) => block.start < endBefore && block.end > start)
	assert.ok(touched.length <= 1, `${message}: ${touched.length} blocks changed`)
	for (const block of blocks) {
		if (touched.includes(block)) continue
		assert.ok(after.includes(body.slice(block.start, block.end)), `${message}: the bytes of a block moved: ${body.slice(block.start, block.start + 60)}`)
	}
}
