import { ApiError, defineRpc } from '@meekojs/meeko/server'
import { getSource } from 'meeko-docs-content/db'

import { previewInput, previewSchema } from '../../../shared/schemas/dashboard'
import { databaseTask } from '../../dashboard/errors'

// The preview of a draft with the real render, in the worker process. The file comes from the stored
// source, never from the client. It costs a render, so other sites cannot start one either.
export default defineRpc({
	auth: 'required',
	origin: 'required',
	input: previewInput,
	output: previewSchema,
	handler: async ({ input, context }) => {
		const { dashboard } = context.services
		const source = await databaseTask(() => getSource(dashboard.database(), input.sourceId))
		if (!source) throw new ApiError('SOURCE_NOT_FOUND', 404, `Documentation source ${input.sourceId} does not exist`)
		if (source.file === null || source.kind === 'page' || source.removedAt !== null) throw new ApiError('SOURCE_NOT_EDITABLE', 409, { message: 'Only the guides and the reference of the site are previewed', issues: [{ path: '', message: 'Solo las guías y la referencia del site tienen vista previa.' }] })
		return dashboard.preview.render({ file: source.file, kind: source.kind, markdown: input.markdown })
	},
})
