import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { copyComponents } from '../../../scripts/copy-components.mjs'

// Copies the .meeko components to dist/app/components with their generated declarations, as @meekojs/ui does.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
await copyComponents(root, [['app', 'components']], fileURLToPath(new URL('./cli.js', import.meta.resolve('@meekojs/meeko'))))
