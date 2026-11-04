import { defineRpc } from '@meekojs/meeko/server'

import { emptyInput, jobsSchema } from '../../../shared/schemas/dashboard'

export default defineRpc({
	auth: 'required',
	input: emptyInput,
	output: jobsSchema,
	handler: ({ context }) => context.services.dashboard.jobs.status(),
})
