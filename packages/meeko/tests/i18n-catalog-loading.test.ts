// How the plugin of @meekojs/meeko/i18n requests its catalogs, with the catalogs of the real manifest replaced by
// promises the test resolves itself: every namespace of a document or a navigation is requested at once, and the
// result (merge order, the error of a failed catalog) does not depend on which one arrives first.
import assert from 'node:assert/strict'
import { registerHooks } from 'node:module'
import test from 'node:test'

import type { Message } from '../src/modules/i18n/messages.ts'

import { compileCatalog } from '../src/modules/i18n/messages.ts'
import { i18nContext } from '../src/shared/i18n.ts'

type Module = { default: Record<string, Message> }
interface Loader {
	(): Promise<Module>
	resolve(messages: Record<string, string>): void
	reject(error: Error): void
}

const catalogs: Record<string, Record<string, Loader>> = {}
;(globalThis as { __meekoI18nTestCatalogs?: unknown }).__meekoI18nTestCatalogs = catalogs
const manifest = registerHooks({
	resolve(specifier, context, next) {
		if (specifier === 'virtual:meeko-i18n') return { url: 'data:text/javascript,export const catalogs = globalThis.__meekoI18nTestCatalogs', shortCircuit: true }
		return next(specifier, context)
	},
})
const { default: plugin } = await import('../src/modules/i18n/plugin.ts')
manifest.deregister()

/** A catalog whose module arrives when the test says so; `requests` records its imports. */
function deferred(name: string, requests: string[]): Loader {
	let settle: { resolve(module: Module): void; reject(error: Error): void }
	const pending = (() => {
		requests.push(name)
		return new Promise<Module>((resolve, reject) => {
			settle = { resolve, reject }
		})
	}) as Loader
	pending.resolve = (messages) => settle.resolve({ default: compileCatalog(messages, `${name}.json`) })
	pending.reject = (error) => settle.reject(error)
	return pending
}

function manifestOf(names: readonly string[]) {
	const requests: string[] = []
	const loaders = Object.fromEntries(names.map((name) => [name, deferred(name, requests)])) as Record<string, Loader>
	catalogs.es = loaders
	return { loaders, requests }
}

const options = (routes: Record<string, readonly string[]>) => ({ defaultLocale: 'es', locales: ['es', 'en'], directions: {}, routes })

interface FakeApp {
	side: 'client' | 'server'
	route: { path: { value: string }; id: { value: string | null }; url: { value: string } }
	provided: Map<unknown, { t(key: string): string }>
	provide(key: unknown, value: { t(key: string): string }): void
	addHead(): void
	beforeNavigate(handler: (url: URL, routeId: string | null) => Promise<unknown>): void
	navigate(url: URL, routeId: string | null): Promise<unknown>
}

function fakeApp(side: 'client' | 'server', id: string | null): FakeApp {
	const app: FakeApp = {
		side,
		route: { path: { value: '/' }, id: { value: id }, url: { value: '/' } },
		provided: new Map(),
		provide: (key, value) => void app.provided.set(key, value),
		addHead() {},
		beforeNavigate: (handler) => {
			app.navigate = handler
		},
		navigate: () => Promise.reject(new Error('This side registers no navigation')),
	}
	return app
}

const start = (app: FakeApp, routes: Record<string, readonly string[]>): Promise<void> => (plugin as unknown as { setup(app: FakeApp, options: unknown): Promise<void> }).setup(app, options(routes))

/** Lets every promise that does not depend on a pending catalog run. */
const settled = () => new Promise((done) => setImmediate(done))

for (const side of ['server', 'client'] as const) {
	test(`${side}: every namespace of the document is requested at once and merged in their order`, async () => {
		const { loaders, requests } = manifestOf(['common', 'docs', 'extra'])
		const app = fakeApp(side, '/docs')
		const started = start(app, { '/docs': ['docs', 'extra'] })
		await settled()
		assert.deepEqual(requests, ['common', 'docs', 'extra'], 'none of them waits for another')
		assert.equal(app.provided.size, 0, 'the app does not start until they arrive')
		// They arrive backwards, and the same key in two of them keeps the merge order of the list.
		loaders.extra!.resolve({ extra: 'Extra', overlap: 'extra' })
		await settled()
		loaders.docs!.resolve({ docs: 'Guías', overlap: 'docs' })
		await settled()
		loaders.common!.resolve({ hello: 'Hola', overlap: 'common' })
		await started
		const i18n = app.provided.get(i18nContext)!
		assert.equal(i18n.t('hello'), 'Hola')
		assert.equal(i18n.t('docs'), 'Guías')
		assert.equal(i18n.t('overlap'), 'extra')
	})
}

