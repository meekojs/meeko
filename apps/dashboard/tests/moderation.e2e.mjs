// The moderation screen in Chrome against a temporary schema: the test migrates it, imports two
// pages of UI and starts `meeko dev` with DASHBOARD_DATABASE_SCHEMA. Rules and announcements are
// written in that schema only, and checked there; the real tables are never read or written.
// Skipped without DATABASE_URL.
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

import { adminEnv, login, testAdmin } from './fixtures/auth.mjs'

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

test('the moderation screen hides, features and announces, and asks first', { skip: url ? false : 'DATABASE_URL is not set', timeout: 240_000 }, async (context) => {
	const vite = await createServer({ root: app, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
	const { createDatabase, importSources, migrate } = await vite.ssrLoadModule('meeko-docs-content/db')
	const schema = `dash_mod_e2e_${process.pid}_${randomBytes(4).toString('hex')}`
	const admin = createDatabase({ connectionString: url })
	const cleanups = []
	context.after(async () => {
		for (const cleanup of cleanups.reverse()) await cleanup()
		try {
			await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		} finally {
			await admin.end()
			await vite.close()
		}
	})
	await admin.query(`CREATE SCHEMA ${schema}`)
	const db = createDatabase({ connectionString: url, searchPath: schema })
	cleanups.push(() => db.end())
	await migrate(db)
	await importSources(
		db,
		[
			{ site: 'ui', path: '/', kind: 'page', title: 'Introducción', file: null, markdown: null },
			{ site: 'ui', path: '/buttons', kind: 'page', title: 'Button', file: null, markdown: null },
			{ site: 'ui', path: '/modals', kind: 'page', title: 'Modal', file: null, markdown: null },
		],
		['ui'],
	)

	const httpPort = await port()
	const hmrPort = await port()
	const account = await testAdmin('Moderadora')
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
		if (server.exitCode !== null || Date.now() - started > 90_000) throw new Error(logs)
		try {
			if ((await fetch(origin)).ok) break
		} catch {
			/* Server is starting. */
		}
		await new Promise((done) => setTimeout(done, 100))
	}

	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	cleanups.push(() => browser.close())
	const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
	await login(page, origin, account)
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	const rows = (table) => page.locator(`table:has(caption:text("${table}")) tbody tr`)
	const notice = page.locator('.dash-notice')

	try {
		await page.goto(origin + '/moderation?site=ui', { waitUntil: 'networkidle' })
		assert.equal(await page.getByRole('link', { name: /^UI/ }).getAttribute('aria-current'), 'page')
		assert.equal(await page.getByRole('link', { name: /Moderación/ }).getAttribute('aria-current'), 'page', 'the section of the header')
		assert.equal(await page.locator('#moderation-author').count(), 0, 'the author is the user of the session (F5), not a field')

		// Validation: a rule needs a page.
		await page.getByRole('button', { name: 'Ocultar la página…' }).click()
		await page.getByRole('alert').filter({ hasText: 'Elige una página.' }).waitFor()

		// Hide: it asks first, and the table and the database have the rule.
		const picker = page.getByRole('combobox', { name: 'Página' })
		await picker.click()
		await picker.fill('Butt')
		await page.getByRole('option', { name: 'Button · /buttons' }).click()
		await page.locator('#rule-reason').fill('Se está rehaciendo')
		await page.getByRole('button', { name: 'Ocultar la página…' }).click()
		const dialog = page.getByRole('dialog', { name: '¿Ocultar Button?' })
		await dialog.waitFor()
		assert.match(await dialog.innerText(), /\/buttons responderá 404 en UI/)
		await dialog.getByRole('button', { name: 'Ocultar la página' }).click()
		await dialog.waitFor({ state: 'detached' })
		await notice.filter({ hasText: 'Oculta: Button' }).waitFor()
		assert.equal(await rows('Reglas de UI').count(), 1)
		assert.match(await rows('Reglas de UI').first().innerText(), /Button[\s\S]*\/buttons[\s\S]*Oculta[\s\S]*Se está rehaciendo[\s\S]*Moderadora/)

		// Feature: saved at once, without a question.
		await picker.click()
		await picker.fill('Modal')
		await page.getByRole('option', { name: 'Modal · /modals' }).click()
		await page.getByText('Destacar', { exact: true }).click()
		await page.getByRole('button', { name: 'Destacar la página' }).click()
		await notice.filter({ hasText: 'Destacada: Modal' }).waitFor()
		assert.equal(await rows('Reglas de UI').count(), 2)
		const stored = await db.query('SELECT site, path, action, reason, author FROM docs_moderation ORDER BY path')
		assert.deepEqual(stored.rows, [
			{ site: 'ui', path: '/buttons', action: 'hide', reason: 'Se está rehaciendo', author: 'Moderadora' },
			{ site: 'ui', path: '/modals', action: 'feature', reason: null, author: 'Moderadora' },
		])
		assert.match(await page.getByRole('link', { name: /^UI/ }).innerText(), /2 reglas/)

		// Announcements: validation, the real banner as preview, create, switch off and delete.
		await page.getByRole('button', { name: 'Crear aviso' }).click()
		await page.getByRole('alert').filter({ hasText: 'Escribe el mensaje.' }).waitFor()
		await page.locator('#announcement-message').fill('La búsqueda falla de forma intermitente.')
		await page.getByRole('combobox', { name: 'Tono' }).click()
		await page.getByRole('option', { name: 'Incidencia' }).click()
		const preview = page.locator('.dash-announcement-preview .docs-announcement')
		await preview.filter({ hasText: 'La búsqueda falla de forma intermitente.' }).waitFor()
		assert.equal(await preview.getAttribute('role'), 'alert', 'a danger announcement interrupts')
		assert.equal(await preview.getAttribute('data-tone'), 'danger')
		await page.locator('#announcement-end').fill('2030-01-01T10:00')
		await page.locator('#announcement-start').fill('2030-01-02T10:00')
		await page.getByRole('button', { name: 'Crear aviso' }).click()
		await page.getByRole('alert').filter({ hasText: 'El fin debe ser posterior al inicio.' }).waitFor()
		await page.locator('#announcement-start').fill('')
		await page.locator('#announcement-end').fill('')
		await page.getByRole('button', { name: 'Crear aviso' }).click()
		await notice.filter({ hasText: /Aviso #\d+ creado: en vigor/ }).waitFor()
		const announcements = rows('Avisos de UI')
		assert.match(await announcements.first().innerText(), /La búsqueda falla[\s\S]*Incidencia[\s\S]*Sin fechas[\s\S]*En vigor/)

		// Another tab fixes the message meanwhile: switching it off from this old row is refused, the
		// table reloads with the fix, and nothing of this tab overwrote it.
		await db.query("UPDATE docs_announcements SET message = 'La búsqueda vuelve a funcionar.', tone = 'success', author = 'Otra pestaña', version = version + 1")
		await announcements
			.first()
			.getByRole('button', { name: /^Desactivar/ })
			.click()
		await page.getByRole('alert').filter({ hasText: 'Otra persona cambió esta regla o este aviso' }).waitFor()
		await announcements.first().filter({ hasText: 'La búsqueda vuelve a funcionar.' }).waitFor()
		assert.deepEqual((await db.query('SELECT message, active FROM docs_announcements')).rows, [{ message: 'La búsqueda vuelve a funcionar.', active: true }])
		// From the reloaded row it works, and switching changes only `active`.
		await announcements
			.first()
			.getByRole('button', { name: /^Desactivar/ })
			.click()
		await notice.filter({ hasText: /desactivado/ }).waitFor()
		assert.match(await announcements.first().innerText(), /Inactivo/)
		assert.deepEqual((await db.query('SELECT message, tone, active, author, version FROM docs_announcements')).rows, [{ message: 'La búsqueda vuelve a funcionar.', tone: 'success', active: false, author: 'Otra pestaña', version: 3 }])

		// Editing from a version that another tab changed: refused, the form keeps the text, and the
		// next save is over the current version.
		await announcements
			.first()
			.getByRole('button', { name: /^Editar/ })
			.click()
		await page.locator('#announcement-message').fill('Texto de esta pestaña.')
		await db.query('UPDATE docs_announcements SET active = true, version = version + 1')
		await page.getByRole('button', { name: 'Guardar cambios' }).click()
		await page.getByRole('alert').filter({ hasText: 'Otra persona cambió esta regla o este aviso' }).waitFor()
		assert.equal(await page.locator('#announcement-message').inputValue(), 'Texto de esta pestaña.')
		assert.equal((await db.query('SELECT message FROM docs_announcements')).rows[0].message, 'La búsqueda vuelve a funcionar.')
		await page.getByRole('button', { name: 'Guardar cambios' }).click()
		await notice.filter({ hasText: /Aviso #\d+ guardado/ }).waitFor()
		assert.deepEqual((await db.query('SELECT message, version FROM docs_announcements')).rows, [{ message: 'Texto de esta pestaña.', version: 5 }])

		// The rule form keeps the rule it began to edit. Another tab changes it, and an action of this
		// tab on an announcement reloads the list with that change: saving is still a conflict, not
		// an overwrite of the other change with the old form.
		const modals = rows('Reglas de UI').filter({ hasText: '/modals' })
		await modals.getByRole('button', { name: /^Cambiar/ }).click()
		await page.locator('#rule-reason').fill('Motivo de esta pestaña')
		await db.query("UPDATE docs_moderation SET reason = 'De la otra pestaña', author = 'Otra pestaña', version = version + 1 WHERE path = '/modals'")
		await announcements
			.first()
			.getByRole('button', { name: /^(Activar|Desactivar)/ })
			.click()
		await notice.filter({ hasText: /Aviso #\d+ (activado|desactivado)/ }).waitFor()
		await modals.filter({ hasText: 'De la otra pestaña' }).waitFor()
		await page.getByRole('button', { name: 'Cambiar la regla', exact: true }).click()
		const ruleConflict = page.getByRole('alert').filter({ hasText: 'Otra persona cambió esta regla o este aviso' })
		await ruleConflict.waitFor()
		assert.deepEqual((await db.query("SELECT reason, author, version FROM docs_moderation WHERE path = '/modals'")).rows, [{ reason: 'De la otra pestaña', author: 'Otra pestaña', version: 2 }])
		assert.equal(await page.locator('#rule-reason').inputValue(), 'Motivo de esta pestaña', 'the form keeps what this tab wrote')
		// The other tab deletes the rule and creates it again, changed once: the same version 2 with
		// another id. The form, pinned to the first rule at version 2, is refused again.
		await db.query("DELETE FROM docs_moderation WHERE path = '/modals'")
		const replaced = await db.query("INSERT INTO docs_moderation (site, path, action, reason, author, version) VALUES ('ui', '/modals', 'feature', 'Recreada en otra pestaña', 'Otra pestaña', 2) RETURNING id")
		await page.getByRole('button', { name: 'Cambiar la regla', exact: true }).click()
		await modals.filter({ hasText: 'Recreada en otra pestaña' }).waitFor()
		await ruleConflict.waitFor()
		assert.deepEqual((await db.query("SELECT reason, version FROM docs_moderation WHERE path = '/modals'")).rows, [{ reason: 'Recreada en otra pestaña', version: 2 }])
		// After seeing the conflict, saving again replaces the current rule on purpose.
		await page.getByRole('button', { name: 'Cambiar la regla', exact: true }).click()
		await notice.filter({ hasText: 'Destacada: Modal' }).waitFor()
		assert.deepEqual((await db.query("SELECT id, reason, version FROM docs_moderation WHERE path = '/modals'")).rows, [{ id: replaced.rows[0].id, reason: 'Motivo de esta pestaña', version: 3 }])

		// Small screens: the screen stacks without a horizontal scroll.
		await page.setViewportSize({ width: 390, height: 844 })
		assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth), 'no horizontal scroll at 390 px')
		await page.screenshot({ path: join(app, '.meeko', 'screenshots', 'moderation-mobile.png'), fullPage: true })
		await page.setViewportSize({ width: 1440, height: 1000 })

		await announcements
			.first()
			.getByRole('button', { name: /^Borrar/ })
			.click()
		const remove = page.getByRole('dialog', { name: /¿Borrar el aviso #\d+\?/ })
		await remove.getByRole('button', { name: 'Borrar el aviso' }).click()
		await remove.waitFor({ state: 'detached' })
		await page.waitForFunction(() => globalThis.document.activeElement?.id === 'announcements-heading')
		assert.equal((await db.query('SELECT count(*)::int AS n FROM docs_announcements')).rows[0].n, 0)

		// A rule that another tab changed is not removed from the old row: the dialog closes over the
		// reloaded table with the conflict, and the next attempt removes the current version.
		await db.query("UPDATE docs_moderation SET reason = 'Cambiado en otra pestaña', version = version + 1 WHERE path = '/buttons'")
		await rows('Reglas de UI')
			.first()
			.getByRole('button', { name: /^Quitar/ })
			.click()
		const stale = page.getByRole('dialog', { name: '¿Quitar la regla de Button?' })
		await stale.getByRole('button', { name: 'Quitar la regla' }).click()
		await stale.waitFor({ state: 'detached' })
		await page.getByRole('alert').filter({ hasText: 'Otra persona cambió esta regla o este aviso' }).waitFor()
		await rows('Reglas de UI').first().filter({ hasText: 'Cambiado en otra pestaña' }).waitFor()
		assert.equal((await db.query('SELECT count(*)::int AS n FROM docs_moderation')).rows[0].n, 2)
		await rows('Reglas de UI')
			.first()
			.getByRole('button', { name: /^Quitar/ })
			.click()
		const unhide = page.getByRole('dialog', { name: '¿Quitar la regla de Button?' })
		await unhide.getByRole('button', { name: 'Quitar la regla' }).click()
		await unhide.waitFor({ state: 'detached' })
		await page.waitForFunction(() => globalThis.document.activeElement?.id === 'rules-heading')
		assert.deepEqual(
			(await db.query('SELECT path FROM docs_moderation')).rows.map((row) => row.path),
			['/modals'],
		)
		await page.screenshot({ path: join(app, '.meeko', 'screenshots', 'moderation-desktop.png'), fullPage: true })

		// Without its own Origin, no change runs.
		const send = (rpc, body, headers = {}) => fetch(`${origin}/_meeko/rpc/${rpc}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) })
		for (const [rpc, body] of [
			['moderation/rules/save', { site: 'ui', path: '/buttons', action: 'hide', author: 'evil', id: null, version: null }],
			['moderation/rules/delete', { id: 1, version: 1 }],
			['moderation/announcements/save', { site: 'ui', message: 'x', tone: 'info', startsAt: null, endsAt: null, active: true, author: 'evil' }],
			['moderation/announcements/active', { id: 1, version: 1, active: true }],
			['moderation/announcements/delete', { id: 1, version: 1 }],
		]) {
			for (const headers of [{}, { origin: 'null' }, { origin: 'https://evil.example' }]) {
				const refused = await send(rpc, body, headers)
				assert.equal(refused.status, 403, `${rpc} with Origin ${headers.origin ?? '(none)'}`)
			}
		}
		assert.equal((await db.query("SELECT count(*)::int AS n FROM docs_moderation WHERE author = 'evil'")).rows[0].n, 0)
		assert.deepEqual(errors, [])
	} catch (error) {
		throw new Error(`${error instanceof Error ? error.stack : error}\n\nServer:\n${logs.slice(-6000)}`, { cause: error })
	}
})
