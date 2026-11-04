import { defineRpc } from '@meekojs/meeko/server'

import { moderationInput, moderationSchema } from '../../../shared/schemas/moderation'
import { databaseTask } from '../../dashboard/errors'
import { readModeration } from '../../dashboard/moderation'

export default defineRpc({
	auth: 'required',
	input: moderationInput,
	output: moderationSchema,
	handler: ({ input, context }) => databaseTask(() => readModeration(context.services.dashboard.database(), input.site)),
})
