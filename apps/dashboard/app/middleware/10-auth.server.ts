import { redirect } from '@meekojs/meeko/framework'

import { isLoginPath, loginLocation, pathLocale, safeNext } from '../../server/dashboard/auth'

// F5: every page needs the administrator's session, except the login page (/login, /en/login). The
// redirections keep the language of the address: /en/sources goes to /en/login?next=/en/sources.
// Global and server-only: it runs
// before the `<script server>` of each page, in the document request and in the data request of a
// navigation, so no page renders or sends its data without a session. API and RPC have their own
// guard (`auth: 'required'`), because route middleware only runs for pages.
export default defineServerRouteMiddleware(({ session, url }) => {
	const onLogin = isLoginPath(url.pathname)
	if (session.current) {
		// Already logged in: the login page goes where it would have gone.
		if (onLogin) redirect(safeNext(url.searchParams.get('next'), pathLocale(url.pathname)))
		return
	}
	if (!onLogin) redirect(loginLocation(url.pathname, url.search))
})
