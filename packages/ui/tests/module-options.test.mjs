import { createRoot, provide } from '@meekojs/meeko'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import configPlugin from '../dist/app/plugins/config.js'
import { uiDefaults } from '../dist/app/utils/defaults.js'
import ui from '../dist/index.js'
import { tokenStyles, validateOptions } from '../dist/options.js'

test('UI validates finite token and default options and keeps CSS values within declarations', () => {
	assert.doesNotThrow(() => validateOptions({ tokens: { primary: 'var(--pill)', font: 'Inter, sans-serif' }, defaults: { link: { shape: 'pill', variant: 'outline' } } }))
	for (const options of [{ unknown: true }, { tokens: { colour: 'red' } }, { tokens: { primary: 'red; color: blue' } }, { defaults: { button: { size: 'huge' } } }, { defaults: { card: { shape: 'pill' } } }]) {
		assert.throws(() => validateOptions(options), /ui:/)
	}
	assert.equal(tokenStyles(undefined), '')
	assert.match(tokenStyles({ primary: 'var(--pill)' }), /:root, :root\[data-theme\]/)
	assert.match(tokenStyles({ primary: 'var(--pill)' }), /--ui-color-primary: var\(--pill\);/)
	assert.match(tokenStyles({ surface: 'var(--panel)' }), /--ui-color-control: var\(--panel\);/, 'an option that predates controls also paints them')
	assert.match(tokenStyles({ accent: 'red' }), /--meeko-ui-accent: red;/, 'a deprecated option still reaches its alias')
	assert.doesNotThrow(() => validateOptions({ base: false }))
	assert.throws(() => validateOptions({ base: 'no' }), /ui: base must be a boolean/)
})

test('the module loads the base unless asked not to, and serves the font from a path of its own', () => {
	const load = (options) => {
		const stylesheets = [],
			publicFiles = [],
			heads = []
		ui.setup(options, {
			rootDir: '/consumer',
			addComponentsDir() {},
			addStylesheet: (file) => stylesheets.push(String(file)),
			addAutoImports() {},
			addPlugin() {},
			addVitePlugin() {},
			addPublicFile: (path, contents) => publicFiles.push({ path, contents }),
			addHead: (head) => heads.push(head),
		})
		return { stylesheets, publicFiles, heads }
	}
	const { stylesheets, publicFiles, heads } = load({})
	assert.match(stylesheets[0], /styles\/base\.css$/, 'first, so that its layer loses to those of the app')
	assert.match(stylesheets[1], /styles\/main\.css$/)
	assert.deepEqual(
		publicFiles.map(({ path }) => path),
		['_meeko-ui/fonts/inter-latin-opsz-normal.woff2'],
	)
	assert.equal(heads[0].link[0].href, '/_meeko-ui/fonts/inter-latin-opsz-normal.woff2')
	assert.equal(heads[0].link[0].crossorigin, 'anonymous', 'a font preload without it is fetched twice')
	const withoutBase = load({ base: false }).stylesheets
	assert.equal(withoutBase.length, 1)
	assert.match(withoutBase[0], /styles\/main\.css$/)
})

test('the module serves the real font file', async () => {
	let contents
	ui.setup(
		{},
		{
			rootDir: '/consumer',
			addComponentsDir() {},
			addStylesheet() {},
			addAutoImports() {},
			addPlugin() {},
			addVitePlugin() {},
			addPublicFile: (_, value) => {
				contents = value
			},
			addHead() {},
		},
	)
	const bytes = await contents()
	assert.equal(Buffer.from(bytes.subarray(0, 4)).toString('latin1'), 'wOF2')
})

test('configured UI installs only a static defaults plugin and transforms its own token stylesheet', () => {
	const plugins = [],
		vite = []
	ui.setup(
		{ tokens: { primary: 'var(--pill)' }, defaults: { link: { shape: 'pill' } } },
		{
			rootDir: '/consumer',
			addComponentsDir() {},
			addStylesheet() {},
			addAutoImports() {},
			addPlugin(plugin) {
				plugins.push(plugin)
			},
			addVitePlugin(plugin) {
				vite.push(plugin)
			},
			addPublicFile() {},
			addHead() {},
		},
	)
	assert.equal(plugins.length, 2)
	assert.deepEqual(plugins[0].options, { link: { shape: 'pill' } })
	assert.match(String(plugins[0].src), /app\/plugins\/config\.js$/)
	const tokens = vite.find((plugin) => plugin.name === 'meeko-ui:tokens')
	assert.equal(tokens.transform('body {}', '/consumer/styles.css'), undefined)
	const path = fileURLToPath(new URL('../src/app/styles/main.css', import.meta.url))
	assert.match(tokens.transform(':root {}', path).code, /--ui-color-primary: var\(--pill\)/)
})

test('UI defaults remain isolated between providers and fall back outside a configured application', () => {
	assert.deepEqual(
		createRoot((dispose) => {
			const result = uiDefaults()
			dispose()
			return result
		}),
		{},
	)
	for (const shape of ['pill', 'rounded']) {
		const values = new Map()
		configPlugin.setup({ provide: (key, value) => values.set(key, value) }, { link: { shape } })
		createRoot((dispose) => {
			for (const [key, value] of values) provide(key, value)
			assert.equal(uiDefaults().link.shape, shape)
			dispose()
		})
	}
})

test('UI module configuration and action variants have checked public types', () => {
	const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
	execFileSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--module', 'nodenext', '--target', 'es2022', fileURLToPath(new URL('./types/ui-options.ts', import.meta.url))], { stdio: 'pipe' })
})
