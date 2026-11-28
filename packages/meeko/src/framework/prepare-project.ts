import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { defaultErrorPageFile, frameworkClientEntry, frameworkNodeEntry, frameworkServerEntry } from './app-manifest'
import { defaultErrorLogo } from './default-error-logo'
import { clientEntrySource, defaultErrorPageSource, nodeEntrySource, serverEntrySource } from './project-templates'
import { writeIfChanged } from './type-declarations'

/**
 * Writes the logo of the default error page next to it, only when it changed: rewriting it on every
 * start would make Vite reload the pages that import it.
 */
async function writeDefaultErrorLogo(target: string): Promise<void> {
	const logo = Buffer.from(defaultErrorLogo, 'base64')
	try {
		if (logo.equals(await readFile(target))) return
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
	}
	await writeFile(target, logo)
}

/**
 * Writes framework-owned Vite entries; no application file is overwritten. An entry that already has
 * its source is left alone: Vite watches them, and rewriting one reloads every page open on every
 * `meeko dev` of the project, with the state it had.
 */
export async function prepareProject(projectRoot: string): Promise<void> {
	const root = resolve(projectRoot)
	const generated = resolve(root, '.meeko/generated')
	await mkdir(generated, { recursive: true })
	await Promise.all([
		writeIfChanged(resolve(root, frameworkClientEntry), clientEntrySource),
		writeIfChanged(resolve(root, defaultErrorPageFile), defaultErrorPageSource),
		writeDefaultErrorLogo(resolve(generated, 'meeko-logo.webp')),
		writeIfChanged(resolve(root, frameworkServerEntry), serverEntrySource),
		writeIfChanged(resolve(root, frameworkNodeEntry), nodeEntrySource),
	])
}
