import { defineRpc } from '@meekojs/meeko/server'

import { emptyInput, pendingListSchema } from '../../../shared/schemas/dashboard'
import { databaseTask } from '../../dashboard/errors'
import { readPending } from '../../dashboard/revisions'

export default defineRpc({
	auth: 'required',
	input: emptyInput,
	output: pendingListSchema,
	handler: ({ context }) => databaseTask(() => readPending(context.services.dashboard.database())),
})
