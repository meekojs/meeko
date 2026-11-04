import { execFile } from 'node:child_process'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { rebaseComponentDeclaration } from '../../../scripts/rebase-component-declaration.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const directory = join(root, 'src/app/components/Docs')
const cli = fileURLToPath(new URL('./cli.js', import.meta.resolve('@meekojs/meeko')))
for (const name of (await readdir(directory)).filter((name) => name.endsWith('.meeko')).sort()) {
	const file = join(directory, name)
	const { stdout } = await promisify(execFile)(process.execPath, [cli, 'types', file], { cwd: root, windowsHide: true })
	const generated = stdout.trim().split(/\r?\n/)[0]
	const destination = file.replace(/\.meeko$/, '.d.meeko.ts')
	const declaration = rebaseComponentDeclaration(await readFile(generated, 'utf8'), generated, destination)
	let previous
	try {
		previous = await readFile(destination, 'utf8')
	} catch (error) {
		if (error.code !== 'ENOENT') throw error
	}
	if (previous !== declaration) await writeFile(destination, declaration)
}
