import { execFile } from 'node:child_process'
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { rebaseComponentDeclaration } from '../../../scripts/rebase-component-declaration.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
// `editor` is the components folder of `@meekojs/ui/editor`, a module of its own.
const folders = [
	['app', 'components'],
	['editor', 'components'],
]
async function componentFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true })
	return (await Promise.all(entries.map((entry) => (entry.isDirectory() ? componentFiles(join(directory, entry.name)) : entry.name.endsWith('.meeko') ? [join(directory, entry.name)] : [])))).flat()
}
for (const folder of folders) {
	const target = join(root, 'dist', ...folder)
	if (dirname(target) !== join(root, 'dist', folder[0])) throw new Error('Refusing to clean components outside UI dist')
	await rm(target, { recursive: true, force: true })
	await mkdir(dirname(target), { recursive: true })
	await cp(join(root, 'src', ...folder), target, { recursive: true })
	for (const file of await componentFiles(target)) {
		const cli = fileURLToPath(new URL('./cli.js', import.meta.resolve('@meekojs/meeko')))
		const { stdout } = await promisify(execFile)(process.execPath, [cli, 'types', file], { cwd: root, windowsHide: true })
		const generatedFile = stdout.trim().split(/\r?\n/)[0]
		const destinationFile = file.replace(/\.meeko$/, '.d.meeko.ts')
		const declaration = await readFile(generatedFile, 'utf8')
		await writeFile(destinationFile, rebaseComponentDeclaration(declaration, generatedFile, destinationFile))
	}
}
