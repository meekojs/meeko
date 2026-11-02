import { execFile } from 'node:child_process'
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { promisify } from 'node:util'

import { rebaseComponentDeclaration } from './rebase-component-declaration.mjs'

const run = promisify(execFile)

async function componentFiles(directory) {
	const entries = await readdir(directory, { withFileTypes: true })
	return (await Promise.all(entries.map((entry) => (entry.isDirectory() ? componentFiles(join(directory, entry.name)) : entry.name.endsWith('.meeko') ? [join(directory, entry.name)] : [])))).flat()
}

/** Windows refuses a rename while something holds a file of the folder open, such as a watcher or an antivirus. */
async function renameWithRetries(from, to) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await rename(from, to)
		} catch (error) {
			if (attempt >= 20 || !['EPERM', 'EBUSY', 'EACCES', 'ENOTEMPTY'].includes(error.code)) throw error
			await new Promise((done) => setTimeout(done, 50 * (attempt + 1)))
		}
	}
}

/**
 * Publishes the `.meeko` sources of a package in `dist`, each with its `.d.meeko.ts`. They are built
 * in a folder beside the final one, at the same depth so that their relative imports mean the same,
 * and replace it at the end: whoever reads `dist` during a build, such as `meeko dev` or an e2e,
 * finds the previous complete folder or the new one, never a component without its declaration.
 * If a declaration fails, the previous folder stays.
 *
 * @param {string} root Directory of the package.
 * @param {ReadonlyArray<readonly [string, string]>} folders Folders under `src` and `dist`, such as `['app', 'components']`.
 * @param {string} cli Path of the `meeko` CLI that the package resolves.
 */
export async function copyComponents(root, folders, cli) {
	const dist = join(root, 'dist')
	for (const folder of folders) {
		const target = join(dist, ...folder)
		if (dirname(target) !== join(dist, folder[0])) throw new Error(`Refusing to replace components outside ${dist}`)
		const building = `${target}.building`
		const previous = `${target}.previous`
		const declarations = join(root, '.meeko', 'types', relative(root, building))
		await rm(building, { recursive: true, force: true, maxRetries: 5 })
		await rm(previous, { recursive: true, force: true, maxRetries: 5 })
		try {
			await mkdir(dirname(target), { recursive: true })
			await cp(join(root, 'src', ...folder), building, { recursive: true })
			for (const file of await componentFiles(building)) {
				const { stdout } = await run(process.execPath, [cli, 'types', file], { cwd: root, windowsHide: true })
				const generatedFile = stdout.trim().split(/\r?\n/)[0]
				const destinationFile = file.replace(/\.meeko$/, '.d.meeko.ts')
				const declaration = await readFile(generatedFile, 'utf8')
				await writeFile(destinationFile, rebaseComponentDeclaration(declaration, generatedFile, destinationFile))
			}
			let replaced = false
			try {
				await renameWithRetries(target, previous)
				replaced = true
			} catch (error) {
				if (error.code !== 'ENOENT') throw error
			}
			try {
				await renameWithRetries(building, target)
			} catch (error) {
				if (replaced) await renameWithRetries(previous, target)
				throw error
			}
		} finally {
			await rm(building, { recursive: true, force: true, maxRetries: 5 })
			await rm(previous, { recursive: true, force: true, maxRetries: 5 })
			await rm(declarations, { recursive: true, force: true, maxRetries: 5 })
		}
	}
}
