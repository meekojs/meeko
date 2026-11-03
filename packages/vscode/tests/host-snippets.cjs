const assert = require('node:assert/strict')
const { writeFileSync } = require('node:fs')
const path = require('node:path')
const vscode = require('vscode')

const prefixes = (file) => Object.values(require(`../snippets/${file}`)).flatMap((snippet) => snippet.prefix)
const namePrefixed = (file, prefix) => Object.keys(require(`../snippets/${file}`)).find((name) => [require(`../snippets/${file}`)[name].prefix].flat().includes(prefix))
const userPrefixes = ['mc', 'ms']
const rootOffered = [...prefixes('meeko.json'), ...userPrefixes]
const scriptOffered = prefixes('meeko-script.json')
const templateOffered = prefixes('meeko-template.json')
// Declared for the language typescript, by the extension and by the user, so VS Code also offers them
// in a block of that language, in its comments and strings too. A declaration has no condition.
const declaredForTypescript = [...prefixes('typescript.json'), 'muser']

const fixture = `@@root@@<!-- raíz @@rootComment@@ -->
<script server @@sectionTag@@lang="ts" title="@@sectionAttribute@@">
import { definePage } from '@meekojs/meeko/framework'
export const route = definePage({ render: 'ssr' })
@@serverScript@@
</script>

@@between@@
<script lang="ts">
const text = 'cadena @@string@@'
const literal = \`literal @@literal@@\`
// comentario @@lineComment@@
/* bloque @@blockComment@@ */
text.@@member@@
@@script@@
</script>

<template>
	<!-- comentario @@templateComment@@ -->
	<div class="a @@attributeValue@@" if:when="@@directiveValue@@" @@tagAttributes@@>
		@@text@@
		{@@interpolation@@}
	</div>
	@@template@@
</template>

<style>
.a {
	@@style@@
	color: red;
}
</style>
@@end@@
`

