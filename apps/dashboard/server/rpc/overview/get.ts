import { defineRpc } from '@meekojs/meeko/server'

import { emptyInput, overviewSchema } from '../../../shared/schemas/dashboard'
import { databaseTask } from '../../dashboard/errors'
import { readOverview } from '../../dashboard/reads'

export default defineRpc({
	auth: 'required',
	input: emptyInput,
	output: overviewSchema,
	handler: ({ context }) => {
		const { dashboard } = context.services
		return databaseTask(() => readOverview(dashboard.database(), dashboard.jobs.status()))
	},
})
