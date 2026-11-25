import { createRoot, provide } from '@meekojs/meeko'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import configPlugin from '../dist/app/plugins/config.js'
import { uiDefaults } from '../dist/app/utils/defaults.js'
import { normalizeDefaults } from '../dist/defaults.js'
import ui from '../dist/index.js'
import { tokenStyles, validateOptions } from '../dist/options.js'
import { guardTailwind, importsEntry, insertTokens } from '../dist/styles.js'

test('UI validates finite token and default options and keeps CSS values within declarations', () => {
	assert.doesNotThrow(() => validateOptions({ tokens: { primary: 'var(--pill)', font: 'Inter, sans-serif' }, defaults: { link: { radius: 'full', variant: 'outline', color: 'neutral' } } }))
	for (const options of [{ unknown: true }, { tokens: { colour: 'red' } }, { tokens: { primary: 'red; color: blue' } }, { defaults: { button: { size: 'huge' } } }, { defaults: { button: { variant: 'primary' } } }, { defaults: { button: { shape: 'pill' } } }, { defaults: { card: { shape: 'pill' } } }]) {
		assert.throws(() => validateOptions(options), /ui:/)
	}
	assert.equal(tokenStyles(undefined), '')
	assert.match(tokenStyles({ primary: 'var(--pill)' }), /:root, :root\[data-theme\]/)
	assert.match(tokenStyles({ primary: 'var(--pill)' }), /--ui-color-primary: var\(--pill\);/)
	assert.match(tokenStyles({ primary: 'var(--pill)', primaryHover: 'var(--pill-hover)' }), /--ui-color-primary-9: var\(--pill\);\n[^]*--ui-color-primary-10: var\(--pill-hover\);/, 'a solid button paints steps 9 and 10 of the scale')
	assert.match(tokenStyles({ surface: 'var(--panel)' }), /--ui-color-control: var\(--panel\);/, 'an option that predates controls also paints them')
	for (const removed of ['accent', 'accentHover', 'onAccent']) assert.throws(() => validateOptions({ tokens: { [removed]: 'red' } }), /ui: unknown token/, 'the options of the removed aliases are gone')
	assert.doesNotThrow(() => validateOptions({ base: false }))
	assert.throws(() => validateOptions({ base: 'no' }), /ui: base must be a boolean/)
})

