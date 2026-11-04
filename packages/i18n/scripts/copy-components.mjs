import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { copyComponents } from '../../../scripts/copy-components.mjs'

// `<I18nT>` ships as source with its declaration, like the components of @meekojs/ui.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
await copyComponents(root, [['app', 'components']], fileURLToPath(new URL('./cli.js', import.meta.resolve('@meekojs/meeko'))))
