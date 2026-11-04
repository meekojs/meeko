import { defineRpc } from '@meekojs/meeko/server'

import { revisionActionInput, revisionDetailSchema } from '../../../shared/schemas/dashboard'
import { assertNoContentJob } from '../../dashboard/errors'
import { archive, revisionTask } from '../../dashboard/revisions'

// Archives a revision. Refused while a job runs, and the published one also while any publication
// of the documentation renders, as publishing one.
export default defineRpc({
	auth: 'required',
	origin: 'required',
	input: revisionActionInput,
	output: revisionDetailSchema,
	handler: ({ input, context }) => {
		const { dashboard } = context.services
		return revisionTask(async () => {
			assertNoContentJob(dashboard.jobs)
			return archive(dashboard.database(), input.id)
		})
	},
})
