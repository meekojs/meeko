import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Locates Meeko configuration without importing its development server or private modules. */
export async function isMeekoProject(root: string): Promise<boolean> {
	for (const file of ['meeko.config.ts', 'meeko.config.mts', 'meeko.config.js', 'meeko.config.mjs']) {
		if ((await stat(join(root, file)).catch(() => undefined))?.isFile()) return true
	}
	try {
		const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as Record<string, Record<string, unknown> | undefined>
		return !!(manifest.dependencies?.['@meekojs/meeko'] || manifest.devDependencies?.['@meekojs/meeko'])
	} catch {
		return false
	}
}
