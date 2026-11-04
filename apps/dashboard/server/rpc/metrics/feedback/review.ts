import { defineRpc } from '@meekojs/meeko/server'

import { feedbackCommentSchema, feedbackReviewInput } from '../../../../shared/schemas/metrics'
import { sessionUser } from '../../../dashboard/auth'
import { databaseTask } from '../../../dashboard/errors'
import { reviewFeedback } from '../../../dashboard/metrics'

// Marks a comment as reviewed by the user of the session, or as waiting again.
export default defineRpc({
	auth: 'required',
	origin: 'required',
	input: feedbackReviewInput,
	output: feedbackCommentSchema,
	handler: ({ input, context }) => databaseTask(() => reviewFeedback(context.services.dashboard.database(), input.id, input.reviewed, sessionUser(context))),
})
