// How the plugin of the module requests its catalogs, with the catalogs of the real manifest replaced by
// promises the test resolves itself: every namespace of a document or a navigation is requested at once,
// and the result (merge order, the error of a failed catalog) does not depend on which one arrives first.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

const catalogs = (globalThis.__meekoI18nTestCatalogs = {})
const manifest = registerHooks({
	resolve(specifier, context, next) {
		if (specifier === 'virtual:meeko-i18n') return { url: 'data:text/javascript,export const catalogs = globalThis.__meekoI18nTestCatalogs', shortCircuit: true }
		return next(specifier, context)
	},
})
const { default: plugin } = await import('../dist/plugin.js')
const { i18nContext } = await import('../dist/context.js')
const { compileCatalog } = await import('../dist/messages.js')
manifest.deregister()

/** A catalog whose module arrives when the test says so; `requests` counts its imports. */
function deferred(locale, name, requests) {
	let settle
	const pending = () => {
		requests.push(`${locale}/${name}`)
		return new Promise((resolve, reject) => {
			settle = { resolve: (messages) => resolve({ default: compileCatalog(messages, `${locale}/${name}.json`) }), reject }
		})
	}
	pending.resolve = (messages) => settle.resolve(messages)
	pending.reject = (error) => settle.reject(error)
	return pending
}

function manifestOf(locale, names) {
	const requests = []
	const loaders = Object.fromEntries(names.map((name) => [name, deferred(locale, name, requests)]))
	catalogs[locale] = loaders
	return { loaders, requests }
}

const options = (extra = {}) => ({ defaultLocale: 'es', locales: ['es', 'en'], directions: {}, global: ['shell'], multilingual: [], ogLocales: false, routes: { '/docs': ['docs'] }, exclude: [], partial: {}, cookie: false, hreflang: false, dev: false, ...extra })

function fakeApp(side, path, id) {
	const app = {
		side,
		route: { path: { value: path }, id: { value: id }, url: { value: path } },
		provided: new Map(),
		provide: (key, value) => app.provided.set(key, value),
		addHead() {},
		resolveLink() {},
		beforeNavigate: (handler) => {
			app.navigate = handler
		},
	}
	return app
}

/** Lets every promise that does not depend on a pending catalog run. */
const settled = () => new Promise((done) => setImmediate(done))

for (const side of ['server', 'client']) {
	test(`${side}: every namespace of the document is requested at once and merged in their order`, async () => {
		const { loaders, requests } = manifestOf('es', ['common', 'shell', 'docs'])
		const app = fakeApp(side, '/docs', '/docs')
		const started = plugin.setup(app, options())
		await settled()
		assert.deepEqual(requests, ['es/common', 'es/shell', 'es/docs'], 'none of them waits for another')
		assert.equal(app.provided.size, 0, 'the app does not start until they arrive')
		// They arrive backwards, and the same key in two of them keeps the merge order of the list.
		loaders.docs.resolve({ 'docs.title': 'Guías', overlap: 'docs' })
		await settled()
		loaders.shell.resolve({ 'shell.menu': 'Menú', overlap: 'shell' })
		await settled()
		loaders.common.resolve({ hello: 'Hola', overlap: 'common' })
		await started
		const i18n = app.provided.get(i18nContext)
		assert.equal(i18n.t('hello'), 'Hola')
		assert.equal(i18n.t('shell.menu'), 'Menú')
		assert.equal(i18n.t('docs.title'), 'Guías')
		assert.equal(i18n.t('overlap'), 'docs')
	})
}

test('a navigation requests at once what the route still lacks, and nothing already loaded', async () => {
	const { loaders, requests } = manifestOf('es', ['common', 'shell', 'docs', 'extra'])
	const app = fakeApp('client', '/', '/')
	const started = plugin.setup(app, options({ routes: { '/docs': ['docs', 'extra', 'shell', 'docs'] } }))
	await settled()
	loaders.common.resolve({ hello: 'Hola' })
	loaders.shell.resolve({ 'shell.menu': 'Menú' })
	await started
	requests.length = 0

	const navigation = app.navigate(new URL('https://a.test/docs'), '/docs')
	await settled()
	assert.deepEqual(requests, ['es/docs', 'es/extra'], 'a namespace listed twice or already loaded is not requested')
	loaders.extra.resolve({ 'extra.title': 'Extra' })
	await settled()
	loaders.docs.resolve({ 'docs.title': 'Guías' })
	assert.equal(await navigation, undefined)
	const i18n = app.provided.get(i18nContext)
	assert.equal(i18n.t('docs.title'), 'Guías')
	assert.equal(i18n.t('extra.title'), 'Extra')

	requests.length = 0
	await app.navigate(new URL('https://a.test/docs'), '/docs')
	assert.deepEqual(requests, [], 'a loaded route requests nothing')
})

