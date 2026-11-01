import { defineRpc } from '@meekojs/meeko/server'

import { announcementSchema, moderationIdInput } from '../../../../shared/schemas/moderation'
import { moderationTask, removeAnnouncement } from '../../../dashboard/moderation'

export default defineRpc({
	auth: 'required',
	origin: 'required',
	input: moderationIdInput,
	output: announcementSchema,
	handler: ({ input, context }) => moderationTask(() => removeAnnouncement(context.services.dashboard.database(), input.id, input.version)),
})
