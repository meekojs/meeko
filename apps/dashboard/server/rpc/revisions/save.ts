import { defineRpc } from '@meekojs/meeko/server'

import { revisionDetailSchema, saveDraftInput } from '../../../shared/schemas/dashboard'
import { sessionUser } from '../../dashboard/auth'
import { revisionTask, saveDraft } from '../../dashboard/revisions'

// Creates a draft or saves it again, signed by the user of the session. Like every action of the
// dashboard it needs the session, whose Origin and CSRF token Meeko checks.
export default defineRpc({
	auth: 'required',
	origin: 'required',
	input: saveDraftInput,
	output: revisionDetailSchema,
	handler: ({ input, context }) => revisionTask(() => saveDraft(context.services.dashboard.database(), { ...input, author: sessionUser(context) })),
})
