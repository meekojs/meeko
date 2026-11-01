import { verifyPassword } from '@meekojs/meeko/password'
import { ApiError, defineApiRoute } from '@meekojs/meeko/server'
import { createHash, timingSafeEqual } from 'node:crypto'

import { loginInput, loginResult } from '../../../shared/schemas/auth'
import { authConfig, safeNext, withConstantFailure } from '../../dashboard/auth'

// The limit per client IP is declared on the route, because Meeko counts it before reading the
// body (also for the native form) and after the Origin check. MEEKO_TRUST_PROXY=1 makes the IP the
// visitor's behind Traefik and the tunnel. The same variables as `server/runtime.ts`.
const { ipLimit, windowMs } = authConfig(process.env)

const digest = (text: string) => createHash('sha256').update(text).digest()

/** Compares two user names in constant time. */
function sameUser(given: string, expected: string): boolean {
	return timingSafeEqual(digest(given), digest(expected))
}

// The administrator login. A failure is always `401 INVALID_CREDENTIALS`, whatever failed, after
// the same time (`withConstantFailure`), and verifyPassword runs also for a wrong user. With
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
		return withConstantFailure(async () => {
			const admin = config.admin
			// Only in development: production does not start without an account.
			if (!admin) throw new ApiError('LOGIN_NOT_CONFIGURED', 503, 'ADMIN_USERNAME or ADMIN_PASSWORD_HASH is not set')
			// Per user name too, so many IPs cannot try one account. Counted before checking anything,
			// for any name: the answer does not tell whether the account exists.
			const hit = await sessions.rateLimit(`dashboard:login:user:${body.username.toLowerCase()}`, config.windowMs)
			if (hit.count > config.userLimit) throw new ApiError('RATE_LIMITED', 429, 'Too many attempts for this user name')
			const valid = await verifyPassword(body.password, admin.passwordHash)
			if (!sameUser(body.username, admin.username) || !valid) throw new ApiError('INVALID_CREDENTIALS', 401)
			// A new ID and CSRF token; a session the browser already had is replaced atomically.
			await context.session.create({ user: admin.username })
			return { next: safeNext(body.next) }
		}, started)
	},
})
