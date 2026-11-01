// `@meekojs/ui/editor` without a browser: saving by blocks over the real documents of `docs/`, with
// remark in the place of Crepe (markdown-editor.e2e.mjs does it with Crepe), and how far Crepe stays
// from the apps that do not ask for it.
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remarkStringify from 'remark-stringify'
import { unified } from 'unified'

import { discoverComponents } from '../../meeko/dist/autoimports/registry.js'
import { resolveUIMessages } from '../dist/app/utils/messages.js'
import { createMarkdownSplicer, splitMarkdownSource } from '../dist/editor/index.js'
import editorModule from '../dist/editor/module.js'
import ui from '../dist/index.js'
import { assertOneBlockChanged, documents, parse } from './helpers/markdown-docs.mjs'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))

// The options of the recipe in src/editor/crepe.ts.
const serializer = unified().use(remarkParse).use(remarkGfm).use(remarkStringify, { bullet: '-', bulletOther: '*', emphasis: '_', strong: '*', fence: '`', fences: true, rule: '-', listItemIndent: 'one', incrementListMarker: true })
const serialize = (markdown) => serializer.stringify(serializer.parse(markdown))

/** A document with its head, its body, its serialization and the blocks of that one. */
function prepared({ file, source }) {
	const { head, body } = splitMarkdownSource(source)
	const baseline = serialize(body)
	return { file, head, body, baseline, splicer: createMarkdownSplicer(parse, body, baseline), blocks: parse(baseline).children }
}

/** The blocks of `baseline` of a kind, with the text of each. */
const blocksOfType = ({ baseline, blocks }, type) => blocks.filter((node) => node.type === type).map((node) => ({ start: node.position.start.offset, end: node.position.end.offset, text: baseline.slice(node.position.start.offset, node.position.end.offset) }))

const replaced = (baseline, { start, end }, text) => baseline.slice(0, start) + text + baseline.slice(end)

test('a head and a body add up to the file, with line breaks as the hash of a revision reads them', () => {
	assert.deepEqual(splitMarkdownSource('---\ntitle: a\n---\n\n# a\n'), { head: '---\ntitle: a\n---\n\n', body: '# a\n' })
	assert.deepEqual(splitMarkdownSource('# a\n'), { head: '', body: '# a\n' })
	assert.deepEqual(splitMarkdownSource('---\r\ntitle: a\r\n---\r\n# a\r\n'), { head: '---\ntitle: a\n---\n', body: '# a\n' })
	for (const { file, source } of documents()) {
		const { head, body } = splitMarkdownSource(source)
		assert.equal(head + body, source.replace(/\r\n?/g, '\n'), file)
	}
})

test('without an edit every document of docs/ comes back byte by byte, and its blocks match', () => {
	const all = documents()
	assert.ok(all.length > 300, 'the real documents')
	for (const document of all) {
		const { file, body, baseline, splicer } = prepared(document)
		assert.equal(splicer.aligned, true, file)
		assert.equal(splicer.splice(baseline), body, file)
	}
})

test('an edit of one block leaves the bytes of the others, in every document of docs/', () => {
	const counts = { paragraph: 0, table: 0, code: 0, list: 0, inserted: 0, removed: 0 }
	for (const document of documents()) {
		const current = prepared(document)
		const { file, body, baseline, splicer } = current
		const edit = (kind, text) => {
			counts[kind]++
			return splicer.splice(text)
		}
		const [paragraph] = blocksOfType(current, 'paragraph')
		const [table] = blocksOfType(current, 'table')
		const [code] = blocksOfType(current, 'code').filter((block) => /^```\w+ \S/.test(block.text))
		const [list] = blocksOfType(current, 'list')
		if (paragraph) assertOneBlockChanged(body, edit('paragraph', replaced(baseline, paragraph, `${paragraph.text} X`)), `${file}: paragraph`)
		if (table) assertOneBlockChanged(body, edit('table', replaced(baseline, table, table.text.replace(/ \|\n/, ' X |\n'))), `${file}: table`)
		if (code) {
			const after = edit('code', replaced(baseline, code, code.text.replace(/\n```$/, '\n// X\n```')))
			assertOneBlockChanged(body, after, `${file}: code`)
			assert.ok(after.includes(code.text.split('\n')[0]), `${file}: the meta of the block`)
		}
		if (list) assertOneBlockChanged(body, edit('list', replaced(baseline, list, list.text.replace(/\n|$/, ' X$&'))), `${file}: list`)
		if (paragraph) {
			const inserted = edit('inserted', `${baseline.slice(0, paragraph.end)}\n\nNuevo párrafo.${baseline.slice(paragraph.end)}`)
			assert.equal(inserted.replace('Nuevo párrafo.\n\n', '').length, body.length, `${file}: only the new paragraph, followed by a blank line`)
			const removed = edit('removed', baseline.slice(0, paragraph.start) + baseline.slice(paragraph.end).replace(/^\n+/, ''))
			assert.ok(removed.length < body.length, `${file}: a removal only removes`)
		}
	}
	for (const [kind, count] of Object.entries(counts)) assert.ok(count > 5, `${kind} ran over real documents: ${count}`)
})

