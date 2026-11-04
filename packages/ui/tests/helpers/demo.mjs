import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

async function port() {
	const server = createServer().listen(0, '127.0.0.1')
	await once(server, 'listening')
	const value = server.address().port
	await new Promise((done) => server.close(done))
	return value
}

export async function startDemo(context) {
	const demo = fileURLToPath(new URL('../../../../apps/ui/', import.meta.url))
	const output = fileURLToPath(new URL('../../.meeko/', import.meta.url))
	const cli = fileURLToPath(new URL('../../../meeko/dist/cli.js', import.meta.url))
	const httpPort = await port(),
		hmrPort = await port()
	const server = spawn(process.execPath, [cli, 'dev', demo], { cwd: demo, env: { ...process.env, PORT: String(httpPort), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: '0' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
	context.after(() => server.kill())
	let logs = ''
	server.stdout.on('data', (chunk) => {
		logs += chunk
	})
	server.stderr.on('data', (chunk) => {
		logs += chunk
	})
	const origin = `http://127.0.0.1:${httpPort}`
	const started = Date.now()
	while (true) {
		if (server.exitCode !== null || Date.now() - started > 30_000) throw new Error(logs)
		try {
			if ((await fetch(origin)).ok) break
		} catch {
			/* Server is starting. */
		}
		await new Promise((done) => setTimeout(done, 50))
	}
	const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
	context.after(() => browser.close())
	await mkdir(output, { recursive: true })
	return { browser, origin, output }
}
