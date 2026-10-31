import assert from 'node:assert/strict'
import { type ChildProcess, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright-core'

import { resolveMeekoModules } from '../src/framework/module-loader'
import { buildProject } from '../src/framework/project'
import { frameworkStylesheets, globalStylesheetSnapshotFile } from '../src/framework/styles'
import { defineMeekoModule } from '../src/modules/define-meeko-module'
import { linkRepositoryPackages, repositoryRoot, stopChild, tempProject } from './helpers/temp-project'

async function put(root: string, file: string, source: string): Promise<void> {
	await mkdir(dirname(join(root, file)), { recursive: true })
	await writeFile(join(root, file), source)
}

async function until(check: () => boolean | Promise<boolean>, message: () => string, timeout = 30_000): Promise<void> {
	const start = Date.now()
	while (!(await check())) {
		if (Date.now() - start > timeout) throw new Error(message())
		await new Promise((done) => setTimeout(done, 25))
	}
}

async function freePort(): Promise<number> {
	const server = createServer().listen(0, '127.0.0.1')
	await once(server, 'listening')
	const address = server.address()
	assert.ok(address && typeof address !== 'string')
	server.close()
	await once(server, 'close')
	return address.port
}

test('addStylesheet validates CSS files, preserves order, deduplicates and owns linked directories', async (context) => {
	const root = await tempProject(context, 'registered-styles')
	await put(root, 'first.css', '.first {}')
	await put(root, 'second.css', '.second {}')
	await put(root, 'wrong.ts', 'export {};')
	const module = defineMeekoModule({
		meta: { name: 'styles' },
		setup(_options, meeko) {
			meeko.addStylesheet('./first.css')
			meeko.addStylesheet(pathToFileURL(join(root, 'first.css')))
			meeko.addStylesheet('./second.css')
		},
	})
	const result = await resolveMeekoModules(root, { modules: [module] })
	assert.deepEqual(result.stylesheets, [join(root, 'first.css'), join(root, 'second.css')])
	assert.ok(result.ownedDirectories.includes(root))
	await put(root, 'app/styles/main.css', '.app {}')
	const application = join(root, 'app/styles/main.css')
	assert.deepEqual(frameworkStylesheets(root, [application, ...result.stylesheets, application]), [...result.stylesheets, application])
	for (const file of ['missing.css', 'wrong.ts']) {
		const invalid = defineMeekoModule({
			meta: { name: 'invalid-styles' },
			setup(_options, meeko) {
				meeko.addStylesheet(file)
			},
		})
		await assert.rejects(resolveMeekoModules(root, { modules: [invalid] }), /stylesheet|\.css/)
	}
})

async function fixture(root: string, provider: string): Promise<void> {
	await linkRepositoryPackages(root, ['@meekojs/meeko', 'vite'])
	await linkRepositoryPackages(provider, ['@meekojs/meeko', 'vite'])
	await put(root, 'package.json', '{"private":true,"type":"module"}')
	await put(provider, 'package.json', '{"private":true,"type":"module"}')
	await put(
		provider,
		'index.mjs',
		`import { defineMeekoModule } from "@meekojs/meeko/framework";
export default defineMeekoModule({ meta: { name: "style-provider" }, setup(_options, meeko) {
  meeko.addStylesheet(new URL("./styles/main.css", import.meta.url));
} });`,
	)
	await put(
		provider,
		'styles/main.css',
		`@import "./tokens.css";
@utilities "./utilities.ts";
.module-probe { padding-left: 11px; background-image: url("./marker.svg"); --cascade: module; }`,
	)
	await put(provider, 'styles/tokens.css', '.module-probe { background-color: rgb(10, 20, 30); }')
	await put(
		provider,
		'styles/utilities.ts',
		`import { defineUtilities } from "@meekojs/meeko/postcss";
export default defineUtilities(({ rule }) => rule(".utility-probe", { "border-top-width": "3px", "border-top-style": "solid" }));`,
	)
	await put(provider, 'styles/marker.svg', `<svg xmlns="http://www.w3.org/2000/svg"><!--${'x'.repeat(5000)}--><rect width="1" height="1"/></svg>`)
	await put(root, 'meeko.config.mjs', `export default { modules: [${JSON.stringify(pathToFileURL(join(provider, 'index.mjs')).href)}] };`)
	await put(
		root,
		'postcss.config.mjs',
		`import { meekoUtilities } from "@meekojs/meeko/postcss";
export default { plugins: [meekoUtilities(), { postcssPlugin: "consumer-css", Declaration(node) {
  if (node.prop === "padding-left" && node.value === "11px") node.value = "17px";
} }] };`,
	)
	await put(root, 'app/styles/main.css', '.module-probe { --cascade: app; }')
	await put(root, 'app/pages/index.meeko', '<script server lang="ts">export const route = { render: "prerender" };</script><template><div class="module-probe utility-probe">Styled module</div></template>')
}

test('module styles use consumer PostCSS, import assets and enter SSR/static hashed CSS before app overrides', { timeout: 180_000 }, async (context) => {
	const root = await tempProject(context, 'module-style-build')
	const provider = await tempProject(context, 'module-style-provider')
	await fixture(root, provider)
	for (const adapter of ['node', 'static'] as const) {
		const result = await buildProject(root, { adapter })
		const directory = adapter === 'node' ? join(result.output, 'client', 'assets') : join(result.output, 'assets')
		const files = await readdir(directory)
		const styles = files.filter((file) => file.endsWith('.css'))
		const css = (await Promise.all(styles.map((file) => readFile(join(directory, file), 'utf8')))).join('\n')
		assert.match(css, /padding-left:\s*17px/)
		assert.match(css, /border-top-width:\s*3px/)
		assert.doesNotMatch(css, /@utilities|@import|\/@fs\//)
		assert.ok(css.search(/--cascade:\s*module/) < css.search(/--cascade:\s*app/), css)
		assert.ok(
			files.some((file) => /^marker-.*\.svg$/.test(file)),
			files.join(', '),
		)
		if (adapter === 'static') {
			const html = await readFile(join(result.output, 'index.html'), 'utf8')
			for (const file of styles) assert.ok(html.includes(file), file)
		}
	}
})

test('linked module CSS has SSR links, CSS-only HMR and a processed editor snapshot', { timeout: 120_000 }, async (context) => {
	let child: ChildProcess | undefined
	let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
	const root = await tempProject(context, 'module-style-dev', async () => {
		await browser?.close()
		await stopChild(child)
	})
	const provider = await tempProject(context, 'module-style-dev-provider')
	await fixture(root, provider)
	const port = await freePort()
	const hmrPort = await freePort()
	const origin = `http://127.0.0.1:${port}`
	child = spawn(process.execPath, [join(repositoryRoot, 'dist', 'cli.js'), 'dev', root], {
		cwd: root,
		env: { ...process.env, PORT: String(port), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: '0' },
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
	await until(
		() => logs.includes(`http://localhost:${port}\n`) || child!.exitCode !== null,
		() => logs,
	)
	assert.equal(child.exitCode, null, logs)
	const html = await (await fetch(origin)).text()
	assert.match(html, /data-vite-dev-id="[^"]*styles\/main\.css"/)
	assert.ok(html.indexOf('/@fs/') < html.indexOf('/app/styles/main.css?direct'), html)
	browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' as const }), headless: true })
	const page = await browser.newPage()
	const errors: string[] = []
	page.on('pageerror', (error) => errors.push(error.message))
	await page.goto(origin)
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.module-probe')!).paddingLeft === '17px')
	const probe = page.locator('.module-probe')
	assert.equal(await probe.evaluate((element) => getComputedStyle(element).getPropertyValue('--cascade').trim()), 'app')
	assert.equal(await probe.evaluate((element) => getComputedStyle(element).borderTopWidth), '3px')
	const links = await page.locator('link[data-vite-dev-id$="styles/main.css"]').count()
	assert.equal(links, 2, 'module and app CSS are linked once each')
	assert.equal(await page.locator('style[data-vite-dev-id$="styles/main.css"]').count(), 0, 'Vite reuses SSR links')
	await page.evaluate(() => {
		;(window as unknown as { moduleStyleState: number }).moduleStyleState = 123
	})
	await put(provider, 'styles/tokens.css', '.module-probe { background-color: rgb(50, 60, 70); }')
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.module-probe')!).backgroundColor === 'rgb(50, 60, 70)')
	assert.equal(await page.evaluate(() => (window as unknown as { moduleStyleState?: number }).moduleStyleState), 123, 'CSS updates without a document reload')
	const snapshot = () => readFile(join(root, globalStylesheetSnapshotFile), 'utf8').catch(() => '')
	await until(
		async () => (await snapshot()).includes('50, 60, 70'),
		() => logs,
	)
	assert.match(await snapshot(), /padding-left: 17px/)
	assert.match(await snapshot(), /border-top-width: 3px/)
	await put(provider, 'styles/utilities.ts', `import { defineUtilities } from "@meekojs/meeko/postcss"; export default defineUtilities(({ rule }) => rule(".utility-probe", { "border-top-width": "5px", "border-top-style": "solid" }));`)
	await page.waitForFunction(() => getComputedStyle(document.querySelector('.module-probe')!).borderTopWidth === '5px')
	await until(
		async () => (await snapshot()).includes('border-top-width: 5px'),
		() => logs,
	)
	assert.equal(await page.evaluate(() => (window as unknown as { moduleStyleState?: number }).moduleStyleState), 123, '@utilities updates without a document reload')
	// Optional app CSS may disappear and return; module CSS and the snapshot stay available.
	await rm(join(root, 'app/styles/main.css'))
	await page.waitForFunction(() => {
		const element = document.querySelector('.module-probe')
		return element && getComputedStyle(element).getPropertyValue('--cascade').trim() === 'module'
	})
	await until(
		async () => !/--cascade:\s*app/.test(await snapshot()) && (await snapshot()).includes('.module-probe'),
		() => logs,
	)
	await put(root, 'app/styles/main.css', '.module-probe { --cascade: restored; }')
	await page.waitForFunction(() => {
		const element = document.querySelector('.module-probe')
		return element && getComputedStyle(element).getPropertyValue('--cascade').trim() === 'restored'
	})
	assert.deepEqual(errors, [], logs)
})
