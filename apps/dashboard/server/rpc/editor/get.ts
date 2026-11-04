import { defineRpc } from '@meekojs/meeko/server'

import { editorInput, editorSchema } from '../../../shared/schemas/dashboard'
import { readSourceRow } from '../../dashboard/reads'
import { readEditor, revisionTask } from '../../dashboard/revisions'
import { originalOf } from '../../dashboard/translations'

// What the editor of a source opens with: the draft, or the text a new draft starts from, and for a
// translation its original.
export default defineRpc({
	auth: 'required',
	input: editorInput,
	output: editorSchema,
	handler: ({ input, context }) => {
		const { dashboard } = context.services
		return revisionTask(async () => {
			const db = dashboard.database()
			const editor = await readEditor(db, input.sourceId, input.revisionId, (source) => readSourceRow(db, source))
			return { ...editor, original: await originalOf(db, editor.source) }
		})
	},
})
