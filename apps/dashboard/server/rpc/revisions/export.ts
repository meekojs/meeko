import { defineRpc } from '@meekojs/meeko/server'

import { exportSchema, revisionActionInput } from '../../../shared/schemas/dashboard'
import { exportFile, revisionTask } from '../../dashboard/revisions'

// The text of a revision's `.md` file, which the browser downloads. The server never writes to docs/.
export default defineRpc({
	auth: 'required',
	origin: 'required',
	input: revisionActionInput,
	output: exportSchema,
	handler: ({ input, context }) => revisionTask(() => exportFile(context.services.dashboard.database(), input.id)),
})
