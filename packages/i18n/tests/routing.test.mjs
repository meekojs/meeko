import assert from 'node:assert/strict'
import test from 'node:test'

import { createI18n, localeOf, localizedPath, negotiateLocale, readLocaleCookie, stripLocale } from '../dist/index.js'
import { compileCatalog } from '../dist/messages.js'
import { localeAlternates, localizedRoute, localizeLink, localizeRoutes, sitemapAlternates } from '../dist/routing.js'
import { localeCookie } from '../dist/runtime.js'

const locales = ['es', 'en', 'ar']

test('paths keep the default locale unprefixed and the others under their prefix', () => {
	assert.equal(localeOf('/en/guide', locales, 'es'), 'en')
	assert.equal(localeOf('/guide', locales, 'es'), 'es')
	assert.equal(stripLocale('/en/guide?tab=a#b', locales), '/guide?tab=a#b')
	assert.equal(stripLocale('/en', locales), '/')
	assert.equal(stripLocale('/english', locales), '/english')
	assert.equal(localizedPath('/guide?tab=a#b', 'en', locales, 'es'), '/en/guide?tab=a#b')
	assert.equal(localizedPath('/en/guide', 'es', locales, 'es'), '/guide')
	assert.equal(localizedPath('/en/guide', 'ar', locales, 'es'), '/ar/guide')
	assert.equal(localizedPath('/', 'en', locales, 'es'), '/en')
	assert.equal(localizedPath('/en', 'es', locales, 'es'), '/')
	// Without a default locale every locale is prefixed, as before.
	assert.equal(localizedPath('/guide', 'es', locales), '/es/guide')
})

test('negotiateLocale and the locale cookie only suggest a configured locale', () => {
	assert.equal(negotiateLocale('en-US,en;q=0.9,es;q=0.8', locales), 'en')
	assert.equal(negotiateLocale('fr;q=1, es-MX;q=0.5', locales), 'es')
	assert.equal(negotiateLocale('fr, de;q=0.8, *;q=0.1', locales), undefined)
	assert.equal(negotiateLocale('en;q=0, es;q=0.4', locales), 'es')
	assert.equal(negotiateLocale(['pt-BR', 'ar-EG'], locales), 'ar')
	assert.equal(negotiateLocale(['es'], ['es-MX', 'en']), 'es-MX')
	assert.equal(negotiateLocale(undefined, locales), undefined)
	assert.equal(readLocaleCookie('theme=dark; meeko-locale=en', 'meeko-locale', locales), 'en')
	assert.equal(readLocaleCookie('meeko-locale=fr', 'meeko-locale', locales), undefined)
	assert.equal(readLocaleCookie('meeko-locale=%E0%A4%A', 'meeko-locale', locales), undefined)
	assert.equal(localeCookie({ name: 'meeko-locale', domain: 'meekojs.com' }, 'en'), 'meeko-locale=en; Path=/; Max-Age=31536000; SameSite=Lax; Domain=meekojs.com')
})

test('has tells whether a message is loaded, without reporting it as missing', () => {
	const reported = []
	const i18n = createI18n({
		locale: 'en',
		locales,
		defaultLocale: 'es',
		path: () => '/en',
		catalog: compileCatalog({ errors: { DENIED: 'Denied' }, plural: { count: { one: 'One', other: 'Many' } } }, 'en.json'),
		foreign: { es: compileCatalog({ suggestion: 'Hola' }, 'es.json') },
		missing: (key) => {
			reported.push(key)
			return key
		},
	})
	assert.equal(i18n.has('errors.DENIED'), true)
	assert.equal(i18n.has('errors.UNKNOWN'), false)
	assert.equal(i18n.has('errors'), false)
	// A name of Object.prototype is not a message, in a catalog with or without a prototype.
	assert.equal(i18n.has('constructor'), false)
	// Another locale only has what is loaded for it: `multilingual`.
	assert.equal(i18n.has('suggestion'), false)
	assert.equal(i18n.has('suggestion', { locale: 'es' }), true)
	assert.equal(i18n.has('errors.DENIED', { locale: 'es' }), false)
	assert.equal(i18n.has('errors.DENIED', { locale: 'ar' }), false)
	assert.throws(() => i18n.has('errors.DENIED', { locale: 'fr' }), /Unsupported locale fr/)
	assert.deepEqual(reported, [])
	// A method of the translator works destructured, as the others do.
	const { has } = i18n
	assert.equal(has('errors.DENIED'), true)
})

