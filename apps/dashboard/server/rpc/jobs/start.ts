import { defineRpc } from '@meekojs/meeko/server'

import { jobSchema, startJobInput } from '../../../shared/schemas/dashboard'
import { sessionUser } from '../../dashboard/auth'

// Starts an import from Git, a publication of a snapshot or a health check in a child process.
// A publication is signed by the user of the session.
export default defineRpc({
	auth: 'required',
	origin: 'required',
	input: startJobInput,
	output: jobSchema,
	handler: ({ input, context }) => {
		const { dashboard } = context.services
		// Importing and publishing need the database: fail here instead of in the child.
		if (input.kind !== 'health') dashboard.database()
		return dashboard.jobs.start(input.kind === 'publish' ? { ...input, publishedBy: sessionUser(context) } : input)
	},
})
