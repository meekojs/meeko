import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

import { projectRootOf, stampOf, warnOnce } from './classes'

/** Sorts the tokens of one `class` value as `prettier-plugin-tailwindcss` does. */
export type TailwindClassSorter = (tokens: readonly string[]) => string[]

/** The part of Tailwind's design system the sorter uses (`tailwindcss` 4). */
interface DesignSystem {
	getClassOrder(classes: string[]): Array<[string, bigint | null]>
}

interface LoadedModule {
	readonly path: string
	readonly base: string
	readonly module: unknown
}

interface LoadedStylesheet {
	readonly path: string
	readonly base: string
	readonly content: string
}

interface TailwindApi {
	__unstable__loadDesignSystem?(
		css: string,
		options: {
			base: string
			loadModule(id: string, base: string, hint: string): Promise<LoadedModule>
			loadStylesheet(id: string, base: string): Promise<LoadedStylesheet>
		},
	): Promise<DesignSystem>
}

interface TailwindNodeApi {
	loadModule?(id: string, base: string, onDependency: (path: string) => void): Promise<LoadedModule>
}

/** The stylesheet the design system is loaded from, relative to the project root, unless configured. */
export const defaultTailwindStylesheet = 'app/styles/main.css'
/** A failed load is retried after this long even if none of its known files changed (an install, a fixed plugin). */
const failureRetryMs = 2000

interface TailwindEntry {
	/** `mtimeMs:size` (or `missing`) of the stylesheet and of every stylesheet and module it loaded. */
	readonly stamps: ReadonlyMap<string, string>
	readonly sorter: TailwindClassSorter | undefined
	readonly retryAt?: number
}

const entries = new Map<string, Promise<TailwindEntry>>()

async function isCurrent(entry: TailwindEntry): Promise<boolean> {
	if (entry.retryAt !== undefined && Date.now() >= entry.retryAt) return false
	const current = await Promise.all([...entry.stamps].map(async ([file, stamp]) => (await stampOf(file)) === stamp))
	return current.every(Boolean)
}

function resolveFrom(directory: string, specifier: string): string | undefined {
	try {
		return createRequire(join(directory, 'noop.js')).resolve(specifier)
	} catch {
		return undefined
	}
}

/**
 * Imports a module by path. With `version` (the file's stamp), a changed file gets a new URL:
 * Node caches an ES module by URL for the life of the process, so the same URL would return the
 * module as it was first loaded.
 */
async function importFile<T>(path: string, version?: string): Promise<T> {
	const url = pathToFileURL(path)
	if (version !== undefined) url.searchParams.set('v', version)
	const module = (await import(url.href)) as T & { default?: T }
	return module
}

/**
 * `@tailwindcss/node` loads `@plugin` and `@config` modules as Tailwind's own integrations do,
 * TypeScript included. It is a dependency of `@tailwindcss/postcss` and `@tailwindcss/vite`, so
 * pnpm may not expose it to the project itself.
 */
async function importTailwindNode(root: string): Promise<TailwindNodeApi | undefined> {
	const direct = resolveFrom(root, '@tailwindcss/node')
	const through = ['@tailwindcss/postcss', '@tailwindcss/vite'].map((name) => resolveFrom(root, name)).find(Boolean)
	const path = direct ?? (through ? resolveFrom(dirname(through), '@tailwindcss/node') : undefined)
	if (!path) return undefined
	try {
		const module = await importFile<TailwindNodeApi & { default?: TailwindNodeApi }>(path)
		return typeof module.loadModule === 'function' ? module : module.default
	} catch {
		return undefined
	}
}

/** The CSS file `@import "<id>"` names from `base`: a path, a package's `style` entry or a CSS subpath. */
async function resolveStylesheet(id: string, base: string): Promise<string> {
	if (id.startsWith('.') || isAbsolute(id)) return resolve(base, id)
	const direct = resolveFrom(base, id)
	if (direct?.endsWith('.css')) return direct
	const manifestPath = resolveFrom(base, `${id}/package.json`)
	if (manifestPath) {
		const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as { style?: string; exports?: Record<string, unknown> }
		const root = manifest.exports?.['.']
		const style = (root && typeof root === 'object' ? (root as { style?: unknown }).style : undefined) ?? manifest.style
		if (typeof style === 'string') return join(dirname(manifestPath), style)
	}
	const index = resolveFrom(base, `${id}/index.css`)
	if (index) return index
	throw new Error(`no se encuentra la hoja "${id}" desde ${base}`)
}

