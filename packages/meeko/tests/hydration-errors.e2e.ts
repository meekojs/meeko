import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import test from 'node:test'
import { chromium } from 'playwright-core'

import { initFrameworkProject } from '../src/framework/init.ts'
import { createTempProject, linkRepositoryPackages, repositoryRoot } from './helpers/temp-project.ts'

async function freePort(): Promise<number> {
	const server = createServer()
	server.listen(0, '127.0.0.1')
	await once(server, 'listening')
	const address = server.address()
	assert.ok(address && typeof address !== 'string')
	server.close()
	await once(server, 'close')
	return address.port
}

async function until(condition: () => boolean, message: () => string, timeout = 30_000): Promise<void> {
	const start = Date.now()
	while (!condition()) {
		if (Date.now() - start > timeout) throw new Error(message())
		await new Promise((done) => setTimeout(done, 50))
	}
}

// An autoimported component whose root is a block element, as <UITooltip> and <UIPopover> render a <div>.
const panel = `<script lang="ts">
const count = signal(0);
</script>

<template>
  <div class="panel"><button id="count" type="button" on:click="() => count.value++">{count.value}</button></div>
</template>
`

const page = `<template>
  <section><p>Before <Panel /> after</p></section>
</template>
`

test("meeko dev shows a failed hydration in the browser: console.error with the component and the nodes, and Vite's overlay", { timeout: 120_000 }, async (context) => {
	const project = await createTempProject('hydration-errors')
	const root = project.root
	await initFrameworkProject(root)
	await mkdir(join(root, 'app', 'components'), { recursive: true })
	await writeFile(join(root, 'app', 'components', 'Panel.meeko'), panel)
	await writeFile(join(root, 'app', 'pages', 'index.meeko'), page)
	await linkRepositoryPackages(root, ['@meekojs/meeko', 'vite'])
	const port = await freePort()
	const child = spawn(process.execPath, [join(repositoryRoot, 'dist', 'cli.js'), 'dev', root], {
		cwd: root,
		env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(await freePort()), MEEKO_LINK_WATCH: '0', MEEKO_EDITOR_BRIDGE: '0' },
		stdio: ['ignore', 'pipe', 'pipe'],
		windowsHide: true,
	})
	let logs = ''
	child.stdout?.on('data', (chunk: Buffer) => {
		logs += chunk.toString()
	})
	child.stderr?.on('data', (chunk: Buffer) => {
		logs += chunk.toString()
	})
	const browser = await chromium.launch({
		...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' as const }),
		headless: true,
	})
	context.after(async () => {
		await browser.close()
		if (child.exitCode === null && child.signalCode === null) {
			const exited = once(child, 'exit')
			child.kill('SIGINT')
			await exited
		}
		await project.remove()
	})
	await until(
		() => logs.includes(`http://localhost:${port}\n`) || child.exitCode !== null,
		() => `meeko dev did not listen: ${logs}`,
	)
	assert.equal(child.exitCode, null, logs)

	const tab = await browser.newPage()
	const consoleErrors: string[] = []
	const pageErrors: string[] = []
	tab.on('console', (message) => {
		if (message.type() === 'error') consoleErrors.push(message.text())
	})
	tab.on('pageerror', (error) => pageErrors.push(error.message))
	await tab.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'networkidle' })
	// The browser closed the <p> before the component's <div>.
	assert.equal(await tab.locator('p > .panel').count(), 0)
	await until(
		() => consoleErrors.some((text) => text.startsWith('[meeko] Hydration mismatch in <Panel>')),
		() => `no hydration error in the console: ${JSON.stringify(consoleErrors)}`,
	)
	const reported = consoleErrors.find((text) => text.startsWith('[meeko] Hydration mismatch in <Panel>'))!
	assert.match(reported, /at index\.meeko:\d+:\d+: the page did not hydrate/)
	assert.match(reported, /expected: <!--\/meeko:component:0--> inside <p>/)
	assert.match(reported, /found: {4}<div> after <\/p>/)
	assert.match(reported, /MEEK139/)
	// Vite's overlay shows it too.
	const overlay = tab.locator('vite-error-overlay')
	await overlay.waitFor({ state: 'attached' })
	assert.match((await overlay.evaluate((node) => node.shadowRoot?.querySelector('.message-body')?.textContent ?? '')) as string, /Hydration mismatch in <Panel>/)
	// The error is still thrown, so it also reaches the terminal of meeko dev.
	assert.ok(
		pageErrors.some((text) => text.includes('Hydration mismatch in index.meeko')),
		JSON.stringify(pageErrors),
	)
	// Without hydration, the control does not respond.
	await tab.evaluate(() => document.querySelector<HTMLButtonElement>('#count')!.click())
	assert.equal(await tab.locator('#count').textContent(), '0')
})
