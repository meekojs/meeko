import { defineRpc } from '@meekojs/meeko/server'

import { sessionSchema } from '../../../shared/schemas/auth'
import { emptyInput } from '../../../shared/schemas/dashboard'

// Who is logged in, for the header. It does not require a session (the login page renders the same
// header) and only answers about the session of the request itself.
export default defineRpc({
	input: emptyInput,
	output: sessionSchema,
	handler: ({ context }) => ({ user: context.session.current?.data.user ?? null }),
})
