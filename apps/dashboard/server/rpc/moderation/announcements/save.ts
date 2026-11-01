import { defineRpc } from '@meekojs/meeko/server'

import { announcementSchema, saveAnnouncementInput } from '../../../../shared/schemas/moderation'
import { sessionUser } from '../../../dashboard/auth'
import { moderationTask, saveAnnouncement } from '../../../dashboard/moderation'

// Creates an announcement, or replaces the one of `id` while it has `version` (409 if it changed),
// signed by the user of the session.
export default defineRpc({
	auth: 'required',
	origin: 'required',
	input: saveAnnouncementInput,
	output: announcementSchema,
	handler: ({ input, context }) => moderationTask(() => saveAnnouncement(context.services.dashboard.database(), { ...input, author: sessionUser(context) })),
})
