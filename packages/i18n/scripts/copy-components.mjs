import { execFile } from 'node:child_process'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { rebaseComponentDeclaration } from '../../../scripts/rebase-component-declaration.mjs'

// `<I18nT>` ships as source with its declaration, like the components of @meekojs/ui.
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const target = join(root, 'dist', 'app', 'components')
if (dirname(target) !== join(root, 'dist', 'app')) throw new Error('Refusing to clean components outside i18n dist/app')
await rm(target, { recursive: true, force: true })
await mkdir(dirname(target), { recursive: true })
await cp(join(root, 'src', 'app', 'components'), target, { recursive: true })
async function componentFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true })
	return (await Promise.all(entries.map((entry) => (entry.isDirectory() ? componentFiles(join(directory, entry.name)) : entry.name.endsWith('.meeko') ? [join(directory, entry.name)] : [])))).flat()
}
const cli = fileURLToPath(new URL('./cli.js', import.meta.resolve('@meekojs/meeko')))
for (const file of await componentFiles(target)) {
	const { stdout } = await promisify(execFile)(process.execPath, [cli, 'types', file], { cwd: root, windowsHide: true })
	const generatedFile = stdout.trim().split(/\r?\n/)[0]
	const declaration = await readFile(generatedFile, 'utf8')
	const destinationFile = file.replace(/\.meeko$/, '.d.meeko.ts')
	await writeFile(destinationFile, rebaseComponentDeclaration(declaration, generatedFile, destinationFile))
}
