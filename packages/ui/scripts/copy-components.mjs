import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { copyComponents } from '../../../scripts/copy-components.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const cli = fileURLToPath(new URL('./cli.js', import.meta.resolve('@meekojs/meeko')))
// `editor` is the components folder of `@meekojs/ui/editor`, a module of its own.
await copyComponents(
	root,
	[
		['app', 'components'],
		['editor', 'components'],
	],
	cli,
)
