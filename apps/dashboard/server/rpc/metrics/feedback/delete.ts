import { defineRpc } from '@meekojs/meeko/server'

import { feedbackDeletedSchema, feedbackIdInput } from '../../../../shared/schemas/metrics'
import { databaseTask } from '../../../dashboard/errors'
import { removeFeedback } from '../../../dashboard/metrics'

export default defineRpc({
	auth: 'required',
	origin: 'required',
	input: feedbackIdInput,
	output: feedbackDeletedSchema,
	handler: ({ input, context }) => databaseTask(() => removeFeedback(context.services.dashboard.database(), input.id)),
})
