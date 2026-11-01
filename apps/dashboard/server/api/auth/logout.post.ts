import { defineApiRoute } from '@meekojs/meeko/server'

// Ends the session: Meeko deletes its whole family in PostgreSQL and empties the cookie. A POST with
// the session's CSRF token (`x-meeko-csrf`, or the `_csrf` field of the native form in the header)
// and its Origin; another site cannot log the administrator out.
export default defineApiRoute({
	auth: 'required',
	status: 204,
	form: { redirect: () => '/login' },
	handler: async ({ context }) => {
		await context.session.revoke()
	},
})
