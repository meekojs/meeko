import type { IconifyJSON } from '@iconify/types'

import { getIconData, iconToSVG } from '@iconify/utils'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

import type { IconData } from './index'
import type { ResolvedIconOptions } from './options'

import { sanitizeSvg } from './sanitize'

/**
 * Icon sources on the Node side: the `@iconify-json/<prefix>` packages of the project and the SVG
 * files of the local folder. Everything is read from disk at build time; nothing is fetched.
 */

/** A collection read from its package. */
export interface Collection {
	readonly data: IconifyJSON
	/** Every icon and alias name, sorted. */
	readonly names: readonly string[]
	readonly prefix: string
}

/** The icons the project can use, by full name. */
export interface IconSources {
	readonly collections: ReadonlyMap<string, Collection>
	/** Files watched for each local icon, so a change invalidates the components that embed it. */
	readonly localFiles: ReadonlyMap<string, string>
	/** Absolute folder of the local icons, if any. */
	readonly localDirectory: string | undefined
	/** `local:<name>` icons. */
	readonly locals: ReadonlyMap<string, IconData>
}

/** The `@iconify-json/*` packages that `package.json` of the project declares, by prefix. */
export function installedCollections(root: string): string[] {
	let manifest: Record<string, unknown>
	try {
		manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as Record<string, unknown>
	} catch {
		return []
	}
	const names = new Set<string>()
	for (const field of ['dependencies', 'devDependencies', 'optionalDependencies']) {
		const dependencies = manifest[field]
		if (dependencies && typeof dependencies === 'object') for (const name of Object.keys(dependencies)) if (name.startsWith('@iconify-json/')) names.add(name.slice('@iconify-json/'.length))
	}
	return [...names].sort()
}

/** Reads `@iconify-json/<prefix>` as the project resolves it; a missing package is a clear error. */
export function loadCollection(root: string, prefix: string): Collection {
	const require = createRequire(join(root, 'package.json'))
	let file: string
	try {
		file = require.resolve(`@iconify-json/${prefix}/icons.json`)
	} catch {
		throw new Error(`icon: the collection "${prefix}" of icon.collections is not installed in ${root}. Install it with: pnpm add -D @iconify-json/${prefix}`)
	}
	const data = JSON.parse(readFileSync(file, 'utf8')) as IconifyJSON
	if (!data || typeof data !== 'object' || typeof data.icons !== 'object') throw new Error(`icon: ${file} is not an Iconify JSON collection`)
	if (data.prefix !== prefix) throw new Error(`icon: @iconify-json/${prefix} declares the prefix "${data.prefix}"`)
	const names = [...Object.keys(data.icons), ...Object.keys(data.aliases ?? {})].sort()
	return { data, names, prefix }
}

/** Makes the ids of an icon body unique to that icon, deterministically: SSR and the browser build agree. */
export function scopeIds(body: string, scope: string): string {
	const ids = [...body.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!)
	if (!ids.length) return body
	const safe = scope.replace(/[^\w-]/g, '-')
	let result = body
	for (const id of new Set(ids)) {
		const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
		result = result.replace(new RegExp(`(\\sid="|#)${escaped}(?=["')])`, 'g'), `$1meeko-icon-${safe}-${id}`)
	}
	return result
}

/** Builds the icon `name` of a collection, or `undefined` if the collection has no such icon. */
export function collectionIcon(collection: Collection, name: string): IconData | undefined {
	const data = getIconData(collection.data, name)
	if (!data) return undefined
	const svg = iconToSVG(data)
	return [svg.attributes.viewBox, scopeIds(svg.body, `${collection.prefix}-${name}`)]
}

