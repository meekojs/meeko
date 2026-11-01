// The test account of F5 and the dashboard's `meeko dev` for the tests. The account exists only in
// the environment of the server a test starts (the real environment wins over apps/dashboard/.env),
// with a random password: no real credential or hash is ever written.
import { hashPassword } from '@meekojs/meeko/password'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { fileURLToPath } from 'node:url'

const app = fileURLToPath(new URL('../../', import.meta.url))
const cli = fileURLToPath(new URL('../../../../packages/meeko/dist/cli.js', import.meta.url))

/** A test administrator: a user name, a random password and its scrypt hash. */
export async function testAdmin(username = 'f5-test-admin') {
	const password = randomBytes(18).toString('base64url')
	return { username, password, hash: await hashPassword(password) }
}

/** The login variables of `admin` for the environment of a server. */
export function adminEnv(admin) {
	return { ADMIN_USERNAME: admin.username, ADMIN_PASSWORD_HASH: admin.hash }
}

/** A free TCP port of 127.0.0.1. */
export async function freePort() {
	const server = createServer().listen(0, '127.0.0.1')
	await once(server, 'listening')
	const value = server.address().port
	await new Promise((done) => server.close(done))
	return value
}

/**
 * Starts `meeko dev` of the dashboard with `env` added to this process's, and waits until it
 * answers. Returns its origin, its output and `stop()`, which kills it.
 */
export async function startDashboard(env) {
	const httpPort = await freePort()
	const hmrPort = await freePort()
	const server = spawn(process.execPath, [cli, 'dev', app], {
		cwd: app,
		env: { ...process.env, ...env, PORT: String(httpPort), MEEKO_HMR_PORT: String(hmrPort), MEEKO_EDITOR_BRIDGE: '0', NODE_OPTIONS: '--max-old-space-size=8192' },
		windowsHide: true,
		stdio: ['ignore', 'pipe', 'pipe'],
	})
	let logs = ''
	server.stdout.on('data', (chunk) => (logs += chunk))
	server.stderr.on('data', (chunk) => (logs += chunk))
	const origin = `http://127.0.0.1:${httpPort}`
	const stop = async () => {
		if (server.exitCode !== null) return
		server.kill()
		await once(server, 'exit').catch(() => {})
	}
	const started = Date.now()
	while (true) {
		if (server.exitCode !== null || Date.now() - started > 90_000) {
			await stop()
			throw new Error(`meeko dev did not start:\n${logs}`)
		}
		try {
			if ((await fetch(`${origin}/login`)).ok) break
		} catch {
			/* Server is starting. */
		}
		await new Promise((done) => setTimeout(done, 100))
	}
	return { origin, logs: () => logs, stop }
}

/**
 * The headers that let a `fetch` of the test act with the session of a logged-in Playwright `page`:
 * its Origin, its session cookie and its CSRF token (from the meta of the page it shows).
 */
export async function sessionHeaders(page, origin) {
	const cookies = await page.context().cookies(origin)
	const session = cookies.find((cookie) => cookie.name.endsWith('meeko-dashboard.sid'))
	if (!session) throw new Error('the page has no session')
	const token = await page.locator('meta[name="meeko-csrf-token"]').getAttribute('content')
	return { origin, cookie: `${session.name}=${session.value}`, 'x-meeko-csrf': token ?? '' }
}

/**
 * Logs `admin` in through the login page of a Playwright `page` and waits for the page it goes to,
 * `next` (by default, the overview).
 */
export async function login(page, origin, admin, next = '/') {
	await page.goto(`${origin}/login${next === '/' ? '' : `?next=${encodeURIComponent(next)}`}`, { waitUntil: 'networkidle' })
	await page.waitForFunction(() => globalThis.performance.getEntriesByName('meeko-hydration').length > 0, undefined, { timeout: 60_000 })
	await page.getByLabel('Usuario').fill(admin.username)
	await page.getByLabel('Contraseña').fill(admin.password)
	await Promise.all([page.waitForURL((url) => url.pathname === new URL(next, origin).pathname, { timeout: 60_000 }), page.getByRole('button', { name: 'Entrar' }).click()])
}
