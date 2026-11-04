import { defineApiRoute } from '@meekojs/meeko/server'

import { logoutLocation } from '../../dashboard/auth'

// Ends the session: Meeko deletes its whole family in PostgreSQL and empties the cookie. A POST with
// the session's CSRF token (`x-meeko-csrf`, or the `_csrf` field of the native form in the header)
// and its Origin; another site cannot log the administrator out. The native form goes to the login
// page in the language of the page it was sent from (/login or /en/login).
export default defineApiRoute({
	auth: 'required',
	status: 204,
	form: { redirect: (_, context) => logoutLocation(context.request.headers.get('referer'), new URL(context.request.url).origin) },
	handler: async ({ context }) => {
		await context.session.revoke()
	},
})
