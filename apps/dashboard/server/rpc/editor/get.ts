import { defineRpc } from '@meekojs/meeko/server'

import { editorInput, editorSchema } from '../../../shared/schemas/dashboard'
import { readSourceRow } from '../../dashboard/reads'
import { readEditor, revisionTask } from '../../dashboard/revisions'

// What the editor of a source opens with: the draft, or the text a new draft starts from.
export default defineRpc({
	auth: 'required',
	input: editorInput,
	output: editorSchema,
	handler: ({ input, context }) => {
		const { dashboard } = context.services
		return revisionTask(() => {
			const db = dashboard.database()
			return readEditor(db, input.sourceId, input.revisionId, (source) => readSourceRow(db, source))
		})
	},
})
