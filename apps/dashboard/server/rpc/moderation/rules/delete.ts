import { defineRpc } from '@meekojs/meeko/server'

import { moderationIdInput, moderationRuleSchema } from '../../../../shared/schemas/moderation'
import { moderationTask, removeRule } from '../../../dashboard/moderation'

export default defineRpc({
	auth: 'required',
	origin: 'required',
	input: moderationIdInput,
	output: moderationRuleSchema,
	handler: ({ input, context }) => moderationTask(() => removeRule(context.services.dashboard.database(), input.id, input.version)),
})
