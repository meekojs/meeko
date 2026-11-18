import assert from 'node:assert/strict'
import { execFile, execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { discoverComponents } from '../../meeko/dist/autoimports/registry.js'
import { builtinMessages, fillMessage, resolveUIMessages } from '../dist/app/utils/messages.js'
import { isCurrentLink } from '../dist/app/utils/navigation.js'
import { validateOptions } from '../dist/options.js'
import { cli, createNavigationApp } from './helpers/navigation-app.mjs'

const components = ['Header', 'Footer', 'Page', 'PageHeader', 'NavigationTree', 'Drawer', 'NavigationTabs', 'Breadcrumb', 'PageNavigation', 'Pagination', 'TableOfContents', 'LocaleSwitcher', 'LocaleSuggestion', 'CodeBlock', 'Prose', 'Diff']

/** The opening tag of the first element whose attributes match. */
function tag(html, pattern) {
	const found = [...html.matchAll(/<[a-z][^>]*>/g)].map(([value]) => value).find((value) => pattern.test(value))
	assert.ok(found, `no tag matches ${pattern}`)
	return found
}
const attribute = (markup, name) => new RegExp(`\\s${name}="([^"]*)"`).exec(markup)?.[1]
const count = (html, pattern) => [...html.matchAll(pattern)].length
/** The block of a class, up to its closing tag: enough for the components that do not nest themselves. */
function block(html, start, end) {
	const from = html.indexOf(start)
	assert.notEqual(from, -1, `no ${start}`)
	return html.slice(from, html.indexOf(end, from) + end.length)
}

/** The markup without the hydration marks and the formatting whitespace of the templates. */
const clean = (html) =>
	html
		.replace(/<!--.*?-->/g, '')
		.replace(/ data-meeko="[^"]*"/g, '')
		.replace(/>\s+/g, '>')
		.replace(/\s+</g, '<')

let pages
const render = async (context) => {
	if (pages) return pages
	const root = await createNavigationApp(context)
	await promisify(execFile)(process.execPath, [cli, 'build', root], { cwd: root, windowsHide: true, timeout: 240_000, env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=8192' } })
	const read = async (...path) => clean(await readFile(join(root, '.meeko', 'output', 'static', ...path, 'index.html'), 'utf8'))
	pages = { es: await read(), en: await read('en'), dashboard: await read('dashboard'), landing: await read('landing'), child: await read('dashboard', 'child') }
	return pages
}

test('the navigation components render on the server with their semantics', { timeout: 300_000 }, async (t) => {
	const { es, en, dashboard, landing, child } = await render(t)

	await t.test('UIPage: one main, focusable, with its skip link, in every layout', () => {
		assert.equal(count(es, /<main\b/g), 1)
		// The wrapper of the notices is the one that hides when it is empty.
		assert.ok(block(es, 'ui:not-has-[*]:hidden', '</section>').includes('Aviso de la página'), 'the notices have their place under the header')
		assert.ok(!landing.includes('ui:not-has-[*]:hidden'), 'without the snippet there is no wrapper')
		const main = tag(es, /<main\b/)
		assert.equal(attribute(main, 'id'), 'contenido')
		assert.equal(attribute(main, 'tabindex'), '-1')
		// The skip link is the first link of the page, fixed off the screen.
		const skip = /<a\b[^>]*class="ui:fixed /
		assert.equal(attribute(tag(es, skip), 'href'), '#contenido')
		assert.ok(es.includes('Saltar al contenido'))
		assert.ok(en.includes('Skip to content'), 'the skip link follows the locale of the document')
		// The layout sets the padding of <main>: 10 and 20 for docs, 8 and 12 for a dashboard, none for a landing page.
		assert.match(tag(es, /<main\b/), /ui:pt-10 ui:pb-20/)
		const custom = tag(dashboard, /class="ui:group\/page /)
		assert.equal(attribute(custom, 'lang'), 'es')
		const customMain = tag(dashboard, /<main\b/)
		assert.equal(attribute(customMain, 'id'), 'principal')
		assert.equal(attribute(customMain, 'lang'), 'en')
		assert.match(customMain, /ui:pt-8 ui:pb-12/)
		assert.equal(attribute(tag(dashboard, skip), 'href'), '#principal')
		assert.ok(dashboard.includes('Ir al panel'))
		assert.match(tag(landing, /<main\b/), /ui:pt-0 ui:pb-0/)
		// The sidebar hides below `sidebar`, where the bar shows.
		assert.equal(count(dashboard, /<aside\b|ui:max-sidebar:hidden|ui:max-sidebar:sticky/g), 0, 'a zone without its snippet paints nothing')
		for (const html of [es, dashboard, landing]) assert.equal(count(html, /<h1\b/g), 1)
	})

	await t.test('UIPageHeader: title, description, breadcrumb and actions', () => {
		const pageHeader = '<header class="ui:grid ui:gap-4 '
		const header = block(es, pageHeader, '</header>')
		assert.match(header, /<h1[^>]*><span>Navegación<\/span><\/h1>/)
		assert.ok(header.includes('Todos los componentes de navegación juntos.'))
		assert.ok(header.includes('aria-label="Ruta de navegación"'))
		assert.ok(header.includes('Editar'))
		assert.match(block(dashboard, pageHeader, '</header>'), /^<header class="[^"]*ui:mb-6 ui:pb-0/, 'a dashboard header has no border')
		const landingHeader = block(landing, pageHeader, '</header>')
		assert.equal(attribute(tag(landingHeader, /<h1\b/), 'id'), 'portada')
		assert.match(landingHeader, /Portada<code>\.meeko<\/code>/)
	})

	await t.test('UIHeader: a compact brand hides its name on a narrow phone, without a product', () => {
		const header = block(landing, '<header', '</header>')
		// The brand is the first link of the bar.
		assert.equal(attribute(tag(header, /<a\b/), 'aria-label'), 'Meeko, inicio')
		assert.match(header, /<span class="[^"]*ui:max-phone:hidden[^"]*"[^>]*>Meeko<\/span>/)
		assert.doesNotMatch(block(es, '<header', '</header>'), /<span(?![^>]*ui:max-phone:hidden)[^>]*>Meeko<\/span>\s*<strong/, 'a product still has its hidden name')
	})

	await t.test('UIHeader: brand, links with to and href, current page and a native menu', () => {
		const header = block(es, '<header', '</header>')
		const brand = tag(header, /<a\b/)
		assert.equal(attribute(brand, 'href'), '/')
		assert.equal(attribute(brand, 'aria-label'), 'Meeko UI: inicio')
		const logo = tag(header, /<img/)
		assert.equal(attribute(logo, 'width'), '24')
		assert.equal(attribute(logo, 'height'), '24')
		assert.equal(attribute(logo, 'alt'), '')
		const nav = block(header, '<nav', '</nav>')
		assert.deepEqual(
			[...nav.matchAll(/href="([^"]*)"/g)].map((match) => match[1]),
			['/', '/about', '/users/7?tab=a', 'https://github.com/meekojs/meeko'],
		)
		assert.equal(attribute(tag(nav, /href="\/"/), 'aria-current'), 'page')
		assert.equal(attribute(tag(nav, /href="\/about"/), 'aria-current'), undefined)
		assert.equal(attribute(tag(nav, /github/), 'rel'), 'noopener noreferrer')
		const toggle = tag(header, /popovertarget=/)
		const menu = tag(header, /popover="auto"/)
		assert.equal(attribute(toggle, 'popovertarget'), attribute(menu, 'id'))
		assert.equal(attribute(menu, 'popover'), 'auto')
		assert.equal(attribute(toggle, 'aria-label'), 'Menú')
		assert.equal(attribute(tag(en, /popovertarget=/), 'aria-label'), 'Menu')
	})

	await t.test('a link with to goes through the link resolvers: with i18n it points to the locale of the document', () => {
		const nav = block(block(en, '<header', '</header>'), '<nav', '</nav>')
		assert.deepEqual(
			[...nav.matchAll(/href="([^"]*)"/g)].map((match) => match[1]),
			['/en', '/en/about', '/en/users/7?tab=a', 'https://github.com/meekojs/meeko'],
		)
		const pager = block(en, 'aria-label="Previous and next pages"', '</nav>')
		assert.match(pager, /href="\/en\/about"/)
	})

	await t.test('UIFooter: brand, description, groups, links and legal', () => {
		const footer = block(es, '<footer data-pagefind-ignore', '</footer>')
		assert.ok(footer.includes('Componentes tipados para Meeko.'))
		assert.match(footer, /<p class="[^"]*">Recursos<\/p>/)
		assert.match(footer, /href="\/about"/)
		assert.match(footer, /href="\/license"/)
		assert.ok(footer.includes('MIT'))
		assert.equal(attribute(tag(footer, /<nav\b/), 'aria-label'), 'Enlaces del pie')
	})

	await t.test('UINavigationTree: native details, current, code, icon, featured and an empty state', () => {
		const tree = block(es, 'aria-label="Documentación"', '</nav>')
		assert.equal(count(tree, /<details/g), 3)
		assert.equal(count(tree, /<summary/g), 3)
		assert.ok(tag(tree, /<details/).includes(' open'), 'open by default')
		assert.equal(attribute(tag(tree, /aria-current="/), 'href'), '/current-page')
		assert.match(tree, /<span class="[^"]*ui:font-mono[^"]*"/, 'code goes in monospace')
		assert.ok(tree.includes('Destacado'))
		assert.match(tree, /<path d="M2\.5 4\.5h11M2\.5 8h11M2\.5 11\.5h7"/)
		const closed = [...tree.matchAll(/<details[^>]*>/g)].map(([value]) => value)
		assert.equal(closed.filter((value) => /\sopen/.test(value)).length, 2, 'open: false folds a group, unless it holds the current link')
		const flat = block(landing, 'aria-label="Navegación de la sección"', '</nav>')
		assert.equal(count(flat, /<details|<summary/g), 0, 'not collapsible, without a title')
		assert.ok(block(dashboard, 'aria-label="Navegación de la sección"', '</nav>').includes('Sin resultados'), 'no groups')
		assert.equal(count(dashboard, /role="status"/g), 1)
	})

	await t.test('UIDrawer: a closed native dialog that a button opens without a script', () => {
		const dialog = tag(es, /<dialog/)
		assert.equal(attribute(dialog, 'id'), 'menu')
		assert.equal(attribute(dialog, 'closedby'), 'any')
		assert.equal(attribute(dialog, 'data-side'), undefined, 'the side is in its classes')
		assert.match(attribute(dialog, 'class'), /ui:start-0/)
		assert.equal(attribute(dialog, 'aria-labelledby'), 'menu-title')
		assert.doesNotMatch(dialog, /\sopen/)
		const trigger = tag(es, /command="show-modal"/)
		assert.equal(attribute(trigger, 'command'), 'show-modal')
		assert.equal(attribute(trigger, 'commandfor'), 'menu')
		const close = tag(es, /command="close"/)
		assert.equal(attribute(close, 'command'), 'close')
		assert.equal(attribute(close, 'commandfor'), 'menu')
		assert.equal(attribute(close, 'aria-label'), 'Cerrar panel')
		assert.equal(attribute(tag(en, /command="close"/), 'aria-label'), 'Close panel')
	})

	await t.test('UINavigationTabs: links with aria-current, not a tablist', () => {
		const tabs = block(es, 'aria-label="Vistas"', '</nav>')
		assert.equal(count(tabs, /role="tab/g), 0)
		assert.equal(attribute(tag(tabs, /aria-current="/), 'href'), '#one')
		assert.match(tabs, /href="\/about"/)
		assert.match(tabs, /<span aria-hidden="true" class="[^"]*position-anchor/, 'the indicator')
		assert.match(tag(es, /aria-label="Vistas"/), /^<nav\b/)
		const section = block(child, '<nav', '</nav>')
		assert.equal(count(section, /aria-current="/g), 1, 'match: prefix marks the section of a child route')
		assert.ok(attribute(tag(section, /href="\/dashboard"/), 'aria-current'))
		assert.equal(attribute(tag(tabs, /users\/7/), 'aria-current'), undefined, 'match: prefix does not mark a route outside it')
		assert.equal(attribute(tag(es, /aria-label="Vistas"/), 'data-variant'), undefined, 'the variant is in its classes')
		const filter = block(es, 'aria-label="Filtro"', '</nav>')
		assert.ok(!filter.includes('position-anchor'), 'a segmented row has no indicator: its View Transition name never repeats')
		assert.equal(attribute(tag(filter, /aria-current="/), 'href'), '#todas')
		assert.match(filter, /Activas<span[^>]*class="[^"]*ui:bg-success-soft[^"]*"/, 'the counter is a badge next to the text')
		assert.match(filter, /<span(?=[^>]*aria-hidden="true")[^>]*class="[^"]*ui:bg-current/)
	})

	await t.test('a link with to: its own current wins over the route, and without it the route decides', () => {
		const row = block(es, 'aria-label="Estados"', '</nav>')
		const links = [...row.matchAll(/<a\b[^>]*>/g)].map((match) => [attribute(match[0], 'href'), attribute(match[0], 'aria-current')])
		assert.deepEqual(links, [
			['/about', 'page'],
			['/', undefined],
			['/', 'page'],
			['/about', undefined],
		])
		assert.doesNotMatch(row, /aria-current="[^"]*"[^>]*aria-current=/, 'one attribute per link')
	})

	await t.test('UIBreadcrumb: an ordered list whose last step is the current page', () => {
		const crumb = block(es, 'aria-label="Ruta de navegación"', '</nav>')
		assert.match(crumb, /<ol\b/)
		assert.equal(count(crumb, /<li\b/g), 3)
		assert.equal(count(crumb, /<a\b/g), 2)
		assert.match(crumb, /<span aria-current="page"[^>]*>useSignal<\/span>/)
		assert.match(tag(es, /aria-label="Ruta de navegación"/), /^<nav\b/)
	})

	await t.test('UIPageNavigation: previous and next, or nothing', () => {
		const pager = block(es, 'aria-label="Páginas anterior y siguiente"', '</nav>')
		assert.equal(attribute(tag(pager, /rel="prev"/), 'href'), '/')
		assert.equal(attribute(tag(pager, /rel="next"/), 'href'), '/about')
		assert.ok(pager.includes('Anterior'))
		assert.ok(block(en, 'aria-label="Previous and next pages"', '</nav>').includes('Previous'))
		assert.doesNotMatch(dashboard, /Páginas anterior y siguiente/)
	})

	await t.test('UIPagination: count, action, a link, and formatted numbers', () => {
		const [first, second] = es.split('aria-label="Paginación"').slice(1)
		assert.ok(first.includes('2 de 5'))
		assert.ok(first.includes('Cargar más'))
		assert.ok(second.includes('1200 en total') || second.includes('1.200 en total') || second.includes('1 200 en total'))
		assert.ok(second.includes('Siguiente tanda'))
		assert.match(second, /<a\b[^>]*href="\/about"/)
		assert.ok(en.includes('2 of 5'))
		assert.ok(en.includes('1,200 in total'))
		assert.ok(en.includes('Load more'))
	})

	await t.test('UITableOfContents: links without a script, in both views, or nothing', () => {
		// The aside is the <nav> that the page search ignores; the collapsible view puts that on its <details>.
		const asideTag = tag(es, /<nav\b(?=[^>]*data-pagefind-ignore)(?=[^>]*aria-label="En esta página")/)
		const aside = block(es, asideTag, '</nav>')
		assert.deepEqual(
			[...aside.matchAll(/href="([^"]*)"/g)].map((match) => match[1]),
			['#uno', '#dos', '#dos-a', '#tres'],
		)
		assert.match(attribute(tag(aside, /href="#dos-a"/), 'class'), /ui:ps-6/, 'a level 3 entry is indented')
		assert.match(attribute(asideTag, 'class'), /\[scroll-target-group:auto\]/, 'the browser follows the active entry')
		assert.ok(block(es, '<details data-pagefind-ignore', '</summary>').includes('En esta página'))
		assert.ok(en.includes('On this page'))
		assert.doesNotMatch(dashboard, /En esta página/)
	})

	await t.test('UILocaleSwitcher: real links in each language, nothing with a single one', () => {
		const switcher = block(es, 'aria-label="Idioma"', '</nav>')
		const english = tag(switcher, /hreflang="en"/)
		assert.equal(attribute(english, 'href'), '/en')
		assert.equal(attribute(english, 'lang'), 'en')
		assert.equal(attribute(english, 'title'), 'English')
		assert.equal(attribute(tag(switcher, /hreflang="es"/), 'aria-current'), 'page')
		assert.match(switcher, /<span aria-hidden="true">EN<\/span>/)
		assert.match(switcher, /<span class="meeko-ui-sr-only">English<\/span>/)
		assert.match(tag(es, /aria-label="Idioma"/), /^<nav\b/)
		assert.doesNotMatch(dashboard, /aria-label="Idioma"/)
	})

	await t.test('UICodeBlock: label, language, verdict, highlighted HTML, log, and a copy button that waits for the script', () => {
		const blocks = es
			.split('<figure')
			.slice(1)
			.map((value) => value.slice(0, value.indexOf('</figure>')))
		assert.equal(blocks.length, 4)
		const [plain, highlighted, bad, log] = blocks
		assert.ok(plain.includes('Instalación'))
		assert.equal(attribute(tag(plain, /meeko-ui-code-label/), 'lang'), 'es')
		assert.equal(attribute(tag(plain, /meeko-ui-code-copy/), 'lang'), 'es')
		assert.equal(attribute(tag(plain, /meeko-ui-code-copy/), 'aria-label'), 'Copiar el comando')
		assert.ok(plain.includes('sh'))
		assert.match(plain, /<pre[^>]*tabindex="0"[^>]*><code>pnpm add @meekojs\/ui<\/code><\/pre>/)
		assert.ok(plain.includes('Copiar'))
		assert.doesNotMatch(plain, /data-ready/)
		assert.match(highlighted, /data-verdict="good"/)
		assert.ok(highlighted.includes('Correcto'))
		assert.match(highlighted, /class="shiki"/)
		assert.ok(bad.includes('Incorrecto'))
		assert.match(log, /data-mode="log"/)
		assert.match(log, /<pre[^>]*role="log"/)
		assert.match(log, /aria-label="Salida"/)
		assert.doesNotMatch(log, /meeko-ui-code-copy/, 'a log has no copy button by default')
		assert.ok(en.includes('Copy'))
	})

	await t.test('UIProse: a tag of the given name around trusted HTML or its snippet', () => {
		assert.match(es, /<article[^>]*class="meeko-ui-prose"[^>]*id="snapshot"|<article[^>]*id="snapshot"[^>]*class="meeko-ui-prose"/)
		assert.match(es, /class="heading-anchor"/)
		assert.match(es, /class="callout callout-warning"/)
		assert.match(es, /<div[^>]*id="handwritten"/)
		assert.ok(es.includes('Con marcado propio.'))
	})

	await t.test('UIDiff: each line with its kind and its label for a screen reader; an empty state', () => {
		const diff = block(es, 'class="meeko-ui-diff"', '</pre>')
		assert.deepEqual(
			[...diff.matchAll(/data-kind="(\w+)"/g)].map((match) => match[1]),
			['file', 'file', 'hunk', 'context', 'remove', 'add'],
		)
		assert.ok(diff.includes('<span class="meeko-ui-sr-only">Añadido:</span>+después'))
		assert.ok(diff.includes('<span class="meeko-ui-sr-only">Eliminado:</span>-antes'))
		assert.equal(attribute(tag(es, /class="meeko-ui-diff"/), 'aria-label'), 'Cambios en la guía')
		assert.ok(es.includes('Sin cambios.'))
		assert.ok(en.includes('No changes.'))
		assert.ok(en.includes('<span class="meeko-ui-sr-only">Added:</span>+después'))
	})
})

test('the module registers the new components and the internal ones stay private', async () => {
	const root = fileURLToPath(new URL('../../../apps/ui', import.meta.url))
	const found = (await discoverComponents(root)).map(({ name }) => name)
	for (const name of components) assert.ok(found.includes(`UI${name}`), `UI${name}`)
	for (const name of found) assert.doesNotMatch(name, /^UI(Internal|ItemLink|Brand$)/)
})

test('every text of the navigation has Spanish and English, and ui.messages overrides it', () => {
	const sections = ['page', 'header', 'footer', 'drawer', 'navigationTree', 'navigationTabs', 'breadcrumb', 'pageNavigation', 'pagination', 'tableOfContents', 'language', 'code', 'diff']
	for (const section of sections) {
		assert.deepEqual(Object.keys(builtinMessages.en[section]).sort(), Object.keys(builtinMessages.es[section]).sort(), section)
		for (const locale of ['es', 'en']) for (const [key, value] of Object.entries(builtinMessages[locale][section])) assert.ok(value.trim(), `${locale}.${section}.${key}`)
	}
	const overridden = resolveUIMessages('fr', { messages: { fr: { pagination: { loadMore: 'Charger plus' } } } })
	assert.equal(overridden.pagination.loadMore, 'Charger plus')
	assert.equal(overridden.pagination.loading, 'Cargando…', 'what is missing falls back')
	assert.doesNotThrow(() => validateOptions({ messages: { en: { language: { go: 'Go to {language}' }, code: { copy: 'Copy it' } } } }))
	assert.throws(() => validateOptions({ messages: { en: { code: { missing: 'x' } } } }), /unknown message/)
})

test('a link is current by its own flag, its href, its route or an alias', () => {
	assert.equal(isCurrentLink({ href: '/a' }, '/a'), true)
	assert.equal(isCurrentLink({ to: '/a' }, '/a'), true)
	assert.equal(isCurrentLink({ href: '/b', aliases: ['/a'] }, '/a'), true)
	assert.equal(isCurrentLink({ href: '/b' }, '/a'), false)
	assert.equal(isCurrentLink({ href: '/b' }, undefined), false)
	assert.equal(isCurrentLink({ href: '/a', current: false }, '/a'), false)
	assert.equal(isCurrentLink({ href: '/b', current: true }, '/a'), true)
})

test('fillMessage replaces its placeholders and leaves the unknown ones', () => {
	assert.equal(fillMessage('{shown} de {total}', { shown: '2', total: '5' }), '2 de 5')
	assert.equal(fillMessage('{a} {b}', { a: '1' }), '1 {b}')
})

test('the public types of the navigation correlate links, routes and props', () => {
	const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url))
	execFileSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--skipLibCheck', '--allowImportingTsExtensions', '--allowArbitraryExtensions', '--module', 'nodenext', '--target', 'es2022', fileURLToPath(new URL('./types/navigation.ts', import.meta.url))], { stdio: 'pipe' })
})
