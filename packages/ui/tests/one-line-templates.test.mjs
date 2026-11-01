import { parseSfc, parseTemplate } from '@meekojs/meeko/parse'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// The compiler keeps whitespace-only text between tags as text nodes. In these components that
// text would change the accessible name of the buttons, the textContent of the options (typeahead)
// and the markup, a stable contract inherited from MeekoPopover, MeekoSelect and MeekoThemeToggle.
// Their templates are written on one line and listed in .prettierignore so no formatter breaks them.
const components = ['Popover', 'Select', 'ThemeToggle']

/** The text nodes of a template, with the element that holds them. */
function* textNodes(node, parent = 'template') {
	for (const child of [...(node.childNodes ?? []), ...(node.content?.childNodes ?? [])]) {
		if (child.nodeName === '#text') yield { node: child, parent }
		else yield* textNodes(child, child.componentName ?? child.tagName ?? parent)
	}
}

for (const name of components) {
	test(`${name}.meeko keeps its template on one line, without whitespace between tags`, async () => {
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
		assert.deepEqual(offenders, [], `${name}.meeko has whitespace text between its tags. The compiler keeps it as text nodes: it would change the accessible name of the buttons, the textContent of the options and the markup inherited from the core. Write the template on one line, without whitespace between tags, and keep the file in .prettierignore (packages/ui/src/app/components/${name}.meeko) so no formatter reflows it.\n${offenders.join('\n')}`)
		const template = source.slice(sfc.template.contentStart, sfc.template.contentEnd)
		assert.ok(!template.includes('\n'), `${name}.meeko: the template must stay on one line (see .prettierignore).`)
	})
}

test('.prettierignore keeps the one-line templates out of Prettier', async () => {
	const ignore = await readFile(new URL('../../../.prettierignore', import.meta.url), 'utf8')
	const lines = new Set(ignore.split(/\r?\n/).map((line) => line.trim()))
	for (const name of components) assert.ok(lines.has(`packages/ui/src/app/components/${name}.meeko`), `.prettierignore must list packages/ui/src/app/components/${name}.meeko`)
})
