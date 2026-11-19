import type { TextEdit, WorkspaceEdit } from 'vscode-languageserver/node'

import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { TextDocument } from 'vscode-languageserver-textdocument'

import { collectCssVariableProject, cssVariableReferences, prepareCssVariableRename, renameCssVariable } from '../src/language-server/css-variable-refactor'
import { tempProject } from './helpers/temp-project'

async function fixture(context: Parameters<typeof tempProject>[0]) {
	const root = await tempProject(context, 'css-variable-refactor')
	const sources: Record<string, string> = {
		'app/styles/main.css': '@import "./tokens.css"; @import "./variant.css";',
		'app/styles/tokens.css': '@theme { --accent: #123456; --accent-strong: black; --collision: red; }\r\n.dark { --accent: white; }',
		'app/styles/variant.css': '.variant { color: var( /* trivia */ --accent /* trivia */, var(--fallback)); content: "var(--accent)"; background: url(data:var(--accent)); } /* var(--accent) */',
		'app/components/Global.meeko': '<script lang="ts">const sample = "var(--accent)";</script>\r\n<template><p style="color: var(--accent)" bind:style="`color: var(--accent); opacity: ${opacity}`">Hi</p></template>\r\n<style>.global { color: var(--accent); }</style>',
		'app/components/Scoped.meeko': '<template><p style="color: var(--accent)">Hi</p></template><style scoped>.local { --accent: red; color: var(--accent); } :global(.shared) { color: var(--accent); }</style>',
		'app/components/Inherited.meeko': '<template><p>Hi</p></template><style scoped>.inherited { color: var(--accent); }</style>',
		'app/components/Inline.meeko': '<template><p style="--accent: pink; color: var(--accent)">Hi</p></template>',
		'.meeko/styles/main.css': ':root { --accent: blue; --generated: 1px; } .generated { color: var(--accent); }',
		'node_modules/other/styles.css': ':root { --accent: cyan; }',
	}
	for (const [path, text] of Object.entries(sources)) {
		await mkdir(dirname(join(root, path)), { recursive: true })
		await writeFile(join(root, path), text)
	}
	const doc = (file: string, version = 1, text = sources[file]!) => TextDocument.create(pathToFileURL(join(root, file)).href, file.endsWith('.meeko') ? 'meeko' : 'css', version, text)
	const document = doc('app/styles/tokens.css')
	const position = document.positionAt(document.getText().indexOf('--accent') + 4)
	return { root, sources, document, position, doc }
}

function changed(edit: WorkspaceEdit): Map<string, TextEdit[]> {
	return new Map(Object.entries(edit.changes ?? {}).map(([uri, edits]) => [fileURLToPath(uri), edits]))
}

test('references distinguish shared and component-local variables, including inline literals', async (context) => {
	const { root, sources, document, position, doc } = await fixture(context)
	const project = collectCssVariableProject(root, document, [document])
	const all = cssVariableReferences(project, document, position, true)!
	const uses = cssVariableReferences(project, document, position, false)!
	assert.equal(all.length, 8)
	assert.equal(uses.length, 6)
	for (const location of all) {
		const path = fileURLToPath(location.uri)
			.slice(root.length + 1)
			.replaceAll('\\', '/')
		const target = doc(path)
		assert.equal(sources[path]!.slice(target.offsetAt(location.range.start), target.offsetAt(location.range.end)), '--accent')
		assert.ok(!path.startsWith('.') && !path.includes('node_modules'))
		if (path.endsWith('Scoped.meeko')) assert.ok(target.offsetAt(location.range.start) > sources[path]!.indexOf(':global'))
		assert.ok(!path.endsWith('Inline.meeko'), 'an inline declaration shadows the shared token in its component')
	}
	const scoped = doc('app/components/Scoped.meeko')
	const scopedPosition = scoped.positionAt(scoped.getText().indexOf('var(--accent)') + 7)
	const local = cssVariableReferences(collectCssVariableProject(root, scoped, [scoped]), scoped, scopedPosition, true)!
	assert.equal(local.length, 3)
	assert.ok(local.every(({ uri }) => uri === scoped.uri))
	assert.ok(local.every(({ range }) => scoped.offsetAt(range.start) < scoped.getText().indexOf(':global')))
})

