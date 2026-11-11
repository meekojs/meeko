import type { AddressInfo } from 'node:net'

import { build } from 'esbuild'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { chromium } from 'playwright-core'

import { createId } from '../src/core/create-id.ts'

test('Chrome: createId generates UUIDs in ordinary functions with native and fallback Web Crypto', { timeout: 60_000 }, async () => {
	const bundle = await build({ entryPoints: ['src/core/create-id.ts'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'MeekoIds' })
	const server = createServer((_request, response) => {
		response.writeHead(200, { 'Content-Type': 'text/html' })
		response.end('<!doctype html><title>IDs</title>')
	})
	await new Promise<void>((ready) => server.listen(0, '127.0.0.1', ready))
	try {
		const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' as const }), headless: true })
		try {
			const page = await browser.newPage()
			await page.goto(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)
			await page.addScriptTag({ content: bundle.outputFiles[0]!.text })
			const browserIds = await page.evaluate(() => {
				const ids = (globalThis as typeof globalThis & { MeekoIds: { createId(): string } }).MeekoIds
				if (typeof crypto.randomUUID !== 'function') throw new Error('Native randomUUID unavailable')
				const native = Array.from({ length: 1_000 }, () => ({ id: ids.createId() }).id)
				Object.defineProperty(crypto, 'randomUUID', { configurable: true, value: undefined })
				const fallback = Array.from({ length: 1_000 }, () => ({ id: ids.createId() }).id)
				return [...native, ...fallback]
			})
			const allIds = [...browserIds, ...Array.from({ length: 1_000 }, () => createId())]
			assert.equal(new Set(allIds).size, 3_000)
			for (const id of allIds) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
		} finally {
			await browser.close()
		}
	} finally {
		await new Promise<void>((done) => server.close(() => done()))
	}
})
