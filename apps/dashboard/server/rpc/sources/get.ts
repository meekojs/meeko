import { defineRpc } from '@meekojs/meeko/server'

import { idInput, sourceDetailSchema } from '../../../shared/schemas/dashboard'
import { databaseTask } from '../../dashboard/errors'
import { readSourceDetail } from '../../dashboard/reads'

export default defineRpc({
	auth: 'required',
	input: idInput,
	output: sourceDetailSchema,
	handler: ({ input, context }) => databaseTask(() => readSourceDetail(context.services.dashboard.database(), input.id)),
})
