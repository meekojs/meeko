import corePlugin from '@meekojs/meeko/prettier'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { format } from 'prettier'

import plugin from '../dist/index.js'
import { templateTree } from './template-tree.mjs'

// The compiler renders the whitespace of a template as text nodes, so saving a file must not change
// what it renders: no whitespace appears, and none disappears, at any boundary between two nodes.
const repository = fileURLToPath(new URL('../../../', import.meta.url))
const ignore = { filepath: 'Component.meeko', htmlWhitespaceSensitivity: 'ignore', printWidth: 800, singleAttributePerLine: true }

const script = '<script lang="ts">\nconst items = ["a"];\nconst label = "x";\nconst on = true;\n</script>\n\n'

const cases = {
	'a list row with its directives': '<ul><li each:of="items" each:as="item">{item}</li></ul>',
	'an interpolation with two attributes': '<button type="button" class="b">{label}</button>',
	'two buttons, which are inline-block': '<div><button type="button" class="a">a</button><button type="button" class="b">b</button></div>',
	'two blocks': '<div class="c" id="d"><div class="a" id="b">a</div><div>b</div></div>',
	'two images': '<p class="c" id="d"><img src="a" alt="" /><img src="b" alt="" /></p>',
	'a line break element': '<p class="c" id="d">a<br />b</p>',
	'a space between links': '<p><a href="a">a</a> <a href="b">b</a></p>',
	'a line break between links': '<p><a href="a">a</a>\n<a href="b">b</a></p>',
	'a space at the inner edge of an inline element': '<p>Hi<b> world</b>!</p>',
	'spaces at both edges of a block': '<div> text </div>',
	'line breaks at both edges of a block': '<p>\n  text\n</p>',
	'a space and an element': '<div> <b>x</b> </div>',
	'an empty element with a space': '<span> </span>',
	'a space around a comment': '<p>a <!-- b --> c</p>',
	'a region next to an element': '<div><span if:when="on" class="x">{label}</span><em>y</em></div>',
	'a component with text': '<Card variant="x" size="y">Text</Card>',
	'a component with text and a snippet': '<Card>Text<snippet name="a"><b>x</b></snippet></Card>',
	'the text of a snippet': '<Card><snippet name="a" params="b">{b}</snippet></Card>',
	'a space at the edge of a snippet': '<Card><snippet name="a"> <b>x</b> </snippet></Card>',
	'a space at the edge of a snippet with several children': '<Card><snippet name="a"> <b>x</b> <i>y</i> </snippet><snippet name="b"> </snippet></Card>',
	'a template region': '<template if:when="on"><p>a</p></template><p>b</p>',
	'a preformatted element': '<pre class="a" id="b">{label}\n  x\n</pre>',
	'a text area': '<textarea class="a" id="b">x</textarea>',
	'no element': 'text',
	'an empty root with a space': ' ',
	'a space at the edges of the root': ' <p>x</p> ',
	'a line break at the edges of the root': '\n<p>x</p>\n',
	'a line break at the start of the root only': '\n<p>x</p>',
}

for (const [name, template] of Object.entries(cases)) {
	test(`formatting keeps the text nodes of ${name}`, async () => {
		const source = `${script}<template>${template}</template>\n`
		for (const [label, options] of [
			['plugin', { ...ignore, plugins: [plugin] }],
			['core', { ...ignore, plugins: [corePlugin] }],
			['indented sections', { ...ignore, plugins: [plugin], meekoIndentSections: true }],
			['narrow', { ...ignore, plugins: [plugin], printWidth: 20 }],
		]) {
			const formatted = await format(source, options)
			assert.deepEqual(templateTree(formatted), templateTree(source), `${label}:\n${formatted}`)
			assert.equal(await format(formatted, options), formatted, `${label}: stable`)
		}
	})
}

test('whitespace stays the printed form of the source: content on its own lines stays there', async () => {
	const options = { ...ignore, plugins: [plugin], useTabs: true }
	assert.match(await format(`${script}<template>\n<p>\ntext\n</p>\n</template>\n`, options), /<template>\n<p>\n\ttext\n<\/p>\n<\/template>/)
	assert.match(await format(`${script}<template><p>text</p></template>\n`, options), /<template><p>text<\/p><\/template>/)
	assert.match(await format(`${script}<template>\n<button type="button" class="a">{label}</button>\n</template>\n`, options), /class="a"\n\t?>\{label\}<\/button\n>/)
})

test('a component with only snippets and the edge of a snippet stay free: the compiler drops that whitespace', async () => {
	const source = `${script}<template><Card><snippet name="a"><b>x</b><i>y</i></snippet><snippet name="b">z</snippet></Card></template>\n`
	const formatted = await format(source, { ...ignore, plugins: [plugin] })
	assert.match(formatted, /<Card>\n\s*<snippet name="a">/)
	assert.deepEqual(templateTree(formatted), templateTree(source))
})

test('the other sensitivities keep the form of Prettier', async () => {
	for (const htmlWhitespaceSensitivity of ['css', 'strict']) {
		const formatted = await format(`${script}<template><p>x</p></template>\n`, { filepath: 'Component.meeko', plugins: [plugin], htmlWhitespaceSensitivity })
		assert.match(formatted, /<template>\n<p>x<\/p>\n<\/template>/, htmlWhitespaceSensitivity)
	}
})

/** The `.meeko` files of a folder, at any depth. */
async function components(directory) {
	const entries = await readdir(join(repository, directory), { recursive: true, withFileTypes: true })
	return entries.filter((entry) => entry.isFile() && entry.name.endsWith('.meeko')).map((entry) => join(entry.parentPath, entry.name))
}

for (const directory of ['packages/ui/src', 'packages/i18n/src', 'packages/meeko/src/app', 'packages/meeko/examples', 'packages/meeko/benchmarks/cases']) {
	test(`formatting ${directory} keeps its text nodes`, { timeout: 120_000 }, async () => {
		const files = await components(directory)
		assert.ok(files.length, directory)
		for (const file of files) {
			const source = await readFile(file, 'utf8')
			const options = { ...ignore, filepath: file, plugins: [plugin], useTabs: true, meekoIndentSections: true, singleQuote: true, semi: false }
			const formatted = await format(source, options)
			assert.deepEqual(templateTree(formatted, file), templateTree(source, file), file)
			assert.equal(await format(formatted, options), formatted, `${file}: stable`)
		}
	})
}
