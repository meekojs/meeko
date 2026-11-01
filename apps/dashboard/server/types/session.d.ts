// The session of the dashboard (F5): who logged in. Pages, API and RPC read it typed.
import type {} from '@meekojs/meeko/server'

declare module '@meekojs/meeko/server' {
	interface MeekoSession {
		/** The administrator's user name, `ADMIN_USERNAME`. */
		user: string
	}
}
