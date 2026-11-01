import assert from 'node:assert/strict'
import test from 'node:test'

import { startDemo } from './helpers/demo.mjs'

// Simulates the HMR of UIApp without editing any file: the real hot module is imported again under a new URL and handed
// to replaceHotModule, as the accept callback of Vite does. Nothing is written to the shared dist.
test('hot-replacing UIApp with a modal open keeps the modal and a single host', { timeout: 120_000 }, async (context) => {
	const { browser, origin } = await startDemo(context)
	const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
	const failures = []
	page.on('pageerror', (error) => failures.push(error.message))
	page.on('console', (message) => {
		if (message.type() === 'error') failures.push(message.text())
	})
	await page.goto(`${origin}/modals`, { waitUntil: 'networkidle' })
	await page.getByRole('button', { name: 'Abrir confirmación', exact: true }).click()
	await page.locator('dialog[open]').waitFor()
	assert.equal(await page.locator('dialog[open]').count(), 1)
	const appUrl = await page.evaluate(() => performance.getEntriesByType('resource').find((entry) => /components\/App\.meeko/.test(entry.name))?.name)
	assert.ok(appUrl, 'UIApp was loaded as a Meeko module')
	for (let round = 1; round <= 2; round++) {
		await page.evaluate(
			async ({ url, round }) => {
				const source = await (await fetch(url)).text()
				const hotId = JSON.parse(/__hotId\s*=\s*("[^"]*")/.exec(source)[1])
				const runtime = await import(/* @vite-ignore */ new URL(/from "([^"]*internal\.js)"/.exec(source)[1], url).href)
				const next = await import(/* @vite-ignore */ `${url}${url.includes('?') ? '&' : '?'}t=${Date.now() + round}`)
				try {
					runtime.replaceHotModule(hotId, next)
				} catch (error) {
					throw new Error([error.message, ...(error.errors ?? []).map((cause) => cause?.stack ?? String(cause))].join(' | '), { cause: error })
				}
				await new Promise((done) => setTimeout(done, 50))
			},
			{ url: appUrl, round },
		)
		assert.equal(await page.locator('dialog[open]').count(), 1, `the open modal survives hot replacement #${round}`)
	}
	await page.getByRole('button', { name: 'Confirmar', exact: true }).click()
	await page.locator('dialog[open]').waitFor({ state: 'detached' })
	// The page below UIApp is mounted again, so its own status text is a new signal: only the modal itself is asserted.
	// The replaced host must be the only one: a new modal opens once and closes cleanly.
	await page.getByRole('button', { name: 'Abrir confirmación', exact: true }).click()
	await page.locator('dialog[open]').waitFor()
	assert.equal(await page.locator('dialog[open]').count(), 1, 'a single host renders each modal')
	assert.deepEqual(failures, [], 'no page errors after hot-replacing UIApp')
})
