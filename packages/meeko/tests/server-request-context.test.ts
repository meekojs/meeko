import assert from 'node:assert/strict'
import test from 'node:test'

import type { RequestContext, Schema, ServerManifest } from '../src/framework-server.ts'

import { createRouteManifest } from '../src/app/runtime/router.ts'
import { createFrameworkHandler, createRequestContext, createServerDispatcher, defineApiRoute, defineRpc, getRequestContext, MemorySessionStore, SessionManager } from '../src/framework-server.ts'

const booleanSchema: Schema<boolean> = {
	'~standard': {
		version: 1,
		validate: (value) => (typeof value === 'boolean' ? { value } : { issues: [{ message: 'boolean' }] }),
	},
}
const nullSchema: Schema<null> = {
	'~standard': {
		version: 1,
		validate: (value) => (value === null ? { value } : { issues: [{ message: 'null' }] }),
	},
}

/** A helper that, like a module deep in an app, reads the request without receiving it. */
async function requestIdLater(): Promise<string> {
	await new Promise((resolve) => setTimeout(resolve, 1))
	return getRequestContext().requestId
}

test('getRequestContext() returns the context of the API route or RPC that is running, also after an await', async () => {
	const seen: Array<[string, string]> = []
	const manifest: ServerManifest = {
		api: [{ kind: 'api', file: 'api.ts', pathname: '/api/who', method: 'GET', clientKey: 'who' }],
		rpc: [{ kind: 'rpc', file: 'rpc.ts', pathname: '/_meeko/rpc/who', id: 'who' }],
	}
	const modules = new Map<string, unknown>([
		[
			'api.ts',
			{
				default: defineApiRoute({
					auth: 'optional',
					response: booleanSchema,
					handler: async ({ context }) => {
						seen.push([context.requestId, await requestIdLater()])
						return true
					},
				}),
			},
		],
		[
			'rpc.ts',
			{
				default: defineRpc({
					auth: 'optional',
					input: nullSchema,
					output: booleanSchema,
					handler: async ({ context }) => {
						seen.push([context.requestId, await requestIdLater()])
						return true
					},
				}),
			},
		],
	])
	const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false })
	const dispatch = createServerDispatcher({ manifest, sessions, services: {}, load: async (file) => modules.get(file) })
	const [first, second] = await Promise.all([dispatch(new Request('https://example.test/api/who')), dispatch(new Request('https://example.test/api/who'))])
	assert.equal(first.status, 200)
	assert.equal(second.status, 200)
	const rpc = await dispatch(new Request('https://example.test/_meeko/rpc/who', { method: 'POST', headers: { origin: 'https://example.test', 'content-type': 'application/json' }, body: 'null' }))
	assert.equal(rpc.status, 200, await rpc.clone().text())
	assert.equal(seen.length, 3)
	for (const [own, ambient] of seen) assert.equal(ambient, own)
	assert.notEqual(seen[0]![0], seen[1]![0], 'two concurrent requests keep their own context')
})

test('getRequestContext() returns the context of the page whose loader runs', async () => {
	const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false })
	let created: RequestContext | undefined
	let ambient: string | undefined
	const handle = createFrameworkHandler({
		routes: createRouteManifest([{ id: '/page', file: '/page.meeko', layouts: [], sidecar: '/page.route.ts' }]),
		loadPage: async () => ({ renderWithState: () => ({ html: '<p>ok</p>', state: {} }) }),
		loadRoute: async () => ({
			load: async () => {
				ambient = await requestIdLater()
				return {}
			},
		}),
		createContext: async (request) => (created = createRequestContext(request, {}, await sessions.load(request))),
	})
	const response = await handle(new Request('http://local/page', { headers: { accept: 'text/html' } }))
	assert.equal(response.status, 200)
	assert.ok(created)
	assert.equal(ambient, created.requestId)
})

test('getRequestContext() throws outside a request', () => {
	assert.throws(() => getRequestContext(), /sólo funciona durante una petición/)
})
