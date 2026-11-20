import assert from 'node:assert/strict'
import test from 'node:test'

import type { AppManifest, RequestContext, Schema, ServerApp, ServerAppOptions, ServerRuntime } from '../src/framework-server.ts'
import type { PageRoute } from '../src/server/runtime/framework-render.ts'

import { defer } from '../src/app/runtime/deferred.ts'
import { ApiError, createRequestContext, createServerApp, createServerClientOptions, defineApiRoute, defineRpc, defineSocketChannel, MemorySessionStore, SessionManager } from '../src/framework-server.ts'
import { defineServerRouteMiddleware } from '../src/server/middleware/definitions.ts'
import { redirect } from '../src/server/runtime/page-body.ts'

const own = 'https://shop.example'

const anySchema: Schema<unknown> = { '~standard': { version: 1, validate: (value) => ({ value }) } }
const textSchema: Schema<{ value: string | null }> = { '~standard': { version: 1, validate: (value) => ({ value: value as { value: string | null } }) } }

const page = (name: string) => ({
	renderWithState: () => ({ html: `<h1>${name}</h1>`, state: {} }),
	renderToString: () => `<h1>${name}</h1>`,
	hydrateScope: () => () => {},
})

const api = (pathname: string, method: 'GET' | 'POST', file: string) => ({ kind: 'api' as const, file, pathname, method, clientKey: `${file.slice(1)}.${method.toLowerCase()}` })

const manifest: AppManifest = {
	version: 1,
	routes: [
		{ id: '/', file: '/pages/home.meeko', layouts: [], sidecar: '/pages/home.route.ts', serverMiddleware: ['/middleware/refresh.server.ts'] },
		{ id: '/private', file: '/pages/home.meeko', layouts: [], serverMiddleware: ['/middleware/refresh.server.ts', '/middleware/guard.server.ts'] },
		{ id: '/broken', file: '/pages/home.meeko', layouts: [], sidecar: '/pages/broken.route.ts' },
		{ id: '/stream', file: '/pages/home.meeko', layouts: [], sidecar: '/pages/stream.route.ts', render: 'stream' },
	],
	server: {
		api: [
			api('/api/json', 'GET', '/json'),
			api('/api/own-response', 'POST', '/own-response'),
			api('/api/fail', 'POST', '/fail'),
			api('/api/form', 'POST', '/form'),
			api('/api/invalid', 'POST', '/invalid'),
			api('/api/session', 'GET', '/session'),
			api('/api/me', 'GET', '/me'),
			api('/api/limited', 'POST', '/limited'),
			api('/api/webhook', 'POST', '/webhook'),
		],
		rpc: [
			{ kind: 'rpc', file: '/rpc-read', pathname: '/_meeko/rpc/cookie/read', id: 'cookie.read' },
			{ kind: 'rpc', file: '/rpc-write', pathname: '/_meeko/rpc/cookie/write', id: 'cookie.write' },
		],
		socket: [{ kind: 'socket', file: '/socket', name: 'live', pathname: '/_meeko/socket/live' }],
	},
	routeMiddleware: [],
	serverMiddleware: [],
	client: { entry: '/assets/entry.js', css: [], preload: [] },
}

/** What the RPC of a page's local call read, by request. */
let readByRpc: (string | null)[] = []
let socketWrite: unknown

