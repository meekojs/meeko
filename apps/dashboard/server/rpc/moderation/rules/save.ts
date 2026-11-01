import { defineRpc } from '@meekojs/meeko/server'

import { moderationRuleSchema, saveRuleInput } from '../../../../shared/schemas/moderation'
import { sessionUser } from '../../../dashboard/auth'
import { moderationTask, saveRule } from '../../../dashboard/moderation'

// Hides or features a page of a web, from the version of its rule the screen read (409 if it
// changed), signed by the user of the session. The webs apply it within their 30 s cache.
export default defineRpc({
	auth: 'required',
	origin: 'required',
	input: saveRuleInput,
	output: moderationRuleSchema,
	handler: ({ input, context }) => moderationTask(() => saveRule(context.services.dashboard.database(), { ...input, author: sessionUser(context) })),
})