/** Orders as `prettier-plugin-tailwindcss`: unknown classes first, in their order, then by Tailwind's order. */
function sorterOf(design: DesignSystem): TailwindClassSorter {
	return (tokens) => {
		const ordered = design.getClassOrder([...tokens])
		// `Array#sort` is stable: unknown classes and classes with the same order keep their order.
		ordered.sort(([, left], [, right]) => {
			if (left === right) return 0
			if (left === null) return -1
			if (right === null) return 1
			return left < right ? -1 : 1
		})
		return ordered.map(([name]) => name)
	}
}

async function loadTailwind(root: string, file: string): Promise<TailwindEntry> {
	const stamps = new Map<string, string>()
	const stamp = async (path: string): Promise<void> => {
		const absolute = resolve(path)
		if (!stamps.has(absolute)) stamps.set(absolute, await stampOf(absolute))
	}
	const shown = relative(root, file).replaceAll('\\', '/')
	// Stamped before reading: a change while the design system loads reloads it next time.
	await stamp(file)
	await stamp(join(root, 'package.json'))
	if (stamps.get(resolve(file)) === 'missing') {
		warnOnce(`${root}\0${file}\0missing`, `no existe ${shown} en ${root}`, 'tailwind')
		return { stamps, sorter: undefined }
	}
	const tailwindPath = resolveFrom(root, 'tailwindcss')
	if (!tailwindPath) {
		warnOnce(`${root}\0missing-tailwind`, `tailwindcss no está instalado en ${root}`, 'tailwind')
		return { stamps, sorter: undefined, retryAt: Date.now() + failureRetryMs }
	}
	try {
		const tailwind = await importFile<TailwindApi & { default?: TailwindApi }>(tailwindPath)
		const load = tailwind.__unstable__loadDesignSystem ?? tailwind.default?.__unstable__loadDesignSystem
		if (typeof load !== 'function') throw new Error('la versión instalada de tailwindcss no expone el orden de clases (se necesita tailwindcss 4)')
		const node = await importTailwindNode(root)
		const pending: Array<Promise<void>> = []
		const design = await load(await readFile(file, 'utf8'), {
			base: dirname(file),
			async loadStylesheet(id, base) {
				const path = await resolveStylesheet(id, base)
				await stamp(path)
				return { path, base: dirname(path), content: await readFile(path, 'utf8') }
			},
			async loadModule(id, base) {
				if (node?.loadModule)
					return node.loadModule(id, base, (path) => {
						pending.push(stamp(path))
					})
				const path = id.startsWith('.') || isAbsolute(id) ? resolve(base, id) : resolveFrom(base, id)
				if (!path) throw new Error(`no se encuentra el módulo "${id}" desde ${base}`)
				await stamp(path)
				// Without @tailwindcss/node, a changed `@plugin` or `@config` module is imported again.
				const module = await importFile<{ default?: unknown }>(path, stamps.get(resolve(path)))
				return { path, base: dirname(path), module: module.default ?? module }
			},
		})
		await Promise.all(pending)
		return { stamps, sorter: sorterOf(design) }
	} catch (error) {
		const reason = error instanceof Error ? error.message.split('\n')[0] : String(error)
		warnOnce(`${root}\0${file}\0failed`, `no se pudo cargar Tailwind desde ${shown} en ${root} (${reason})`, 'tailwind')
		return { stamps, sorter: undefined, retryAt: Date.now() + failureRetryMs }
	}
}

/**
 * The class sorter of the project's Tailwind design system, loaded from `stylesheet` (relative to
 * the project root; `app/styles/main.css` by default) with the `tailwindcss` the project resolves.
 * `undefined` when there is no project, no stylesheet, no Tailwind 4 or it does not load; a warning
 * says so once. Cached per project and stylesheet while none of the files it was loaded from changes.
 */
export async function tailwindClassSorter(filepath: string | undefined, stylesheet?: string): Promise<TailwindClassSorter | undefined> {
	if (!filepath) {
		warnOnce('\0nofile', 'Prettier no recibió la ruta del archivo (filepath)', 'tailwind')
		return undefined
	}
	const root = await projectRootOf(filepath)
	if (!root) {
		warnOnce('\0noroot', `${filepath} no está en un proyecto Meeko (meeko.config.* o package.json con @meekojs/meeko)`, 'tailwind')
		return undefined
	}
	const file = resolve(root, stylesheet || defaultTailwindStylesheet)
	const key = `${root}\0${file}`
	for (;;) {
		const pending = entries.get(key)
		if (pending) {
			const entry = await pending
			if (await isCurrent(entry)) return entry.sorter
			// Another format call already started the new load: wait for it.
			if (entries.get(key) !== pending) continue
		}
		const loading = loadTailwind(root, file)
		entries.set(key, loading)
		return (await loading).sorter
	}
}
