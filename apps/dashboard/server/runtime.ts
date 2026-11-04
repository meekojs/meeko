import { defineServerRuntime } from '@meekojs/meeko/server'

import { assertProductionAuth, authConfig } from './dashboard/auth'
import { createDashboard } from './dashboard/services'
import { createDashboardSessions } from './dashboard/sessions'

// F5: one administrator account (ADMIN_USERNAME, ADMIN_PASSWORD_HASH) whose sessions live in
// PostgreSQL, in the same database as the documentation. Production refuses to start without it.
// The pool and the jobs live once per process. `root` is the project's folder in `meeko dev`, in the
// build (the folder three levels above `.meeko/output/node`) and with `MEEKO_ROOT`, so the scripts of
// the jobs are found from any cwd.
export default defineServerRuntime(({ env, production, prerendering, root }) => {
	const serving = production && !prerendering
	const auth = authConfig(env)
	if (serving) assertProductionAuth(auth, env)
	const dashboard = createDashboard(env, root === undefined ? {} : { root })
	// Without DATABASE_URL (development only) the sessions live in memory; the pages say why the
	// data is missing.
	const sessions = createDashboardSessions(auth, env.DATABASE_URL?.trim() ? dashboard.database() : null, serving)
	return {
		sessions: sessions.manager,
		services: { dashboard, auth: { config: auth, sessions: sessions.manager } },
		close: async () => {
			sessions.stop()
			await dashboard.close()
		},
	}
})
