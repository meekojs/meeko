import { verifyPassword } from '@meekojs/meeko/password'
import { ApiError, defineApiRoute } from '@meekojs/meeko/server'
import { createHash, timingSafeEqual } from 'node:crypto'

import { loginInput, loginResult } from '../../../shared/schemas/auth'
import { authConfig, failedLoginMs, loginVerdict, safeNext, withConstantFailure } from '../../dashboard/auth'

// The limit per client IP is declared on the route, because Meeko counts it before reading the
// body (also for the native form) and after the Origin check. MEEKO_TRUST_PROXY=cloudflare makes
// the IP the visitor's behind Cloudflare, the tunnel and Traefik (docs/deploy-meekojs.md, «IP del
// cliente»). The same variables as `server/runtime.ts`.
const { ipLimit, windowMs } = authConfig(process.env)

const digest = (text: string) => createHash('sha256').update(text).digest()

/** Compares two user names in constant time. */
function sameUser(given: string, expected: string): boolean {
	return timingSafeEqual(digest(given), digest(expected))
}

// The administrator login. A failure is always `401 INVALID_CREDENTIALS`, whatever failed, after
// the same time (`withConstantFailure`), and verifyPassword runs also for a wrong user. The
// counters of `loginVerdict` refuse with `429` only the client that failed too often, never the
// right password from another IP. With
// JavaScript the page sends JSON; without it, the native form gets `303` to `next` or back to the
// login page with the error, which `useForm({ action: '/api/auth/login' })` paints.
export default defineApiRoute({
	body: loginInput,
	response: loginResult,
	// The default since 1.8, explicit: another site cannot log the browser into an account (login CSRF).
	origin: 'required',
	rateLimit: { limit: ipLimit, window: windowMs },
	form: { redirect: (result) => result.next, echo: ['username'] },
	handler: ({ body, context }) => {
		const started = performance.now()
		const { config, sessions } = context.services.auth
		let minimumMs = failedLoginMs
		return withConstantFailure(
			async () => {
				const admin = config.admin
				// Only in development: production does not start without an account.
				if (!admin) throw new ApiError('LOGIN_NOT_CONFIGURED', 503, 'ADMIN_USERNAME or ADMIN_PASSWORD_HASH is not set')
				// The password is always checked, for any name, before the counters decide.
				const valid = await verifyPassword(body.password, admin.passwordHash)
				const verdict = await loginVerdict({
					count: (key, windowMs) => sessions.rateLimit(key, windowMs),
					username: body.username,
					address: context.clientAddress,
					valid: sameUser(body.username, admin.username) && valid,
					userLimit: config.userLimit,
					windowMs: config.windowMs,
				})
				minimumMs = failedLoginMs + verdict.delayMs
				if (verdict.outcome === 'limited') throw new ApiError('RATE_LIMITED', 429, 'Too many attempts for this user name')
				if (verdict.outcome === 'invalid') throw new ApiError('INVALID_CREDENTIALS', 401)
				// A new ID and CSRF token; a session the browser already had is replaced atomically.
				await context.session.create({ user: admin.username })
				return { next: safeNext(body.next) }
			},
			started,
			() => minimumMs,
		)
	},
})
