// Crepe in Chrome with the recipe of src/editor/crepe.ts: every document of `docs/` comes back byte by
// byte without an edit, and a real key in the hard blocks (a table with `\|`, a code block with its
// meta, a GitHub note) changes only that block. A production build of the chunk, with no framework
// around it: the bytes of the documents are its whole subject. The component is in the dashboard's
// e2e. Also: what the apps without the editor have in their bundles.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, extname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { chromium } from 'playwright-core'

import { assertOneBlockChanged, documents, readDocument } from './helpers/markdown-docs.mjs'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const viteEntry = fileURLToPath(new URL('../../meeko/node_modules/vite/dist/node/index.js', import.meta.url))
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }

const harness = `
import { createMarkdownEditor } from ${JSON.stringify(pathToFileURL(join(packageRoot, 'dist/editor/crepe.js')).pathname.replace(/^\/(?=[A-Za-z]:)/, ''))}
const texts = new Proxy({}, { get: (_, key) => String(key) })
let current
let changes = []
window.openEditor = async (source) => {
	await window.closeEditor()
	changes = []
	const root = document.createElement('div')
	root.id = 'host'
	document.body.append(root)
	current = { root, handle: await createMarkdownEditor(root, source, { readonly: false, placeholder: '…', texts, onChange: (text) => changes.push(text) }) }
	return current.handle.canSplice
}
window.flushEditor = () => current.handle.flush()
window.editorChanges = () => changes.length
window.closeEditor = async () => {
	if (!current) return 0
	const { root, handle } = current
	current = undefined
	await handle.destroy()
	const left = root.childElementCount
	root.remove()
	return left
}
window.ready = true
`

