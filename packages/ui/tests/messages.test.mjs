import { createRoot, provide } from '@meekojs/meeko'
import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import messagesPlugin from '../dist/app/plugins/messages.js'
import { resolveUIMessages, uiMessages, uiMessagesKey } from '../dist/app/utils/messages.js'
import { themeToggleGroupLabel, themeToggleItems, themeToggleStatus } from '../dist/app/utils/theme-toggle.js'
import ui from '../dist/index.js'
import { validateOptions } from '../dist/options.js'

const i18nKey = Symbol.for('meeko.i18n')
const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const i18nRoot = fileURLToPath(new URL('../../i18n', import.meta.url))
const cli = fileURLToPath(new URL('../../meeko/dist/cli.js', import.meta.url))
// `meeko build` checks the types of the application, which name vite/client.
const viteRoot = fileURLToPath(new URL('../../meeko/node_modules/vite', import.meta.url))

const inRoot = (values, read) =>
	createRoot((dispose) => {
		for (const [key, value] of values) provide(key, value)
		const result = read()
		dispose()
		return result
	})

test('without i18n or configuration the components keep their Spanish texts', () => {
	const messages = inRoot([], uiMessages)
	assert.equal(messages.locale, 'es')
	assert.equal(messages.modal.close, 'Cerrar modal')
	assert.equal(messages.table.empty, 'No hay datos.')
	assert.deepEqual(messages.select, { empty: 'Sin resultados', clear: 'Quitar selección' })
	assert.equal(messages.themeToggle.labels.dark, 'Oscuro')
	assert.equal(messages.themeToggle.cycle, 'Tema: {current}. Cambiar a {next}')
})

test('the locale of @meekojs/i18n wins over ui.locale, which applies without that module', () => {
	assert.equal(inRoot([[i18nKey, { locale: 'en' }]], uiMessages).table.empty, 'No data.')
	assert.equal(inRoot([[i18nKey, { locale: 'es' }]], uiMessages).table.empty, 'No hay datos.')
	assert.equal(inRoot([[uiMessagesKey, { locale: 'en' }]], uiMessages).modal.close, 'Close modal')
	const both = [
		[i18nKey, { locale: 'es' }],
		[uiMessagesKey, { locale: 'en' }],
	]
	assert.equal(inRoot(both, uiMessages).modal.close, 'Cerrar modal')
})

test('a locale without texts falls back to its base language, ui.locale and Spanish', () => {
	assert.equal(resolveUIMessages('en-GB').select.clear, 'Clear selection')
	assert.equal(resolveUIMessages('en-GB').locale, 'en-GB')
	assert.equal(resolveUIMessages('ar').table.empty, 'No hay datos.')
	assert.equal(resolveUIMessages('ar', { locale: 'en' }).table.empty, 'No data.')
	// A name of Object.prototype is not a language.
	assert.equal(resolveUIMessages('constructor').table.empty, 'No hay datos.')
})

test('a locale is read in its canonical form, and an invalid one counts as absent', () => {
	assert.equal(resolveUIMessages(undefined, { locale: 'EN' }).table.empty, 'No data.')
	assert.equal(resolveUIMessages(undefined, { locale: 'EN' }).locale, 'en')
	assert.equal(resolveUIMessages('EN-gb').select.clear, 'Clear selection')
	assert.equal(resolveUIMessages('EN-gb').locale, 'en-GB')
	assert.equal(resolveUIMessages('pt-br', { messages: { 'pt-BR': { table: { empty: 'Sem dados.' } } } }).table.empty, 'Sem dados.')
	// `en-u` passes a regular expression, but `Intl` rejects it: the fallback answers instead.
	assert.equal(resolveUIMessages('en-u').locale, 'es')
	assert.equal(resolveUIMessages('en-u', { locale: 'en' }).locale, 'en')
	assert.equal(resolveUIMessages(undefined, { locale: 'en-u' }).locale, 'es')
	// The locale of a document with an invalid tag reaches the provider of useI18n() as it is.
	assert.equal(inRoot([[i18nKey, { locale: 'en-u' }]], uiMessages).locale, 'es')
})

test('UIThemeToggle never throws because of a locale', () => {
	const toggle = {
		choices: ['light', 'dark', 'system'],
		system: undefined,
		theme: { theme: { value: 'dark' }, resolved: { value: 'dark' } },
		known: { value: true },
		interactive: { value: false },
	}
	const { themeToggle: text } = resolveUIMessages('en')
	const items = themeToggleItems(toggle, { text })
	for (const locale of ['en-u', 'not a locale', '', 'EN', undefined]) {
		assert.equal(themeToggleStatus(toggle, items, { text, locale }).label, 'Theme: dark. Switch to system', String(locale))
	}
})

