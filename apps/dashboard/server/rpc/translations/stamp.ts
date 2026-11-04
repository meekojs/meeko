import { defineRpc } from '@meekojs/meeko/server'

import { stampInput, stampSchema } from '../../../shared/schemas/dashboard'
import { databaseTask } from '../../dashboard/errors'
import { stampSource } from '../../dashboard/translations'

// The text of the editor of a translation with the current hash of its original as `source-hash`.
// It writes nothing: the editor saves it as a draft like any other change.
export default defineRpc({
	auth: 'required',
	input: stampInput,
	output: stampSchema,
	handler: ({ input, context }) => databaseTask(() => stampSource(context.services.dashboard.database(), input.sourceId, input.markdown)),
})
