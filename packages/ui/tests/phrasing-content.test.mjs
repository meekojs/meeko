import { parseSfc, parseTemplate } from '@meekojs/meeko/parse'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// An app may put these components inside a <p> or another element that only takes phrasing content. A block
// element in their markup makes the HTML parser close the <p> early: the DOM of the client no longer matches
// the server's and the page is left without JavaScript. Their own elements must be phrasing content; the
// content of the popover, which in the top layer is laid out as a block anyway, is a <span>.
const components = ['Popover', 'Tooltip', 'IconButton', 'Hint', 'Menu']
const block = new Set(['address', 'article', 'aside', 'blockquote', 'details', 'dialog', 'div', 'dl', 'fieldset', 'figure', 'footer', 'form', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'header', 'hr', 'main', 'menu', 'nav', 'ol', 'p', 'pre', 'section', 'table', 'ul'])

function* elements(node) {
	for (const child of [...(node.childNodes ?? []), ...(node.content?.childNodes ?? [])]) {
		if (child.tagName) yield child
		yield* elements(child)
	}
}

for (const name of components) {
	test(`${name}.meeko renders only phrasing content, so it is valid inside a <p>`, async () => {
		const file = fileURLToPath(new URL(`../src/app/components/${name}.meeko`, import.meta.url))
		const source = await readFile(file, 'utf8')
		const sfc = parseSfc(source, file)
		const found = [...elements(parseTemplate(source, sfc.template, file))].map((node) => node.tagName).filter((tag) => block.has(tag))
		assert.deepEqual(found, [], `${name}.meeko has block elements: ${found.join(', ')}`)
	})
}