test('the translator localizes links, names locales and suggests without redirecting', () => {
	const catalog = compileCatalog({ hello: 'Hello' }, 'en.json')
	let url = '/en/guide?tab=a#b'
	let cookies = ''
	const navigations = []
	const i18n = createI18n({
		locale: 'en',
		catalog,
		locales,
		defaultLocale: 'es',
		directions: { ar: 'rtl' },
		cookie: { name: 'meeko-locale' },
		path: () => url,
		navigate: (path) => navigations.push(path),
		cookies: () => cookies,
		languages: () => ['es-ES', 'en'],
	})
	assert.deepEqual([i18n.locale, i18n.defaultLocale, i18n.dir, i18n.directionOf('ar')], ['en', 'es', 'ltr', 'rtl'])
	assert.deepEqual(i18n.locales, locales)
	assert.equal(i18n.localePath('/docs'), '/en/docs')
	assert.equal(i18n.localePath('/en/docs', 'es'), '/docs')
	assert.equal(i18n.switchLocalePath('es'), '/guide?tab=a#b')
	url = '/en'
	assert.equal(i18n.switchLocalePath('ar'), '/ar')
	assert.equal(i18n.localeName('es'), 'Español')
	assert.equal(i18n.localeName('en'), 'English')
	assert.equal(i18n.localeName('es', 'en'), 'Spanish')
	assert.throws(() => i18n.localePath('/', 'fr'), /Unsupported locale fr/)
	// The browser prefers Spanish; a remembered choice wins over it.
	assert.equal(i18n.suggestedLocale(), 'es')
	cookies = 'meeko-locale=en'
	assert.equal(i18n.suggestedLocale(), undefined)
	cookies = 'meeko-locale=ar'
	assert.equal(i18n.suggestedLocale(), 'ar')
	i18n.switchLocale('es')
	assert.deepEqual(navigations, ['/'])
	// On a server there is no reader preference to read.
	const server = createI18n({ locale: 'es', catalog, locales, defaultLocale: 'es', path: () => '/' })
	assert.equal(server.suggestedLocale(), undefined)
	server.switchLocale('en')
})

test('localizeRoutes adds one route per non-default locale with the same page, unless excluded or already present', () => {
	const routing = { locales, defaultLocale: 'es', exclude: ['/admin/*'] }
	const routes = [
		{ id: '/', file: 'index.meeko', layouts: ['app.meeko'] },
		{ id: '/docs/[...slug]', file: 'docs.meeko', layouts: [], render: 'prerender' },
		{ id: '/admin/users', file: 'admin.meeko', layouts: [] },
		{ id: '/legal', file: 'legal.meeko', layouts: [] },
		{ id: '/en/legal', file: 'legal.en.meeko', layouts: [] },
		{ id: '/[locale]/playground', file: 'playground.meeko', layouts: [] },
	]
	const result = localizeRoutes(routes, routing)
	assert.deepEqual(
		result.slice(routes.length).map((route) => `${route.id} ${route.file}`),
		[
			'/en index.meeko',
			'/ar index.meeko',
			'/en/docs/[...slug] docs.meeko',
			'/ar/docs/[...slug] docs.meeko',
			'/ar/legal legal.meeko',
		],
	)
	assert.equal(result.find((route) => route.id === '/en/docs/[...slug]').render, 'prerender')
	assert.equal(localizedRoute('/en/docs/[...slug]', routing), true)
	assert.equal(localizedRoute('/admin/users', routing), false)
	assert.equal(localizedRoute(null, routing), false)
	// A partially translated locale only gets the routes that it lists.
	const partial = localizeRoutes(routes, { ...routing, partial: { ar: ['/docs/*'] } })
	assert.deepEqual(
		partial.slice(routes.length).map((route) => route.id),
		['/en', '/en/docs/[...slug]', '/ar/docs/[...slug]'],
	)
})

test('pageLocales lists the locales that have a version of the current page', () => {
	const catalog = compileCatalog({}, 'es.json')
	let available = true
	const i18n = createI18n({ locale: 'es', catalog, locales, defaultLocale: 'es', path: () => '/', available: (locale) => available && locale !== 'ar' })
	assert.deepEqual(i18n.pageLocales(), ['es', 'en'])
	available = false
	assert.deepEqual(i18n.pageLocales(), ['es'])
	assert.deepEqual(createI18n({ locale: 'en', catalog, locales, defaultLocale: 'es', path: () => '/' }).pageLocales(), locales)
})

test('localeAlternates lists every version and x-default, only when the versions exist', () => {
	const routing = { locales: ['es', 'en'], defaultLocale: 'es' }
	assert.deepEqual(localeAlternates('/en/guide', routing), [
		{ hreflang: 'es', pathname: '/guide' },
		{ hreflang: 'en', pathname: '/en/guide' },
		{ hreflang: 'x-default', pathname: '/guide' },
	])
	assert.deepEqual(
		localeAlternates('/private', routing, (pathname) => pathname === '/private'),
		[],
	)
})