test('rename returns versioned edits for current buffers, excludes generated files and leaves scripts alone', async (context) => {
	const { root, document, position, doc } = await fixture(context)
	const component = doc('app/components/Global.meeko', 42, '<template><p style="color: var(--accent)">Unsaved</p></template><style>.changed { color: var(--accent); }</style>')
	const project = collectCssVariableProject(root, document, [document, component])
	assert.equal(prepareCssVariableRename(project, document, position)?.placeholder, '--accent')
	const result = renameCssVariable(project, document, position, '--brand', true)!
	const edits = result.documentChanges as { textDocument: { uri: string; version: number | null }; edits: TextEdit[] }[]
	assert.equal(edits.find(({ textDocument }) => textDocument.uri === component.uri)!.textDocument.version, 42)
	assert.ok(edits.some(({ textDocument }) => textDocument.version === null))
	assert.ok(edits.every(({ textDocument }) => !textDocument.uri.includes('/.meeko/') && !textDocument.uri.includes('/node_modules/')))
	for (const { textDocument, edits: changes } of edits) {
		const target =
			textDocument.uri === component.uri
				? component
				: doc(
						fileURLToPath(textDocument.uri)
							.slice(root.length + 1)
							.replaceAll('\\', '/'),
					)
		for (const edit of changes) {
			assert.equal(edit.newText, '--brand')
			assert.equal(target.getText(edit.range), '--accent')
		}
	}
	const legacy = changed(renameCssVariable(project, document, position, '--brand', false)!)
	assert.equal(legacy.get(fileURLToPath(component.uri))!.length, 2, 'uses unsaved text, not the three references of the saved component')
	assert.ok(!legacy.has(join(root, 'app/components/Inline.meeko')))
	assert.throws(() => renameCssVariable(project, document, position, '--collision', true), /ya aparece/)
	for (const invalid of ['accent', '--', '--has space', '--escaped\\name', '--x; color: red']) assert.throws(() => renameCssVariable(project, document, position, invalid, true), /nombre debe ser/)
})

test('a local rename stays in its component and rejects capture by an existing global name', async (context) => {
	const { root, doc } = await fixture(context)
	const document = doc('app/components/Scoped.meeko')
	const position = document.positionAt(document.getText().indexOf('var(--accent)') + 7)
	const project = collectCssVariableProject(root, document, [document])
	const edits = changed(renameCssVariable(project, document, position, '--local-accent', false)!)
	assert.deepEqual([...edits.keys()], [fileURLToPath(document.uri)])
	assert.equal([...edits.values()][0]!.length, 3)
	const shadow = doc('app/components/Scoped.meeko', 2, document.getText().replace('--accent: red;', '--accent: red; --brand: gold;'))
	const tokens = doc('app/styles/tokens.css')
	assert.throws(() => renameCssVariable(collectCssVariableProject(root, tokens, [shadow, tokens]), tokens, tokens.positionAt(tokens.getText().indexOf('--accent') + 4), '--brand', false), /ya aparece/, 'global rename must not capture a private variable in a component it also edits')
})

test('@property registrations and nested fallback uses preserve offsets and Unicode names', async (context) => {
	const root = await tempProject(context, 'css-variable-property')
	const text = '@property --цвет { syntax: "<color>"; inherits: true; initial-value: red; }\r\n:root { --цвет: blue; color: var(--missing, var(--цвет)); }'
	const filename = join(root, 'tokens.css')
	await writeFile(filename, text)
	const document = TextDocument.create(pathToFileURL(filename).href, 'css', 7, text)
	const position = document.positionAt(text.indexOf('--цвет') + 4)
	const project = collectCssVariableProject(root, document, [document])
	assert.equal(cssVariableReferences(project, document, position, true)!.length, 3)
	assert.equal(cssVariableReferences(project, document, position, false)!.length, 1)
	const edits = changed(renameCssVariable(project, document, position, '--тон', false)!).get(filename)!
	assert.equal(edits.length, 3)
	for (const edit of edits) assert.equal(document.getText(edit.range), '--цвет')
})

test('rename refuses incomplete CSS, unknown external declarations and escaped identifiers', async (context) => {
	const { root, document, position } = await fixture(context)
	const broken = join(root, 'app/styles/broken.css')
	for (const text of ['.broken { color: var(--accent)', '.escaped { color: var(--\\61 ccent); }']) {
		await writeFile(broken, text)
		assert.throws(() => prepareCssVariableRename(collectCssVariableProject(root, document, [document]), document, position), /CSS incompleto/)
	}
	await writeFile(broken, '.external { color: var(--external); }')
	const external = TextDocument.create(pathToFileURL(broken).href, 'css', 1, '.external { color: var(--external); }')
	const externalPosition = external.positionAt(external.getText().indexOf('--external') + 4)
	assert.throws(() => prepareCssVariableRename(collectCssVariableProject(root, external, [external]), external, externalPosition), /declaración editable/)
})