const modules: Record<string, unknown> = {
	'/pages/home.meeko': page('home'),
	'/middleware/refresh.server.ts': {
		// A provider refreshes its token in the middleware; the rest of the request reads the new one.
		default: defineServerRouteMiddleware(({ cookies, responseHeaders }) => {
			if (cookies.get('sb-token') === 'stale') cookies.set('sb-token', 'fresh', { maxAge: 3600 })
			responseHeaders.set('x-auth-state', cookies.get('sb-token') ?? 'none')
		}),
	},
	'/middleware/guard.server.ts': {
		default: defineServerRouteMiddleware(({ cookies, url }) => {
			if (!cookies.has('sb-token')) {
				cookies.set('return-to', url.pathname, { httpOnly: false })
				redirect('/login')
			}
		}),
	},
	'/pages/home.route.ts': {
		route: {
			load: async ({ context }: { context?: RequestContext }) => {
				const seen = context!.cookies.get('sb-token') ?? null
				// A local RPC call (the SSR clients use the same path) shares the cookies of the page.
				const client = createServerClientOptions()
				const headers = new Headers(typeof client.headers === 'function' ? await client.headers() : client.headers)
				headers.set('content-type', 'application/json')
				const base = typeof client.baseUrl === 'function' ? client.baseUrl() : client.baseUrl
				const response = await client.fetch!(new URL('/_meeko/rpc/cookie/read', base).href, { method: 'POST', headers, body: '{}' })
				readByRpc.push(((await response.json()) as { value: string | null }).value)
				context!.cookies.set('visited', 'yes; really', { sameSite: 'strict' })
				return { seen }
			},
		} satisfies PageRoute,
	},
	'/pages/broken.route.ts': {
		route: {
			load: ({ context }: { context?: RequestContext }) => {
				context!.cookies.set('attempt', '1')
				throw new ApiError('CONFLICT', 409)
			},
		} satisfies PageRoute,
	},
	'/pages/stream.route.ts': {
		route: {
			render: 'stream',
			load: ({ context }: { context?: RequestContext }) => {
				context!.cookies.set('before', 'first-byte')
				return {
					late: defer(
						new Promise((resolve) => setTimeout(resolve, 5)).then(() => {
							context!.cookies.set('after', 'first-byte')
							return 'never'
						}),
					),
				}
			},
		} satisfies PageRoute,
	},
	'/json': {
		default: defineApiRoute({
			response: textSchema,
			handler: ({ context }) => {
				context.cookies.set('json', 'a b/c', { path: '/api', maxAge: 60 })
				context.responseHeaders.set('cache-control', 'private, max-age=5')
				return { value: context.cookies.get('json') ?? null }
			},
		}),
	},
	'/own-response': {
		default: defineApiRoute({
			contentType: 'response',
			handler: ({ context }) => {
				context.cookies.set('meeko-side', '1')
				const response = Response.redirect(`${own}/done`, 302)
				return new Response(null, { status: response.status, headers: { location: `${own}/done`, 'set-cookie': 'handler-side=1; Path=/' } })
			},
		}),
	},
	'/fail': {
		default: defineApiRoute({
			response: textSchema,
			handler: ({ context }) => {
				context.cookies.delete('sb-token')
				throw new ApiError('CONFLICT', 409)
			},
		}),
	},
	'/form': {
		default: defineApiRoute({
			form: true,
			status: 204,
			handler: ({ context }) => {
				context.cookies.set('form', 'sent')
			},
		}),
	},
	'/invalid': {
		default: defineApiRoute({
			response: textSchema,
			handler: ({ context }) => {
				const errors: string[] = []
				const attempts: Array<() => void> = [
					() => context.cookies.set('bad name', 'x'),
					() => context.cookies.set('a;b', 'x'),
					() => context.cookies.set('ok', 'x', { path: 'relative' }),
					() => context.cookies.set('ok', 'x', { domain: 'bad domain' }),
					() => context.cookies.set('ok', 'x', { sameSite: 'None', secure: false }),
					() => context.cookies.set('__Host-x', 'x', { path: '/api' }),
					() => context.cookies.set('ok', 'x'.repeat(5000)),
					() => context.cookies.set('__Host-meeko.sid', 'stolen'),
					() => context.responseHeaders.set('set-cookie', 'a=b'),
					() => context.responseHeaders.set('x-request-id', 'mine'),
					() => context.responseHeaders.set('x-ok', 'a\r\nb: c'),
				]
				for (const attempt of attempts) {
					try {
						attempt()
						errors.push('accepted')
					} catch (error) {
						errors.push((error as Error).name)
					}
				}
				return { value: errors.join(',') }
			},
		}),
	},
	'/session': { default: defineApiRoute({ contentType: 'response', handler: ({ context }) => Response.json({ user: context.session.current?.data ?? null }) }) },
	'/me': { default: defineApiRoute({ auth: 'required', response: textSchema, locals: ({ cookies }) => cookies.get('sb-token') ?? null, handler: ({ locals }) => ({ value: locals }) }) },
	'/limited': { default: defineApiRoute({ rateLimit: { limit: 1, window: '1m' }, status: 204, handler: () => {} }) },
	'/webhook': { default: defineApiRoute({ origin: 'none', status: 204, handler: () => {} }) },
	'/rpc-read': { default: defineRpc({ input: anySchema, output: textSchema, handler: ({ context }) => ({ value: context.cookies.get('sb-token') ?? null }) }) },
	'/rpc-write': {
		default: defineRpc({
			input: anySchema,
			output: textSchema,
			handler: ({ context }) => {
				context.cookies.set('rpc', 'written', { httpOnly: false, sameSite: 'lax', priority: 'high' })
				context.responseHeaders.append('x-trace', 'one')
				context.responseHeaders.append('x-trace', 'two')
				return { value: context.cookies.get('rpc') ?? null }
			},
		}),
	},
	'/socket': {
		default: defineSocketChannel({
			clientToServer: {},
			serverToClient: {},
			authorize: ({ context }) => {
				try {
					context.cookies.set('socket', '1')
					socketWrite = 'accepted'
				} catch (error) {
					socketWrite = error
				}
				return context.cookies.get('sb-token') === 'fresh'
			},
		}),
	},
}

