import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** The named exports of a data module, again only when a file of its chain changes. */
const dataModules = new Map<string, { readonly version: string; readonly exports: Promise<Record<string, unknown>> }>()

const scriptExtensions = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs']
/** A JavaScript extension in a specifier may name a TypeScript source, as `./data.js` for `data.ts`. */
const sourceExtensions: Readonly<Record<string, readonly string[]>> = { '.js': ['.ts', '.tsx'], '.jsx': ['.tsx'], '.mjs': ['.mts'], '.cjs': ['.cts'] }

/** `import`, `export … from` and `import()` of relative paths. A text of an example that looks the same only adds a file to watch. */
const relativeImports = /(?:\bfrom\s*|\bimport\s*\(?\s*)['"](\.{1,2}\/[^'"\n]+)['"]/g

const isFile = (path: string): boolean => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false

/** The file of a relative specifier as `tsx` finds it, or `undefined`. */
function resolveLocal(from: string, specifier: string): string | undefined {
	const path = join(dirname(from), specifier)
	const extension = extname(path)
	const sources = (sourceExtensions[extension] ?? []).map((source) => path.slice(0, -extension.length) + source)
	return [path, ...sources, ...scriptExtensions.map((script) => path + script), ...scriptExtensions.map((script) => join(path, `index${script}`))].find(isFile)
}

/**
 * Every local file `module` needs, itself included, with its modification time. A specifier that
 * finds no file counts too, so creating that file changes the result; a package is not local.
 */
function localChain(module: string): Map<string, number | undefined> {
	const chain = new Map<string, number | undefined>()
	const pending = [module]
	for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
		if (chain.has(file)) continue
		chain.set(file, statSync(file, { throwIfNoEntry: false })?.mtimeMs)
		if (!isFile(file) || !scriptExtensions.includes(extname(file))) continue
		for (const [, specifier] of readFileSync(file, 'utf8').matchAll(relativeImports)) {
			const found = resolveLocal(file, specifier!)
			if (found) pending.push(found)
			else chain.set(join(dirname(file), specifier!), undefined)
		}
	}
	return chain
}

/**
 * The values of the named relative imports of a component, such as `examples`, read from their
 * modules: plain data that the template passes to `bind:code`. A change of those modules, or of any
 * local file they import, invalidates the component, so `meeko dev` shows the new text.
 */
export async function importedValues(source: string, file: string, load: (module: string) => Promise<unknown>, watch: (source: string) => void): Promise<Map<string, unknown>> {
	const values = new Map<string, unknown>()
	for (const [, names, specifier] of source.matchAll(/^\s*import\s*\{([^}]+)\}\s*from\s*['"](\.[^'"]+)['"]/gm)) {
		const module = join(dirname(file), `${specifier}.ts`)
		if (!existsSync(module)) continue
		const chain = localChain(module)
		for (const [path, modified] of chain) if (modified !== undefined) watch(path)
		const version = JSON.stringify([...chain])
		let cached = dataModules.get(module)
		if (cached?.version !== version) dataModules.set(module, (cached = { version, exports: load(pathToFileURL(module).href) as Promise<Record<string, unknown>> }))
		const loaded = await cached.exports
		for (const part of names!.split(',')) {
			const [name, alias] = part.trim().split(/\s+as\s+/)
			if (name && name in loaded) values.set(alias ?? name, loaded[name])
		}
	}
	return values
}
