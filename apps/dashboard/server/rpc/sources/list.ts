import { defineRpc } from '@meekojs/meeko/server'

import { sourceListInput, sourceListSchema } from '../../../shared/schemas/dashboard'
import { databaseTask } from '../../dashboard/errors'
import { readSources } from '../../dashboard/reads'

export default defineRpc({
	auth: 'required',
	input: sourceListInput,
	output: sourceListSchema,
	handler: ({ input, context }) => databaseTask(() => readSources(context.services.dashboard.database(), input)),
})
