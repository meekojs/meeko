// F5: the administrator login. The rules (durations, open redirect, production refusal) without a
// server; then the real `meeko dev` against a temporary schema with migration 005, so the sessions
// and rate limit counters live in PostgreSQL as in production. The test account exists only in the
// environment of that server. The tables of the database it connects to are never read or written.
// The HTTP part is skipped without DATABASE_URL (apps/dashboard/.env is loaded).
import { discoverConfiguredRoutes, discoverServerManifest } from '@meekojs/meeko/build'
import { createDatabase, migrate } from 'meeko-docs-content/db'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { after, before, describe, test } from 'node:test'
import { fileURLToPath } from 'node:url'

import { assertProductionAuth, authConfig, loginLocation, logoutLocation, parseDuration, safeNext, withConstantFailure } from '../server/dashboard/auth'
import { createDashboardSessions } from '../server/dashboard/sessions'
import runtime from '../server/runtime'
import { startDashboard, testAdmin } from './fixtures/auth.mjs'

const app = fileURLToPath(new URL('../', import.meta.url))
if (!process.env.DATABASE_URL && existsSync(join(app, '.env'))) process.loadEnvFile(join(app, '.env'))
const url = process.env.DATABASE_URL

describe('login rules', () => {
	test('durations and limits come from the environment, with safe defaults', () => {
		assert.equal(parseDuration('30m', 'X'), 1_800_000)
		assert.equal(parseDuration('12h', 'X'), 43_200_000)
		assert.equal(parseDuration('45s', 'X'), 45_000)
		for (const bad of ['', '30', '-1m', '1.5h', '0m', 'una hora']) assert.throws(() => parseDuration(bad, 'X'), TypeError, bad)
		const defaults = authConfig({})
		assert.deepEqual(defaults, { admin: null, ttlMs: 12 * 3_600_000, idleMs: 30 * 60_000, sameSite: 'Strict', ipLimit: 20, userLimit: 5, windowMs: 15 * 60_000 })
		const hash = 'scrypt$131072$8$1$c2FsdA$a2V5'
		assert.deepEqual(authConfig({ ADMIN_USERNAME: ' ada ', ADMIN_PASSWORD_HASH: hash, DASHBOARD_SESSION_SAMESITE: 'Lax' }).admin, { username: 'ada', passwordHash: hash })
		assert.equal(authConfig({ ADMIN_USERNAME: 'ada' }).admin, null, 'both variables or none')
		// A `$` lost to a shell or an interpolation leaves something that is not a hash: refuse to start.
		assert.throws(() => authConfig({ ADMIN_USERNAME: 'ada', ADMIN_PASSWORD_HASH: 'scrypt131072814' }), /ADMIN_PASSWORD_HASH/)
		assert.throws(() => authConfig({ DASHBOARD_SESSION_SAMESITE: 'None' }), /Strict or Lax/)
		assert.throws(() => authConfig({ DASHBOARD_LOGIN_USER_LIMIT: '0' }), /positive integer/)
	})

	test('next only goes to a path of the dashboard: no open redirect', () => {
		for (const [given, expected] of [
			['/sources?site=ui#x', '/sources?site=ui#x'],
			['/sources/12/edit', '/sources/12/edit'],
			['//evil.example', '/'],
			['/\\evil.example', '/'],
			['\\\\evil.example', '/'],
			['https://evil.example/', '/'],
			['http:evil.example', '/'],
			['javascript:alert(1)', '/'],
			['/%2F%2Fevil.example', '/%2F%2Fevil.example'],
			['/./../..//evil.example', '/'],
			['/x\nLocation: https://evil.example', '/'],
			['evil.example', '/'],
			['/login?next=/x', '/'],
			['', '/'],
		] as const) {
			assert.equal(safeNext(given), expected, given)
		}
		assert.equal(safeNext(undefined), '/')
		assert.equal(safeNext(['/x']), '/')
		assert.equal(loginLocation('/sources', '?site=ui'), '/login?next=%2Fsources%3Fsite%3Dui')
		assert.equal(loginLocation('/'), '/login')
	})

	test('the login keeps the language of the address: /en goes to /en/login and back to /en', () => {
		assert.equal(loginLocation('/en/sources', '?site=ui'), '/en/login?next=%2Fen%2Fsources%3Fsite%3Dui')
		assert.equal(loginLocation('/en'), '/en/login')
		assert.equal(safeNext('/en/metrics?lang=en'), '/en/metrics?lang=en')
		// The login page itself, in either language, goes to the overview of its language.
		assert.equal(safeNext('/en/login?next=/x'), '/en')
		assert.equal(safeNext('/login'), '/')
		// The fallback is the overview of the language of the page that asks.
		assert.equal(safeNext(undefined, 'en'), '/en')
		assert.equal(safeNext('//evil.example', 'en'), '/en')
		// The logout goes to the login of the page it was sent from, only from this origin.
		assert.equal(logoutLocation('http://127.0.0.1:4310/en/sources', 'http://127.0.0.1:4310'), '/en/login')
		assert.equal(logoutLocation('http://127.0.0.1:4310/sources', 'http://127.0.0.1:4310'), '/login')
		assert.equal(logoutLocation('https://evil.example/en/x', 'http://127.0.0.1:4310'), '/login')
		assert.equal(logoutLocation(null, 'http://127.0.0.1:4310'), '/login')
	})

	test('production does not start without the login or the database', async () => {
		assert.throws(() => assertProductionAuth(authConfig({}), { DATABASE_URL: 'postgresql://x' }), /ADMIN_USERNAME y ADMIN_PASSWORD_HASH/)
		assert.throws(() => assertProductionAuth(authConfig({ ADMIN_USERNAME: 'a', ADMIN_PASSWORD_HASH: 'scrypt$1$1$1$a$b' }), {}), /DATABASE_URL/)
		assert.doesNotThrow(() => assertProductionAuth(authConfig({ ADMIN_USERNAME: 'a', ADMIN_PASSWORD_HASH: 'scrypt$1$1$1$a$b' }), { DATABASE_URL: 'postgresql://x' }))
		// The runtime itself refuses, so `meeko start` fails before listening; the prerender of the build does not.
		const context = { production: true, prerendering: false, platform: 'node', root: app }
		await assert.rejects(async () => runtime({ ...context, env: { DATABASE_URL: 'postgresql://x' } } as never), /no arranca en producción sin login/)
		const prerender = await runtime({ ...context, prerendering: true, env: {} } as never)
		await prerender.close?.()
	})

	test('the production cookie is __Host-, Secure, HttpOnly and SameSite; development drops only Secure', () => {
		const config = authConfig({ DASHBOARD_SESSION_TTL: '8h' })
		const development = createDashboardSessions(config, null, false)
		assert.equal(development.manager.serializeCookie('x', config.ttlMs), 'meeko-dashboard.sid=x; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800')
		development.stop()
		// The SQL store opens no connection until a request: a pool that is never used is enough here.
		const production = createDashboardSessions(config, {} as never, true)
		assert.equal(production.manager.serializeCookie('x', config.ttlMs), '__Host-meeko-dashboard.sid=x; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800; Secure')
		production.stop()
		// Production never uses the memory store.
		assert.throws(() => createDashboardSessions(config, null, true), /Persistent session storage/)
	})

	test('a failed login always takes at least the same time', async () => {
		const started = performance.now()
		await assert.rejects(
			withConstantFailure(() => Promise.reject(new Error('wrong')), started, 300),
			/wrong/,
		)
		assert.ok(performance.now() - started >= 295)
		const quick = performance.now()
		assert.equal(await withConstantFailure(() => Promise.resolve('ok'), quick, 300), 'ok')
		assert.ok(performance.now() - quick < 200, 'a success is not delayed')
	})
})