/** An app started on `/` with `common` and `shell`, whose route `/docs` needs `docs`, `extra` and `last`. */
async function startedApp() {
	const manifest = manifestOf('es', ['common', 'shell', 'docs', 'extra', 'last'])
	const app = fakeApp('client', '/', '/')
	const started = plugin.setup(app, options({ routes: { '/docs': ['docs', 'extra', 'last'] } }))
	await settled()
	manifest.loaders.common.resolve({ hello: 'Hola' })
	manifest.loaders.shell.resolve({ 'shell.menu': 'Menú' })
	await started
	manifest.requests.length = 0
	return { ...manifest, app, go: () => app.navigate(new URL('https://a.test/docs'), '/docs') }
}

test('several failed catalogs reject with the error of the first of the list, and the others are not left unhandled', async () => {
	const unhandled = []
	const onUnhandled = (error) => unhandled.push(error)
	process.on('unhandledRejection', onUnhandled)
	try {
		const { loaders, go } = await startedApp()
		const navigation = go()
		await settled()
		const docsError = new Error('docs failed')
		// The last of the list fails first: the error does not depend on which one arrives first.
		loaders.last.reject(new Error('last failed'))
		await settled()
		loaders.extra.reject(new Error('extra failed'))
		await settled()
		loaders.docs.reject(docsError)
		await assert.rejects(navigation, (error) => error === docsError)
		await settled()
		assert.deepEqual(unhandled, [], 'an unhandled rejection stops a Node server')
	} finally {
		process.off('unhandledRejection', onUnhandled)
	}
})

test('a failed catalog keeps what comes before it in the list, and the next navigation requests the rest again', async () => {
	const { app, loaders, requests, go } = await startedApp()
	const navigation = go()
	await settled()
	const extraError = new Error('extra failed')
	loaders.docs.resolve({ 'docs.title': 'Guías' })
	loaders.last.resolve({ 'last.title': 'Última' })
	loaders.extra.reject(extraError)
	await assert.rejects(navigation, (error) => error === extraError)
	const i18n = app.provided.get(i18nContext)
	assert.equal(i18n.has('docs.title'), true, 'merged: it comes before the failure')
	assert.equal(i18n.has('last.title'), false, 'not merged: it comes after the failure')

	requests.length = 0
	const retry = go()
	await settled()
	assert.deepEqual(requests, ['es/extra', 'es/last'])
	loaders.extra.resolve({ 'extra.title': 'Extra' })
	loaders.last.resolve({ 'last.title': 'Última' })
	await retry
	assert.equal(i18n.t('extra.title'), 'Extra')
	assert.equal(i18n.t('last.title'), 'Última')
})

test('the application does not start when a catalog of its document fails', async () => {
	const { loaders } = manifestOf('es', ['common', 'shell', 'docs'])
	const app = fakeApp('client', '/docs', '/docs')
	const started = plugin.setup(app, options())
	await settled()
	const shellError = new Error('shell failed')
	loaders.common.resolve({ hello: 'Hola' })
	loaders.docs.resolve({ 'docs.title': 'Guías' })
	loaders.shell.reject(shellError)
	await assert.rejects(started, (error) => error === shellError)
	assert.equal(app.provided.size, 0)
})

test('a namespace the manifest does not have is the same RangeError, in its place in the list', async () => {
	const { loaders } = manifestOf('es', ['common', 'shell'])
	const app = fakeApp('server', '/docs', '/docs')
	const started = plugin.setup(app, options({ routes: { '/docs': ['ghost'] } }))
	await settled()
	loaders.common.resolve({ hello: 'Hola' })
	loaders.shell.resolve({ 'shell.menu': 'Menú' })
	await assert.rejects(started, { name: 'RangeError', message: 'i18n: missing es/ghost' })
})

test('multilingual namespaces of the other locales do not wait for those of the document', async () => {
	const own = manifestOf('es', ['common', 'shell', 'suggestion'])
	const other = manifestOf('en', ['common', 'shell', 'suggestion'])
	const app = fakeApp('server', '/', '/')
	const started = plugin.setup(app, options({ multilingual: ['suggestion'] }))
	await settled()
	assert.deepEqual(own.requests, ['es/common', 'es/shell', 'es/suggestion'])
	assert.deepEqual(other.requests, ['en/suggestion'], 'requested with the catalogs of the document')
	other.loaders.suggestion.resolve({ 'suggestion.go': 'Read in English' })
	await settled()
	own.loaders.suggestion.resolve({ 'suggestion.go': 'Leer en español' })
	own.loaders.shell.resolve({})
	own.loaders.common.resolve({})
	await started
	const i18n = app.provided.get(i18nContext)
	assert.equal(i18n.t('suggestion.go'), 'Leer en español')
	assert.equal(i18n.t('suggestion.go', {}, { locale: 'en' }), 'Read in English')
})

test('with multilingual namespaces, the error of the document wins over that of another locale', async () => {
	const own = manifestOf('es', ['common', 'shell', 'suggestion'])
	const other = manifestOf('en', ['common', 'shell', 'suggestion'])
	const app = fakeApp('server', '/', '/')
	const started = plugin.setup(app, options({ multilingual: ['suggestion'] }))
	await settled()
	const ownError = new Error('own failed')
	other.loaders.suggestion.reject(new Error('foreign failed'))
	await settled()
	own.loaders.common.reject(ownError)
	own.loaders.shell.resolve({})
	own.loaders.suggestion.resolve({})
	await assert.rejects(started, (error) => error === ownError)
})
