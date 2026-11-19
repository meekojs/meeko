import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import type { AppManifest, Schema, ServerApp } from '../src/framework-server.ts'
import type { DevAllowedHosts } from '../src/server/runtime/dev-hosts.ts'

import { createServerApp, createSocketHub, defineApiRoute, defineRpc, defineSocketChannel, MemorySessionStore, SessionManager } from '../src/framework-server.ts'
import { loadMeekoConfig } from '../src/framework/config.ts'
import { devViteAllowedHosts } from '../src/framework/project.ts'
import { blockedDevHostMessage, isDevHostAllowed, isDevOriginAllowed, mergeDevAllowedHosts, normalizeDevAllowedHost, parseAllowedHostsEnv, rejectedDevOriginMessage, viteAllowedHosts } from '../src/server/runtime/dev-hosts.ts'
import { allowDevHosts } from '../src/server/runtime/sessions.ts'

// `dev.allowedHosts` opens `meeko dev` to a proxy or a tunnel (tailscale serve, ngrok, a LAN name):
// Vite's host check and the Origin checks of API, RPC, forms, sessions and Socket, only in dev.

/** A tunnel that terminates TLS: the browser is at https://box…, Meeko sees http://box… */
const tunnel = 'box.tailnet.ts.net'
const tunnelUrl = `http://${tunnel}`
const tunnelOrigin = `https://${tunnel}`

const anySchema: Schema<unknown> = { '~standard': { version: 1, validate: (value) => ({ value }) } }
const okSchema: Schema<{ ok: true }> = { '~standard': { version: 1, validate: (value) => ({ value: value as { ok: true } }) } }

const manifest: AppManifest = {
	version: 1,
	routes: [],
	server: {
		api: [
			{ kind: 'api', file: '/items', pathname: '/api/items', method: 'POST', clientKey: 'items.post' },
			{ kind: 'api', file: '/form', pathname: '/api/form', method: 'POST', clientKey: 'form.post' },
			{ kind: 'api', file: '/login', pathname: '/api/login', method: 'POST', clientKey: 'login.post' },
		],
		rpc: [{ kind: 'rpc', file: '/rpc', pathname: '/_meeko/rpc/items/add', id: 'items.add' }],
	},
	routeMiddleware: [],
	serverMiddleware: [],
	client: { entry: '/assets/entry.js', css: [], preload: [] },
}

const modules: Record<string, unknown> = {
	'/items': { default: defineApiRoute({ response: okSchema, handler: () => ({ ok: true as const }) }) },
	'/form': { default: defineApiRoute({ form: true, status: 204, handler: () => {} }) },
	'/login': { default: defineApiRoute({ response: okSchema, handler: async ({ context }) => (await context.session.create({ user: 'ada' }), { ok: true as const }) }) },
	'/rpc': { default: defineRpc({ input: anySchema, output: okSchema, handler: () => ({ ok: true as const }) }) },
}

async function app(options: { devAllowedHosts?: DevAllowedHosts; production?: boolean } = {}): Promise<{ server: ServerApp; sessions: SessionManager }> {
	const production = options.production === true
	const store = new MemorySessionStore()
	// A persistent-looking store, so a production manager can be built in this test.
	if (production) Object.assign(store, { persistent: true })
	const sessions = new SessionManager({ store, production, secure: false })
	const server = await createServerApp({
		manifest,
		production,
		load: async (key) => modules[key],
		runtime: () => ({ sessions, onError: () => {} }),
		...(options.devAllowedHosts === undefined ? {} : { devAllowedHosts: options.devAllowedHosts }),
	})
	return { server, sessions }
}

function send(server: ServerApp, path: string, origin: string | undefined, base = tunnelUrl): Promise<Response> {
	const headers: Record<string, string> = {}
	let body: BodyInit | undefined
	if (path.startsWith('/_meeko/rpc/') || path === '/api/items' || path === '/api/login') {
		headers['content-type'] = 'application/json'
		body = '{}'
	} else {
		headers['content-type'] = 'application/x-www-form-urlencoded'
		body = 'a=1'
	}
	if (origin !== undefined) headers.origin = origin
	return server.fetch(new Request(`${base}${path}`, { method: 'POST', headers, body }))
}

