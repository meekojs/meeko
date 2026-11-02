import { parseSfc, parseTemplate } from '@meekojs/meeko/parse'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// The compiler keeps whitespace-only text between tags as text nodes. In these components that
// text would change the accessible name of the buttons, the textContent of the options (typeahead)
// and the markup, a stable contract inherited from MeekoPopover, MeekoSelect and MeekoThemeToggle.
// Prettier adds none with `htmlWhitespaceSensitivity: "ignore"`, whatever the width of the template.
const components = ['Popover', 'Select', 'ThemeToggle', 'Tabs', 'Tooltip', 'CommandPalette', 'Combobox']

const isLineBreak = (node) => node.nodeName === '#text' && /^[\t\n\f\r ]*\n[\t\n\f\r ]*$/.test(node.value ?? '')
const isContent = (node) => node.nodeName !== '#comment' && (node.nodeName !== '#text' || Boolean(node.value?.trim()))

/** The children that render: the compiler drops line breaks at the edges of a snippet, and the text among the snippets of a component. */
function renderedChildren(node) {
	let children = [...(node.childNodes ?? []), ...(node.content?.childNodes ?? [])]
	if (node.tagName === 'snippet') {
		while (children.length && isLineBreak(children[0])) children = children.slice(1)
		while (children.length && isLineBreak(children.at(-1))) children = children.slice(0, -1)
	}
	if (node.componentName && !children.some((child) => child.tagName !== 'snippet' && isContent(child))) return children.filter((child) => child.tagName === 'snippet')
	return children
}

/** The text nodes of a template, with the element that holds them. */
function* textNodes(node, parent = 'template') {
	for (const child of renderedChildren(node)) {
		if (child.nodeName === '#text') yield { node: child, parent }
		else yield* textNodes(child, child.componentName ?? child.tagName ?? parent)
	}
}

for (const name of components) {
	test(`${name}.meeko has no whitespace between the tags of its template`, async () => {
		const file = fileURLToPath(new URL(`../src/app/components/${name}.meeko`, import.meta.url))
		const source = await readFile(file, 'utf8')
		const sfc = parseSfc(source, file)
		assert.ok(sfc.template, `${name}.meeko has no <template>`)
		const offenders = []
		for (const { node, parent } of textNodes(parseTemplate(source, sfc.template, file))) {
			const raw = source.slice(node.start, node.end)
			// Whitespace-only text, or formatting whitespace (a line break) around real text.
			if (/^\s+$/.test(raw) || /^\s*\n|\n\s*$/.test(raw)) {
				const line = source.slice(0, node.start).split('\n').length
				offenders.push(`  line ${line}, inside <${parent}>: ${JSON.stringify(raw)}`)
			}
		}
		assert.deepEqual(offenders, [], `${name}.meeko has whitespace text between its tags. The compiler keeps it as text nodes: it would change the accessible name of the buttons, the textContent of the options and the markup inherited from the core. Remove that whitespace; Prettier will not add it back.\n${offenders.join('\n')}`)
	})
}