/** Reads and sanitizes the SVG files of the local folder; names are the file names without `.svg`. */
export function loadLocalIcons(root: string, folder: string): { files: Map<string, string>; icons: Map<string, IconData> } {
	const directory = resolve(root, folder)
	const files = new Map<string, string>()
	const icons = new Map<string, IconData>()
	const inside = relative(realpathSync(root), realpathSync(directory))
	if (isAbsolute(inside) || inside === '..' || inside.startsWith(`..${sep}`)) throw new Error(`icon: icon.local leaves the project: ${directory}`)
	for (const entry of readdirSync(directory).sort()) {
		if (extname(entry).toLowerCase() !== '.svg') continue
		const file = join(directory, entry)
		if (!statSync(file).isFile()) continue
		const name = basename(entry, extname(entry))
		if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) throw new Error(`icon: ${file}: rename it in kebab-case (letters, digits and dashes) to use it as local:<name>`)
		const [viewBox, body] = sanitizeSvg(readFileSync(file, 'utf8'), file)
		icons.set(`local:${name}`, [viewBox, scopeIds(body, `local-${name}`)])
		files.set(`local:${name}`, file)
	}
	return { files, icons }
}

/** Loads every source of icons that the options name. */
export function loadSources(root: string, options: ResolvedIconOptions): IconSources {
	const collections = new Map<string, Collection>()
	for (const prefix of options.collections) collections.set(prefix, loadCollection(root, prefix))
	const folder = options.local === undefined ? (existsSync(join(root, 'app', 'icons')) ? 'app/icons' : undefined) : options.local || undefined
	if (folder !== undefined && !existsSync(resolve(root, folder))) throw new Error(`icon: icon.local names a folder that does not exist: ${resolve(root, folder)}`)
	const local = folder === undefined ? { files: new Map<string, string>(), icons: new Map<string, IconData>() } : loadLocalIcons(root, folder)
	return { collections, localDirectory: folder === undefined ? undefined : resolve(root, folder), localFiles: local.files, locals: local.icons }
}

/** The closest names to `name`, for the error of an unknown icon. */
function suggestions(name: string, candidates: readonly string[]): string[] {
	const distance = (a: string, b: string): number => {
		const row = Array.from({ length: b.length + 1 }, (_, index) => index)
		for (let i = 1; i <= a.length; i++) {
			let previous = row[0]!
			row[0] = i
			for (let j = 1; j <= b.length; j++) {
				const current = row[j]!
				row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1))
				previous = current
			}
		}
		return row[b.length]!
	}
	return candidates
		.map((candidate) => ({ candidate, score: distance(name, candidate) }))
		.filter(({ score }) => score <= Math.max(2, Math.floor(name.length / 3)))
		.sort((a, b) => a.score - b.score || a.candidate.localeCompare(b.candidate))
		.slice(0, 3)
		.map(({ candidate }) => candidate)
}

/**
 * Resolves `prefix:name` from the sources.
 *
 * @throws {Error} With the closest names when the icon or its collection does not exist.
 */
export function resolveIcon(sources: IconSources, fullName: string): IconData {
	const separator = fullName.indexOf(':')
	const prefix = fullName.slice(0, separator)
	const name = fullName.slice(separator + 1)
	if (separator <= 0 || !name) throw new Error(`icon: invalid icon name "${fullName}"; use "collection:name"`)
	if (prefix === 'local') {
		const icon = sources.locals.get(fullName)
		if (icon) return icon
		if (!sources.localDirectory) throw new Error(`icon: "${fullName}" needs a folder of local icons (app/icons or icon.local)`)
		const close = suggestions(fullName, [...sources.locals.keys()])
		throw new Error(`icon: unknown icon "${fullName}": there is no ${name}.svg in ${sources.localDirectory}${close.length ? `. Did you mean ${close.join(', ')}?` : ''}`)
	}
	const collection = sources.collections.get(prefix)
	if (!collection) throw new Error(`icon: "${fullName}" belongs to the collection "${prefix}", which is not in icon.collections`)
	const icon = collectionIcon(collection, name)
	if (icon) return icon
	const close = suggestions(name, collection.names).map((candidate) => `${prefix}:${candidate}`)
	throw new Error(`icon: unknown icon "${fullName}"${close.length ? `. Did you mean ${close.join(', ')}?` : ''}`)
}