test('incomplete project coverage never produces a partial rename or reference list', async (context) => {
	const { root, document, position } = await fixture(context)
	await writeFile(join(root, 'app/styles/large.css'), ' '.repeat(16 * 1024 * 1024 + 1))
	const project = collectCssVariableProject(root, document, [document])
	assert.equal(project.complete, false)
	assert.throws(() => renameCssVariable(project, document, position, '--brand', true), /fuentes/)
	assert.throws(() => cssVariableReferences(project, document, position, true), /límites/)
})

test('script strings that look like sections and nested packages are never renamed', async (context) => {
	const { root, document, position, doc } = await fixture(context)
	const text = '<script lang="ts">const example = `<template><p style="color: var(--accent)"></p></template><style>:root { --accent: red; }</style>`;</script><template><p>Hello</p></template><style>.real { color: var(--accent); }</style>'
	await writeFile(join(root, 'app/components/Example.meeko'), text)
	await mkdir(join(root, 'app/nested'), { recursive: true })
	await writeFile(join(root, 'app/nested/package.json'), '{"private":true}')
	await writeFile(join(root, 'app/nested/tokens.css'), ':root { --accent: purple; }')
	const nested = doc('app/nested/tokens.css', 2, ':root { --accent: gold; }')
	const edits = changed(renameCssVariable(collectCssVariableProject(root, document, [document, nested]), document, position, '--brand', false)!)
	const example = TextDocument.create(pathToFileURL(join(root, 'app/components/Example.meeko')).href, 'meeko', 0, text)
	const changes = edits.get(fileURLToPath(example.uri))!
	assert.equal(changes.length, 1)
	assert.ok(example.offsetAt(changes[0]!.range.start) > text.indexOf('</script>'))
	assert.ok(!edits.has(join(root, 'app/nested/tokens.css')))
})

test('a local component rename remains available when an unrelated stylesheet is incomplete', async (context) => {
	const { root, doc } = await fixture(context)
	await writeFile(join(root, 'app/styles/broken.css'), '.broken { color: var(')
	const document = doc('app/components/Scoped.meeko')
	const position = document.positionAt(document.getText().indexOf('var(--accent)') + 6)
	const project = collectCssVariableProject(root, document, [document])
	assert.equal(cssVariableReferences(project, document, position, true)!.length, 3)
	assert.equal(changed(renameCssVariable(project, document, position, '--private-accent', false)!).size, 1)
})

test('style queries, custom-property transitions and Tailwind theme helpers follow the same symbol', async (context) => {
	const root = await tempProject(context, 'css-variable-queries')
	const text = ':root { --accent: red; transition-property: --accent; transition: --accent 1s; will-change: --accent; color: --theme(--accent); } @container style(--accent: red) { .child {} } @supports (--accent: red) { .fallback {} }'
	const filename = join(root, 'tokens.css')
	await writeFile(filename, text)
	const document = TextDocument.create(pathToFileURL(filename).href, 'css', 1, text)
	const position = document.positionAt(text.indexOf('--accent') + 4)
	const project = collectCssVariableProject(root, document, [document])
	assert.equal(cssVariableReferences(project, document, position, true)!.length, 7)
	const edits = changed(renameCssVariable(project, document, position, '--brand', false)!).get(filename)!
	assert.equal(edits.length, 7)
	for (const edit of edits) assert.equal(document.getText(edit.range), '--accent')
	for (const start of [text.indexOf('--accent', text.indexOf('style(')), text.lastIndexOf('--accent'), text.indexOf('--accent', text.indexOf('--theme('))]) assert.ok(prepareCssVariableRename(project, document, document.positionAt(start + 4)))
})

test('@property registrations also bind scoped and inline overrides of that registered name', async (context) => {
	const { root, doc } = await fixture(context)
	const tokens = doc('app/styles/tokens.css', 2, '@property --accent { syntax: "<color>"; inherits: true; initial-value: red; }')
	const scoped = doc('app/components/Scoped.meeko')
	const position = scoped.positionAt(scoped.getText().indexOf('var(--accent)') + 6)
	const project = collectCssVariableProject(root, scoped, [tokens, scoped])
	const edits = changed(renameCssVariable(project, scoped, position, '--registered-accent', false)!)
	assert.ok(edits.has(fileURLToPath(tokens.uri)))
	assert.ok(edits.has(join(root, 'app/components/Inline.meeko')))
	assert.equal(edits.get(fileURLToPath(scoped.uri))!.length, 4)
})