test('sitemapAlternates follows the rules of the <head>: exclude and partial win over the pages that exist', () => {
	const routing = { locales, defaultLocale: 'es', exclude: ['/admin/*'], partial: { ar: ['/playground'] } }
	const urls = new Set(['/admin/users', '/en/admin/users', '/guide', '/en/guide', '/ar/guide', '/playground', '/en/playground', '/ar/playground', '/solo', '/users/7', '/en/users/7'])
	// Physical pages at both URLs of an excluded route declare nothing, from either side.
	assert.deepEqual(sitemapAlternates('/admin/users', '/admin/users', urls, routing), [])
	assert.deepEqual(sitemapAlternates('/en/admin/users', '/en/admin/users', urls, routing), [])
	// A URL that no route serves has no versions to declare.
	assert.deepEqual(sitemapAlternates('/guide', null, urls, routing), [])
	// A page at /ar/guide does not make a partial locale have that version.
	const guide = [
		{ hreflang: 'es', pathname: '/guide' },
		{ hreflang: 'en', pathname: '/en/guide' },
		{ hreflang: 'x-default', pathname: '/guide' },
	]
	assert.deepEqual(sitemapAlternates('/guide', '/guide', urls, routing), guide)
	assert.deepEqual(sitemapAlternates('/en/guide', '/en/guide', urls, routing), guide)
	assert.deepEqual(
		sitemapAlternates('/ar/playground', '/ar/playground', urls, routing).map((version) => version.hreflang),
		['es', 'en', 'ar', 'x-default'],
	)
	// A dynamic route is judged by its ID, and a version outside the sitemap is left out.
	assert.deepEqual(
		sitemapAlternates('/users/7', '/users/[id]', urls, routing).map((version) => version.pathname),
		['/users/7', '/en/users/7', '/users/7'],
	)
	assert.deepEqual(sitemapAlternates('/solo', '/solo', urls, routing), [])
	assert.deepEqual(sitemapAlternates('/users/7', '/users/[id]', urls, { ...routing, exclude: ['/users/*'] }), [])
})

test("localizeLink points <MeekoLink to> at the document's locale, or at its hreflang", () => {
	const routing = { locales, defaultLocale: 'es', exclude: ['/admin/*'], partial: { ar: ['/playground'] } }
	const link = (to, href = to, hreflang = undefined) => ({ to, href, hreflang })
	// The document's locale: the default one keeps the href, the others get their prefix.
	assert.equal(localizeLink(link('/guide'), 'es', routing), '/guide')
	assert.equal(localizeLink(link('/guide'), 'en', routing), '/en/guide')
	assert.equal(localizeLink(link('/'), 'en', routing), '/en')
	assert.equal(localizeLink(link('/', '/?q=1#top'), 'en', routing), '/en?q=1#top')
	assert.equal(localizeLink(link('/users/[id]', '/users/7?tab=a#b'), 'en', routing), '/en/users/7?tab=a#b')
	// A parameter equal to a locale stays: the prefix is added, never parsed out of the href.
	assert.equal(localizeLink(link('/[slug]', '/en'), 'en', routing), '/en/en')
	// hreflang forces a configured locale, exact or by its base language; an unknown one is ignored.
	assert.equal(localizeLink(link('/guide', '/guide', 'en'), 'es', routing), '/en/guide')
	assert.equal(localizeLink(link('/guide', '/guide', 'es'), 'en', routing), '/guide')
	assert.equal(localizeLink(link('/guide', '/guide', 'en-US'), 'es', routing), '/en/guide')
	assert.equal(localizeLink(link('/guide', '/guide', 'fr'), 'en', routing), '/en/guide')
	// A route ID that names its locale is explicit; an excluded route has no localized version.
	assert.equal(localizeLink(link('/en/legal'), 'es', routing), '/en/legal')
	assert.equal(localizeLink(link('/[locale]/x', '/es/x'), 'en', routing), '/es/x')
	assert.equal(localizeLink(link('/admin/users'), 'en', routing), '/admin/users')
	// A partial locale only prefixes the routes it has: the others link to the default version.
	assert.equal(localizeLink(link('/playground'), 'ar', routing), '/ar/playground')
	assert.equal(localizeLink(link('/guide'), 'ar', routing), '/guide')
	assert.equal(localizeLink(link('/guide', '/guide', 'ar'), 'en', routing), '/guide')
})
