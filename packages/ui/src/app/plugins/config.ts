import { definePlugin } from '@meekojs/meeko/framework'

import type { UIDefaults } from '../types/config'

import { uiDefaultsKey } from '../utils/defaults'

export default definePlugin<UIDefaults>((app, defaults) => {
	app.provide(uiDefaultsKey, defaults)
})
