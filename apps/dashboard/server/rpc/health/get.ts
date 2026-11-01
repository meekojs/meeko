import { defineRpc } from '@meekojs/meeko/server'

import { emptyInput, healthSchema } from '../../../shared/schemas/dashboard'
import { databaseTask } from '../../dashboard/errors'
import { readSources } from '../../dashboard/reads'

export default defineRpc({
	auth: 'required',
	input: emptyInput,
	output: healthSchema,
	handler: async ({ context }) => {
		const { dashboard } = context.services
		const report = dashboard.jobs.healthReport()
		const job = dashboard.jobs.status().health
		const pages = await databaseTask(async () => (await readSources(dashboard.database(), { kind: 'page' })).filter((row) => row.site !== 'site'))
		return { report, job, pages }
	},
})
