import { createRoot, provide } from '@meekojs/meeko'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import configPlugin from '../dist/app/plugins/config.js'
import { uiDefaults } from '../dist/app/utils/defaults.js'
import { normalizeDefaults } from '../dist/defaults.js'
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
	for (const removed of ['accent', 'accentHover', 'onAccent']) assert.throws(() => validateOptions({ tokens: { [removed]: 'red' } }), /ui: unknown token/, 'the options of the removed aliases are gone')
	assert.doesNotThrow(() => validateOptions({ base: false }))
	assert.throws(() => validateOptions({ base: 'no' }), /ui: base must be a boolean/)
})

test('ui.defaults accepts class and ui for every component, and the variants of a few, with clear errors', () => {
	assert.doesNotThrow(() =>
		validateOptions({
			defaults: {
				card: { padding: 'sm', density: 'compact', variant: 'soft', actionsWrap: 'auto', ui: { header: 'my-card-header' } },
				table: { density: 'compact', class: 'my-table', ui: { base: 'my-scroll', cell: 'my-cell' } },
				stat: { ui: { value: 'my-stat-value' } },
				alert: { class: 'my-alert', ui: { title: 'my-alert-title' } },
				descriptionList: { ui: { label: 'my-label' } },
				button: { variant: 'ghost', class: 'my-button' },
				link: { shape: 'pill' },
				toast: { ui: { base: 'my-toast' } },
				tooltip: { class: 'my-tooltip' },
				markdownEditor: { ui: { bar: 'my-bar' } },
				modal: { class: undefined },
			},
		}),
	)
	const errors = [
		[{ cards: {} }, /ui: unknown defaults component cards; use one of alert, badge,/],
		[{ Card: {} }, /unknown defaults component Card/],
		[{ card: 'soft' }, /ui: defaults\.card must be an object/],
		[{ card: { ui: { head: 'x' } } }, /ui: unknown slot head in defaults\.card\.ui; its slots are base, header, title, description, actions, body, footer/],
		[{ card: { ui: 'x' } }, /ui: defaults\.card\.ui must be an object/],
		[{ card: { padding: 'xl' } }, /ui: invalid defaults\.card\.padding; use one of none, sm, md, lg/],
		[{ card: { density: 'dense' } }, /ui: invalid defaults\.card\.density; use one of compact, normal, comfortable/],
		[{ card: { shape: 'pill' } }, /ui: unknown option defaults\.card\.shape; card accepts class, ui, density, variant, padding, actionsWrap/],
		[{ card: { actionsWrap: 'wrap' } }, /ui: invalid defaults\.card\.actionsWrap; use one of inline, below, auto/],
		[{ table: { layout: 'grid' } }, /ui: unknown option defaults\.table\.layout; table accepts class, ui, density/],
		[{ alert: { tone: 'danger' } }, /unknown option defaults\.alert\.tone/],
		[{ button: { ui: { base: 'x' } } }, /unknown option defaults\.button\.ui; button accepts class, variant, size, shape/],
		[{ toast: { class: 'x' } }, /unknown option defaults\.toast\.class; toast accepts ui/],
		[{ stat: { class: '' } }, /ui: defaults\.stat\.class must be a non-empty string of classes/],
		[{ stat: { class: ['a'] } }, /defaults\.stat\.class must be a non-empty string/],
		[{ stat: { ui: { value: 3 } } }, /ui: defaults\.stat\.ui\.value must be a non-empty string/],
	]
	for (const [defaults, message] of errors) assert.throws(() => validateOptions({ defaults }), message)
})

test('only the validated plain values of ui.defaults reach the client', () => {
	const settings = Object.assign(Object.create({ inherited: 'no' }), { class: 'mine', ui: { header: 'h', body: undefined } })
	const options = { defaults: { card: settings, stat: { ui: { value: undefined } }, table: { class: undefined } } }
	validateOptions(options)
	const normalized = normalizeDefaults(options.defaults)
	assert.deepEqual(normalized, { card: { class: 'mine', ui: { header: 'h' } } })
	assert.equal(Object.getPrototypeOf(normalized.card), Object.prototype)
	assert.equal(JSON.stringify(normalized), '{"card":{"class":"mine","ui":{"header":"h"}}}')
	const plugins = []
	ui.setup({ defaults: { stat: { class: undefined } } }, { rootDir: '/consumer', addComponentsDir() {}, addStylesheet() {}, addAutoImports() {}, addPlugin: (plugin) => plugins.push(plugin), addVitePlugin() {}, addPublicFile() {}, addHead() {} })
	assert.ok(!plugins.some((plugin) => /plugins\/config\.js$/.test(String(plugin.src))), 'defaults with nothing left install no plugin')
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
	assert.equal(plugins.length, 3)
	assert.deepEqual(plugins[0].options, { link: { shape: 'pill' } })
	assert.match(String(plugins[0].src), /app\/plugins\/config\.js$/)
	const tokens = vite.find((plugin) => plugin.name === 'meeko-ui:tokens')
	assert.equal(tokens.transform('body {}', '/consumer/styles.css'), undefined)
	// The tokens go after the compiled sheet, the one that the module adds to the app.
	const path = fileURLToPath(new URL('../dist/styles/main.css', import.meta.url))
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
