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
	assert.match(tokenStyles({ primary: 'var(--pill)' }), /--meeko-ui-primary: var\(--pill\);/)
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
		},
	)
	assert.equal(plugins.length, 2)
	assert.deepEqual(plugins[0].options, { link: { shape: 'pill' } })
	assert.match(String(plugins[0].src), /app\/plugins\/config\.js$/)
	const tokens = vite.find((plugin) => plugin.name === 'meeko-ui:tokens')
	assert.equal(tokens.transform('body {}', '/consumer/styles.css'), undefined)
	const path = fileURLToPath(new URL('../src/app/styles/main.css', import.meta.url))
	assert.match(tokens.transform(':root {}', path).code, /--meeko-ui-primary: var\(--pill\)/)
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
