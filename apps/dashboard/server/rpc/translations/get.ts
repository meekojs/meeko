import { defineRpc } from '@meekojs/meeko/server'

import { translationDetailInput, translationDetailSchema } from '../../../shared/schemas/dashboard'
import { databaseTask } from '../../dashboard/errors'
import { readTranslation } from '../../dashboard/translations'

// A translation and its original, by the id of either, with the diff of the original since it was translated.
export default defineRpc({
	auth: 'required',
	input: translationDetailInput,
	output: translationDetailSchema,
	handler: ({ input, context }) => databaseTask(() => readTranslation(context.services.dashboard.database(), input.id)),
})