const expected = {
	root: rootOffered,
	between: rootOffered,
	end: rootOffered,
	rootComment: [],
	sectionTag: [],
	sectionAttribute: [],
	script: [...scriptOffered, ...declaredForTypescript],
	serverScript: [...scriptOffered, ...declaredForTypescript],
	member: [],
	string: declaredForTypescript,
	literal: declaredForTypescript,
	lineComment: declaredForTypescript,
	blockComment: declaredForTypescript,
	template: templateOffered,
	text: templateOffered,
	templateComment: [],
	attributeValue: [],
	directiveValue: [],
	tagAttributes: [],
	interpolation: [],
	style: [],
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const labelOf = (item) => (typeof item.label === 'string' ? item.label : item.label.label)
const sorted = (labels) => [...labels].sort()

/** Prefixes that look like Meeko's among the snippets a position offers, with VS Code's own command. */
async function offeredAt(uri, position) {
	const list = await vscode.commands.executeCommand('vscode.executeCompletionItemProvider', uri, position)
	return sorted(list.items.filter((item) => item.kind === vscode.CompletionItemKind.Snippet && /^(m[a-z]*)$/.test(labelOf(item))).map(labelOf))
}

exports.run = async function run() {
	const workspace = vscode.workspace.workspaceFolders[0].uri.fsPath
	const markers = new Map()
	let source = ''
	let last = 0
	for (const match of fixture.matchAll(/@@(\w+)@@/g)) {
		source += fixture.slice(last, match.index)
		markers.set(match[1], source.length)
		last = match.index + match[0].length
	}
	source += fixture.slice(last)
	assert.deepEqual(sorted(markers.keys()), sorted(Object.keys(expected)))
	const uri = vscode.Uri.file(path.join(workspace, 'Blocks.meeko'))
	writeFileSync(uri.fsPath, source)
	const tsUri = vscode.Uri.file(path.join(workspace, 'plain.ts'))
	writeFileSync(tsUri.fsPath, 'const a = 1\n\n')

	const settings = vscode.workspace.getConfiguration('editor')
	assert.equal(settings.get('snippetSuggestions'), 'inline')
	assert.equal(settings.get('tabCompletion'), 'off')

	await vscode.extensions.getExtension('meekojs.meeko-language').activate()
	const document = await vscode.workspace.openTextDocument(uri)
	const editor = await vscode.window.showTextDocument(document)
	const at = (marker) => document.positionAt(markers.get(marker))

	// The language at a position comes from the tokens, which an open editor computes in the background.
	for (let attempt = 0; attempt < 80 && !(await offeredAt(uri, at('script'))).includes(declaredForTypescript[0]); attempt++) await sleep(250)
	const offered = {}
	for (const marker of markers.keys()) offered[marker] = await offeredAt(uri, at(marker))
	const wanted = Object.fromEntries([...markers.keys()].map((marker) => [marker, sorted(expected[marker])]))
	const wrong = [...markers.keys()].filter((marker) => JSON.stringify(offered[marker]) !== JSON.stringify(wanted[marker]))
	assert.deepEqual(
		wrong.map((marker) => `${marker}: ${offered[marker].join(' ')}`),
		[],
		'Fragmentos ofrecidos en cada posición',
	)

	const reset = async () => {
		await vscode.commands.executeCommand('leaveSnippet')
		await vscode.commands.executeCommand('hideSuggestWidget')
		await vscode.commands.executeCommand('workbench.action.files.revert')
		for (let attempt = 0; attempt < 40 && document.getText() !== source; attempt++) await sleep(50)
		assert.equal(document.getText(), source, 'El documento debe volver a su texto')
	}
	const atCursor = (marker, length) => document.getText().slice(markers.get(marker), markers.get(marker) + length)

	/** Writes a prefix, opens the suggestions and accepts the first: what the user sees and gets. */
	const accept = async (marker, typed) => {
		const position = at(marker)
		editor.selection = new vscode.Selection(position, position)
		assert.ok(await editor.edit((builder) => builder.insert(position, typed)))
		const written = document.getText()
		for (let attempt = 0; attempt < 40 && document.getText() === written; attempt++) {
			await vscode.commands.executeCommand('editor.action.triggerSuggest')
			await sleep(250)
			await vscode.commands.executeCommand('acceptSelectedSuggestion')
			await sleep(100)
		}
		assert.notEqual(document.getText(), written, `${typed} en ${marker} debe aceptar una sugerencia`)
	}

	// In <script>: inserted, the first field selected, Tab goes to the next.
	await accept('script', 'msig')
	const signal = "import { signal } from '@meekojs/meeko'\n\nconst count = signal(0)\n"
	assert.equal(atCursor('script', signal.length), signal)
	assert.equal(document.getText(editor.selection), 'count')
	await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder')
	assert.equal(document.getText(editor.selection), '0')
	await reset()

	// <script server> offers the same.
	await accept('serverScript', 'mprops')
	const props = 'interface Props {\n\tlabel: string\n}\n\nconst props = defineProps<Props>()\n'
	assert.equal(atCursor('serverScript', props.length), props)
	await reset()

	// In <template>: indented like its line, and a repeated name stays in sync.
	await accept('template', 'mif')
	assert.equal(document.getText(editor.selection), 'div')
	await vscode.commands.executeCommand('type', { text: 'section' })
	const element = '<section if:when="visible.value">\n\t\t\n\t</section>\n'
	assert.equal(atCursor('template', element.length), element)
	await vscode.commands.executeCommand('jumpToNextSnippetPlaceholder')
	assert.equal(document.getText(editor.selection), 'visible.value')
	await reset()

	// At the root: the declared skeleton, and the user's own snippet with a near prefix.
	await accept('end', 'mcomp')
	assert.ok(document.getText().endsWith('</template>\n'), document.getText())
	assert.equal(atCursor('end', '<!-- Blocks -->'.length), '<!-- Blocks -->')
	await reset()
	await accept('end', 'mc')
	assert.equal(atCursor('end', '<template>user</template>'.length), '<template>user</template>')
	await reset()

	// Insert Snippet resolves the language at the cursor: it has what is declared for that language.
	const insertedByName = async (marker, name) => {
		const position = at(marker)
		editor.selection = new vscode.Selection(position, position)
		await vscode.commands.executeCommand('editor.action.insertSnippet', { name })
		await sleep(150)
		const inserted = document.getText() !== source
		await reset()
		return inserted
	}
	assert.equal(await insertedByName('end', namePrefixed('meeko.json', 'mpage')), true, 'Insert Snippet ofrece los esqueletos en la raíz')
	assert.equal(await insertedByName('end', namePrefixed('meeko-script.json', 'msignal')), false, 'Insert Snippet no ofrece los de script en la raíz')
	assert.equal(await insertedByName('script', namePrefixed('meeko-script.json', 'msignal')), false, 'docs/editors.md: Insert Snippet no ofrece los de bloque')
	assert.equal(await insertedByName('script', namePrefixed('typescript.json', 'mapi')), true, 'Insert Snippet ofrece en un bloque lo declarado para typescript')

	// A plain TypeScript file: only its own four, and only once.
	const tsDocument = await vscode.workspace.openTextDocument(tsUri)
	await vscode.window.showTextDocument(tsDocument)
	assert.deepEqual(await offeredAt(tsUri, new vscode.Position(1, 0)), sorted(declaredForTypescript))
}
