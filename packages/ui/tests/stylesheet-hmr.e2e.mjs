import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'

import { startDevServer } from '../../../scripts/test-support/dev-server.ts'
import { createFixture } from '../../../scripts/test-support/fixture.ts'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const viteRoot = fileURLToPath(new URL('../../meeko/node_modules/vite', import.meta.url))
const cli = fileURLToPath(new URL('../../meeko/dist/cli.js', import.meta.url))

const page = `<template>
	<main>
		<UIButton id="action" variant="primary">Guardar</UIButton>
		<p class="theme-mark">Tema</p>
		<Note />
	</main>
</template>
`
const note = (color) => `<template><p class="note">Nota</p></template>

<style scoped>
.note { color: ${color}; }
</style>
`
const appStyles = (color) => `body { outline-color: ${color}; }\n`

/**
 * A module packaged as @meekojs/ui was until 1.9, with its stylesheet at `src/app/styles/main.css`: the
 * development URL of that sheet ends with the path of the application's `app/styles/main.css`.
 */
const themeModule = `import { defineMeekoModule } from '@meekojs/meeko/framework'

export default defineMeekoModule({
	meta: { name: 'theme-fixture' },
	setup(_options, meeko) {
		meeko.addStylesheet(new URL('./src/app/styles/main.css', import.meta.url))
	},
})
`

/**
 * Records, from the first paint on, every frame and every change of the document in which a rule of a
 * module stylesheet stops applying: the background that @meekojs/ui gives the primary UIButton and the
 * colour of the theme module.
 */
function watchStyles() {
	globalThis.meekoUnstyled = []
	const check = (when) => {
		const button = globalThis.document.querySelector('#action')
		const mark = globalThis.document.querySelector('.theme-mark')
		if (!button || !mark) return
		const seen = { button: globalThis.getComputedStyle(button).backgroundColor, theme: globalThis.getComputedStyle(mark).color }
		if (seen.button !== globalThis.meekoExpected.button || seen.theme !== globalThis.meekoExpected.theme) {
			const sheets = [...globalThis.document.querySelectorAll('link[rel=stylesheet]')].map((node) => new URL(node.href).pathname.split('/').slice(-4).join('/'))
			globalThis.meekoUnstyled.push({ when, ...seen, sheets })
		}
	}
	const frame = () => {
		check('frame')
		globalThis.requestAnimationFrame(frame)
	}
	globalThis.requestAnimationFrame(frame)
	new globalThis.MutationObserver(() => check('mutation')).observe(globalThis.document, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'media', 'disabled'] })
}

async function app(t, { tokens } = {}) {
	const parent = fileURLToPath(new URL('../.meeko/', import.meta.url))
	const config = { modules: ['@meekojs/ui', 'theme-fixture'], server: { adapter: 'static' }, ...(tokens ? { ui: { tokens } } : {}) }
	const fixture = await createFixture(t, parent, 'stylesheet-hmr-', {
		files: {
			'package.json': JSON.stringify({ name: 'stylesheet-hmr-fixture', private: true, type: 'module' }),
			'meeko.config.mjs': `export default ${JSON.stringify(config)}\n`,
			'app/app.meeko': '<template><UIApp><MeekoOutlet /></UIApp></template>\n',
			'app/pages/index.meeko': page,
			'app/components/Note.meeko': note('rgb(1, 2, 3)'),
			'app/styles/main.css': appStyles('rgb(1, 2, 3)'),
			'packages/theme-fixture/package.json': JSON.stringify({ name: 'theme-fixture', private: true, type: 'module', exports: './module.mjs' }),
			'packages/theme-fixture/module.mjs': themeModule,
			'packages/theme-fixture/src/app/styles/main.css': '.theme-mark { color: rgb(7, 77, 7); }\n',
		},
		links: { '@meekojs/ui': packageRoot, vite: viteRoot },
	})
	// A workspace package, linked as pnpm does: its real path is outside node_modules, so dev watches it.
	await fixture.link('theme-fixture', join(fixture.root, 'packages/theme-fixture'))
	const server = await startDevServer({ root: fixture.root, cli })
	fixture.setStop(server.stop)
	return { root: fixture.root, origin: server.origin }
}

async function open(browser, origin, expected) {
	const tab = await browser.newPage({ viewport: { width: 1024, height: 700 } })
	const errors = []
	tab.on('pageerror', (error) => errors.push(error.message))
	await tab.addInitScript(
		([source, styles]) => {
			globalThis.meekoExpected = styles
			globalThis.document.addEventListener('DOMContentLoaded', () => new Function(`(${source})()`)())
		},
		[watchStyles.toString(), expected],
	)
	await tab.goto(origin, { waitUntil: 'networkidle' })
	await tab.waitForFunction(() => performance.getEntriesByName('meeko-hydration').length > 0)
	return { tab, errors }
}

const computed = (tab, selector, property) => tab.locator(selector).evaluate((node, name) => globalThis.getComputedStyle(node)[name], property)

