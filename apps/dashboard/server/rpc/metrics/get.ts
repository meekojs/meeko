import { defineRpc } from '@meekojs/meeko/server'

import { metricsInput, metricsSummarySchema } from '../../../shared/schemas/metrics'
import { metricsTask, readMetrics } from '../../dashboard/metrics'

export default defineRpc({
	auth: 'required',
	input: metricsInput,
	output: metricsSummarySchema,
	handler: ({ input, context }) => metricsTask(() => readMetrics(context.services.dashboard.database(), input)),
})
