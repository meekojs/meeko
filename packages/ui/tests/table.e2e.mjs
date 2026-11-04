import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

const demo = fileURLToPath(new URL('../../../apps/ui/', import.meta.url))
const output = fileURLToPath(new URL('../.meeko/', import.meta.url))
async function port() {
	const server = createServer().listen(0, '127.0.0.1')
	await once(server, 'listening')
	const value = server.address().port
	await new Promise((done) => server.close(done))
	return value
}
async function until(check, message) {
	const started = Date.now()
	while (!(await check())) {
		if (Date.now() - started > 30_000) throw new Error(message())
		await new Promise((done) => setTimeout(done, 50))
	}
}

test('UITable keeps sections, reactive rows and accessible table semantics in native and grid layouts', { timeout: 90_000 }, async (context) => {
	const httpPort = await port(),
		hmrPort = await port()
	const cli = fileURLToPath(new URL('../../meeko/dist/cli.js', import.meta.url))
	const server = spawn(process.execPath, [cli, 'dev', demo], { cwd: demo, env: { ...process.env, PORT: String(httpPort), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
	let logs = ''
	server.stdout.on('data', (chunk) => {
		logs += chunk
	})
	server.stderr.on('data', (chunk) => {
		logs += chunk
	})
	context.after(() => server.kill())
	const origin = `http://127.0.0.1:${httpPort}`
	await until(
		async () => {
			if (server.exitCode !== null) throw new Error(logs)
			try {
				return (await fetch(`${origin}/tables`)).ok
			} catch {
				return false
			}
		},
		() => logs,
	)
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	const ssr = await browser.newPage({ javaScriptEnabled: false })
	await ssr.goto(`${origin}/tables`)
	assert.equal(await ssr.locator('table').first().locator('tbody tr').count(), 3)
	assert.equal(await ssr.locator('table').first().locator('thead th').count(), 3)
	assert.equal(await ssr.locator('table').first().locator('tfoot td').count(), 3)
	await ssr.close()
	const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
	const errors = []
	page.on('pageerror', (error) => errors.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') errors.push(message.text())
	})
	await page.goto(`${origin}/tables`, { waitUntil: 'networkidle' })
	const table = page.getByRole('table', { name: 'Proyectos del equipo', exact: true })
	assert.equal(await table.evaluate((element) => globalThis.getComputedStyle(element).display), 'table')
	const first = await table.locator('tbody tr').first().elementHandle()
	await page.getByRole('button', { name: 'Añadir proyecto' }).click()
	await until(
		async () => (await table.locator('tbody tr').count()) === 4,
		() => 'Inserted table row was lost',
	)
	assert.match(await table.locator('tfoot').innerText(), /4/)
	assert.equal(await first.evaluate((element) => element.isConnected), true, 'reactive updates retain the server rows')
	// cell-<clave> y header-<clave>: snippets por columna, con prioridad sobre cell y format.
	const byColumn = page.getByRole('table', { name: 'Estado por proyecto', exact: true })
	assert.equal(await byColumn.locator('thead th abbr').innerText(), 'Proyecto', 'header-name replaces the label of its column only')
	assert.equal(await byColumn.locator('thead th').nth(1).innerText(), 'Tipo')
	assert.equal(await byColumn.locator('tbody tr').first().locator('td').last().locator('.meeko-ui-badge, [data-tone]').first().innerText(), 'Publicado', 'cell-status wins over the column formatter')
	await until(
		async () => (await byColumn.locator('tbody tr').count()) === 4 && (await byColumn.locator('tbody tr').last().locator('td').last().innerText()).trim() === 'Borrador',
		() => 'Column snippet did not render the added row',
	)
	assert.equal(await byColumn.locator('tbody tr').first().locator('td').first().innerText(), 'Sitio principal', 'other columns keep the default text')
	const second = page.getByRole('table', { name: 'Tabla sin cabecera ni pie', exact: true })
	assert.equal(await second.locator('thead, tfoot').count(), 0)
	assert.equal(await second.locator('strong').innerText(), 'Entorno', 'cell snippet receives its typed row and column')
	assert.equal(await table.locator('tbody tr').first().locator('td').last().innerText(), 'PUBLICADO', 'column formatter controls presentation')
	const empty = page.getByRole('table', { name: 'Tabla vacía', exact: true })
	assert.equal(await empty.locator('tbody td').innerText(), 'No hay datos.')
	await page.getByLabel('Distribución', { exact: true }).selectOption('grid')
	assert.equal(await table.evaluate((element) => globalThis.getComputedStyle(element).display), 'grid')
	const xs = await table.evaluate((element) => [...element.querySelectorAll('thead tr > *, tbody tr:first-child > *, tfoot tr > *')].map((cell) => cell.getBoundingClientRect().x))
	for (let index = 0; index < 3; index++) {
		assert.ok(Math.abs(xs[index] - xs[index + 3]) < 1)
		assert.ok(Math.abs(xs[index] - xs[index + 6]) < 1)
	}
	const session = await page.context().newCDPSession(page)
	const { nodes } = await session.send('Accessibility.getFullAXTree')
	const accessibleTable = nodes.find((node) => node.role?.value === 'table' && node.name?.value === 'Proyectos del equipo')
	assert.ok(accessibleTable, 'CSS grid retains an accessible table')
	const byId = new Map(nodes.map((node) => [node.nodeId, node]))
	const roles = []
	const walk = (node) => {
		roles.push(node.role?.value)
		for (const id of node.childIds ?? []) walk(byId.get(id))
	}
	walk(accessibleTable)
	assert.equal(roles.filter((role) => role === 'columnheader').length, 3)
	assert.equal(roles.filter((role) => role === 'row').length, 6)
	assert.ok(roles.filter((role) => role === 'cell').length >= 12)
	await mkdir(output, { recursive: true })
	await page.screenshot({ path: `${output}/table-desktop.png`, fullPage: true })
	await page.setViewportSize({ width: 390, height: 844 })
	assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true, 'overflow stays inside the table')
	// A name is never cut at 390 px: a long type breaks at its spaces, and the table scrolls before that.
	const cutNames = await page.evaluate(() => [...globalThis.document.querySelectorAll('.meeko-ui-table code')].filter((code) => !/\s/.test(code.textContent.trim()) && code.getClientRects().length > 1).map((code) => code.textContent))
	assert.deepEqual(cutNames, [], 'code without spaces stays on one line')
	// The code shows the characters that were written, not the ligatures of the system mono.
	assert.equal(
		await page
			.locator('pre')
			.first()
			.evaluate((element) => globalThis.getComputedStyle(element).fontVariantLigatures),
		'none',
	)
	const region = page.getByRole('region', { name: 'Proyectos del equipo', exact: true })
	assert.equal(await region.evaluate((element) => element.scrollWidth > element.clientWidth), true)
	const emptyWidth = await empty.locator('tbody td').evaluate((element) => element.getBoundingClientRect().width)
	const gridWidth = await empty.evaluate((element) => element.getBoundingClientRect().width)
	assert.ok(Math.abs(emptyWidth - gridWidth) < 1, 'empty state spans all grid columns')
	await region.focus()
	await page.keyboard.press('ArrowRight')
	await until(
		() => region.evaluate((element) => element.scrollLeft > 0),
		() => 'Table cannot scroll with the keyboard',
	)
	await page.evaluate(() => {
		globalThis.document.documentElement.dataset.theme = 'dark'
	})
	await page.screenshot({ path: `${output}/table-mobile-dark.png`, fullPage: true })
	assert.deepEqual(errors, [])
})