test('undoing an edit gives the original back, and a document without blocks in common is refused', () => {
	const body = '| a |\n|---|\n| b |\n\nHola  \nmundo\n'
	const baseline = '| a |\n| - |\n| b |\n\nHola\\\nmundo\n'
	const splicer = createMarkdownSplicer(parse, body, baseline)
	assert.equal(splicer.splice(baseline), body)
	assert.equal(splicer.splice('| a |\n| - |\n| c |\n\nHola\\\nmundo\n'), '| a |\n| - |\n| c |\n\nHola  \nmundo\n')
	assert.equal(splicer.splice('| a |\n| - |\n| b |\n\nAdiós\n'), '| a |\n|---|\n| b |\n\nAdiós\n')
	assert.equal(splicer.splice('Primero\n\n| a |\n| - |\n| b |\n\nHola\\\nmundo\n'), 'Primero\n\n| a |\n|---|\n| b |\n\nHola  \nmundo\n')
	const refused = createMarkdownSplicer(parse, 'uno\n\ndos\n', 'uno dos\n')
	assert.equal(refused.aligned, false)
	assert.equal(refused.splice('uno dos tres\n'), null)
	assert.throws(() => createMarkdownSplicer(() => ({ children: [{}] }), 'a', 'a'), /offsets/)
})

test('UIMarkdownEditor belongs to its own module: the main one does not register it', async () => {
	const site = fileURLToPath(new URL('../../../apps/ui', import.meta.url))
	const components = await discoverComponents(site)
	assert.ok(components.some(({ name }) => name === 'UIButton'))
	assert.ok(!components.some(({ name }) => name === 'UIMarkdownEditor'), 'the registry generates an import() for each component')
	const directories = []
	const stylesheets = []
	const plugins = []
	editorModule.setup(
		{},
		{
			addComponentsDir: (directory, options) => directories.push([fileURLToPath(directory).replaceAll('\\', '/'), options]),
			addStylesheet: (file) => stylesheets.push(fileURLToPath(file).replaceAll('\\', '/')),
			addVitePlugin: (plugin) => plugins.push(plugin),
		},
	)
	assert.match(directories[0][0], /\/dist\/editor\/components\/?$/)
	assert.deepEqual(directories[0][1], { prefix: 'UI' })
	assert.match(stylesheets[0], /\/src\/app\/styles\/markdown-editor\.css$/)
	const { define, optimizeDeps } = plugins[0].config()
	assert.equal(define.__VUE_OPTIONS_API__, 'false')
	assert.ok(optimizeDeps.include.every((name) => name.startsWith('@meekojs/ui > ')))
	assert.equal(typeof ui.setup, 'function')
})

test('only the chunk of the editor imports Crepe, and only with import() from the browser', async () => {
	const files = (await readdir(dist, { recursive: true })).filter((file) => /\.(?:js|meeko)$/.test(file)).map((file) => file.replaceAll('\\', '/'))
	const importers = []
	for (const file of files) if (/from "@(?:milkdown|codemirror|lezer)\/|import "@milkdown\//.test(await readFile(join(dist, file), 'utf8'))) importers.push(file)
	assert.deepEqual(importers, ['editor/crepe.js'])
	assert.match(await readFile(join(dist, 'editor/load.js'), 'utf8'), /import\.meta\.env\.SSR \? null : \(\) => import\("\.\/crepe\.js"\)/)
	assert.doesNotMatch(await readFile(join(dist, 'editor/components/MarkdownEditor.meeko'), 'utf8'), /^\s*import (?!type ).*crepe['"]|import\(['"][^'"]*crepe/m)
	assert.doesNotMatch(await readFile(join(dist, 'editor/index.js'), 'utf8'), /crepe|milkdown/)
})

test('Crepe and what it needs are optional peers, so an app without the editor does not install them', () => {
	const peers = ['@milkdown/crepe', '@milkdown/kit', '@codemirror/language', '@codemirror/view', '@lezer/highlight', '@codemirror/lang-javascript', '@codemirror/lang-html', '@codemirror/lang-css', '@codemirror/lang-json']
	for (const name of peers) {
		assert.ok(pkg.peerDependencies[name], name)
		assert.equal(pkg.peerDependenciesMeta[name]?.optional, true, name)
		assert.ok(pkg.devDependencies[name], `${name} for the build of this package`)
		assert.equal(pkg.dependencies?.[name], undefined, name)
	}
	assert.ok(pkg.exports['./editor'] && pkg.exports['./editor/module'])
})

test('the editor has its texts in both languages, and ui.messages overrides them', () => {
	const spanish = resolveUIMessages('es').markdownEditor
	const english = resolveUIMessages('en').markdownEditor
	assert.deepEqual(Object.keys(english).sort(), Object.keys(spanish).sort())
	assert.equal(spanish.code, 'Código')
	assert.equal(english.code, 'Code')
	for (const key of Object.keys(spanish).filter((key) => !['visual'].includes(key))) if (spanish[key] === english[key]) assert.fail(`${key} is not translated: ${spanish[key]}`)
	assert.equal(resolveUIMessages('en', { messages: { en: { markdownEditor: { code: 'Source' } } } }).markdownEditor.code, 'Source')
})
