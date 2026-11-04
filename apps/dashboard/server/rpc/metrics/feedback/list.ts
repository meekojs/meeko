import { defineRpc } from '@meekojs/meeko/server'

import { feedbackListInput, feedbackListSchema } from '../../../../shared/schemas/metrics'
import { metricsTask, readFeedback } from '../../../dashboard/metrics'

export default defineRpc({
	auth: 'required',
	input: feedbackListInput,
	output: feedbackListSchema,
	handler: ({ input, context }) => metricsTask(() => readFeedback(context.services.dashboard.database(), input)),
})
