import { execFile } from 'node:child_process'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { rebaseComponentDeclaration } from '../../../scripts/rebase-component-declaration.mjs'

// Copies the .meeko components to dist/app/components with their generated declarations, as @meekojs/ui does.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'dist', 'app', 'components')
if (dirname(target) !== join(root, 'dist', 'app')) throw new Error('Refusing to clean components outside icon dist/app')
await rm(target, { recursive: true, force: true })
await mkdir(dirname(target), { recursive: true })
await cp(join(root, 'src', 'app', 'components'), target, { recursive: true })
const cli = fileURLToPath(new URL('./cli.js', import.meta.resolve('@meekojs/meeko')))
for (const entry of await readdir(target)) {
	if (!entry.endsWith('.meeko')) continue
	const file = join(target, entry)
	const { stdout } = await promisify(execFile)(process.execPath, [cli, 'types', file], { cwd: root, windowsHide: true })
	const generatedFile = stdout.trim().split(/\r?\n/)[0]
	const destinationFile = file.replace(/\.meeko$/, '.d.meeko.ts')
	await writeFile(destinationFile, rebaseComponentDeclaration(await readFile(generatedFile, 'utf8'), generatedFile, destinationFile))
}
