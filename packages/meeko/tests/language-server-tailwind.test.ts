import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { TextDocument } from 'vscode-languageserver-textdocument'

import { ClassIndex, configuredClassView } from '../src/language-server/classes.ts'
import { styleDiagnostics } from '../src/language-server/embedded.ts'
import { createTempProject } from './helpers/temp-project.ts'

test('Tailwind CSS imports delegate only generated classes, preserving authored duplicates', async () => {
	const { root, remove } = await createTempProject('lsp-tailwind-')
	try {
		await mkdir(join(root, 'app/styles'), { recursive: true })
		await mkdir(join(root, '.meeko/styles'), { recursive: true })
		await writeFile(join(root, 'app/styles/main.css'), '@import "./theme.css"; .card {}')
		await writeFile(join(root, 'app/styles/theme.css'), '@import "tailwindcss"; .flex {}')
		await writeFile(join(root, '.meeko/styles/main.css'), '.flex { display: flex } .p-4 { padding: 1rem }')
		const view = new ClassIndex(root).view(join(root, 'app/pages/index.meeko'), '<template><p /></template>', [])
		const filtered = configuredClassView(view, { completion: 'auto', tailwindActive: true })
		assert.deepEqual([...filtered.global.keys()], ['card', 'flex'])
		assert.equal(filtered.global.get('flex')?.[0]?.origin, 'stylesheet')
		assert.ok(configuredClassView(view, { completion: 'auto', tailwindActive: false }).global.has('p-4'))
		assert.ok(configuredClassView(view, { completion: 'on', tailwindActive: true }).global.has('p-4'))
		assert.equal(configuredClassView(view, { completion: 'off' }).global.size, 0)
	} finally {
		await remove()
	}
})

test('unused scoped classes exclude Tailwind utilities and their nested selectors', () => {
	const source = '<template><p /></template><style scoped>@utility foo { color: red; &.nested { color: blue } } .unused { color: red }</style>'
	const diagnostics = styleDiagnostics(TextDocument.create('file:///index.meeko', 'meeko', 1, source))
	const unused = diagnostics.filter((item) => item.code === 'MEEK_UNUSED_CLASS')
	assert.equal(unused.length, 1)
	// LSP 3.18 types a diagnostic message as a string or as MarkupContent.
	const message = unused[0]!.message
	assert.match(typeof message === 'string' ? message : message.value, /\.unused/)
})
