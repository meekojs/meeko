import { definePlugin } from '@meekojs/meeko/framework'

import { unsavedQuestion } from '../utils/unsaved'

// Asks before a navigation of the app leaves an editor with unsaved changes. A reload or a closed
// tab is the editor's `beforeunload`; Meeko has no navigation guard per component, so the editor
// publishes its state in app/utils/unsaved.ts and this plugin reads it.
export default definePlugin((app) => {
	app.beforeNavigate(() => {
		const question = unsavedQuestion()
		return question === null || window.confirm(question)
	})
})