/** Builds the chunk as an app would and serves it, for a browser. */
async function serveChunk(context) {
	const { build } = await import(pathToFileURL(viteEntry).href)
	const directory = await mkdtemp(join(tmpdir(), 'meeko-ui-editor-'))
	context.after(() => rm(directory, { recursive: true, force: true }))
	await writeFile(join(directory, 'main.js'), harness)
	await writeFile(join(directory, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="icon" href="data:,"><body><script type="module" src="./main.js"></script>')
	await build({
		root: directory,
		configFile: false,
		logLevel: 'error',
		define: { __VUE_OPTIONS_API__: 'false', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' },
		build: { outDir: 'out', emptyOutDir: true, chunkSizeWarningLimit: 100_000 },
	})
	const out = join(directory, 'out')
	const server = createServer(async (request, response) => {
		const path = new URL(request.url, 'http://x').pathname
		const file = join(out, path === '/' ? 'index.html' : path)
		if (!existsSync(file)) return void response.writeHead(404).end()
		response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' })
		response.end(await readFile(file))
	}).listen(0, '127.0.0.1')
	context.after(() => server.close())
	await new Promise((resolve) => server.once('listening', resolve))
	return { origin: `http://127.0.0.1:${server.address().port}`, out }
}

test('Crepe with the recipe: documents without an edit, real keys in the hard blocks, and the weight of the chunk', { timeout: 420_000 }, async (context) => {
	const { origin, out } = await serveChunk(context)
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	const page = await browser.newPage({ viewport: { width: 1200, height: 900 } })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})
	await page.goto(origin)
	await page.waitForFunction(() => globalThis.ready)

	// The bytes that an app pays when the editor opens, and no more: the languages stay apart.
	const assets = await readdir(join(out, 'assets'))
	const scripts = await Promise.all(assets.filter((file) => file.endsWith('.js')).map(async (file) => ({ file, bytes: await readFile(join(out, 'assets', file)) })))
	const largest = scripts.toSorted((a, b) => b.bytes.length - a.bytes.length)[0]
	const gzip = gzipSync(largest.bytes).length
	assert.ok(gzip < 420_000, `the chunk of the editor weighs ${gzip} bytes in gzip, it was measured at 360 KB`)
	assert.equal(assets.filter((file) => /\.(?:woff2?|ttf)$/.test(file)).length, 0, 'no fonts of KaTeX')
	for (const script of scripts) assert.doesNotMatch(script.bytes.toString('utf8'), /katex-display/, script.file)

	const open = (source) => page.evaluate((text) => globalThis.openEditor(text), source)
	const flush = () => page.evaluate(() => globalThis.flushEditor())
	const editor = page.locator('#host .ProseMirror')

	// Every document without an edit: the file itself, and no change event.
	const all = documents()
	assert.ok(all.length > 300)
	for (const { file, source } of all) {
		assert.equal(await open(source), true, `${file} does not match block by block`)
		assert.equal(await flush(), source, `${file} changes without an edit`)
		assert.equal(await page.evaluate(() => globalThis.editorChanges()), 0, `${file} reports a change without an edit`)
	}
	assert.equal(await page.evaluate(() => globalThis.closeEditor()), 0, 'destroy empties the container')
	assert.equal(await page.locator('.milkdown').count(), 0)

	/** Opens a document, runs `edit` on the page and returns what it had and what would be saved. */
	const edited = async (file, edit) => {
		const source = readDocument(file)
		assert.equal(await open(source), true, file)
		await editor.waitFor()
		await edit()
		return { source, after: await flush() }
	}
	const typeAtEndOf = async (locator, text) => {
		await locator.scrollIntoViewIfNeeded()
		await locator.click()
		await page.keyboard.press('End')
		await page.keyboard.type(text)
	}

	// A paragraph of the largest document, in which marks and blank lines are normalized elsewhere.
	let result = await edited('docs/framework.md', () => typeAtEndOf(editor.locator('p').first(), ' Palabra nueva.'))
	assertOneBlockChanged(result.source, result.after, 'framework.md, a paragraph')
	assert.ok(result.after.includes(' Palabra nueva.'))

	// A table with `\|`: its cell stays one cell, and only that table is rewritten.
	result = await edited('docs/reference/advanced/buildproject.md', () => typeAtEndOf(editor.locator('td').filter({ hasText: '|' }).first(), ' Xq'))
	assertOneBlockChanged(result.source, result.after, 'buildproject.md, a table with a pipe')
	const row = result.after.split('\n').find((line) => line.includes(' Xq'))
	assert.match(row ?? '', /\\\|/, 'the pipe keeps its escape')

	// A click in a cell puts the caret there. Milkdown then selects the whole cell, in a next frame and
	// with no visible mark, so that the next key would erase what the cell had.
	result = await edited('docs/reference/advanced/buildproject.md', async () => {
		const cell = editor.locator('td').filter({ hasText: '|' }).first()
		await cell.scrollIntoViewIfNeeded()
		await cell.click()
		await page.waitForTimeout(150)
		assert.equal(await page.evaluate(() => globalThis.document.querySelector('#host .ProseMirror-selectednode')), null, 'nothing is selected by a click')
		await page.keyboard.type('Xq')
	})
	assertOneBlockChanged(result.source, result.after, 'buildproject.md, a click in a cell')
	const clicked = result.after.split('\n').find((line) => line.includes('Xq'))
	for (const value of ['"node"', '"bun"', '"deno"', '"cloudflare"', '"static"']) assert.ok(clicked?.includes(value), `the cell keeps ${value}: ${clicked}`)

	// A code block with its meta: the line is added, and the fence stays.
	const withMeta = documents().find(({ source }) => /^```ts bad$/m.test(source))
	assert.ok(withMeta, 'a document with a meta')
	result = await edited(withMeta.file, () => typeAtEndOf(editor.locator('.milkdown-code-block:has(.cm-content) .cm-line').first(), ' // X'))
	assertOneBlockChanged(result.source, result.after, `${withMeta.file}, a code block`)
	assert.equal(result.after.match(/^```ts bad$/gm)?.length, result.source.match(/^```ts bad$/gm)?.length, 'every meta stays')

	// A GitHub note: its marker stays a marker when its own block is rewritten.
	result = await edited('docs/reference/composables/useform.md', () => typeAtEndOf(editor.locator('blockquote p').first(), ' X'))
	assertOneBlockChanged(result.source, result.after, 'useform.md, a note')
	assert.match(result.after, /^> \[!NOTE\]/m)
	assert.doesNotMatch(result.after, /\\\[!NOTE\]/)

	// A list.
	result = await edited('docs/doctor.md', () => typeAtEndOf(editor.locator('li').first(), ' X'))
	assertOneBlockChanged(result.source, result.after, 'doctor.md, a list')

	// A new paragraph: nothing else changes, in a document that is not normalized as it is written.
	result = await edited('docs/doctor.md', async () => {
		await typeAtEndOf(editor.locator('p').first(), '')
		await page.keyboard.press('Enter')
		await page.keyboard.type('Párrafo nuevo.')
	})
	assert.equal(result.after.replace('Párrafo nuevo.\n\n', ''), result.source, 'only the paragraph is new')

	// Typing and undoing, and two Enter without text: the file itself.
	result = await edited('docs/framework.md', async () => {
		await typeAtEndOf(editor.locator('p').first(), 'X')
		await page.keyboard.press('Control+z')
	})
	assert.equal(result.after, result.source, 'undo gives the file back')
	result = await edited('docs/doctor.md', async () => {
		await typeAtEndOf(editor.locator('p').first(), '')
		await page.keyboard.press('Enter')
		await page.keyboard.press('Enter')
	})
	assert.equal(result.after, result.source, 'empty paragraphs are not an edit')

	// A table from the menu, right before a code block: the caret goes to its first cell.
	result = await edited('docs/doctor.md', async () => {
		await typeAtEndOf(editor.locator('p').first(), '')
		await page.keyboard.press('Enter')
		await page.keyboard.type('/table')
		await page.locator('.milkdown-slash-menu[data-show="true"]').getByText('table', { exact: true }).waitFor()
		await page.keyboard.press('Enter')
		await page.keyboard.type('Columna')
	})
	assert.match(result.after, /^\| Columna +\|/m, 'the key goes to the first cell')
	assert.ok(result.after.includes('```sh\npnpm exec meeko doctor\n'), 'and not into the code block after the table')

	// The rest of a table by hand: a click in an empty cell, a new row and the handle of a column.
	const table = editor.locator('.milkdown-table-block').first()
	await table.locator('tbody tr').nth(1).locator('td').nth(1).click()
	await page.waitForTimeout(150)
	await page.keyboard.type('Vacía')
	assert.match(await flush(), /^\| +\| Vacía +\| +\|$/m, 'an empty cell takes the key')
	const rows = await table.locator('tr').count()
	// The button to add a row appears near the line between two rows.
	const line = await table.locator('tr').nth(1).boundingBox()
	await page.mouse.move(line.x + 40, line.y + line.height - 1)
	await table.locator('[data-role="x-line-drag-handle"][data-show="true"] .add-button').click({ timeout: 5000 })
	assert.equal(await table.locator('tr').count(), rows + 1, 'the button adds a row')
	await table.locator('th').nth(1).hover()
	await table.locator('[data-role="col-drag-handle"][data-show="true"]').click({ timeout: 5000 })
	await table.locator('.selectedCell').first().waitFor({ timeout: 5000 })
	assert.equal(await table.locator('.selectedCell').count(), rows + 1, 'the handle still selects the whole column')

	// Copying a code block keeps its meta in the HTML of the clipboard, and pasting it brings it back.
	const clipboard = await page.evaluate(async () => {
		await globalThis.openEditor('```ts bad\nconst a = 1\n```\n\nFin.\n')
		const view = globalThis.document.querySelector('#host .ProseMirror')
		view.focus()
		globalThis.getSelection().selectAllChildren(view)
		await new Promise((resolve) => setTimeout(resolve, 100))
		const data = new globalThis.DataTransfer()
		view.dispatchEvent(new globalThis.ClipboardEvent('copy', { clipboardData: data, bubbles: true, cancelable: true }))
		return data.getData('text/html')
	})
	assert.match(clipboard, /data-meta="bad"/)
	const pasted = await page.evaluate(async (html) => {
		await globalThis.openEditor('Primero.\n')
		const view = globalThis.document.querySelector('#host .ProseMirror')
		view.focus()
		const data = new globalThis.DataTransfer()
		data.setData('text/html', html)
		view.dispatchEvent(new globalThis.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
		await new Promise((resolve) => setTimeout(resolve, 100))
		return globalThis.flushEditor()
	}, clipboard)
	assert.match(pasted, /^```ts bad$/m, 'pasted with its meta')

	// A pasted image does not become the `blob:` address of this tab.
	const image = await page.evaluate(async () => {
		await globalThis.openEditor('Primero.\n')
		const view = globalThis.document.querySelector('#host .ProseMirror')
		view.focus()
		const data = new globalThis.DataTransfer()
		data.items.add(new File([new Uint8Array([137, 80, 78, 71])], 'a.png', { type: 'image/png' }))
		view.dispatchEvent(new globalThis.ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }))
		await new Promise((resolve) => setTimeout(resolve, 200))
		return globalThis.flushEditor()
	})
	assert.doesNotMatch(image, /blob:/)

	await page.evaluate(() => globalThis.closeEditor())
	assert.deepEqual(errors, [])
})

const page = `<script lang="ts">
	const text = signal('# Título\\n\\nTexto.\\n')
	const mode = signal<'code' | 'visual'>('visual')
	const readonly = signal(false)
	const disabled = signal(false)
	const shown = signal(true)
	onMounted(() => {
		Object.assign(globalThis, { controls: { text, mode, readonly, disabled, shown } })
	})
</script>

<template>
	<UIMarkdownEditor
		if:when="shown.value"
		id="code"
		label="Contenido"
		model="text"
		model:mode="mode"
		bind:readonly="readonly.value"
		bind:disabled="disabled.value"
	/>
</template>
`

/** An app that registers the module by its name, without declaring Crepe: the workspace gives it. */
async function startConsumer(context) {
	const parent = join(packageRoot, '.meeko')
	await mkdir(parent, { recursive: true })
	const root = await mkdtemp(join(parent, 'markdown-editor-'))
	const links = { '@meekojs/meeko': join(packageRoot, '../meeko'), '@meekojs/ui': packageRoot, vite: join(packageRoot, '../meeko/node_modules/vite') }
	const linked = Object.keys(links).map((name) => join(root, 'node_modules', name))
	const files = {
		'package.json': JSON.stringify({ name: 'markdown-editor-consumer', private: true, type: 'module', dependencies: { '@meekojs/meeko': '*', '@meekojs/ui': '*' } }),
		'meeko.config.mjs': `export default { modules: ['@meekojs/ui', '@meekojs/ui/editor'], server: { adapter: 'node' } }\n`,
		'app/app.meeko': '<template><MeekoOutlet /></template>\n',
		'app/pages/index.meeko': page,
	}
	for (const [file, source] of Object.entries(files)) {
		await mkdir(dirname(join(root, file)), { recursive: true })
		await writeFile(join(root, file), source)
	}
	for (const [name, source] of Object.entries(links)) {
		await mkdir(dirname(join(root, 'node_modules', name)), { recursive: true })
		await symlink(source, join(root, 'node_modules', name), 'junction')
	}
	const listener = createServer().listen(0, '127.0.0.1')
	await new Promise((resolve) => listener.once('listening', resolve))
	const port = listener.address().port
	await new Promise((resolve) => listener.close(resolve))
	const hmr = createServer().listen(0, '127.0.0.1')
	await new Promise((resolve) => hmr.once('listening', resolve))
	const hmrPort = hmr.address().port
	await new Promise((resolve) => hmr.close(resolve))
	const cli = fileURLToPath(new URL('../../meeko/dist/cli.js', import.meta.url))
	const server = spawn(process.execPath, [cli, 'dev', root], { cwd: root, env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: '0', NODE_OPTIONS: '--max-old-space-size=8192' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
	let logs = ''
	server.stdout.on('data', (chunk) => (logs += chunk))
	server.stderr.on('data', (chunk) => (logs += chunk))
	context.after(async () => {
		server.kill()
		if (server.exitCode === null) await once(server, 'exit')
		for (const link of linked) await unlink(link).catch(() => undefined)
		await rm(root, { recursive: true, force: true })
	})
	const origin = `http://127.0.0.1:${port}`
	const started = Date.now()
	while (true) {
		if (server.exitCode !== null || Date.now() - started > 90_000) throw new Error(logs)
		try {
			if ((await fetch(origin)).ok) return { origin, html: await (await fetch(origin)).text(), logs: () => logs }
		} catch {
			/* Server is starting. */
		}
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
}

test('the component: SSR marker, one load, readonly, disabled, a text from outside, a failed chunk and its release', { timeout: 240_000 }, async (context) => {
	const { origin, html } = await startConsumer(context)
	assert.match(html, /ui-markdown-editor-marker/, 'the server paints the marker')
	assert.match(html, /Cargando el editor…/)
	assert.doesNotMatch(html, /class="milkdown|ProseMirror/, 'and not Crepe')
	assert.doesNotMatch(html, /crepe[^"]*\.(?:js|css)/, 'nor does it ask for its chunk')

	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	const browserPage = await browser.newPage({ viewport: { width: 1200, height: 800 } })
	const errors = []
	let documents = 0
	browserPage.on('pageerror', (error) => errors.push(error.message))
	browserPage.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})
	browserPage.on('framenavigated', (frame) => {
		if (frame === browserPage.mainFrame()) documents++
	})
	await browserPage.goto(origin)
	const editor = browserPage.locator('.ui-markdown-editor .ProseMirror')
	const code = browserPage.locator('#code')
	const root = browserPage.locator('.ui-markdown-editor')
	const text = () => browserPage.evaluate(() => globalThis.controls.text.value)
	const set = (name, value) => browserPage.evaluate(([key, next]) => (globalThis.controls[key].value = next), [name, value])
	await editor.waitFor({ timeout: 120_000 })
	await browserPage.waitForFunction(() => globalThis.controls)
	assert.equal(await text(), '# Título\n\nTexto.\n', 'opening is not an edit')
	assert.equal(await browserPage.getByRole('textbox', { name: 'Contenido' }).count(), 1, 'named by its label')
	assert.equal(documents, 1, 'Vite does not reload the page to optimize Crepe')
	assert.equal(await browserPage.locator('.ui-markdown-editor-marker').count(), 0)

	// The model follows a real key, right when the editor loses the focus.
	await editor.locator('p').click()
	await browserPage.keyboard.press('End')
	await browserPage.keyboard.type(' Más.')
	await browserPage.getByRole('button', { name: 'Código' }).focus()
	assert.equal(await text(), '# Título\n\nTexto. Más.\n')

	// Read-only: neither face takes a key.
	await set('readonly', true)
	assert.equal(await editor.getAttribute('contenteditable'), 'false')
	await editor.locator('p').click()
	await browserPage.keyboard.type('nada')
	await browserPage.getByRole('button', { name: 'Código' }).click()
	assert.equal(await code.getAttribute('readonly'), '')
	await code.click()
	await browserPage.keyboard.type('nada')
	assert.equal(await text(), '# Título\n\nTexto. Más.\n')
	await set('readonly', false)
	await code.fill('# Otro\n\nDesde el código.\n')
	assert.equal(await text(), '# Otro\n\nDesde el código.\n', 'the code mode writes the model')

	// Disabled: as read-only, and it looks so.
	await set('disabled', true)
	assert.equal(await code.isDisabled(), true)
	assert.equal(await root.getAttribute('data-disabled'), '')
	await browserPage.getByRole('button', { name: 'Visual' }).click()
	await editor.getByText('Desde el código.').waitFor()
	assert.equal(await editor.getAttribute('contenteditable'), 'false', 'also when Crepe starts over while disabled')
	await set('disabled', false)
	assert.equal(await editor.getAttribute('contenteditable'), 'true')

	// A text from outside reaches Crepe, and that is not an edit of its own.
	await set('text', '# De fuera\n')
	await editor.getByText('De fuera').waitFor()
	assert.equal(await text(), '# De fuera\n')

	// What Crepe could not write back as it was opens as text, with a notice, and is not touched.
	const tricky = '[a]: https://example.com\n\nTexto con [a].\n'
	await set('text', tricky)
	await browserPage.locator('.ui-markdown-editor-notice').getByText('reescribiría').waitFor({ timeout: 30_000 })
	assert.equal(await root.getAttribute('data-state'), 'unsafe')
	assert.equal(await root.getAttribute('data-mode'), 'code')
	assert.equal(await code.inputValue(), tricky)
	assert.equal(await text(), tricky)

	// Unmounting releases Crepe.
	await set('text', '# Fin\n')
	await set('mode', 'visual')
	await editor.getByText('Fin').waitFor({ timeout: 30_000 })
	await set('shown', false)
	await browserPage.locator('.milkdown').waitFor({ state: 'detached' })
	assert.deepEqual(errors, [])
	await browserPage.close()

	// A chunk that does not arrive leaves the editor usable, in code mode, and says so.
	const offline = await browser.newPage()
	await offline.route(/editor\/crepe/, (route) => route.abort())
	await offline.goto(origin)
	await offline.locator('.ui-markdown-editor-notice').getByText('No se pudo cargar el editor visual').waitFor({ timeout: 60_000 })
	assert.equal(await offline.locator('.ui-markdown-editor').getAttribute('data-mode'), 'code')
	await offline.locator('#code').fill('# Sigue\n')
	assert.equal(await offline.evaluate(() => globalThis.controls.text.value), '# Sigue\n')
	await offline.close()
})

/** Every file of a folder, recursively. */
async function filesIn(directory) {
	const entries = await readdir(directory, { withFileTypes: true })
	return (await Promise.all(entries.map((entry) => (entry.isDirectory() ? filesIn(join(directory, entry.name)) : [join(directory, entry.name)])))).flat()
}

// `pnpm test:e2e` builds apps/ui first.
test('the client bundle of apps/ui has no Crepe, CodeMirror or Vue, and its server bundle neither', async () => {
	const output = fileURLToPath(new URL('../../../apps/ui/.meeko/output/', import.meta.url))
	assert.ok((await stat(output)).isDirectory(), 'apps/ui was built')
	const files = (await filesIn(output)).filter((file) => /\.(?:m?js|css)$/.test(file))
	assert.ok(files.length > 10, 'the files of a build')
	for (const file of files) assert.doesNotMatch(await readFile(file, 'utf8'), /milkdown|ProseMirror|cm-editor|__VUE_|markdown-editor/, file)
})