test('ui.defaults accepts class and ui for every component, and the variants of a few, with clear errors', () => {
	assert.doesNotThrow(() =>
		validateOptions({
			defaults: {
				card: { padding: 'sm', density: 'compact', variant: 'soft', color: 'primary', radius: 'xl', elevation: 'md', actionsWrap: 'auto', ui: { header: 'my-card-header' } },
				linkCard: { variant: 'glass', color: 'info', radius: 'sm', elevation: 'none', ui: { title: 'my-link-card-title' } },
				table: { density: 'compact', class: 'my-table', ui: { base: 'my-scroll', cell: 'my-cell' } },
				stat: { ui: { value: 'my-stat-value' } },
				alert: { class: 'my-alert', ui: { title: 'my-alert-title' } },
				descriptionList: { ui: { label: 'my-label' } },
				button: { variant: 'ghost', color: 'neutral', size: 'xl', radius: 'none', class: 'my-button' },
				link: { radius: 'full' },
				toast: { ui: { base: 'my-toast' } },
				tooltip: { class: 'my-tooltip' },
				markdownEditor: { ui: { bar: 'my-bar' } },
				modal: { class: undefined },
			},
		}),
	)
	const errors = [
		[{ cards: {} }, /ui: unknown defaults component cards; use one of alert, avatar, badge,/],
		[{ Card: {} }, /unknown defaults component Card/],
		[{ card: 'soft' }, /ui: defaults\.card must be an object/],
		[{ card: { ui: { head: 'x' } } }, /ui: unknown slot head in defaults\.card\.ui; its slots are base, header, title, description, actions, body, footer/],
		[{ card: { ui: 'x' } }, /ui: defaults\.card\.ui must be an object/],
		[{ card: { padding: 'xl' } }, /ui: invalid defaults\.card\.padding; use one of none, sm, md, lg/],
		[{ card: { density: 'dense' } }, /ui: invalid defaults\.card\.density; use one of compact, normal, comfortable/],
		[{ card: { shape: 'pill' } }, /ui: unknown option defaults\.card\.shape; card accepts class, ui, density, variant, color, radius, elevation, padding, actionsWrap/],
		[{ card: { variant: 'elevated' } }, /ui: invalid defaults\.card\.variant; use one of surface, outline, soft, subtle, solid, glass, plain/],
		[{ card: { variant: 'ghost' } }, /ui: invalid defaults\.card\.variant;/],
		[{ card: { color: 'crimson' } }, /ui: invalid defaults\.card\.color; use one of primary, secondary, neutral, success, info, warning, danger/],
		[{ card: { elevation: 'huge' } }, /ui: invalid defaults\.card\.elevation; use one of none, xs, sm, md, lg, xl, 2xl/],
		[{ card: { appearance: { variant: 'surface' } } }, /ui: unknown option defaults\.card\.appearance/],
		[{ linkCard: { padding: 'sm' } }, /ui: unknown option defaults\.linkCard\.padding; linkCard accepts class, ui, variant, color, radius, elevation/],
		[{ card: { actionsWrap: 'wrap' } }, /ui: invalid defaults\.card\.actionsWrap; use one of inline, below, auto/],
		[{ table: { layout: 'grid' } }, /ui: unknown option defaults\.table\.layout; table accepts class, ui, density/],
		[{ alert: { tone: 'danger' } }, /unknown option defaults\.alert\.tone/],
		[{ button: { ui: { base: 'x' } } }, /unknown option defaults\.button\.ui; button accepts class, variant, color, size, radius/],
		[{ button: { tone: 'danger' } }, /unknown option defaults\.button\.tone; button accepts class, variant, color, size, radius/],
		[{ button: { variant: 'secondary' } }, /invalid defaults\.button\.variant; use one of solid, soft, surface, outline, subtle, ghost, link/],
		[{ link: { color: 'crimson' } }, /invalid defaults\.link\.color; use one of primary, secondary, neutral, success, info, warning, danger/],
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
	// The rest of the CSS is the entry that the app's sheet imports and compiles with its Tailwind.
	assert.equal(stylesheets.length, 1, 'no precompiled sheet')
	assert.match(stylesheets[0], /src\/app\/styles\/base\.css$/, 'first, so that its layer loses to those of the app')
	assert.deepEqual(
		publicFiles.map(({ path }) => path),
		['_meeko-ui/fonts/inter-latin-opsz-normal.woff2'],
	)
	assert.equal(heads[0].link[0].href, '/_meeko-ui/fonts/inter-latin-opsz-normal.woff2')
	assert.equal(heads[0].link[0].crossorigin, 'anonymous', 'a font preload without it is fetched twice')
	assert.deepEqual(load({ base: false }).stylesheets, [])
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

test('configured UI installs only a static defaults plugin and puts its tokens in the sheet that imports UI', () => {
	const plugins = [],
		vite = []
	ui.setup(
		{ tokens: { primary: 'var(--pill)' }, defaults: { link: { radius: 'full' } } },
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
	assert.equal(plugins.length, 4)
	assert.deepEqual(plugins[0].options, { link: { radius: 'full' } })
	assert.match(String(plugins[0].src), /app\/plugins\/config\.js$/)
	const tokens = vite.find((plugin) => plugin.name === 'meeko-ui:tokens')
	// Before Tailwind inlines the imports, whichever instance of @tailwindcss/vite compiles the sheet.
	assert.equal(tokens.enforce, 'pre')
	assert.equal(tokens.transform.order, 'pre')
	const transform = (code, id) => tokens.transform.handler(code, id)
	assert.equal(transform('body {}', '/consumer/app/styles/main.css'), undefined, 'a sheet that does not import UI')
	assert.equal(transform("@import '@meekojs/ui';", '/consumer/app/components/Card.meeko?meeko&type=script'), undefined, 'only CSS')
	const { code } = transform("@import 'tailwindcss';\n@import '@meekojs/ui';\n:root { --ui-color-primary: red; }\n", '/consumer/app/styles/main.css?direct')
	assert.match(code, /@import '@meekojs\/ui';\n+:root, :root\[data-theme\] \{\n {2}--ui-color-primary: var\(--pill\);/)
	assert.ok(code.indexOf('var(--pill)') < code.indexOf('--ui-color-primary: red'), 'the rules of the sheet itself still win')
})

test('the tokens of ui.tokens go after the imports of the sheet, which keeps them valid CSS', () => {
	const tokens = ':root { --ui-color-primary: blue; }\n'
	assert.equal(insertTokens("@import 'tailwindcss';\n.a {}", tokens), undefined)
	assert.equal(insertTokens("@import '@meekojs/ui/hues';", tokens), undefined, 'the optional entry alone is not the stylesheet of UI')
	assert.equal(insertTokens("/* @import '@meekojs/ui'; */ .a {}", tokens), undefined, 'a commented import')
	assert.equal(insertTokens("@import url('@meekojs/ui');", tokens), "@import url('@meekojs/ui');\n" + tokens)
	const css = "@import 'tailwindcss';\n/* UI; */\n@import \"@meekojs/ui\";\n@import '@meekojs/ui/hues';\n@import './brand.css';\n.app { color: red; }\n"
	const result = insertTokens(css, tokens)
	assert.equal(result, css.replace("@import './brand.css';", "@import './brand.css';\n" + tokens))
	assert.equal(importsEntry(undefined), false)
	assert.equal(importsEntry("@import 'tailwindcss';"), false)
	assert.equal(importsEntry("@import 'tailwindcss';\n@import '@meekojs/ui';"), true)
	// Tailwind without its preflight: the theme and the utilities in their layers, then UI.
	const withoutPreflight = "@layer theme, base, components, utilities;\n@import 'tailwindcss/theme.css' layer(theme);\n@import 'tailwindcss/utilities.css' layer(utilities);\n@import '@meekojs/ui';\n.app {}\n"
	assert.equal(importsEntry(withoutPreflight), true)
	assert.equal(insertTokens(withoutPreflight, tokens), withoutPreflight.replace("@import '@meekojs/ui';", "@import '@meekojs/ui';\n" + tokens))
})

test('the tokens and the check of meeko dev follow the local imports of the sheet, without looping on a cycle', async (context) => {
	const tokens = ':root { --ui-color-primary: blue; }\n'
	const sheets = {
		'/app/styles/main.css': "@import 'tailwindcss';\n@import './ui.css';\n.app {}\n",
		'/app/styles/ui.css': "@import './theme/base.css';\n",
		'/app/styles/theme/base.css': "/* @import './nothing.css'; */\n@import '@meekojs/ui';\n",
		'/app/styles/a.css': "@import './b.css';",
		'/app/styles/b.css': '@import "./a.css";\n@import url(\'../styles/a.css\');',
		'/app/styles/deep.css': "@import './d1.css';",
	}
	for (let level = 1; level <= 10; level++) sheets[`/app/styles/d${level}.css`] = level === 10 ? "@import '@meekojs/ui';" : `@import './d${level + 1}.css';`
	const reads = []
	const read = (path) => {
		const key = path.replaceAll('\\', '/').replace(/^[A-Za-z]:/, '')
		reads.push(key)
		return sheets[key]
	}
	const main = sheets['/app/styles/main.css']
	assert.equal(importsEntry(main, '/app/styles/main.css', read), true, 'main.css → ui.css → theme/base.css → @meekojs/ui')
	assert.equal(importsEntry(main), false, 'without the path of the sheet only a direct import counts')
	assert.equal(insertTokens(main, tokens, '/app/styles/main.css', read), main.replace("@import './ui.css';", "@import './ui.css';\n" + tokens), 'after the imports of the sheet that Vite loads')
	assert.ok(!reads.includes('/app/styles/nothing.css'), 'a commented import is not followed')
	reads.length = 0
	assert.equal(importsEntry(sheets['/app/styles/a.css'], '/app/styles/a.css', read), false, 'a cycle ends')
	assert.deepEqual(reads, ['/app/styles/b.css'], 'each sheet is read once')
	assert.equal(insertTokens(sheets['/app/styles/a.css'], tokens, '/app/styles/a.css', read), undefined)
	assert.equal(importsEntry(sheets['/app/styles/deep.css'], '/app/styles/deep.css', read), false, 'the depth is bounded')
	assert.equal(importsEntry("@import './missing.css';", '/app/styles/main.css', read), false)

	// The module, on disk: no warning, and the transform of meeko-ui:tokens inserts them in main.css.
	const root = await mkdtemp(join(tmpdir(), 'meeko-ui-import-'))
	context.after(() => rm(root, { recursive: true, force: true }))
	await mkdir(join(root, 'app', 'styles'), { recursive: true })
	await writeFile(join(root, 'app', 'styles', 'main.css'), "@import 'tailwindcss';\n@import './ui.css';\n")
	await writeFile(join(root, 'app', 'styles', 'ui.css'), "@import '@meekojs/ui';\n")
	const vite = [],
		warnings = []
	await ui.setup({ tokens: { primary: 'var(--pill)' } }, { rootDir: root, dev: true, addComponentsDir() {}, addStylesheet() {}, addAutoImports() {}, addPlugin() {}, addVitePlugin: (plugin) => vite.push(plugin), addPublicFile() {}, addHead() {}, warn: (message) => warnings.push(message) })
	assert.deepEqual(warnings, [], 'main.css reaches UI through ui.css')
	const transform = vite.find((plugin) => plugin.name === 'meeko-ui:tokens').transform.handler
	const { code } = transform("@import 'tailwindcss';\n@import './ui.css';\n", join(root, 'app', 'styles', 'main.css') + '?direct')
	assert.match(code, /@import '\.\/ui\.css';\n+:root, :root\[data-theme\] \{\n {2}--ui-color-primary: var\(--pill\);/)
	await writeFile(join(root, 'app', 'styles', 'ui.css'), '.nothing {}\n')
	await ui.setup({}, { rootDir: root, dev: true, addComponentsDir() {}, addStylesheet() {}, addAutoImports() {}, addPlugin() {}, addVitePlugin() {}, addPublicFile() {}, addHead() {}, warn: (message) => warnings.push(message) })
	assert.match(warnings[0] ?? '', /no importa @meekojs\/ui/, 'and it still warns when nothing reaches UI')
})

test('UI registers @tailwindcss/vite once, lazily, and no precompiled sheet', async () => {
	const vite = [],
		stylesheets = [],
		warnings = []
	const context = (dev, rootDir) => ({ rootDir, dev, addComponentsDir() {}, addStylesheet: (file) => stylesheets.push(String(file)), addAutoImports() {}, addPlugin() {}, addVitePlugin: (plugin) => vite.push(plugin), addPublicFile() {}, addHead() {}, warn: (message) => warnings.push(message) })
	await ui.setup({}, context(false, '/consumer'))
	assert.ok(!stylesheets.some((file) => /main\.css$/.test(file)), 'the app compiles the entry of UI')
	const pending = vite.filter((plugin) => typeof plugin.then === 'function')
	assert.equal(pending.length, 1, 'one entry of plugins for Tailwind')
	assert.ok(!vite.some((plugin) => typeof plugin.name === 'string' && plugin.name.startsWith('@tailwindcss/')), 'nothing of Tailwind is loaded during setup')
	const plugins = await pending[0]
	assert.deepEqual(
		plugins.map((plugin) => plugin.name),
		['@tailwindcss/vite:scan', '@tailwindcss/vite:generate:serve', '@tailwindcss/vite:generate:build'],
	)
	assert.notEqual((await pending[0])[0], plugins[0], 'each configuration of Vite gets its own instances')
	assert.deepEqual(warnings, [], 'only meeko dev warns')
	await ui.setup({}, context(true, '/consumer'))
	assert.match(warnings[0], /app\/styles\/main\.css no importa @meekojs\/ui/)
})

test('the plugins of Tailwind step aside when the configuration of Vite already has another instance', () => {
	const calls = []
	const original = [
		{ name: '@tailwindcss/vite:scan', enforce: 'pre', configResolved: (config) => calls.push(config) },
		{ name: '@tailwindcss/vite:generate:serve', apply: 'serve', enforce: 'pre', transform: { filter: { id: /\.css$/ }, handler: () => 'compiled' } },
	]
	const plugins = guardTailwind(original)
	assert.deepEqual(
		plugins.map(({ name, enforce, apply }) => ({ name, enforce, apply })),
		original.map(({ name, enforce, apply }) => ({ name, enforce, apply })),
	)
	assert.equal(plugins[1].transform.filter, original[1].transform.filter)
	const alone = { plugins: [{ name: 'vite:css' }, ...plugins] }
	plugins[0].configResolved(alone)
	assert.deepEqual(calls, [alone])
	assert.equal(plugins[1].transform.handler('a {}', 'main.css'), 'compiled')
	const twice = { plugins: [{ name: '@tailwindcss/vite:scan' }, { name: '@tailwindcss/vite:generate:serve' }, ...plugins] }
	plugins[0].configResolved(twice)
	assert.deepEqual(calls, [alone], 'the other instance resolves its configuration')
	assert.equal(plugins[1].transform.handler('a {}', 'main.css'), undefined, 'and compiles the sheet alone')
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
	for (const radius of ['full', 'md']) {
		const values = new Map()
		configPlugin.setup({ provide: (key, value) => values.set(key, value) }, { link: { radius } })
		createRoot((dispose) => {
			for (const [key, value] of values) provide(key, value)
			assert.equal(uiDefaults().link.radius, radius)
			dispose()
		})
	}
})

test('UI module configuration and action variants have checked public types', () => {
	const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
	execFileSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--module', 'nodenext', '--target', 'es2022', fileURLToPath(new URL('./types/ui-options.ts', import.meta.url))], { stdio: 'pipe' })
})
