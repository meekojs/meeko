// The editor in Chrome against a temporary schema: edit a guide in Crepe with real keys (its menus,
// and a file that stays as it was without an edit) and in code mode, see the real preview in its
// sandboxed iframe (hostile markup included), save the draft, fail a save and retry it, and publish
// the revision from a modal driven by the keyboard; a reference page whose frontmatter the site
// would reject; the export; a conflict with Git merged into a new draft; a publication that loses to
// a rollback, retried after a reload; a rollback and a return that refresh the pending revisions;
// the Origin of every action; and the size limit of the Markdown as JSON. Every revision and
// snapshot lives in the schema the test creates and drops: the tables of the development database
// are never read or written. Skipped without DATABASE_URL.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

import { adminEnv, login, sessionHeaders, testAdmin } from './fixtures/auth.mjs'

const app = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(new URL('../../../packages/meeko/dist/cli.js', import.meta.url))
if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const url = process.env.DATABASE_URL

async function port() {
	const server = createNetServer().listen(0, '127.0.0.1')
	await once(server, 'listening')
	const value = server.address().port
	await new Promise((done) => server.close(done))
	return value
}

/** The temporary schema: three Markdown sources, a revision written from an older Git and two tiny snapshots. */
async function seed(load, schema) {
	const { createDatabase, createRevision, getSource, importSources, migrate } = await load('meeko-docs-content/db')
	const { publishSnapshot } = await load('meeko-docs-content/snapshots')
	const { readGitFile } = await load('meeko-docs-content/content/repository')
	const admin = createDatabase({ connectionString: url })
	await admin.query(`CREATE SCHEMA ${schema}`)
	await admin.end()
	const db = createDatabase({ connectionString: url, searchPath: schema })
	try {
		await migrate(db)
		const doctor = readGitFile('docs/doctor.md')
		const older = readGitFile('docs/testing.md').replace(/^.*\n/, '# Pruebas (versión antigua)\n')
		await importSources(
			db,
			[
				{ site: 'site', path: '/docs/doctor', kind: 'guide', title: 'Doctor', file: 'docs/doctor.md', markdown: doctor },
				{ site: 'site', path: '/docs/reference/signal', kind: 'reference', title: 'signal', file: 'docs/reference/reactivity/signal.md', markdown: readGitFile('docs/reference/reactivity/signal.md') },
				{ site: 'site', path: '/docs/testing', kind: 'guide', title: 'Pruebas y CI', file: 'docs/testing.md', markdown: older },
			],
			['site'],
		)
		const ids = {}
		for (const [key, path] of [
			['doctor', '/docs/doctor'],
			['signal', '/docs/reference/signal'],
			['testing', '/docs/testing'],
		])
			ids[key] = (await getSource(db, { site: 'site', path })).id
		await createRevision(db, { sourceId: ids.testing, markdown: `${older}\nLínea de la revisión antigua.\n`, author: 'e2e', note: 'escrita sobre un Git antiguo' })
		ids.first = await publishSnapshot([{ path: '/docs', payload: { title: 'uno' } }], { db, publishedBy: 'e2e' })
		ids.second = await publishSnapshot([{ path: '/docs', payload: { title: 'dos' } }], { db, publishedBy: 'e2e' })
		return { ids, doctor }
	} finally {
		await db.end()
	}
}

