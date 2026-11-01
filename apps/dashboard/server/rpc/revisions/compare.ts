import { defineRpc } from '@meekojs/meeko/server'

import { compareInput, comparisonSchema } from '../../../shared/schemas/dashboard'
import { compare, revisionTask } from '../../dashboard/revisions'

export default defineRpc({
	auth: 'required',
	input: compareInput,
	output: comparisonSchema,
	handler: ({ input, context }) => revisionTask(() => compare(context.services.dashboard.database(), input.sourceId, input.from, input.to)),
})
