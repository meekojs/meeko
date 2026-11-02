import { execFile } from 'node:child_process'
import { cp, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import { promisify } from 'node:util'

import { rebaseComponentDeclaration } from './rebase-component-declaration.mjs'

const run = promisify(execFile)

async function filesIn(directory) {
	const entries = await readdir(directory, { withFileTypes: true }).catch((error) => {
		if (error.code === 'ENOENT') return []
		throw error
	})
	return (await Promise.all(entries.map((entry) => (entry.isDirectory() ? filesIn(join(directory, entry.name)) : [join(directory, entry.name)])))).flat()
}

/** Windows refuses a rename over a file that something holds open for a moment, such as a server reading it. */
async function moveFile(from, to) {
	for (let attempt = 0; ; attempt++) {
		try {
			return await rename(from, to)
		} catch (error) {
			if (!['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error
			if (attempt >= 10) return writeFile(to, await readFile(from))
			await new Promise((done) => setTimeout(done, 50 * (attempt + 1)))
		}
	}
}

/**
 * Publishes the `.meeko` sources of a package in `dist`, each with its `.d.meeko.ts`. They are built
 * in a folder beside the final one, at the same depth so that their relative imports mean the same,
 * and only what changed moves at the end, file by file: declarations first and sources after them,
 * so that whoever reads `dist` during a build, such as `meeko dev` or an e2e, never finds a component
 * without its declaration. If a declaration fails, nothing changes. The final folder itself is never
 * renamed: Windows refuses that while a watcher, such as that of `meeko dev`, has it open.
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
		const declarations = join(root, '.meeko', 'types', relative(root, building))
		const clean = () => Promise.all([building, declarations].map((path) => rm(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })))
		await clean()
		try {
			await mkdir(dirname(target), { recursive: true })
			await cp(join(root, 'src', ...folder), building, { recursive: true })
			const sources = (await filesIn(building)).filter((file) => file.endsWith('.meeko'))
			for (const file of sources) {
				const { stdout } = await run(process.execPath, [cli, 'types', file], { cwd: root, windowsHide: true })
				const generatedFile = stdout.trim().split(/\r?\n/)[0]
				const destinationFile = file.replace(/\.meeko$/, '.d.meeko.ts')
				const declaration = await readFile(generatedFile, 'utf8')
				await writeFile(destinationFile, rebaseComponentDeclaration(declaration, generatedFile, destinationFile))
			}
			const built = (await filesIn(building)).map((file) => relative(building, file))
			const isSource = (file) => file.endsWith('.meeko')
			for (const file of [...built.filter((item) => !isSource(item)), ...built.filter(isSource)]) {
				const to = join(target, file)
				const previous = await readFile(to).catch(() => undefined)
				if (previous?.equals(await readFile(join(building, file)))) continue
				await mkdir(dirname(to), { recursive: true })
				await moveFile(join(building, file), to)
			}
			// What is gone: the source before its declaration, for the same reason.
			const current = new Set(built)
			const stale = (await filesIn(target)).map((file) => relative(target, file)).filter((file) => !current.has(file))
			for (const file of [...stale.filter(isSource), ...stale.filter((item) => !isSource(item))]) await rm(join(target, file), { force: true, maxRetries: 10, retryDelay: 100 })
		} finally {
			await clean()
		}
	}
}