test('edit a source with its preview, save the draft and publish it; rejections, export, conflicts and a retried publication', { skip: url ? false : 'DATABASE_URL is not set', timeout: 420_000 }, async (context) => {
	const vite = await createServer({ root: app, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
	const load = (id) => vite.ssrLoadModule(id)
	const { createDatabase } = await load('meeko-docs-content/db')
	const { activateSnapshot } = await load('meeko-docs-content/snapshots')
	const schema = `dash_e2e_${process.pid}_${randomBytes(4).toString('hex')}`
	const cleanups = []
	context.after(async () => {
		for (const cleanup of cleanups.reverse()) await cleanup()
		const admin = createDatabase({ connectionString: url })
		try {
			await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		} finally {
			await admin.end()
			await vite.close()
		}
	})
	const { ids, doctor } = await seed(load, schema)

	const httpPort = await port()
	const hmrPort = await port()
	const account = await testAdmin('E2E')
	const server = spawn(process.execPath, [cli, 'dev', app], {
		cwd: app,
		env: { ...process.env, ...adminEnv(account), DASHBOARD_DATABASE_SCHEMA: schema, PORT: String(httpPort), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: '0', NODE_OPTIONS: '--max-old-space-size=8192' },
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	cleanups.push(async () => {
		server.kill()
		if (server.exitCode === null) await once(server, 'exit')
	})
	let logs = ''
	server.stdout.on('data', (chunk) => (logs += chunk))
	server.stderr.on('data', (chunk) => (logs += chunk))
	const origin = `http://127.0.0.1:${httpPort}`
	const started = Date.now()
	while (true) {
		if (server.exitCode !== null || Date.now() - started > 60_000) throw new Error(logs)
		try {
			if ((await fetch(origin)).ok) break
		} catch {
			/* Server is starting. */
		}
		await new Promise((done) => setTimeout(done, 100))
	}

	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	cleanups.push(() => browser.close())
	const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true })
	await login(page, origin, account)
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		// With the URL of a failed resource, so an unexpected one says what it was.
		if (message.type() === 'error') errors.push(message.location()?.url && /Failed to load resource/.test(message.text()) ? `${message.text()} (${message.location().url})` : message.text())
	})
	// A page that does not hydrate reports what the console said meanwhile.
	const hydrated = () =>
		page
			.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0, undefined, { timeout: 60_000 })
			.catch((error) => {
				throw new Error([error.message, page.url(), ...errors].join('\n'))
			})
	const status = (text) => page.getByRole('status').filter({ hasText: text }).waitFor({ timeout: 60_000 })
	// The two faces of UIMarkdownEditor: Crepe, and the text area of the code mode.
	const crepe = page.locator('.ui-markdown-editor .ProseMirror')
	const editor = page.locator('#draft-markdown')
	const modes = page.getByRole('group', { name: 'Modo de edición' })
	const codeMode = async () => {
		await modes.getByRole('button', { name: 'Código' }).click()
		await editor.waitFor()
	}
	const visualMode = async () => {
		await modes.getByRole('button', { name: 'Visual' }).click()
		await crepe.waitFor({ timeout: 60_000 })
	}
	/** Puts the caret at the end of the first element of a kind, with a real click and a real key. */
	const caretAtEndOf = async (locator) => {
		await locator.scrollIntoViewIfNeeded()
		await locator.click()
		// `End` stops at the end of the visual line, and an Enter there would split a wrapped paragraph.
		await locator.evaluate((element) => globalThis.getSelection().collapse(element, element.childNodes.length))
	}
	// The preview is the document of a sandboxed iframe: its content is read through the frame.
	const previewFrame = page.locator('iframe.dash-preview-frame')
	const preview = page.frameLocator('iframe.dash-preview-frame').locator('body')
	/** The focused element, as `tag#id:text`, to follow the focus through the modals. */
	const focused = () =>
		page.evaluate(() => {
			const element = globalThis.document.activeElement
			return element ? `${element.tagName.toLowerCase()}${element.id ? '#' + element.id : ''}:${(element.textContent ?? '').trim().replace(/\s+/g, ' ')}` : 'none'
		})
	const inDialog = () => page.evaluate(() => Boolean(globalThis.document.activeElement?.closest('dialog[open]')))

	// The guide: from its detail to the editor, whose preview is the real render of the site.
	await page.goto(`${origin}/sources/${ids.doctor}`, { waitUntil: 'networkidle' })
	await hydrated()
	await page.getByRole('link', { name: 'Editar', exact: true }).click()
	await page.waitForURL(/\/sources\/\d+\/edit$/)
	await hydrated()
	await preview.getByRole('heading', { level: 1, name: 'Diagnóstico del proyecto' }).waitFor({ timeout: 60_000 })
	assert.equal(await page.getByLabel('Autor').count(), 0, 'the author is the user of the session (F5), not a field')

	// Crepe opens by itself, in the browser, and opening it is not an edit.
	await crepe.waitFor({ timeout: 60_000 })
	assert.equal(await crepe.getAttribute('role'), 'textbox')
	assert.equal(await page.getByRole('textbox', { name: 'Markdown de la fuente' }).count(), 1, 'the editor is named')
	await status('Sin cambios todavía')
	assert.equal(await page.getByRole('button', { name: 'Crear borrador' }).isDisabled(), true, 'nothing to save without an edit')

	// Real keys in Crepe: one line changes, and undoing them leaves nothing to save.
	await caretAtEndOf(crepe.locator('p').first())
	await page.keyboard.type(' Escrito con el teclado.')
	await status('1 línea cambiada sin guardar')
	await page.keyboard.press('Control+z')
	await status('Sin cambios todavía')
	// Empty paragraphs are not an edit either.
	await caretAtEndOf(crepe.locator('p').first())
	await page.keyboard.press('Enter')
	await page.keyboard.press('Enter')
	await page.getByRole('button', { name: 'Actualizar', exact: true }).focus()
	await status('Sin cambios todavía')
	assert.equal(await page.getByRole('button', { name: 'Crear borrador' }).isDisabled(), true, 'two Enter do not make a draft')

	// The menus of Crepe, in the language of the dashboard: a heading and a table from the slash menu,
	// and a mark from the floating toolbar. In code mode they are Markdown, next to the bytes of the rest.
	await page.reload({ waitUntil: 'networkidle' })
	await hydrated()
	await crepe.waitFor({ timeout: 60_000 })
	await caretAtEndOf(crepe.locator('p').first())
	await page.keyboard.press('Enter')
	await page.keyboard.type('/tabla')
	const slash = page.locator('.milkdown-slash-menu[data-show="true"]')
	await slash.getByText('Tabla', { exact: true }).waitFor()
	await page.keyboard.press('Enter')
	await crepe.locator('.milkdown-table-block').waitFor()
	await page.keyboard.type('Columna')
	await page.keyboard.press('Shift+Home')
	const toolbar = page.locator('.milkdown-toolbar[data-show="true"]')
	await toolbar.getByRole('button', { name: 'Negrita' }).click()
	await status(/líneas cambiadas sin guardar/)
	await codeMode()
	const withTable = await editor.inputValue()
	assert.match(withTable, /\*\*Columna\*\*/, 'the mark of the toolbar')
	assert.match(withTable, /^\| \*\*Columna\*\* +\|/m, 'the table of the menu')
	const without = withTable.replace(/\n\| \*\*Columna[\s\S]*?\n\n/, '\n')
	assert.equal(without, doctor, 'the rest of the file keeps its bytes')

	// The code mode shows the same text, and what is written there reaches Crepe.
	await editor.fill(`${doctor}\nLínea escrita en la prueba e2e.\n`)
	await status('2 líneas cambiadas sin guardar')
	await visualMode()
	await crepe.getByText('Línea escrita en la prueba e2e.').waitFor()
	await codeMode()
	assert.equal(await editor.inputValue(), `${doctor}\nLínea escrita en la prueba e2e.\n`)
	await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
	await preview.getByText('Línea escrita en la prueba e2e.').waitFor({ timeout: 60_000 })
	assert.equal(await previewFrame.getAttribute('sandbox'), '', 'sandboxed without any allow-* token')

	// Hostile raw HTML in a draft stays inside the iframe: a global <style>, an <iframe>, a <script>
	// and on* attributes neither hide the controls of the editor nor run.
	const title = await page.title()
	await editor.fill(
		[
			'# Marcado hostil',
			'',
			'<style>#draft-author, #draft-markdown, .dash-editor-bar, button, body { display: none !important; }</style>',
			'<iframe src="/"></iframe>',
			'<script>parent.document.title = "pwned"; parent.__pwned = 1; document.body.dataset.ran = "1"</script>',
			`<details open ontoggle="parent.__pwned = 2; document.body.dataset.ran = '2'"><summary>Hostil</summary>Contenido hostil.</details>`,
			'',
		].join('\n'),
	)
	await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
	await preview.getByText('Contenido hostil.').waitFor({ state: 'attached', timeout: 60_000 })
	for (const control of [editor, page.getByRole('button', { name: 'Actualizar', exact: true }), page.getByRole('button', { name: 'Crear borrador' })]) assert.equal(await control.isVisible(), true, 'the controls of the editor stay visible')
	assert.equal(await page.title(), title)
	assert.equal(await page.evaluate(() => globalThis.__pwned), undefined, 'nothing ran in the dashboard')
	assert.equal(await preview.getAttribute('data-ran'), null, 'nothing ran in the preview either')
	// Nor in Crepe, which shows the raw HTML of a document as data.
	await visualMode()
	await crepe.getByText('Marcado hostil').waitFor()
	assert.equal(await page.evaluate(() => globalThis.__pwned), undefined, 'nothing ran in Crepe')
	assert.equal(await page.title(), title)
	assert.equal(await crepe.locator('script, iframe, style, details').count(), 0, 'the HTML is not markup in Crepe')
	await codeMode()
	await editor.fill(`${doctor}\nLínea escrita en la prueba e2e.\n`)
	await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
	await preview.getByText('Línea escrita en la prueba e2e.').waitFor({ timeout: 60_000 })

	// Unsaved changes: leaving through the app asks first; dismissing keeps the editor.
	const asked = page.waitForEvent('dialog')
	const nav = page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Fuentes' }).click()
	const dialog = await asked
	assert.match(dialog.message(), /cambios sin guardar/)
	await dialog.dismiss()
	await nav
	assert.match(page.url(), /\/edit$/)

	// Save the draft: the address keeps it, and nothing is left unsaved.
	await page.getByLabel('Nota').fill('Prueba e2e')
	await page.getByRole('button', { name: 'Crear borrador' }).click()
	await status(/Borrador #\d+ creado\./)
	const draft = Number(/revision=(\d+)/.exec(page.url())?.[1])
	assert.ok(draft > 0, page.url())
	await status('Todo guardado')

	// A failed save: another tab saved the draft meanwhile. The text stays, it is still unsaved and
	// leaving still asks; once the other change is gone, saving again works.
	const e2eText = `${doctor}\nLínea escrita en la prueba e2e.\n`
	const { updateDraft } = await load('meeko-docs-content/db')
	const tab = createDatabase({ connectionString: url, searchPath: schema })
	try {
		await updateDraft(tab, draft, { markdown: `${doctor}\nOtra pestaña.\n`, author: 'otra pestaña' })
		const edited = `${doctor}\nLínea previa.\nLínea escrita en la prueba e2e.\n`
		await editor.fill(edited)
		await page.getByRole('button', { name: 'Guardar borrador' }).click()
		await page.getByText('No se guardó el borrador').waitFor()
		await status(/sin guardar/)
		assert.equal(await editor.inputValue(), edited, 'the text of the failed save is kept')
		const leaving = page.waitForEvent('dialog')
		const away = page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Fuentes' }).click()
		const ask = await leaving
		assert.match(ask.message(), /cambios sin guardar/)
		await ask.dismiss()
		await away
		assert.match(page.url(), /\/edit\?revision=/)
		await updateDraft(tab, draft, { markdown: e2eText, author: 'E2E' })
	} finally {
		await tab.end()
	}
	await page.getByRole('button', { name: 'Guardar borrador' }).click()
	await status(`Borrador #${draft} guardado.`)
	await status('Todo guardado')

	// Publish it from the source, after confirming. The modal opens and closes from the keyboard,
	// and Escape gives the focus back to the button that opened it.
	await page.getByRole('link', { name: 'Publicarlo desde la fuente' }).click()
	await page.waitForURL(/\/sources\/\d+#revisiones$/)
	await hydrated()
	const publishButton = page.getByRole('button', { name: `Publicar la revisión #${draft}` })
	await publishButton.focus()
	const trigger = await focused()
	await page.keyboard.press('Enter')
	let modal = page.getByRole('dialog')
	await modal.waitFor({ state: 'visible' })
	assert.equal(await inDialog(), true, 'the focus moves into the modal')
	await page.keyboard.press('Escape')
	await modal.waitFor({ state: 'hidden' })
	assert.equal(await focused(), trigger, 'Escape returns the focus to its button')
	await page.keyboard.press('Enter')
	await modal.waitFor({ state: 'visible' })
	await modal.getByRole('button', { name: 'Publicar revisión' }).click()
	await modal.waitFor({ state: 'hidden' })
	await status(`Revisión #${draft} publicada`)
	await page.getByRole('note').filter({ hasText: 'el snapshot activo aún no la incluye' }).waitFor()

	// Export: the browser downloads the .md; the server writes nothing to docs/.
	const downloading = page.waitForEvent('download')
	await page.getByRole('button', { name: `Exportar la revisión #${draft} a .md` }).click()
	const download = await downloading
	assert.equal(download.suggestedFilename(), 'doctor.md')
	const chunks = []
	for await (const chunk of await download.createReadStream()) chunks.push(chunk)
	assert.match(Buffer.concat(chunks).toString('utf8'), /Línea escrita en la prueba e2e\.\n$/)

	// A reference page, whose frontmatter is edited as fields and never reaches Crepe.
	await page.goto(`${origin}/sources/${ids.signal}/edit`, { waitUntil: 'networkidle' })
	await hydrated()
	await page.locator('.dash-preview-state').filter({ hasText: 'Render en' }).waitFor({ timeout: 60_000 })
	await crepe.waitFor({ timeout: 60_000 })
	assert.equal(await crepe.getByText('source-hash').count(), 0)
	assert.equal(await crepe.locator('hr').first().count(), 0, 'its delimiters are not a rule of the editor')
	const reference = (await load('meeko-docs-content/content/repository')).readGitFile('docs/reference/reactivity/signal.md')
	const [, referenceHead, referenceBody] = /^(---\n[\s\S]*?\n---\n\s*)([\s\S]*)$/.exec(reference)
	await page.locator('#draft-frontmatter summary').click()
	assert.equal(await page.getByLabel('title', { exact: true }).inputValue(), 'signal')
	assert.equal(await page.getByLabel('since', { exact: true }).inputValue(), '1.0.0')
	assert.match(await page.getByLabel('symbols', { exact: true }).inputValue(), /^@meekojs\/meeko#signal$/m)
	await status('Sin cambios todavía')

	// A key in a block of a real page saved right after typing: the text of the draft is this file with
	// one line changed, and that line is this paragraph, whatever Crepe would do to the rest.
	await caretAtEndOf(crepe.locator('p').first())
	await page.keyboard.type(' Con Crepe.')
	await page.getByLabel('Nota').fill('Desde Crepe')
	await page.getByRole('button', { name: 'Crear borrador' }).click()
	await status(/Borrador #\d+ creado\./)
	const fromCrepe = Number(/revision=(\d+)/.exec(page.url())?.[1])
	const { getRevision } = await load('meeko-docs-content/db')
	const reader = createDatabase({ connectionString: url, searchPath: schema })
	try {
		const stored = (await getRevision(reader, fromCrepe)).markdown
		assert.equal(stored.startsWith(referenceHead), true, 'the frontmatter is the same')
		const before = reference.split('\n')
		const after = stored.split('\n')
		assert.equal(after.length, before.length)
		const changedLines = after.filter((line, index) => line !== before[index])
		assert.equal(changedLines.length, 1, changedLines.join('\n'))
		assert.ok(changedLines[0].endsWith(' Con Crepe.'))
	} finally {
		await reader.end()
	}
	await page.goto(`${origin}/sources/${ids.signal}`, { waitUntil: 'networkidle' })
	await hydrated()
	await page.getByRole('button', { name: `Archivar la revisión #${fromCrepe}` }).click()
	await page.getByRole('dialog').getByRole('button', { name: 'Archivar revisión' }).click()
	await status(`Revisión #${fromCrepe} archivada.`)

	// A broken link: its warning opens the code mode with the caret on its line of the file, past the
	// frontmatter, which the code mode does not show.
	await page.goto(`${origin}/sources/${ids.signal}/edit`, { waitUntil: 'networkidle' })
	await hydrated()
	await crepe.waitFor({ timeout: 60_000 })
	await codeMode()
	const broken = '[enlace roto](/docs/esta-pagina-no-existe)'
	await editor.fill(`${broken}\n\n${referenceBody}`)
	await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
	const warnings = page.getByRole('region', { name: 'Avisos de la vista previa' })
	const brokenWarning = warnings.getByRole('listitem').filter({ hasText: 'esta-pagina-no-existe' })
	await brokenWarning.waitFor({ timeout: 60_000 })
	await visualMode()
	await brokenWarning.getByRole('button', { name: /^Línea \d+$/ }).click()
	await editor.waitFor()
	assert.equal(await editor.evaluate((element) => element === globalThis.document.activeElement), true, 'the caret goes to the code')
	assert.equal(await editor.evaluate((element) => element.value.slice(element.selectionStart, element.selectionEnd)), broken)
	await editor.fill(referenceBody)
	await status('Sin cambios todavía')

	// A reference page without `since`: a warning in the preview, a draft, and a clear refusal on publish.
	await page.locator('#draft-frontmatter summary').click()
	await page.getByLabel('since', { exact: true }).fill('')
	await status('1 línea cambiada sin guardar')
	await page.getByRole('button', { name: 'Actualizar', exact: true }).click()
	await page.getByRole('region', { name: 'Avisos de la vista previa' }).getByText('Bloquea la publicación').waitFor({ timeout: 60_000 })
	await page.getByRole('button', { name: 'Crear borrador' }).click()
	await status(/Borrador #\d+ creado\./)
	const incomplete = Number(/revision=(\d+)/.exec(page.url())?.[1])
	await page.goto(`${origin}/sources/${ids.signal}`, { waitUntil: 'networkidle' })
	await hydrated()
	await page.getByRole('button', { name: `Publicar la revisión #${incomplete}` }).click()
	modal = page.getByRole('dialog')
	await modal.getByRole('button', { name: 'Publicar revisión' }).click()
	await modal.getByRole('alert').filter({ hasText: 'No se publicó' }).waitFor()
	assert.match((await modal.getByRole('alert').textContent()) ?? '', /needs since/)
	await modal.getByRole('button', { name: 'Cancelar' }).click()
	await page.getByRole('button', { name: `Archivar la revisión #${incomplete}` }).click()
	await page.getByRole('dialog').getByRole('button', { name: 'Archivar revisión' }).click()
	await status(`Revisión #${incomplete} archivada.`)

	// A revision written from an older Git: the three sides, and a trivial merge into a new draft.
	await page.goto(`${origin}/sources/${ids.testing}`, { waitUntil: 'networkidle' })
	await hydrated()
	assert.equal(await page.getByText('Conflicto con Git', { exact: true }).count(), 1)
	await page.getByRole('button', { name: /^Ver conflicto de la revisión/ }).click()
	await page.getByRole('heading', { name: 'Base → Git ahora' }).waitFor()
	assert.match((await page.locator('.dash-three-way').textContent()) ?? '', /Pruebas \(versión antigua\)/)
	await page.getByRole('button', { name: 'Crear borrador: Git actual + mis cambios' }).click()
	await status(/creado con Git actual y los cambios de la revisión/)
	assert.equal(await page.getByText('Conflicto con Git', { exact: true }).count(), 1, 'the new draft is written from the Git of now')

	// Snapshots: the published revision is pending; a publication that loses to a rollback is retried after a reload.
	await page.goto(`${origin}/snapshots`, { waitUntil: 'networkidle' })
	await hydrated()
	await page.getByRole('region', { name: 'Revisiones sin publicar en el site' }).getByRole('link', { name: 'Doctor' }).waitFor()
	await page.getByRole('button', { name: 'Publicar snapshot…' }).click()
	modal = page.getByRole('dialog')
	await modal.getByLabel('Nota').fill('con conflicto')
	await modal.getByRole('button', { name: 'Publicar y activar' }).click()
	// The rollback must commit after the job read the active snapshot it builds on: the job prints
	// that line right after the read, before the render. «Renderizando…» comes earlier, before the
	// child loads the package through Vite, which under load takes longer than any fixed pause.
	await page
		.getByRole('log')
		.filter({ hasText: `Over the active snapshot #${ids.second}` })
		.waitFor({ timeout: 120_000 })
		.catch(async (error) => {
			const text = async (selector) => ((await page.locator(selector).allTextContents()).join(' | ') || '(none)').replace(/\s+/g, ' ')
			throw new Error([error.message, `failure: ${await text('.dash-failure')}`, `job: ${await text('.dash-job')}`, `server: ${logs.slice(-1500)}`].join(' // '))
		})
	// The rollback commits while the publication renders, in the temporary schema.
	const db = createDatabase({ connectionString: url, searchPath: schema })
	try {
		await activateSnapshot(ids.first, db)
	} finally {
		await db.end()
	}
	await page
		.getByText('Otro cambio se publicó mientras tanto')
		.waitFor({ timeout: 180_000 })
		.catch(async (error) => {
			const text = async (selector) => ((await page.locator(selector).allTextContents()).join(' | ') || '(none)').replace(/\s+/g, ' ')
			throw new Error([error.message, `notice: ${await text('.dash-notice')}`, `failure: ${await text('.dash-failure')}`, `job: ${await text('.dash-job')}`].join(' // '))
		})
	await page.reload({ waitUntil: 'networkidle' })
	await hydrated()
	await page.getByRole('button', { name: 'Volver a publicar' }).click()
	await page.getByRole('log').filter({ hasText: 'by e2e' }).waitFor({ timeout: 30_000 })
	// The summary of the job, not the notice: the notice only appears if this very page saw the job
	// go from running to finished, and a reload of `meeko dev` meanwhile (another change to the
	// workspace) loses that transition, while the job keeps its summary.
	await page
		.locator('.dash-job-summary')
		.filter({ hasText: /Snapshot \d+ publicado y activo/ })
		.waitFor({ timeout: 180_000 })
		.catch(async (error) => {
			const text = async (selector) => ((await page.locator(selector).allTextContents()).join(' | ') || '(none)').replace(/\s+/g, ' ')
			throw new Error([error.message, `notice: ${await text('.dash-notice')}`, `failure: ${await text('.dash-failure')}`, `job: ${await text('.dash-job')}`, `server:\n${logs}`].join('\n'))
		})
	await page.getByText(/incluye todas las revisiones publicadas/).waitFor({ timeout: 30_000 })

	// A rollback and a return without reloading: the pending revisions follow the active snapshot.
	// The modal of the rollback opens from the keyboard and Escape gives the focus back.
	const latest = Number(/El snapshot activo #(\d+)/.exec((await page.getByText(/incluye todas las revisiones publicadas/).textContent()) ?? '')?.[1])
	assert.ok(latest > ids.second, String(latest))
	const back = page.getByRole('button', { name: `Volver al #${ids.second}` })
	await back.focus()
	const backTrigger = await focused()
	await page.keyboard.press('Enter')
	modal = page.getByRole('dialog', { name: `¿Activar el snapshot #${ids.second}?` })
	await modal.waitFor({ state: 'visible' })
	assert.equal(await inDialog(), true)
	await page.keyboard.press('Escape')
	await modal.waitFor({ state: 'hidden' })
	assert.equal(await focused(), backTrigger, 'Escape returns the focus to its button')
	await back.click()
	await modal.getByRole('button', { name: 'Activar snapshot' }).click()
	await modal.waitFor({ state: 'hidden' })
	const pendingRegion = page.getByRole('region', { name: 'Revisiones sin publicar en el site' })
	await pendingRegion.getByRole('link', { name: 'Doctor' }).waitFor({ timeout: 30_000 })
	await pendingRegion.getByText(`Se publicaron después del snapshot activo #${ids.second}`).waitFor()
	await page.getByRole('button', { name: `Activar el #${latest}` }).click()
	await page
		.getByRole('dialog', { name: `¿Activar el snapshot #${latest}?` })
		.getByRole('button', { name: 'Activar snapshot' })
		.click()
	await page.getByText(`El snapshot activo #${latest} incluye todas las revisiones publicadas.`).waitFor({ timeout: 30_000 })

	// The first paint is the same box as the editor: without JavaScript the marker takes its place.
	await page.goto(`${origin}/sources/${ids.doctor}/edit?revision=${draft}`, { waitUntil: 'networkidle' })
	await hydrated()
	await crepe.waitFor({ timeout: 60_000 })
	const box = async (target) => target.locator('.ui-markdown-editor-surface').boundingBox()
	const hydratedBox = await box(page)
	const noScript = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1440, height: 900 }, storageState: await page.context().storageState() })
	const firstPaint = await noScript.newPage()
	await firstPaint.goto(`${origin}/sources/${ids.doctor}/edit?revision=${draft}`)
	await firstPaint.locator('.ui-markdown-editor-marker').getByText('Cargando el editor…').waitFor()
	assert.equal(await firstPaint.locator('.milkdown').count(), 0, 'the server does not render Crepe')
	assert.deepEqual(await box(firstPaint), hydratedBox, 'nothing moves when the editor arrives')
	await noScript.close()

	// In the light theme too it follows the tokens, without a rule per theme or a second instance.
	const dark = await crepe.evaluate((element) => globalThis.getComputedStyle(element).color)
	await page.evaluate(() => (globalThis.document.documentElement.dataset.theme = 'light'))
	assert.notEqual(await crepe.evaluate((element) => globalThis.getComputedStyle(element).color), dark)
	await page.evaluate(() => (globalThis.document.documentElement.dataset.theme = 'dark'))

	// Leaving the page releases Crepe.
	await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Fuentes' }).click()
	await page.waitForURL(/\/sources$/)
	await page.locator('.milkdown').waitFor({ state: 'detached' })

	// Narrow screens: the editor and the detail do not overflow sideways.
	await page.setViewportSize({ width: 390, height: 844 })
	for (const path of [`/sources/${ids.doctor}/edit?revision=${draft}`, `/sources/${ids.testing}`]) {
		await page.goto(origin + path, { waitUntil: 'networkidle' })
		if (path.includes('/edit')) await crepe.waitFor({ timeout: 60_000 })
		assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth), true, `${path} overflows at 390 px`)
	}

	// Without its own Origin, no action runs: absent, `null` (a sandboxed or opaque document) or
	// another site. Meeko checks the Origin before the session, so these are 403 even without one.
	const send = (rpc, body, headers = {}) => fetch(`${origin}/_meeko/rpc/${rpc}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
	for (const [rpc, body] of [
		['revisions/save', { sourceId: ids.doctor, markdown: '# x', author: 'evil' }],
		['revisions/publish', { id: draft }],
		['revisions/archive', { id: draft }],
		['revisions/merge', { id: draft, author: 'evil' }],
		['revisions/export', { id: draft }],
		['preview/render', { sourceId: ids.doctor, markdown: '# x' }],
		['snapshots/activate', { id: ids.first }],
		['jobs/start', { kind: 'health' }],
	]) {
		for (const headers of [{}, { origin: 'null' }, { origin: 'https://evil.example' }]) {
			const refused = await send(rpc, body, headers)
			assert.equal(refused.status, 403, `${rpc} with Origin ${headers.origin ?? '(none)'}`)
			assert.equal((await refused.json()).code, 'INVALID_ORIGIN')
		}
	}

	// The limit counts the Markdown as JSON: escapes included, a text the schema accepts fits in the
	// 1 MiB body of an RPC, and one that does not is refused by the schema or by the body limit.
	const same = await sessionHeaders(page, origin)
	const escaped = `# Límite\n${'"'.repeat(440_000)}\n`
	assert.ok(Buffer.byteLength(escaped) < 450_000 && Buffer.byteLength(JSON.stringify(escaped)) > 880_000, 'about half as UTF-8, twice as JSON')
	const fits = await send('revisions/save', { sourceId: ids.doctor, markdown: escaped, author: 'E2E', note: '\\'.repeat(500) }, same)
	assert.equal(fits.status, 200, await fits.clone().text())
	const fitted = await fits.json()
	assert.equal(fitted.markdown, escaped)
	const over = `# Límite\n${'\\'.repeat(460_000)}\n`
	assert.ok(Buffer.byteLength(JSON.stringify({ markdown: over })) < 1_048_576, 'below the body limit, above the schema')
	const refusedBySchema = await send('revisions/save', { sourceId: ids.doctor, markdown: over, author: 'E2E' }, same)
	assert.equal(refusedBySchema.status, 400, await refusedBySchema.clone().text())
	const schemaError = await refusedBySchema.json()
	assert.equal(schemaError.code, 'INVALID_INPUT')
	assert.match(schemaError.issues?.[0]?.message ?? '', /^validation.markdownTooLarge$/)
	const huge = `# Límite\n${'\n'.repeat(600_000)}`
	assert.ok(Buffer.byteLength(huge) < 900_000, 'within 900 kB as UTF-8')
	const refusedByBody = await send('revisions/save', { sourceId: ids.doctor, markdown: huge, author: 'E2E' }, same)
	assert.equal(refusedByBody.status, 413)
	assert.equal((await refusedByBody.json()).code, 'BODY_TOO_LARGE')
	await send('revisions/archive', { id: fitted.id }, same)
	// The editor counts the same bytes: such a text is too large before it is sent.
	await page.goto(`${origin}/sources/${ids.doctor}/edit?revision=${draft}`, { waitUntil: 'networkidle' })
	await hydrated()
	await crepe.waitFor({ timeout: 60_000 })
	await codeMode()
	// Typing 900 kB through fill() takes longer than the test allows: set it as one input.
	await editor.evaluate((element, value) => {
		element.value = value
		element.dispatchEvent(new Event('input', { bubbles: true }))
	}, over)
	await page.locator('.dash-editor-size[data-over]').waitFor()
	assert.equal(await page.getByRole('button', { name: /^(Crear|Guardar) borrador$/ }).isDisabled(), true)

	// Expected in the console: the refused publication of the reference page (422), the failed save
	// (409), and what the sandbox and the policy of the preview blocked in the hostile draft.
	const expected = [/status of 422/, /status of 409/, /Blocked script execution in 'about:srcdoc'/, /violates the following Content Security Policy directive: "frame-src 'none'"/]
	assert.deepEqual(
		errors.filter((message) => !expected.some((pattern) => pattern.test(message))),
		[],
	)
	assert.equal(errors.filter((message) => /status of 422/.test(message)).length, 1)
	assert.equal(errors.filter((message) => /status of 409/.test(message)).length, 1)
	assert.ok(
		errors.some((message) => /"frame-src 'none'"/.test(message)),
		'the policy inside the preview blocked the iframe of the hostile draft',
	)
})
