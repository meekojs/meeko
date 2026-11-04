import { definePlugin } from '@meekojs/meeko/framework'
import { resolveComponent } from 'virtual:meeko-ui-components'

import { installModalPlugin } from '../composables/useModal'

export default definePlugin((app) => installModalPlugin(app, resolveComponent))
