import { defineRpc } from '@meekojs/meeko/server'

import { revisionActionInput, revisionDetailSchema } from '../../../shared/schemas/dashboard'
import { assertNoContentJob } from '../../dashboard/errors'
import { publish, revisionTask } from '../../dashboard/revisions'

// Publishes a revision: the site shows it from the next snapshot. Refused while a job runs here
// (`assertNoContentJob`, the quick answer) and while any publication of the documentation renders,
// in this process or another: the content lock of meeko-docs-content answers `busy`, which is
// `409 JOB_RUNNING` too. A publication that starts meanwhile waits for this one to commit.
export default defineRpc({
	auth: 'required',
	origin: 'required',
	input: revisionActionInput,
	output: revisionDetailSchema,
	handler: ({ input, context }) => {
		const { dashboard } = context.services
		return revisionTask(async () => {
			assertNoContentJob(dashboard.jobs)
			return publish(dashboard.database(), input.id)
		})
	},
})
