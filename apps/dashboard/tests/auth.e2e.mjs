// F5 in Chrome: a page without a session goes to the login, a wrong password shows the generic
// error, the right one comes back to the page, the app navigates with the session, and logging out
// ends it. Also without JavaScript, and at 390 px. Against a temporary schema with the migrations;
// the account exists only in the environment of the server. Skipped without DATABASE_URL.
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

import { adminEnv, startDashboard, testAdmin } from './fixtures/auth.mjs'

const app = fileURLToPath(new URL('../', import.meta.url))
if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const url = process.env.DATABASE_URL
// Outside the repository: a screenshot is evidence of the run, not a file of the project.
const screenshots = process.env.DASHBOARD_SCREENSHOTS ?? join(tmpdir(), 'meeko-dashboard-e2e')

test('the administrator logs in, navigates and logs out', { skip: url ? false : 'DATABASE_URL is not set', timeout: 240_000 }, async (context) => {
	const vite = await createServer({ root: app, configFile: false, logLevel: 'error', appType: 'custom', server: { middlewareMode: true, hmr: false, ws: false, watch: null }, optimizeDeps: { noDiscovery: true, include: [] } })
	const { createDatabase, migrate } = await vite.ssrLoadModule('meeko-docs-content/db')
	const schema = `dash_auth_e2e_${process.pid}_${randomBytes(4).toString('hex')}`
	const admin = createDatabase({ connectionString: url })
	const db = createDatabase({ connectionString: url, searchPath: schema })
	const cleanups = []
	context.after(async () => {
		for (const cleanup of cleanups.reverse()) await cleanup()
		try {
			await db.end()
			await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		} finally {
			await admin.end()
			await vite.close()
		}
	})
	await admin.query(`CREATE SCHEMA ${schema}`)
	await migrate(db)

	const account = await testAdmin()
	const server = await startDashboard({ ...adminEnv(account), DASHBOARD_DATABASE_SCHEMA: schema })
	cleanups.push(() => server.stop())
	const { origin } = server
	mkdirSync(screenshots, { recursive: true })

	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	cleanups.push(() => browser.close())
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		// The 401 of the wrong password is the expected answer of the login, not a failure of the page.
		if (message.type() === 'error' && !/status of 401/.test(message.text())) errors.push(message.text())
	})
	const hydrated = () => page.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0, undefined, { timeout: 60_000 })

	try {
		// A page without a session goes to the login, which remembers where to come back.
		await page.goto(`${origin}/sources?site=ui`, { waitUntil: 'networkidle' })
		await hydrated()
		assert.equal(new URL(page.url()).pathname, '/login')
		assert.equal(new URL(page.url()).searchParams.get('next'), '/sources?site=ui')
		assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Iniciar sesión')
		assert.equal(await page.getByRole('navigation', { name: 'Secciones' }).count(), 0, 'no sections before the login')
		assert.equal(await page.getByLabel('Contraseña').getAttribute('autocomplete'), 'current-password')
		await page.screenshot({ path: join(screenshots, 'login-desktop.png') })

		// Empty fields are checked in the browser; a wrong password gets the generic error.
		await page.getByRole('button', { name: 'Entrar' }).click()
		await page.getByText('Escribe tu usuario.').waitFor()
		await page.getByLabel('Usuario').fill(account.username)
		await page.getByLabel('Contraseña').fill('no-es-la-contraseña')
		await page.getByRole('button', { name: 'Entrar' }).click()
		const alert = page.getByRole('alert').filter({ hasText: 'El usuario o la contraseña no son correctos.' })
		await alert.waitFor()
		assert.equal(new URL(page.url()).pathname, '/login')
		await page.screenshot({ path: join(screenshots, 'login-error.png') })

		// The right password comes back to the page it asked for, with the account in the header.
		await page.getByLabel('Contraseña').fill(account.password)
		await Promise.all([page.waitForURL(`${origin}/sources?site=ui`), page.getByRole('button', { name: 'Entrar' }).click()])
		await hydrated()
		assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Fuentes')
		assert.equal((await page.getByTitle('Sesión iniciada').first().textContent())?.trim(), account.username)
		const cookie = (await page.context().cookies(origin)).find((item) => item.name === 'meeko-dashboard.sid')
		assert.ok(cookie?.httpOnly, 'the session cookie is HttpOnly')
		assert.equal(cookie.sameSite, 'Strict')
		assert.equal(await page.evaluate(() => globalThis.document.cookie.includes('meeko-dashboard.sid')), false, 'scripts cannot read it')

		// Navigation inside the app keeps the session: its data requests pass the server middleware.
		await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Métricas' }).click()
		await page.waitForURL(`${origin}/metrics`)
		await page.getByRole('heading', { level: 1, name: 'Métricas' }).waitFor()
		await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Resumen' }).click()
		await page.waitForURL(`${origin}/`)
		await page.getByRole('heading', { level: 1, name: 'Resumen' }).waitFor()
		// Logged in, the login page goes on to where it would have gone.
		await page.goto(`${origin}/login?next=%2Fhealth`, { waitUntil: 'networkidle' })
		assert.equal(new URL(page.url()).pathname, '/health')

		// Logging out is a POST with the CSRF token; afterwards every page asks for the login again.
		await Promise.all([page.waitForURL(/\/login$/), page.getByRole('button', { name: 'Cerrar sesión' }).click()])
		assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Iniciar sesión')
		assert.equal(
			(await page.context().cookies(origin)).some((item) => item.name === 'meeko-dashboard.sid'),
			false,
		)
		await page.goto(`${origin}/snapshots`, { waitUntil: 'networkidle' })
		assert.equal(new URL(page.url()).pathname, '/login')
		assert.equal((await db.query('SELECT count(*)::int AS n FROM dashboard_sessions')).rows[0].n, 0, 'no session is left in PostgreSQL')

		// 390 px: the login fits without sideways scroll.
		await page.setViewportSize({ width: 390, height: 844 })
		await page.goto(`${origin}/login`, { waitUntil: 'networkidle' })
		assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.document.documentElement.clientWidth), true)
		await page.screenshot({ path: join(screenshots, 'login-mobile.png') })
		assert.deepEqual(errors, [])

		// The credentials typed or autofilled before the JavaScript arrives are the ones the form sends.
		const slow = await browser.newPage({ viewport: { width: 1280, height: 900 } })
		let release
		const held = new Promise((resolve) => {
			release = resolve
		})
		await slow.route('**/entry-client.ts*', async (route) => {
			await held
			await route.continue()
		})
		await slow.goto(`${origin}/login?next=%2Fhealth`, { waitUntil: 'commit' })
		await slow.getByLabel('Usuario').fill(account.username)
		await slow.getByLabel('Contraseña').fill(account.password)
		release()
		await slow.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0, undefined, { timeout: 60_000 })
		assert.equal(await slow.getByLabel('Usuario').inputValue(), account.username)
		// With an empty model the schema of the form would stop this submission with "Escribe tu usuario."
		await Promise.all([slow.waitForURL(`${origin}/health`), slow.getByRole('button', { name: 'Entrar' }).click()])
		await slow.getByRole('heading', { level: 1 }).waitFor()
		await Promise.all([slow.waitForURL(/\/login$/), slow.getByRole('button', { name: 'Cerrar sesión' }).click()])
		await slow.close()

		// Without JavaScript the native forms do the same: log in, come back, log out.
		const plain = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } })
		await plain.goto(`${origin}/moderation`)
		assert.equal(new URL(plain.url()).pathname, '/login')
		await plain.getByLabel('Usuario').fill(account.username)
		await plain.getByLabel('Contraseña').fill('mal')
		await Promise.all([plain.waitForURL(/\/login\?next=%2Fmoderation$/), plain.getByRole('button', { name: 'Entrar' }).click()])
		await plain.getByRole('alert').filter({ hasText: 'El usuario o la contraseña no son correctos.' }).waitFor()
		assert.equal(await plain.getByLabel('Usuario').inputValue(), account.username, 'the user name comes back; the password never does')
		assert.equal(await plain.getByLabel('Contraseña').inputValue(), '')
		await plain.getByLabel('Contraseña').fill(account.password)
		await Promise.all([plain.waitForURL(`${origin}/moderation`), plain.getByRole('button', { name: 'Entrar' }).click()])
		assert.equal(await plain.getByRole('heading', { level: 1 }).textContent(), 'Moderación')
		await Promise.all([plain.waitForURL(/\/login$/), plain.getByRole('button', { name: 'Cerrar sesión' }).click()])
		await plain.close()
	} catch (error) {
		throw new Error(`${error instanceof Error ? error.stack : error}\n\nServer:\n${server.logs().slice(-6000)}`, { cause: error })
	}
})