for (const tokens of [undefined, { primary: 'rgb(10, 120, 30)' }]) {
	const expected = { button: tokens ? 'rgb(10, 120, 30)' : 'rgb(103, 60, 221)', theme: 'rgb(7, 77, 7)' }
	test(`module stylesheets stay applied through CSS hot updates ${tokens ? 'with' : 'without'} ui.tokens`, { timeout: 240_000 }, async (t) => {
		const { root, origin } = await app(t, { tokens })
		const browser = await chromium.launch({ ...(process.env.MEEKO_CHROME_PATH ? { executablePath: process.env.MEEKO_CHROME_PATH } : { channel: 'chrome' }), headless: true })
		t.after(() => browser.close())
		const { tab, errors } = await open(browser, origin, expected)
		assert.equal(await computed(tab, '#action', 'backgroundColor'), expected.button, 'the first paint has the stylesheet of @meekojs/ui')
		assert.equal(await computed(tab, '.theme-mark', 'color'), expected.theme, 'the first paint has the stylesheet of the theme module')

		const settle = async (selector, property, value) => {
			await tab.waitForFunction(([selector, property, value]) => globalThis.getComputedStyle(globalThis.document.querySelector(selector))[property] === value, [selector, property, value], { timeout: 20_000 })
			// A link that Vite replaced may still be loading: the old one goes once the new one loads.
			await tab.waitForTimeout(300)
		}
		const styled = async (step) => {
			const found = await tab.evaluate(() => globalThis.meekoUnstyled.splice(0))
			assert.deepEqual(found.slice(0, 2), [], `${step}: the module stylesheets never stopped applying`)
			assert.equal(await computed(tab, '#action', 'backgroundColor'), expected.button, `${step}: @meekojs/ui after the update`)
			assert.equal(await computed(tab, '.theme-mark', 'color'), expected.theme, `${step}: the theme module after the update`)
			const hrefs = await tab.evaluate(() => [...globalThis.document.querySelectorAll('link[rel=stylesheet]')].map((node) => new URL(node.href).pathname))
			assert.equal(hrefs.filter((href) => href.endsWith('/dist/styles/main.css')).length, 1, `${step}: one link to the stylesheet of @meekojs/ui`)
			assert.equal(hrefs.filter((href) => href.endsWith('/theme-fixture/src/app/styles/main.css')).length, 1, `${step}: one link to the theme stylesheet`)
		}

		await t.test('editing app/styles/main.css', async () => {
			for (let round = 1; round <= 3; round++) {
				const color = `rgb(${round}, 20, 30)`
				await writeFile(join(root, 'app/styles/main.css'), appStyles(color))
				await settle('body', 'outlineColor', color)
				await styled(`app stylesheet #${round}`)
			}
		})

		await t.test('editing the <style> of a component', async () => {
			for (let round = 1; round <= 2; round++) {
				const color = `rgb(${round}, 40, 50)`
				await writeFile(join(root, 'app/components/Note.meeko'), note(color))
				await settle('.note', 'color', color)
				await styled(`component style #${round}`)
			}
		})

		await t.test('quick edits in a row', async () => {
			let color = ''
			for (let round = 1; round <= 6; round++) {
				color = `rgb(${round}, 60, 70)`
				await writeFile(join(root, 'app/styles/main.css'), appStyles(color))
				if (round % 2) await writeFile(join(root, 'app/components/Note.meeko'), note(color))
				// Beyond the 50 ms in which the watcher merges the changes of one file.
				await tab.waitForTimeout(60 + round * 10)
			}
			await settle('body', 'outlineColor', color)
			await settle('.note', 'color', 'rgb(5, 60, 70)')
			await styled('quick edits')
		})

		await t.test('editing a module stylesheet still hot-updates it', async () => {
			await writeFile(join(root, 'packages/theme-fixture/src/app/styles/main.css'), '.theme-mark { color: rgb(8, 88, 8); }\n')
			await settle('.theme-mark', 'color', 'rgb(8, 88, 8)')
			assert.equal(await tab.evaluate(() => globalThis.meekoUnstyled.filter((entry) => entry.button !== globalThis.meekoExpected.button).length), 0, '@meekojs/ui stays')
			await tab.evaluate(() => globalThis.meekoUnstyled.splice(0))
			await writeFile(join(root, 'packages/theme-fixture/src/app/styles/main.css'), '.theme-mark { color: rgb(7, 77, 7); }\n')
			await settle('.theme-mark', 'color', expected.theme)
			await tab.evaluate(() => globalThis.meekoUnstyled.splice(0))
			await styled('module stylesheet')
		})

		await t.test('a reload after the edits keeps every stylesheet', async () => {
			await tab.reload({ waitUntil: 'networkidle' })
			await tab.waitForFunction(() => performance.getEntriesByName('meeko-hydration').length > 0)
			await styled('reload')
		})
		assert.deepEqual(errors, [])
	})
}
