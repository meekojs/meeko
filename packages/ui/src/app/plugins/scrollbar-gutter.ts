import { definePlugin } from '@meekojs/meeko/framework'

import { trackScrollbarGutter } from '../utils/scrollbar-gutter'

// Always on, and before the hydration: a drawer opened with `command` before it, or a panel of the app, finds
// the width of the gutter already written.
export default definePlugin((app) => {
	if (app.side === 'client') trackScrollbarGutter()
})