test('ui.messages overrides a text or adds a language, and what it lacks is inherited', () => {
	const config = {
		messages: {
			en: { table: { empty: 'Nothing here yet.' } },
			fr: { modal: { close: 'Fermer' }, themeToggle: { labels: { dark: 'Sombre' } } },
			'pt-BR': { select: { clear: 'Limpar' } },
			pt: { select: { clear: 'Limpar seleção', empty: 'Sem resultados' } },
		},
	}
	const en = resolveUIMessages('en', config)
	assert.equal(en.table.empty, 'Nothing here yet.')
	assert.equal(en.modal.close, 'Close modal')
	const fr = resolveUIMessages('fr', config)
	assert.equal(fr.modal.close, 'Fermer')
	assert.equal(fr.table.empty, 'No hay datos.')
	assert.deepEqual(fr.themeToggle.labels, { light: 'Claro', dark: 'Sombre', system: 'Sistema' })
	assert.deepEqual(resolveUIMessages('pt-BR', config).select, { clear: 'Limpar', empty: 'Sem resultados' })
	// The texts of the fallback locale reach the languages that do not have them.
	assert.equal(resolveUIMessages('fr', { ...config, locale: 'en' }).table.empty, 'Nothing here yet.')
	assert.equal(resolveUIMessages(undefined, { locale: 'fr', ...config }).modal.close, 'Fermer')
})

test('UIThemeToggle reads its texts from the locale, and its props win over them', () => {
	const toggle = {
		choices: ['light', 'dark', 'system'],
		system: undefined,
		theme: { theme: { value: 'dark' }, resolved: { value: 'dark' } },
		known: { value: true },
		interactive: { value: false },
	}
	const { themeToggle: text, locale } = resolveUIMessages('en')
	const items = themeToggleItems(toggle, { text })
	assert.deepEqual(
		items.map((item) => item.label),
		['Light', 'Dark', 'System'],
	)
	assert.equal(themeToggleStatus(toggle, items, { text, locale }).label, 'Theme: dark. Switch to system')
	assert.equal(themeToggleStatus({ ...toggle, known: { value: false } }, items, { text, locale }).label, 'Change theme')
	assert.equal(themeToggleGroupLabel(undefined, text), 'Theme')
	assert.equal(themeToggleItems(toggle, { text, labels: { dark: 'Night' } })[1].label, 'Night')
	assert.equal(themeToggleStatus(toggle, items, { text, locale, labels: { dark: 'Night' } }).label, 'Theme: night. Switch to system')
	assert.equal(themeToggleStatus(toggle, items, { text, locale, messages: { cycle: (current, next) => `${current} → ${next}` } }).label, 'Dark → System')
	assert.equal(themeToggleStatus({ ...toggle, known: { value: false } }, items, { text, locale, messages: { unknown: 'Pick' } }).label, 'Pick')
	assert.equal(themeToggleGroupLabel({ group: 'Look' }, text), 'Look')
	// A replacement value is text, not a pattern of String.replace.
	assert.equal(themeToggleStatus(toggle, items, { text, labels: { dark: '$&' } }).label, 'Theme: $&. Switch to system')
})

test('the module options are validated and only installed when they are given', () => {
	assert.doesNotThrow(() => validateOptions({ locale: 'pt-BR', messages: { en: { table: { empty: 'None' } }, 'pt-BR': { themeToggle: { labels: { sepia: 'Sépia' }, cycle: '{current} → {next}' } } } }))
	for (const options of [
		{ locale: 'not a locale' },
		{ locale: 7 },
		{ locale: 'en-u' },
		{ messages: [] },
		{ messages: { __proto__: null, 'not a locale': {} } },
		{ messages: { 'en-u': {} } },
		// One language written twice: only one of them could win.
		{ messages: { en: {}, EN: {} } },
		{ messages: { en: 'text' } },
		{ messages: { en: { toast: { close: 'x' } } } },
		{ messages: { en: { table: { title: 'x' } } } },
		{ messages: { en: { table: { empty: '' } } } },
		{ messages: { en: { table: { empty: 7 } } } },
		{ messages: { en: { themeToggle: { labels: { dark: ' ' } } } } },
		// A function does not survive the serialization to the client.
		{ messages: { en: { themeToggle: { cycle: () => 'x' } } } },
	]) {
		assert.throws(() => validateOptions(options), /ui:/, JSON.stringify(options))
	}
	const setup = (options) => {
		const plugins = []
		ui.setup(options, {
			rootDir: '/consumer',
			addComponentsDir() {},
			addStylesheet() {},
			addAutoImports() {},
			addPlugin: (plugin) => plugins.push(plugin),
			addVitePlugin() {},
			addPublicFile() {},
			addHead() {},
		})
		return plugins.filter((plugin) => /plugins\/messages\.js$/.test(String(plugin.src ?? plugin)))
	}
	assert.deepEqual(setup({}), [])
	assert.deepEqual(setup({ defaults: { link: { shape: 'pill' } } }), [])
	assert.deepEqual(setup({ locale: 'en' })[0].options, { locale: 'en' })
	assert.deepEqual(setup({ messages: { fr: { modal: { close: 'Fermer' } } } })[0].options, { messages: { fr: { modal: { close: 'Fermer' } } } })
	// The components find the texts by the canonical tag, however the configuration writes it.
	assert.deepEqual(setup({ locale: 'EN', messages: { 'pt-br': { modal: { close: 'Fechar' } } } })[0].options, { locale: 'en', messages: { 'pt-BR': { modal: { close: 'Fechar' } } } })
	const provided = new Map()
	messagesPlugin.setup({ provide: (key, value) => provided.set(key, value) }, { locale: 'en' })
	assert.equal(inRoot([...provided], uiMessages).table.empty, 'No data.')
})

