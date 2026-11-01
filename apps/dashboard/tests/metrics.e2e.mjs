// The metrics screen in Chrome against a temporary schema: the test migrates it, writes views,
// searches and answers of the last days there and starts `meeko dev` with DASHBOARD_DATABASE_SCHEMA.
// Comments are reviewed and deleted in that schema only, and checked there; the real tables are
// never read or written. Skipped without DATABASE_URL.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { existsSync, mkdirSync } from 'node:fs'
import { createServer as createNetServer } from 'node:net'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

import { adminEnv, login, sessionHeaders, testAdmin } from './fixtures/auth.mjs'

const app = fileURLToPath(new URL('../', import.meta.url))
const cli = fileURLToPath(new URL('../../../packages/meeko/dist/cli.js', import.meta.url))
const screenshots = join(app, '.meeko', 'screenshots')
if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const url = process.env.DATABASE_URL

async function port() {
	const server = createNetServer().listen(0, '127.0.0.1')
	await once(server, 'listening')
	const value = server.address().port
	await new Promise((done) => server.close(done))
	return value
}

/** A UTC day `offset` days before today, as `YYYY-MM-DD`. */
const day = (offset) => new Date(Date.now() - offset * 86_400_000).toISOString().slice(0, 10)

test('the metrics screen charts the views, ranks pages and searches, and reviews the comments', { skip: url ? false : 'DATABASE_URL is not set', timeout: 240_000 }, async (context) => {
	const vite = await createServer({ root: app, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
	const { createDatabase, migrate } = await vite.ssrLoadModule('meeko-docs-content/db')
	const schema = `dash_met_e2e_${process.pid}_${randomBytes(4).toString('hex')}`
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
	await db.query(
		`INSERT INTO docs_page_views (site, path, day, views) VALUES
		('site', '/docs/signal', $1, 12), ('site', '/docs/signal', $2, 30), ('site', '/docs/api', $2, 8), ('site', '/docs/api', $3, 3), ('ui', '/buttons', $1, 5)`,
		[day(0), day(2), day(9)],
	)
	await db.query(
		`INSERT INTO docs_searches (site, query, results, created_at) VALUES
		('site', 'signal', 4, now() - interval '1 day'), ('site', 'signal', 5, now()), ('site', 'nada parecido', 0, now()), ('site', 'nada parecido', 0, now() - interval '2 days'), ('site', 'otra cosa', 0, now())`,
	)
	const comments = (
		await db.query(
			`INSERT INTO docs_feedback (site, path, helpful, comment, created_at) VALUES
			('site', '/docs/signal', true, NULL, now() - interval '3 days'),
			('site', '/docs/signal', false, 'Falta un ejemplo con effect.', now() - interval '2 days'),
			('site', '/docs/signal', false, NULL, now() - interval '1 day'),
			('site', '/docs/api', true, 'Muy clara, gracias.', now())
			RETURNING id, comment`,
		)
	).rows.filter((row) => row.comment)

	const httpPort = await port()
	const hmrPort = await port()
	const account = await testAdmin()
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
			if ((await fetch(origin + '/metrics')).ok) break
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
	mkdirSync(screenshots, { recursive: true })

	try {
		// The mutations of the comments need the dashboard's Origin.
		for (const headers of [{}, { origin: 'null' }, { origin: 'https://otro.example' }]) {
			const response = await fetch(`${origin}/_meeko/rpc/metrics/feedback/delete`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ id: comments[0].id }) })
			assert.equal(response.status, 403, JSON.stringify(headers))
		}

		await page.goto(origin + '/metrics', { waitUntil: 'networkidle' })
		assert.equal(await page.getByRole('link', { name: 'Métricas' }).getAttribute('aria-current'), 'page', 'the section of the header')
		assert.equal((await page.locator('.metrics-presets a[aria-current="true"]').textContent()).trim(), '30 días')

		// Totals, the chart (30 days, one column each) and its table.
		const totals = page.getByRole('region', { name: 'Totales del rango' })
		assert.match(await totals.textContent(), /53/)
		assert.match(await totals.textContent(), /3 sin resultados/)
		assert.match(await totals.textContent(), /50\s%\ssí/)
		const plot = page.getByRole('img', { name: /Vistas por día de Framework/ })
		assert.match(await plot.getAttribute('aria-label'), /Máximo: 38/)
		assert.equal(await page.locator('.views-chart .column').count(), 30)
		await plot.hover({ position: { x: 5, y: 100 } })
		await page.locator('.views-chart .tooltip').waitFor()
		await plot.focus()
		await page.keyboard.press('End')
		assert.match(await page.locator('.views-chart .tooltip').textContent(), /^\s*12\s+vistas/)
		await page.keyboard.press('ArrowLeft')
		await page.keyboard.press('ArrowLeft')
		assert.match(await page.locator('.views-chart .tooltip').textContent(), /^\s*38\s+vistas/)
		await page.getByText('Ver los valores como tabla').click()
		assert.equal(await page.locator('.views-chart table tbody tr').count(), 30)

		// Rankings.
		const pages = page.getByRole('region', { name: 'Páginas más vistas' })
		assert.deepEqual(await pages.locator('li code').allTextContents(), ['/docs/signal', '/docs/api'])
		const empty = page.getByRole('region', { name: 'Búsquedas sin resultados' })
		assert.deepEqual(await empty.locator('.metrics-query').allTextContents(), ['nada parecido', 'otra cosa'])
		const searches = page.getByRole('region', { name: 'Búsquedas más frecuentes' })
		assert.match(await searches.locator('tbody tr').first().textContent(), /nada parecido\s*2\s*Ninguno/)
		const helpful = page.getByRole('region', { name: '¿Te sirvió? por página' })
		assert.match(await helpful.locator('tbody tr').first().textContent(), /\/docs\/signal\s*33\s*%\s*1 sí · 2 no\s*1/)
		await page.screenshot({ path: join(screenshots, 'metrics-desktop.png'), fullPage: true })

		// Comments: pending by default, filtered by answer and by page.
		const list = page.locator('.metrics-comment-items > li')
		assert.equal(await list.count(), 2)
		await page.getByText('Respondió no').click()
		await page.waitForFunction(() => globalThis.document.querySelectorAll('.metrics-comment-items > li').length === 1)
		assert.match(await list.first().textContent(), /Falta un ejemplo con effect\./)
		await page.getByText('Sí y no').click()
		await page.locator('#comment-path').fill('api')
		await page.waitForFunction(() => globalThis.document.querySelector('.metrics-comment-items')?.textContent?.includes('Muy clara') && globalThis.document.querySelectorAll('.metrics-comment-items > li').length === 1)
		await page.locator('#comment-path').fill('')
		await page.waitForFunction(() => globalThis.document.querySelectorAll('.metrics-comment-items > li').length === 2)

		// Mark as reviewed: it leaves the pending ones and is reviewed in the database.
		const target = list.filter({ hasText: 'Falta un ejemplo' })
		await target.getByRole('button', { name: /Marcar como revisado/ }).click()
		await page.locator('.dash-notice').filter({ hasText: 'marcado como revisado' }).waitFor()
		await page.waitForFunction(() => globalThis.document.querySelectorAll('.metrics-comment-items > li').length === 1)
		assert.notEqual((await db.query('SELECT reviewed_at FROM docs_feedback WHERE id = $1', [comments[0].id])).rows[0].reviewed_at, null)
		await page.getByText('Revisados').click()
		await page.waitForFunction(() => globalThis.document.querySelector('.metrics-comment-items')?.textContent?.includes('Falta un ejemplo'))

		// Delete asks first: cancel keeps it, confirm deletes it and the focus goes to the heading.
		await list
			.first()
			.getByRole('button', { name: /^Borrar/ })
			.click()
		const dialog = page.getByRole('dialog', { name: '¿Borrar este comentario?' })
		await dialog.waitFor()
		assert.match(await dialog.textContent(), /Falta un ejemplo con effect\./)
		await dialog.getByRole('button', { name: 'Cancelar' }).click()
		await dialog.waitFor({ state: 'hidden' })
		assert.equal((await db.query('SELECT count(*)::int AS count FROM docs_feedback WHERE id = $1', [comments[0].id])).rows[0].count, 1)
		await list
			.first()
			.getByRole('button', { name: /^Borrar/ })
			.click()
		await dialog.getByRole('button', { name: 'Borrar el comentario' }).click()
		await dialog.waitFor({ state: 'hidden' })
		await page.locator('.dash-notice').filter({ hasText: 'borrado' }).waitFor()
		await page.getByText('Aún no has revisado ningún comentario de este rango.').waitFor()
		await page.waitForFunction(() => globalThis.document.activeElement?.id === 'comments-heading')
		assert.equal((await db.query('SELECT count(*)::int AS count FROM docs_feedback WHERE id = $1', [comments[0].id])).rows[0].count, 0)

		// Another web without data: every empty state.
		await page.getByRole('link', { name: 'UI', exact: true }).click()
		await page.waitForURL(/site=ui/)
		await page.getByText('Ninguna respuesta en este rango.').waitFor()
		assert.equal(await page.locator('.views-chart .column').count(), 30, 'UI has 5 views today')
		assert.equal(await page.getByText('Nadie buscó en este rango.').count(), 1)
		assert.equal(await page.getByText('No hay comentarios pendientes en este rango: todos están revisados.').count(), 1)

		// The 7-day preset leaves the views of 9 days ago out; a reversed range is an error state.
		await page.goto(origin + '/metrics', { waitUntil: 'networkidle' })
		await page.getByRole('link', { name: '7 días' }).click()
		await page.waitForURL(/from=/)
		await page.locator('.metrics-presets a[aria-current="true"]').filter({ hasText: '7 días' }).waitFor()
		assert.match(await page.getByRole('region', { name: 'Totales del rango' }).textContent(), /50/)
		await page.goto(`${origin}/metrics?from=${day(1)}&to=${day(5)}`, { waitUntil: 'networkidle' })
		await page.getByRole('alert').filter({ hasText: 'No se pudieron cargar las métricas' }).waitFor()

		// Days that are not in the calendar: the whole SSR answers with the error of the range (no
		// RangeError of the label), and so does the page in the browser.
		const broken = `${origin}/metrics?from=2026-99-99&to=2026-99-99`
		const rendered = await fetch(broken, { headers: { cookie: (await sessionHeaders(page, origin)).cookie } })
		assert.equal(rendered.status, 200)
		const html = await rendered.text()
		assert.match(html, /El rango de fechas no es válido/)
		assert.doesNotMatch(html, /Invalid time value/)
		await page.goto(broken, { waitUntil: 'networkidle' })
		await page.getByRole('alert').filter({ hasText: 'El rango de fechas no es válido' }).first().waitFor()
		assert.match(await page.locator('#comments-heading').locator('xpath=..').textContent(), /Rango no válido/)

		// Reviewing, or reopening, the only comment of the last page shows the page that is left
		// instead of an empty one without a pager.
		await db.query(
			`INSERT INTO docs_feedback (site, path, helpful, comment, created_at)
			SELECT 'ui', '/buttons', false, 'Comentario ' || n, now() - n * interval '1 minute' FROM generate_series(1, 26) AS n`,
		)
		const pager = page.locator('.metrics-pager')
		const lastOf = async (filter) => {
			await pager.filter({ hasText: 'Página 1 de 2' }).waitFor()
			await pager.getByRole('button', { name: 'Más antiguos' }).click()
			await pager.filter({ hasText: 'Página 2 de 2' }).waitFor()
			// The pager says page 2 at once; the list arrives after its request.
			await page.waitForFunction(() => globalThis.document.querySelectorAll('.metrics-comment-items > li').length === 1, undefined, { timeout: 15_000 }).catch(async () => assert.equal(await list.count(), 1, filter))
		}
		await page.goto(`${origin}/metrics?site=ui`, { waitUntil: 'networkidle' })
		await lastOf('pending')
		await list
			.first()
			.getByRole('button', { name: /Marcar como revisado/ })
			.click()
		await page.locator('.dash-notice').filter({ hasText: 'marcado como revisado' }).waitFor()
		await page.waitForFunction(() => globalThis.document.querySelectorAll('.metrics-comment-items > li').length === 25)
		assert.equal(await pager.count(), 0, 'the 25 pending comments fit in one page')
		await db.query("UPDATE docs_feedback SET reviewed_at = now() WHERE site = 'ui'")
		await page.getByText('Revisados').click()
		await lastOf('reviewed')
		await list
			.first()
			.getByRole('button', { name: /Volver a pendiente/ })
			.click()
		await page.locator('.dash-notice').filter({ hasText: 'de nuevo pendiente' }).waitFor()
		await page.waitForFunction(() => globalThis.document.querySelectorAll('.metrics-comment-items > li').length === 25)
		assert.equal(await pager.count(), 0, 'the 25 reviewed comments fit in one page')

		// Small screens: no horizontal scroll.
		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto(origin + '/metrics', { waitUntil: 'networkidle' })
		assert.ok(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), 'no horizontal scroll at 390 px')
		await page.screenshot({ path: join(screenshots, 'metrics-mobile.png'), fullPage: true })
		assert.deepEqual(errors, [])
	} catch (error) {
		throw new Error(`${error instanceof Error ? error.stack : String(error)}\n\nServer log:\n${logs}`, { cause: error })
	}
})
