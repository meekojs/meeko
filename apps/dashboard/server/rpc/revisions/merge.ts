import { defineRpc } from '@meekojs/meeko/server'

import { mergeInput, revisionDetailSchema } from '../../../shared/schemas/dashboard'
import { sessionUser } from '../../dashboard/auth'
import { mergeWithGit, revisionTask } from '../../dashboard/revisions'

// A new draft from the Git of now and the changes of a revision in conflict, when the merge is trivial.
export default defineRpc({
	auth: 'required',
	origin: 'required',
	input: mergeInput,
	output: revisionDetailSchema,
	handler: ({ input, context }) => revisionTask(() => mergeWithGit(context.services.dashboard.database(), input.id, sessionUser(context), input.note)),
})
