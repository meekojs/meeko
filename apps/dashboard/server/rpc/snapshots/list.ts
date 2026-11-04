import { defineRpc } from '@meekojs/meeko/server'

import { emptyInput, snapshotListSchema } from '../../../shared/schemas/dashboard'
import { databaseTask } from '../../dashboard/errors'
import { readSnapshots } from '../../dashboard/reads'

export default defineRpc({
	auth: 'required',
	input: emptyInput,
	output: snapshotListSchema,
	handler: ({ context }) => databaseTask(() => readSnapshots(context.services.dashboard.database())),
})
