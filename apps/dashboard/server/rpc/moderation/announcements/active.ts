import { defineRpc } from '@meekojs/meeko/server'

import { announcementActiveInput, announcementSchema } from '../../../../shared/schemas/moderation'
import { moderationTask, switchAnnouncement } from '../../../dashboard/moderation'

// Switches an announcement on or off and changes nothing else, while it has `version` (409 if it
// changed): an old tab cannot bring back the message or the dates it shows.
export default defineRpc({
	auth: 'required',
	origin: 'required',
	input: announcementActiveInput,
	output: announcementSchema,
	handler: ({ input, context }) => moderationTask(() => switchAnnouncement(context.services.dashboard.database(), input.id, input.version, input.active)),
})
