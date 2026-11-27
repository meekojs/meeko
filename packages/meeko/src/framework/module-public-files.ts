import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { ResolvedModules } from './module-loader'

export async function publicFileContents(contents: ResolvedModules['publicFiles'] extends ReadonlyMap<string, infer T> ? T : never): Promise<string | Uint8Array> {
	const value = typeof contents === 'function' ? await contents() : contents
	if (typeof value !== 'string' && !(value instanceof Uint8Array)) throw new TypeError('A module public file must produce a string or bytes')
	return value
}

/** Writes the public files of the modules into the client build; one that `public/` also has is an error. */
export async function writeModulePublicFiles(directory: string, modules: ResolvedModules): Promise<void> {
	for (const [path, contents] of modules.publicFiles) {
		const target = join(directory, ...path.split('/'))
		if (existsSync(target)) throw new Error(`El archivo público ${path} de un módulo choca con public/${path}`)
		await mkdir(dirname(target), { recursive: true })
		await writeFile(target, await publicFileContents(contents))
	}
}