/** An app started on `/` with `common`, whose route `/docs` needs `docs`, `extra` and `last`. */
async function startedApp() {
	const manifest = manifestOf(['common', 'docs', 'extra', 'last'])
	const app = fakeApp('client', '/')
	const started = start(app, { '/docs': ['docs', 'extra', 'last', 'docs', 'common'] })
	await settled()
	manifest.loaders.common!.resolve({ hello: 'Hola' })
	await started
	manifest.requests.length = 0
	return { ...manifest, app, go: () => app.navigate(new URL('https://a.test/docs'), '/docs') }
}

test('a navigation requests at once what the route still lacks, and nothing already loaded', async () => {
	const { app, loaders, requests, go } = await startedApp()
	const navigation = go()
	await settled()
	assert.deepEqual(requests, ['docs', 'extra', 'last'], 'a namespace listed twice or already loaded is not requested')
	loaders.last!.resolve({ last: 'Última' })
	await settled()
	loaders.extra!.resolve({ extra: 'Extra' })
	loaders.docs!.resolve({ docs: 'Guías' })
	assert.equal(await navigation, undefined)
	assert.equal(app.provided.get(i18nContext)!.t('last'), 'Última')
	requests.length = 0
	await go()
	assert.deepEqual(requests, [], 'a loaded route requests nothing')
})

test('several failed catalogs reject with the error of the first of the list, and the others are not left unhandled', async () => {
	const unhandled: unknown[] = []
	const onUnhandled = (error: unknown) => unhandled.push(error)
	process.on('unhandledRejection', onUnhandled)
	try {
		const { loaders, go } = await startedApp()
		const navigation = go()
		await settled()
		const docsError = new Error('docs failed')
		// The last of the list fails first: the error does not depend on which one arrives first.
		loaders.last!.reject(new Error('last failed'))
		await settled()
		loaders.extra!.reject(new Error('extra failed'))
		await settled()
		loaders.docs!.reject(docsError)
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
	loaders.docs!.resolve({ docs: 'Guías' })
	loaders.last!.resolve({ last: 'Última' })
	loaders.extra!.reject(extraError)
	await assert.rejects(navigation, (error) => error === extraError)
	const i18n = app.provided.get(i18nContext)!
	assert.equal(i18n.t('docs'), 'Guías', 'merged: it comes before the failure')
	assert.throws(() => i18n.t('last'), /Missing i18n message/, 'not merged: it comes after the failure')

	requests.length = 0
	const retry = go()
	await settled()
	assert.deepEqual(requests, ['extra', 'last'])
	loaders.extra!.resolve({ extra: 'Extra' })
	loaders.last!.resolve({ last: 'Última' })
	await retry
	assert.equal(i18n.t('extra'), 'Extra')
	assert.equal(i18n.t('last'), 'Última')
})

test('the application does not start when a catalog of its document fails', async () => {
	const { loaders } = manifestOf(['common', 'docs', 'extra'])
	const app = fakeApp('client', '/docs')
	const started = start(app, { '/docs': ['docs', 'extra'] })
	await settled()
	const docsError = new Error('docs failed')
	loaders.common!.resolve({ hello: 'Hola' })
	loaders.extra!.resolve({ extra: 'Extra' })
	loaders.docs!.reject(docsError)
	await assert.rejects(started, (error) => error === docsError)
	assert.equal(app.provided.size, 0)
})

test('a namespace the manifest does not have is the same RangeError, in its place in the list', async () => {
	const { loaders } = manifestOf(['common'])
	const app = fakeApp('server', '/docs')
	const started = start(app, { '/docs': ['ghost'] })
	await settled()
	loaders.common!.resolve({ hello: 'Hola' })
	await assert.rejects(started, { name: 'RangeError', message: 'i18n: missing es/ghost' })
})