const load = async (key: string): Promise<unknown> => modules[key]

async function app(runtime: ServerRuntime<unknown, Record<string, string>> = {}, options: Partial<ServerAppOptions<Record<string, string>>> = {}): Promise<ServerApp> {
	const sessions = new SessionManager({ store: new MemorySessionStore(), production: false })
	return createServerApp({ manifest, production: false, load, runtime: () => ({ sessions, onError: () => {}, ...runtime }), ...options })
}

function cookiesOf(response: Response): string[] {
	return response.headers.getSetCookie()
}

function rpc(server: ServerApp, path: string, headers: Record<string, string> = {}): Promise<Response> {
	return server.fetch(new Request(`${own}/_meeko/rpc/${path}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: own, ...headers }, body: '{}' }))
}

test('API and RPC write cookies and headers with secure defaults, and read back what they wrote', async () => {
	const server = await app()
	try {
		const json = await server.fetch(new Request(`${own}/api/json`))
		assert.equal(json.status, 200)
		assert.deepEqual(await json.json(), { value: 'a b/c' })
		assert.deepEqual(cookiesOf(json), ['json=a%20b%2Fc; Path=/api; Max-Age=60; HttpOnly; Secure; SameSite=Lax'])
		assert.equal(json.headers.get('cache-control'), 'private, max-age=5')
		const written = await rpc(server, 'cookie/write')
		assert.deepEqual(await written.json(), { value: 'written' })
		assert.deepEqual(cookiesOf(written), ['rpc=written; Path=/; Secure; SameSite=Lax; Priority=High'])
		assert.equal(written.headers.get('x-trace'), 'one, two')
		assert.ok(written.headers.get('x-request-id'), 'Meeko keeps its own headers')
		// The value read from the browser is decoded.
		const read = await rpc(server, 'cookie/read', { cookie: 'sb-token=a%20b' })
		assert.deepEqual(await read.json(), { value: 'a b' })
	} finally {
		await server.close()
	}
})

test("a handler's own Response, an error and a native form keep their cookies and add the request's", async () => {
	const server = await app()
	try {
		const own302 = await server.fetch(new Request(`${own}/api/own-response`, { method: 'POST', headers: { origin: own } }))
		assert.equal(own302.status, 302)
		assert.deepEqual(cookiesOf(own302), ['handler-side=1; Path=/', 'meeko-side=1; Path=/; HttpOnly; Secure; SameSite=Lax'])
		const failed = await server.fetch(new Request(`${own}/api/fail`, { method: 'POST', headers: { origin: own, cookie: 'sb-token=old' } }))
		assert.equal(failed.status, 409)
		assert.equal(((await failed.json()) as { code: string }).code, 'CONFLICT')
		assert.deepEqual(cookiesOf(failed), ['sb-token=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax'])
		const form = await server.fetch(new Request(`${own}/api/form`, { method: 'POST', headers: { origin: own, 'content-type': 'application/x-www-form-urlencoded', referer: `${own}/contact` }, body: 'return=%2Fcontact' }))
		assert.equal(form.status, 303)
		const formCookies = cookiesOf(form)
		assert.equal(formCookies.length, 2, formCookies.join('\n'))
		assert.match(formCookies[0]!, /^__Host-meeko-form=/)
		assert.equal(formCookies[1], 'form=sent; Path=/; HttpOnly; Secure; SameSite=Lax')
	} finally {
		await server.close()
	}
})

test('names, values, attributes and Meeko-owned headers are validated', async () => {
	const server = await app()
	try {
		const response = await server.fetch(new Request(`${own}/api/invalid`, { method: 'POST', headers: { origin: own } }))
		assert.deepEqual(((await response.json()) as { value: string }).value.split(','), ['TypeError', 'TypeError', 'TypeError', 'TypeError', 'TypeError', 'TypeError', 'RangeError', 'TypeError', 'TypeError', 'TypeError', 'TypeError'])
		assert.deepEqual(cookiesOf(response), [], 'a refused write sends nothing')
	} finally {
		await server.close()
	}
})

test('route middleware refreshes a cookie that the loader and a local RPC call read, and the page sends it once', async () => {
	const server = await app()
	try {
		readByRpc = []
		const response = await server.fetch(new Request(`${own}/`, { headers: { cookie: 'sb-token=stale' } }))
		assert.equal(response.status, 200)
		assert.deepEqual(readByRpc, ['fresh'], 'the local RPC call saw the cookie of the middleware')
		assert.match(await response.text(), /"seen":"fresh"/)
		assert.deepEqual(cookiesOf(response), ['sb-token=fresh; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Lax', 'visited=yes%3B%20really; Path=/; HttpOnly; Secure; SameSite=Strict'])
		assert.equal(response.headers.get('x-auth-state'), 'fresh')
		// Without a write, nothing is sent.
		const quiet = await server.fetch(new Request(`${own}/private`, { headers: { cookie: 'sb-token=ok' } }))
		assert.equal(quiet.status, 200)
		assert.deepEqual(cookiesOf(quiet), [])
	} finally {
		await server.close()
	}
})

test("a middleware redirect and a failed loader still send the request's cookies", async () => {
	const server = await app()
	try {
		const redirected = await server.fetch(new Request(`${own}/private`))
		assert.equal(redirected.status, 302)
		assert.equal(redirected.headers.get('location'), '/login')
		assert.deepEqual(cookiesOf(redirected), ['return-to=%2Fprivate; Path=/; Secure; SameSite=Lax'])
		const broken = await server.fetch(new Request(`${own}/broken`))
		assert.equal(broken.status, 409)
		assert.deepEqual(cookiesOf(broken), ['attempt=1; Path=/; HttpOnly; Secure; SameSite=Lax'])
	} finally {
		await server.close()
	}
})

test('a stream sends the cookies written before its first byte and refuses later ones with RESPONSE_LOCKED', async () => {
	const failures: unknown[] = []
	const server = await app({ onError: (error) => failures.push(error) })
	try {
		const response = await server.fetch(new Request(`${own}/stream`))
		assert.equal(response.status, 200)
		assert.deepEqual(cookiesOf(response), ['before=first-byte; Path=/; HttpOnly; Secure; SameSite=Lax'])
		const html = await response.text()
		assert.match(html, /"code":"RESPONSE_LOCKED","status":500/)
		assert.doesNotMatch(html, /never/)
		assert.equal((failures[0] as ApiError).code, 'RESPONSE_LOCKED')
		assert.match((failures[0] as Error).message, /render: "stream"/)
	} finally {
		await server.close()
	}
})

test("Meeko's session cookie keeps working and cannot be written through cookies", async () => {
	const sessions = new SessionManager({ store: new MemorySessionStore(), production: false })
	const handle = await sessions.load(new Request(own))
	const record = await handle.create({ user: 'ada' })
	const context = createRequestContext(new Request(own, { headers: { cookie: `${sessions.cookieName}=${record.id}; theme=dark` } }), {}, await sessions.load(new Request(own, { headers: { cookie: `${sessions.cookieName}=${record.id}` } })))
	assert.equal(context.cookies.get(sessions.cookieName), record.id, 'the session cookie can be read')
	assert.equal(context.cookies.get('theme'), 'dark')
	assert.deepEqual(
		context.cookies.getAll().map((cookie) => cookie.name),
		[sessions.cookieName, 'theme'],
	)
	assert.throws(() => context.cookies.set(sessions.cookieName, 'x'), /change it with context\.session/)
	assert.throws(() => context.cookies.delete(sessions.cookieName), /change it with context\.session/)
	await sessions.close()
})

test('sessions: false starts production without Redis; context.session explains itself and auth asks isAuthenticated', async () => {
	await assert.rejects(createServerApp({ manifest, load, production: true, platform: { name: 'node', env: {}, waitUntil() {} } }), /return \{ sessions: false \} if the application authenticates on its own/)
	const seen: string[] = []
	const runtime =
		(extra: Partial<ServerRuntime<unknown, Record<string, string>>> = {}) =>
		() => ({
			sessions: false as const,
			allowedOrigins: ['https://admin.shop.example'],
			services: (_request: Request, { cookies }: { cookies: RequestContext['cookies'] }) => {
				seen.push(cookies.get('sb-token') ?? 'none')
				return { user: cookies.get('sb-token') }
			},
			onError: () => {},
			...extra,
		})
	const server = await createServerApp({ manifest, load, production: true, platform: { name: 'node', env: {}, waitUntil() {} }, runtime: runtime({ isAuthenticated: ({ services }) => (services as { user?: string }).user !== undefined }) })
	try {
		const session = await server.fetch(new Request(`${own}/api/session`))
		assert.equal(session.status, 500, 'reading context.session is an error, not undefined')
		const anonymous = await server.fetch(new Request(`${own}/api/me`))
		assert.equal(anonymous.status, 401)
		const signedIn = await server.fetch(new Request(`${own}/api/me`, { headers: { cookie: 'sb-token=tok' } }))
		assert.deepEqual(await signedIn.json(), { value: 'tok' })
		assert.ok(seen.includes('tok'), 'the services factory read the cookie')
		// The Origin and Fetch Metadata checks stay, with the runtime's allowedOrigins.
		assert.equal((await server.fetch(new Request(`${own}/api/limited`, { method: 'POST' }))).status, 403)
		assert.equal((await server.fetch(new Request(`${own}/api/limited`, { method: 'POST', headers: { origin: own, 'sec-fetch-site': 'cross-site' } }))).status, 403)
		assert.equal((await server.fetch(new Request(`${own}/api/limited`, { method: 'POST', headers: { origin: 'https://admin.shop.example', 'sec-fetch-site': 'same-site' } }))).status, 204)
		// rateLimit counts without a session store.
		assert.equal((await server.fetch(new Request(`${own}/api/limited`, { method: 'POST', headers: { origin: own } }))).status, 429)
		// Pages render and set cookies; no session cookie name is reserved.
		readByRpc = []
		const home = await server.fetch(new Request(`${own}/`, { headers: { cookie: 'sb-token=stale' } }))
		assert.equal(home.status, 200)
		assert.deepEqual(readByRpc, ['fresh'])
		assert.equal(home.headers.get('x-meeko-csrf-token'), '')
	} finally {
		await server.close()
	}
	// Without isAuthenticated, auth: "required" is a configuration error, never a silent 401.
	const unconfigured = await createServerApp({ manifest, load, production: false, runtime: runtime() })
	try {
		assert.equal((await unconfigured.fetch(new Request(`${own}/api/me`, { headers: { cookie: 'sb-token=tok' } }))).status, 500)
	} finally {
		await unconfigured.close()
	}
	// allowedOrigins next to an own SessionManager is ambiguous.
	let closed = false
	await assert.rejects(
		createServerApp({
			manifest,
			load,
			production: false,
			runtime: () => ({
				sessions: new SessionManager({ store: new MemorySessionStore() }),
				allowedOrigins: ['https://admin.shop.example'],
				close: () => {
					closed = true
				},
			}),
		}),
		/declare allowedOrigins in it/,
	)
	assert.ok(closed)
})

test('a Socket handshake reads cookies and cannot write them', async () => {
	const server = await app()
	try {
		const request = new Request(`${own}/_meeko/socket/live`, { headers: { origin: own, cookie: 'sb-token=fresh' } })
		socketWrite = undefined
		await server.socket!.hub.preflight('live', request)
		assert.ok(socketWrite instanceof TypeError)
		assert.match((socketWrite as Error).message, /Socket handshake/)
		await assert.rejects(server.socket!.hub.preflight('live', new Request(`${own}/_meeko/socket/live`, { headers: { origin: own } })), /FORBIDDEN/)
	} finally {
		await server.close()
	}
})

test('Sec-Fetch-Site refuses cross-site and same-site mutations, also without a session, except listed origins and origin: "none"', async () => {
	const server = await app({}, {})
	const allowedApp = await createServerApp({ manifest, load, production: false, runtime: () => ({ sessions: new SessionManager({ store: new MemorySessionStore(), allowedOrigins: ['https://partner.example'] }), onError: () => {} }) })
	try {
		const send = (target: ServerApp, path: string, headers: Record<string, string>) => target.fetch(new Request(`${own}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: '{}' }))
		const matrix: Array<[Record<string, string>, number]> = [
			[{ origin: own, 'sec-fetch-site': 'same-origin' }, 200],
			[{ origin: own, 'sec-fetch-site': 'none' }, 200],
			[{ origin: own }, 200],
			[{ origin: own, 'sec-fetch-site': 'cross-site' }, 403],
			[{ origin: own, 'sec-fetch-site': 'Same-Site' }, 403],
			[{ origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' }, 403],
			[{ 'sec-fetch-site': 'same-origin' }, 403],
		]
		for (const [headers, status] of matrix) {
			const response = await send(server, '/_meeko/rpc/cookie/read', headers)
			assert.equal(response.status, status, JSON.stringify(headers))
			if (status === 403) assert.equal(((await response.json()) as { code: string }).code, 'INVALID_ORIGIN')
		}
		// An origin the application lists is trusted whatever the browser says about its site.
		assert.equal((await send(allowedApp, '/_meeko/rpc/cookie/read', { origin: 'https://partner.example', 'sec-fetch-site': 'cross-site' })).status, 200)
		// Webhooks and cron keep their exemption.
		assert.equal((await send(server, '/api/webhook', { 'sec-fetch-site': 'cross-site', origin: 'https://evil.example' })).status, 204)
		assert.equal((await send(server, '/api/webhook', {})).status, 204)
		// A native form is refused the same way.
		const form = await server.fetch(new Request(`${own}/api/form`, { method: 'POST', headers: { origin: own, 'sec-fetch-site': 'cross-site', 'content-type': 'application/x-www-form-urlencoded' }, body: '' }))
		assert.equal(form.status, 403)
	} finally {
		await server.close()
		await allowedApp.close()
	}
})