test('the public types of ui.messages and of UILinkCard are checked', () => {
	const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
	execFileSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--module', 'nodenext', '--target', 'es2022', fileURLToPath(new URL('./types/messages.ts', import.meta.url))], { stdio: 'pipe' })
})

// What a real application renders, without JavaScript: the Spanish of today, `ui.locale` and
// `ui.messages`, the locale of @meekojs/i18n in /en/…, and the props and snippets over all of them.
const page = `<script lang="ts">
	const opened = signal(true)
	const value = signal<string | null>('a')
	const columns = [{ key: 'name' as const, label: 'Name' }]
	const rows: { name: string }[] = []
</script>
<template>
	<UITable bind:columns="columns" bind:rows="rows" rowKey="name" />
	<UITable bind:columns="columns" bind:rows="rows" rowKey="name" emptyText="From the prop" />
	<UITable bind:columns="columns" bind:rows="rows" rowKey="name"><snippet name="empty">From the snippet</snippet></UITable>
	<UISelect model="value" bind:options="['a']" clearable />
	<UISelect model="value" bind:options="['a']" clearable clearLabel="Clear from the prop" />
	<UIModal title="Dialog" model="opened"><p>Body</p></UIModal>
	<UIModal title="Dialog" model="opened" closeLabel="Close from the prop"><p>Body</p></UIModal>
	<UIThemeToggle />
	<UIThemeToggle icons />
	<UIThemeToggle mode="select" bind:labels="{ dark: 'Night' }" />
	<UILinkCard to="/about" title="To" />
	<UILinkCard to="/about" hreflang="es" title="Other language" />
	<UILinkCard to="/about" bind:resolve="false" title="As written" />
	<UILinkCard href="/about" title="Href" />
	<UILinkCard to="/users/[id]" bind:params="{ id: '7' }" bind:search="{ tab: 'a' }" target="_blank" class="wide" data-testid="user" title="Dynamic" description="With params" />
</template>
`

const prerender = (options = '') => `import { definePage } from '@meekojs/meeko/framework'\nexport const route = definePage({ render: 'prerender'${options} })\n`

/** Prerenders an application with the given config, without a server; returns the HTML of each path. */
async function renderApp(context, name, config, links, paths) {
	const parent = join(packageRoot, '.meeko')
	await mkdir(parent, { recursive: true })
	const root = await mkdtemp(join(parent, `messages-${name}-`))
	const linkPaths = Object.keys(links).map((target) => join(root, 'node_modules', target))
	// The links go first, so removing the application never walks into the packages.
	context.after(async () => {
		for (const link of linkPaths) await unlink(link).catch(() => undefined)
		await rm(root, { recursive: true, force: true })
	})
	const files = {
		'package.json': JSON.stringify({ name: `messages-${name}`, private: true, type: 'module' }),
		'meeko.config.mjs': `export default ${JSON.stringify({ ...config, server: { adapter: 'static' } })}\n`,
		'app/app.meeko': '<template><MeekoOutlet /></template>\n',
		'app/pages/index.meeko': page,
		'app/pages/index.route.ts': prerender(),
		'app/pages/about.meeko': '<template><p>About</p></template>\n',
		'app/pages/about.route.ts': prerender(),
		'app/pages/users/[id].meeko': '<template><p>User</p></template>\n',
		'app/pages/users/[id].route.ts': prerender(", prerenderEntries: [{ id: '7' }]"),
		'app/locales/es.json': '{"hello":"Hola"}',
		'app/locales/en.json': '{"hello":"Hello"}',
	}
	for (const [file, source] of Object.entries(files)) {
		await mkdir(dirname(join(root, file)), { recursive: true })
		await writeFile(join(root, file), source)
	}
	for (const [target, source] of Object.entries(links)) {
		await mkdir(dirname(join(root, 'node_modules', target)), { recursive: true })
		await symlink(source, join(root, 'node_modules', target), 'junction')
	}
	await promisify(execFile)(process.execPath, [cli, 'build', root], { cwd: root, windowsHide: true, timeout: 120_000, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } })
	const pages = {}
	for (const path of paths) pages[path] = (await readFile(join(root, '.meeko', 'output', 'static', ...path.split('/').filter(Boolean), 'index.html'), 'utf8')).replace(/<!--.*?-->/g, '')
	return pages
}

