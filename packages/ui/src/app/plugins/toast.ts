import { definePlugin } from '@meekojs/meeko/framework'

import { installToastPlugin } from '../composables/useToast'

export default definePlugin((app) => installToastPlugin(app))
