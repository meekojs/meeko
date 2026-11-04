import { defineRpc } from '@meekojs/meeko/server'

import { conflictSchema, revisionActionInput } from '../../../shared/schemas/dashboard'
import { readConflict, revisionTask } from '../../dashboard/revisions'

export default defineRpc({
	auth: 'required',
	input: revisionActionInput,
	output: conflictSchema,
	handler: ({ input, context }) => revisionTask(() => readConflict(context.services.dashboard.database(), input.id)),
})