const ariaLabels = (html) => [...html.matchAll(/aria-label="([^"]*)"/g)].map((match) => match[1])
const cards = (html) => [...html.matchAll(/<a\b[^>]*class="meeko-ui-link-card[^"]*"[^>]*>/g)].map((match) => match[0])
const attribute = (tag, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1]

/** The props and the snippets win in every locale. */
function assertOverrides(html) {
	assert.ok(html.includes('From the prop'), 'emptyText')
	assert.ok(html.includes('From the snippet'), 'the empty snippet')
	assert.ok(ariaLabels(html).includes('Clear from the prop'), 'clearLabel')
	assert.ok(ariaLabels(html).includes('Close from the prop'), 'closeLabel')
	assert.ok(html.includes('Night'), 'the labels of UIThemeToggle')
	assert.match(html, /data-meeko-theme-icon="dark"[^>]*>\s*<svg[^>]*class="meeko-ui-icon"/, 'UIThemeToggle icons paints the icon')
}

function assertApp(html, { empty, clear, close, unknown, group, light }) {
	assert.ok(html.includes(`<span>${empty}</span>`), `the empty table says ${empty}`)
	const labels = ariaLabels(html)
	for (const label of [clear, close, unknown, group]) assert.ok(labels.includes(label), `aria-label ${label} in ${JSON.stringify(labels)}`)
	assert.ok(html.includes(light), `the label ${light}`)
	assertOverrides(html)
}

const spanish = { empty: 'No hay datos.', clear: 'Quitar selección', close: 'Cerrar modal', unknown: 'Cambiar tema', group: 'Tema', light: 'Claro' }
const english = { empty: 'No data.', clear: 'Clear selection', close: 'Close modal', unknown: 'Change theme', group: 'Theme', light: 'Light' }

test('SSR without i18n renders Spanish by default, and ui.locale and ui.messages change it', { timeout: 300_000 }, async (context) => {
	const links = { '@meekojs/ui': packageRoot, vite: viteRoot }
	const byDefault = await renderApp(context, 'default', { modules: ['@meekojs/ui'], theme: true }, links, ['/'])
	assertApp(byDefault['/'], spanish)
	const configured = await renderApp(context, 'configured', { modules: ['@meekojs/ui'], theme: true, ui: { locale: 'en', messages: { en: { table: { empty: 'Nothing here yet.' } } } } }, links, ['/'])
	assertApp(configured['/'], { ...english, empty: 'Nothing here yet.' })
})

test('SSR with i18n follows the locale of the URL, and UILinkCard to behaves as UILink to', { timeout: 300_000 }, async (context) => {
	const pages = await renderApp(context, 'i18n', { modules: ['@meekojs/ui', '@meekojs/i18n'], theme: true, ui: { locale: 'en' }, i18n: { defaultLocale: 'es', catalogs: { es: 'app/locales/es.json', en: 'app/locales/en.json' } } }, { '@meekojs/ui': packageRoot, '@meekojs/i18n': i18nRoot, vite: viteRoot }, ['/', '/en'])
	// The document's locale wins over ui.locale, in both directions.
	assertApp(pages['/'], spanish)
	assertApp(pages['/en'], english)
	const hrefs = (html) => cards(html).map((tag) => attribute(tag, 'href'))
	assert.deepEqual(hrefs(pages['/']), ['/about', '/about', '/about', '/about', '/users/7?tab=a'])
	assert.deepEqual(hrefs(pages['/en']), ['/en/about', '/about', '/about', '/about', '/en/users/7?tab=a'])
	const [, foreign, , , user] = cards(pages['/en'])
	assert.equal(attribute(foreign, 'hreflang'), 'es')
	assert.equal(attribute(user, 'target'), '_blank')
	assert.equal(attribute(user, 'rel'), 'noopener noreferrer')
	assert.equal(attribute(user, 'data-testid'), 'user')
	assert.match(attribute(user, 'class'), /^meeko-ui-link-card wide/)
	// `title` is the text of the card, not an attribute of the link.
	assert.equal(attribute(user, 'title'), undefined)
	assert.ok(pages['/en'].includes('<strong class="meeko-ui-link-card-title">Dynamic</strong>'))
	assert.ok(pages['/en'].includes('With params'))
})
