import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

import { startDevServer } from '../../../../scripts/test-support/dev-server.ts'

export async function startDemo(context) {
	const demo = fileURLToPath(new URL('../../../../apps/ui/', import.meta.url))
	const output = fileURLToPath(new URL('../../.meeko/', import.meta.url))
	const cli = fileURLToPath(new URL('../../../meeko/dist/cli.js', import.meta.url))
	const { origin, stop } = await startDevServer({ root: demo, cli, startupTimeout: 30_000 })
	context.after(stop)
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	await mkdir(output, { recursive: true })
	return { browser, origin, output }
}
