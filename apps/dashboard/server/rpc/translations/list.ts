import { defineRpc } from '@meekojs/meeko/server'

import { translationListInput, translationListSchema } from '../../../shared/schemas/dashboard'
import { databaseTask } from '../../dashboard/errors'
import { readTranslations } from '../../dashboard/translations'

// The guides and the written reference of the site with the status of their English translation.
export default defineRpc({
	auth: 'required',
	input: translationListInput,
	output: translationListSchema,
	handler: ({ input, context }) => databaseTask(() => readTranslations(context.services.dashboard.database(), input)),
})
