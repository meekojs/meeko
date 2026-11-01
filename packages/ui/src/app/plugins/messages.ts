import { definePlugin } from '@meekojs/meeko/framework'

import type { UIMessagesConfig } from '../types/messages'

import { uiMessagesKey } from '../utils/messages'

export default definePlugin<UIMessagesConfig>((app, config) => {
	app.provide(uiMessagesKey, config)
})