describe('login over HTTP', { skip: url ? false : 'DATABASE_URL is not set', timeout: 300_000 }, () => {
	const schema = `dash_auth_${process.pid}_${randomBytes(4).toString('hex')}`
	const admin = createDatabase({ connectionString: url ?? 'postgresql://unused' })
	const db = createDatabase({ connectionString: url ?? 'postgresql://unused', searchPath: schema })
	let account: Awaited<ReturnType<typeof testAdmin>>
	let server: Awaited<ReturnType<typeof startDashboard>>
	let origin = ''
	const cookieName = 'meeko-dashboard.sid'

	before(async () => {
		await admin.query(`CREATE SCHEMA ${schema}`)
		await migrate(db)
		account = await testAdmin()
		server = await startDashboard({
			ADMIN_USERNAME: account.username,
			ADMIN_PASSWORD_HASH: account.hash,
			DASHBOARD_DATABASE_SCHEMA: schema,
			DASHBOARD_LOGIN_IP_LIMIT: '40',
			DASHBOARD_LOGIN_USER_LIMIT: '8',
			DASHBOARD_LOGIN_WINDOW: '15m',
			DASHBOARD_SESSION_TTL: '2h',
			DASHBOARD_SESSION_IDLE: '20m',
		})
		origin = server.origin
	})

	after(async () => {
		await server?.stop()
		await db.end()
		await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
		await admin.end()
	})

	const json = { 'content-type': 'application/json', origin: '' }
	const headers = (extra: Record<string, string> = {}) => ({ ...json, origin, ...extra })
	const sessionCookie = (response: Response) => response.headers.getSetCookie().find((line) => line.startsWith(`${cookieName}=`))
	const cookieValue = (line: string | undefined) => line?.split(';')[0]?.slice(cookieName.length + 1) ?? ''
	const login = (username: string, password: string, extra: Record<string, string> = {}) => fetch(`${origin}/api/auth/login`, { method: 'POST', headers: headers(extra), body: JSON.stringify({ username, password, next: '/sources?site=ui' }), redirect: 'manual' })
	const redirected = (response: Response) => [302, 303, 307].includes(response.status) && new URL(response.headers.get('location')!, origin).pathname === '/login'
	const page = (path: string, cookie?: string) => fetch(`${origin}${path}`, { headers: cookie ? { cookie: `${cookieName}=${cookie}` } : {}, redirect: 'manual' })
	/** The CSRF token of a session, from the meta of a page. */
	async function csrf(cookie: string): Promise<string> {
		const html = await (await page('/health', cookie)).text()
		const token = /<meta name="meeko-csrf-token" content="([^"]+)"/.exec(html)?.[1]
		assert.ok(token, 'the page carries the CSRF token of the session')
		return token
	}

	test('without a session every page redirects to /login and every RPC and API answers 401', async () => {
		const routes = await discoverConfiguredRoutes(app)
		const pages = routes.map((route) => route.id).filter((id) => id !== '/login' && id !== '/en/login')
		assert.ok(pages.length >= 16, 'the manifest has the pages of the dashboard in both languages')
		assert.ok(pages.includes('/en/sources/[id]/edit'), 'the English versions are pages too')
		for (const id of pages) {
			const path = id.replace(/\[[^\]]+\]/g, '1')
			const response = await page(path)
			assert.ok([302, 303, 307].includes(response.status), `${path}: ${response.status}`)
			const location = new URL(response.headers.get('location')!, origin)
			// The login of the language of the page, which comes back to the same address.
			const english = path === '/en' || path.startsWith('/en/')
			assert.equal(location.pathname, english ? '/en/login' : '/login', path)
			assert.equal(location.searchParams.get('next') ?? (english ? '/en' : '/'), path, `${path} comes back after the login`)
		}
		// The login page itself is open, in both languages, and so are the assets.
		assert.equal((await page('/login')).status, 200)
		assert.equal((await page('/en/login')).status, 200)
		assert.equal((await page('/brand/meeko-logo.png')).status, 200)

		// Every procedure, with an allowed Origin: 401, so a new one cannot stay open by mistake.
		// The only exception says who is logged in, and answers about the request's own session.
		const manifest = await discoverServerManifest(app)
		const open = new Set(['auth.session'])
		assert.ok(manifest.rpc.length >= 28)
		for (const procedure of manifest.rpc) {
			const response = await fetch(`${origin}${procedure.pathname}`, { method: 'POST', headers: headers(), body: '{}' })
			if (open.has(procedure.id)) {
				assert.equal(response.status, 200, procedure.id)
				assert.deepEqual(await response.json(), { user: null })
				continue
			}
			assert.equal(response.status, 401, `${procedure.id} must declare auth: 'required'`)
			assert.equal(((await response.json()) as { code: string }).code, 'UNAUTHENTICATED', procedure.id)
		}
		for (const endpoint of manifest.api) {
			if (endpoint.pathname === '/api/auth/login') continue
			const response = await fetch(`${origin}${endpoint.pathname}`, { method: endpoint.method, headers: headers(), body: endpoint.method === 'GET' ? null : '{}' })
			assert.equal(response.status, 401, `${endpoint.method} ${endpoint.pathname}`)
		}
	})

	test('a wrong user and a wrong password fail the same way, after the same time', async () => {
		for (const [username, password] of [
			[account.username, 'not-the-password'],
			['someone', account.password],
		] as const) {
			const started = performance.now()
			const response = await login(username, password)
			const elapsed = performance.now() - started
			assert.equal(response.status, 401)
			assert.equal(((await response.json()) as { code: string }).code, 'INVALID_CREDENTIALS')
			assert.equal(sessionCookie(response), undefined, 'no session')
			assert.ok(elapsed >= 950, `${elapsed} ms`)
		}
	})

	test('the right account logs in, with a session in PostgreSQL and a new ID at each login', async () => {
		const first = await login(account.username, account.password)
		assert.equal(first.status, 200)
		assert.deepEqual(await first.json(), { next: '/sources?site=ui' })
		const line = sessionCookie(first)
		assert.match(line ?? '', /; HttpOnly/)
		assert.match(line ?? '', /SameSite=Strict/)
		assert.match(line ?? '', /Max-Age=7200/, 'the absolute lifetime of DASHBOARD_SESSION_TTL')
		const id = cookieValue(line)
		const rows = await db.query<{ data_json: string }>('SELECT data_json FROM dashboard_sessions WHERE id = $1', [id])
		assert.deepEqual(JSON.parse(rows.rows[0]!.data_json), { user: account.username })

		const overview = await page('/', id)
		assert.equal(overview.status, 200)
		assert.match(await overview.text(), new RegExp(`class="dash-user"[^>]*>(?:\\s|<!--[^>]*-->)*${account.username}`))
		// Logged in, /login goes on to `next`, and /en/login without one to the English overview.
		assert.equal(new URL((await page('/login?next=%2Fhealth', id)).headers.get('location')!, origin).pathname, '/health')
		assert.equal(new URL((await page('/en/login', id)).headers.get('location')!, origin).pathname, '/en')
		assert.equal((await page('/en/sources', id)).status, 200, 'the English pages open with the same session')

		// Logging in again with that cookie rotates the ID: the old one no longer opens anything. With
		// a live session the login is an authenticated mutation, so it needs the session's CSRF token
		// (the login page sends a logged-in browser on to `next` anyway).
		const second = await login(account.username, account.password, { cookie: `${cookieName}=${id}`, 'x-meeko-csrf': await csrf(id) })
		assert.equal(second.status, 200)
		const rotated = cookieValue(sessionCookie(second))
		assert.ok(rotated && rotated !== id)
		assert.ok(redirected(await page('/', id)))
		assert.equal((await page('/', rotated)).status, 200)
	})

	test('mutations need the session CSRF token and the Origin; logout is a POST with both', async () => {
		const response = await login(account.username, account.password)
		const id = cookieValue(sessionCookie(response))
		const cookie = `${cookieName}=${id}`
		const token = await csrf(id)
		const call = (extra: Record<string, string>) => fetch(`${origin}/_meeko/rpc/jobs/start`, { method: 'POST', headers: headers({ cookie, ...extra }), body: JSON.stringify({ kind: 'nothing' }) })
		assert.equal(((await (await call({})).json()) as { code: string }).code, 'INVALID_CSRF')
		assert.equal(((await (await call({ 'x-meeko-csrf': token, origin: 'https://evil.example' })).json()) as { code: string }).code, 'INVALID_ORIGIN')
		assert.equal((await call({ 'x-meeko-csrf': token })).status, 400, 'with both, the input is validated')
		// A read is a POST too, so it also needs the token.
		const overview = await fetch(`${origin}/_meeko/rpc/overview/get`, { method: 'POST', headers: headers({ cookie, 'x-meeko-csrf': token }), body: '{}' })
		assert.equal(overview.status, 200)

		// Logout without the token is refused; with it, the family is deleted and the cookie emptied.
		assert.equal((await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: headers({ cookie }) })).status, 403)
		const out = await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: headers({ cookie, 'x-meeko-csrf': token }) })
		assert.equal(out.status, 204)
		assert.match(sessionCookie(out) ?? '', /Max-Age=0/)
		assert.equal((await db.query('SELECT 1 FROM dashboard_sessions WHERE id = $1', [id])).rowCount, 0)
		assert.ok(redirected(await page('/', id)))
	})

	test('the native form logs in without JavaScript, and logs out with the _csrf field', async () => {
		const form = (body: Record<string, string>, cookie?: string) => fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin, ...(cookie ? { cookie } : {}) }, body: new URLSearchParams(body), redirect: 'manual' })
		const failed = await form({ username: account.username, password: 'wrong', next: '/metrics', return: '/login?next=%2Fmetrics' })
		assert.equal(failed.status, 303)
		const back = new URL(failed.headers.get('location')!, origin)
		assert.deepEqual([back.pathname, back.searchParams.get('next')], ['/login', '/metrics'])
		const flash = failed.headers.getSetCookie().find((line) => line.startsWith('meeko-form='))
		assert.ok(flash, 'the result travels in the one-use cookie')
		// The login page paints the generic error from it, with the user name and never the password.
		const painted = await (await fetch(`${origin}/login?next=%2Fmetrics`, { headers: { cookie: flash.split(';')[0]! } })).text()
		assert.match(painted, /El usuario o la contraseña no son correctos\./)
		assert.match(painted, new RegExp(`value="${account.username}"`))
		assert.doesNotMatch(painted, /value="wrong"/)

		const ok = await form({ username: account.username, password: account.password, next: '//evil.example', return: '/login' })
		assert.equal(ok.status, 303)
		assert.equal(new URL(ok.headers.get('location')!, origin).href, `${origin}/`, 'an outside next goes to the overview')
		const cookie = sessionCookie(ok)!.split(';')[0]!
		const token = await csrf(cookie.slice(cookieName.length + 1))
		const out = await fetch(`${origin}/api/auth/logout`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin, cookie }, body: new URLSearchParams({ _csrf: token }), redirect: 'manual' })
		assert.equal(out.status, 303)
		assert.equal(new URL(out.headers.get('location')!, origin).pathname, '/login')
		// Another site's form cannot log in: no Origin of the dashboard, no session (login CSRF).
		const forged = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', origin: 'https://evil.example' }, body: new URLSearchParams({ username: account.username, password: account.password }), redirect: 'manual' })
		assert.equal(forged.status, 403)
		assert.equal(sessionCookie(forged), undefined)
	})

	test('a session ends when it goes idle and when it expires', async () => {
		const idle = cookieValue(sessionCookie(await login(account.username, account.password)))
		assert.equal((await page('/', idle)).status, 200)
		// 21 minutes without requests, with DASHBOARD_SESSION_IDLE=20m.
		await db.query('UPDATE dashboard_sessions SET last_seen_at = last_seen_at - 21 * 60000 WHERE id = $1', [idle])
		assert.ok(redirected(await page('/', idle)))
		assert.equal((await db.query('SELECT 1 FROM dashboard_sessions WHERE id = $1', [idle])).rowCount, 0, 'and it is deleted')

		const expired = cookieValue(sessionCookie(await login(account.username, account.password)))
		await db.query('UPDATE dashboard_sessions SET expires_at = $2 WHERE id = $1', [expired, Date.now() - 1])
		assert.ok(redirected(await page('/', expired)))
	})

	test('login attempts are limited per user name, for any name, and per IP', async () => {
		// The account already used its 8 attempts of the window in the tests above, logins included.
		const blocked = await login(account.username, account.password)
		assert.equal(blocked.status, 429)
		assert.equal(((await blocked.json()) as { code: string }).code, 'RATE_LIMITED')
		assert.equal(sessionCookie(blocked), undefined, 'not even with the right password')
		// A name that does not exist is limited the same way, so the limit does not reveal accounts.
		let last = 0
		for (let attempt = 1; attempt <= 9; attempt++) last = (await login('Nadie', 'x')).status
		assert.equal(last, 429)
		// Per IP, before reading the body: invalid bodies count too, until 429 with Retry-After.
		let response: Response | undefined
		for (let attempt = 0; attempt < 45; attempt++) {
			response = await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: headers(), body: '{}' })
			if (response.status === 429) break
		}
		assert.equal(response?.status, 429)
		assert.ok(Number(response?.headers.get('retry-after')) > 0)
		const counters = await db.query<{ key: Buffer }>('SELECT key FROM dashboard_rate_limits')
		assert.ok(counters.rowCount! >= 3, 'the counters live in PostgreSQL')
	})
})
