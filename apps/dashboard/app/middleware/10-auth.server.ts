import { redirect } from '@meekojs/meeko/framework'

import { loginLocation, safeNext } from '../../server/dashboard/auth'

// F5: every page needs the administrator's session, except /login. Global and server-only: it runs
// before the `<script server>` of each page, in the document request and in the data request of a
// navigation, so no page renders or sends its data without a session. API and RPC have their own
// guard (`auth: 'required'`), because route middleware only runs for pages.
export default defineServerRouteMiddleware(({ session, url }) => {
	const onLogin = url.pathname === '/login'
	if (session.current) {
		// Already logged in: the login page goes where it would have gone.
		if (onLogin) redirect(safeNext(url.searchParams.get('next')))
		return
	}
	if (!onLogin) redirect(loginLocation(url.pathname, url.search))
})
