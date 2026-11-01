import { ApiError, defineRpc } from '@meekojs/meeko/server'
import { activateSnapshot } from 'meeko-docs-content/snapshots'

import { idInput, snapshotListSchema } from '../../../shared/schemas/dashboard'
import { databaseTask } from '../../dashboard/errors'
import { readSnapshots } from '../../dashboard/reads'

// Makes a stored snapshot the one the site serves: the rollback. Like every RPC of the dashboard it
// needs the administrator's session (`auth`), whose Origin and CSRF token Meeko checks.
export default defineRpc({
	auth: 'required',
	origin: 'required',
	input: idInput,
	output: snapshotListSchema,
	handler: ({ input, context }) =>
		databaseTask(async () => {
			const db = context.services.dashboard.database()
			if (context.services.dashboard.jobs.status().content?.status === 'running') throw new ApiError('JOB_RUNNING', 409, 'An import or a publication is running')
			try {
				await activateSnapshot(input.id, db)
			} catch (error) {
				const message = error instanceof Error ? error.message : ''
				if (/does not exist/.test(message)) throw new ApiError('SNAPSHOT_NOT_FOUND', 404, message)
				if (/has no pages/.test(message)) throw new ApiError('SNAPSHOT_EMPTY', 409, message)
				throw error
			}
			return readSnapshots(db)
		}),
})