async function code(response: Response): Promise<string | undefined> {
	return response.headers.get('content-type')?.includes('json') ? ((await response.json()) as { code?: string }).code : undefined
}

/** Runs `run` with console.warn captured. */
async function warningsOf(run: () => Promise<void>): Promise<string> {
	const original = console.warn
	let written = ''
	console.warn = (...args: unknown[]) => {
		written += `${args.map(String).join(' ')}\n`
	}
	try {
		await run()
	} finally {
		console.warn = original
	}
	return written
}

const paths = ['/api/items', '/api/form', '/api/login', '/_meeko/rpc/items/add'] as const

test('normalizeDevAllowedHost accepts host names, suffixes and origins, and explains the rest', () => {
	assert.deepEqual(normalizeDevAllowedHost(' Box.Tailnet.TS.net '), { value: 'box.tailnet.ts.net' })
	assert.deepEqual(normalizeDevAllowedHost('.ngrok-free.app'), { value: '.ngrok-free.app' })
	assert.deepEqual(normalizeDevAllowedHost('https://Dev.Example.com:8443/'), { value: 'https://dev.example.com:8443' })
	for (const [entry, error] of [
		['', /no vacía/],
		[42, /no vacía/],
		['box.local:4173', /nombre de host/],
		['ftp://box.local', /http:\/\/ o https:\/\//],
		['https://box.local/app', /sin ruta/],
	] as const) {
		const result = normalizeDevAllowedHost(entry)
		assert.ok('error' in result, String(entry))
		assert.match(result.error, error)
	}
})

test('MEEKO_ALLOWED_HOSTS lists hosts separated by commas, or true', () => {
	assert.deepEqual(parseAllowedHostsEnv(undefined), [])
	assert.deepEqual(parseAllowedHostsEnv('  '), [])
	assert.equal(parseAllowedHostsEnv('true'), true)
	assert.deepEqual(parseAllowedHostsEnv('a.local, .ts.net,,https://b.example'), ['a.local', '.ts.net', 'https://b.example'])
	assert.throws(() => parseAllowedHostsEnv('a.local:80'), /MEEKO_ALLOWED_HOSTS: "a\.local:80"/)
	assert.deepEqual(mergeDevAllowedHosts(['a.local'], ['a.local', 'b.local'], undefined), ['a.local', 'b.local'])
	assert.equal(mergeDevAllowedHosts(['a.local'], true), true)
})

test('loadMeekoConfig validates dev.allowedHosts', async () => {
	const root = await mkdtemp(join(tmpdir(), 'meeko-config-allowed-hosts-'))
	try {
		const file = join(root, 'meeko.config.mjs')
		await writeFile(file, `export default { dev: { allowedHosts: ["${tunnel}", ".ngrok-free.app", "https://dev.example.com"] } };\n`)
		assert.deepEqual((await loadMeekoConfig(root)).dev?.allowedHosts, [tunnel, '.ngrok-free.app', 'https://dev.example.com'])
		await writeFile(file, `export default { dev: { allowedHosts: true } };\n`)
		assert.equal((await loadMeekoConfig(root)).dev?.allowedHosts, true)
		for (const [value, error] of [
			['"box.local"', /dev\.allowedHosts debe ser true o una lista de hosts/],
			['false', /dev\.allowedHosts debe ser true o una lista de hosts/],
			['["ok.local", "box.local:4173"]', /dev\.allowedHosts\[1\] "box\.local:4173" debe ser un nombre de host/],
			['[""]', /dev\.allowedHosts\[0\] debe ser una cadena no vacía/],
		] as const) {
			await writeFile(file, `export default { dev: { allowedHosts: ${value} } };\n`)
			await assert.rejects(loadMeekoConfig(root), error, value)
		}
	} finally {
		await rm(root, { recursive: true, force: true })
	}
})

test('the host check follows Vite: IPs and localhost always pass, the rest by name or .suffix', () => {
	const allowed = viteAllowedHosts([tunnel, '.ngrok-free.app', 'https://dev.example.com:8443'])
	assert.deepEqual(allowed, [tunnel, '.ngrok-free.app', 'dev.example.com'])
	for (const host of [undefined, '127.0.0.1:4173', '[::1]:4173', 'localhost:4173', 'app.localhost', `${tunnel}`, `${tunnel}:443`, 'abc.ngrok-free.app', 'ngrok-free.app', 'dev.example.com:8443', 'BOX.TAILNET.TS.NET']) {
		assert.equal(isDevHostAllowed(host, allowed), true, String(host))
	}
	for (const host of ['evil.example', 'box.tailnet.ts.net.evil.example', 'xngrok-free.app', 'mi-pc.local:4173']) {
		assert.equal(isDevHostAllowed(host, allowed), false, host)
		assert.equal(isDevHostAllowed(host, []), false, host)
	}
	assert.equal(isDevHostAllowed('anything.example', true), true)
	assert.match(blockedDevHostMessage('mi-pc.local'), /"mi-pc\.local".*dev\.allowedHosts en meeko\.config\.ts.*MEEKO_ALLOWED_HOSTS/)
})

test('meeko dev gives Vite the listening host and the public origin besides dev.allowedHosts', () => {
	assert.deepEqual(devViteAllowedHosts([tunnel], 'Mi-PC.local', 'https://public.example'), [tunnel, 'mi-pc.local', 'public.example'])
	assert.deepEqual(devViteAllowedHosts([], '127.0.0.1', undefined), ['127.0.0.1'])
	assert.equal(devViteAllowedHosts(true, '127.0.0.1', undefined), true)
})

test('a dev origin rule accepts http and https of a listed host, a full origin exactly, and with true only the request host', () => {
	const hosts = [tunnel, '.ngrok-free.app', 'https://dev.example.com:8443']
	for (const origin of [tunnelOrigin, `http://${tunnel}`, `https://${tunnel}:8443`, 'https://abc.ngrok-free.app', 'https://dev.example.com:8443']) {
		assert.equal(isDevOriginAllowed(origin, `${tunnelUrl}/api`, hosts), true, origin)
	}
	for (const origin of ['https://evil.example', 'https://dev.example.com', 'http://dev.example.com:8443', `https://${tunnel}.evil.example`, 'null', `ws://${tunnel}`, `${tunnelOrigin}/`]) {
		assert.equal(isDevOriginAllowed(origin, `${tunnelUrl}/api`, hosts), false, origin)
	}
	assert.equal(isDevOriginAllowed(tunnelOrigin, `${tunnelUrl}/api`, true), true)
	assert.equal(isDevOriginAllowed('https://evil.example', `${tunnelUrl}/api`, true), false)
	assert.equal(isDevOriginAllowed(tunnelOrigin, `${tunnelUrl}/api`, []), false)
})

test('without dev.allowedHosts a tunnel that terminates TLS fails the Origin checks, as before', async () => {
	const { server } = await app()
	try {
		for (const path of paths) {
			const response = await send(server, path, tunnelOrigin)
			assert.equal(response.status, 403, path)
			assert.equal(await code(response), 'INVALID_ORIGIN', path)
		}
	} finally {
		await server.close()
	}
})

test('dev.allowedHosts lets API, RPC, forms and session.create accept the tunnel origin in development', async () => {
	const { server } = await app({ devAllowedHosts: [tunnel] })
	try {
		for (const path of paths) {
			const response = await send(server, path, tunnelOrigin)
			// A native form answers with a redirect back to the page.
			assert.ok([200, 204, 303].includes(response.status), `${path}: ${response.status}`)
		}
		// The app's own origin still passes, and other sites are still refused.
		assert.equal((await send(server, '/api/items', tunnelUrl)).status, 200)
		for (const path of paths) {
			for (const origin of ['https://evil.example', undefined]) {
				const response = await send(server, path, origin)
				assert.equal(response.status, 403, `${path} ${origin}`)
				assert.equal(await code(response), 'INVALID_ORIGIN')
			}
		}
	} finally {
		await server.close()
	}
})

test('true accepts the request host whatever the scheme, never another site', async () => {
	const { server } = await app({ devAllowedHosts: true })
	try {
		assert.equal((await send(server, '/_meeko/rpc/items/add', tunnelOrigin)).status, 200)
		assert.equal((await send(server, '/_meeko/rpc/items/add', 'https://evil.example')).status, 403)
	} finally {
		await server.close()
	}
})

test('a refused Origin in development warns once with the option that allows it', async () => {
	const { server } = await app({ devAllowedHosts: [] })
	try {
		const origin = 'https://refused-once.example'
		const warnings = await warningsOf(async () => {
			assert.equal((await send(server, '/_meeko/rpc/items/add', origin)).status, 403)
			assert.equal((await send(server, '/api/items', origin)).status, 403)
		})
		assert.equal(warnings.match(/refused-once/g)?.length, 2, warnings)
		assert.match(warnings, /meeko dev rechazó una petición con Origin "https:\/\/refused-once\.example" \(403 INVALID_ORIGIN\)/)
		assert.match(warnings, /añada "refused-once\.example" a dev\.allowedHosts en meeko\.config\.ts o a la variable MEEKO_ALLOWED_HOSTS/)
		assert.equal(warnings.split('\n').filter(Boolean).length, 1, 'once per origin')
		assert.match(rejectedDevOriginMessage(null), /sin cabecera Origin/)
	} finally {
		await server.close()
	}
})

test('production ignores devAllowedHosts: nothing is relaxed and nothing warns', async () => {
	const { server, sessions } = await app({ devAllowedHosts: true, production: true })
	try {
		const warnings = await warningsOf(async () => {
			for (const path of ['/api/items', '/_meeko/rpc/items/add']) {
				const response = await send(server, path, tunnelOrigin)
				assert.equal(response.status, 403, path)
				assert.equal(await code(response), 'INVALID_ORIGIN')
			}
		})
		assert.doesNotMatch(warnings, /dev\.allowedHosts/)
		// A production manager refuses the dev hosts even when asked directly.
		sessions[allowDevHosts]([tunnel])
		assert.equal((await send(server, '/api/items', tunnelOrigin)).status, 403)
	} finally {
		await server.close()
	}
})

test('the Socket handshake follows the dev hosts of the sessions manager', async () => {
	const channel = defineSocketChannel({ clientToServer: { message: anySchema }, serverToClient: { message: anySchema }, handlers: { message: () => {} } })
	const handshake = (origin: string) => new Request(`${tunnelUrl}/_meeko/socket/chat`, { headers: { origin } })
	const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false })
	const hub = createSocketHub({ channels: { chat: channel }, sessions, services: {} })
	try {
		await assert.rejects(hub.preflight('chat', handshake(tunnelOrigin)), { code: 'INVALID_ORIGIN' })
		sessions[allowDevHosts]([tunnel])
		await hub.preflight('chat', handshake(tunnelOrigin))
		await assert.rejects(hub.preflight('chat', handshake('https://evil.example')), { code: 'INVALID_ORIGIN' })
	} finally {
		await sessions.close()
	}
})

test('session.create() outside a guard accepts the tunnel origin only with dev hosts', async () => {
	const sessions = new SessionManager({ store: new MemorySessionStore(), secure: false })
	const login = () => new Request(`${tunnelUrl}/login`, { method: 'POST', headers: { origin: tunnelOrigin } })
	try {
		await assert.rejects((await sessions.load(login())).create({ user: 'ada' }), { code: 'INVALID_ORIGIN' })
		sessions[allowDevHosts]([tunnel])
		const created = await (await sessions.load(login())).create({ user: 'ada' })
		assert.ok(created.csrfToken)
	} finally {
		await sessions.close()
	}
})
