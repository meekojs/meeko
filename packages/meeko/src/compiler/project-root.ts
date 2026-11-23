import { existsSync } from 'node:fs'
import { dirname, parse, resolve } from 'node:path'

/** The package owns generated Meeko artifacts; a standalone TS project is a fallback. */
export function projectRoot(filename: string): string {
	let directory = dirname(resolve(filename))
	let tsProject: string | undefined
	for (;;) {
		if (existsSync(resolve(directory, 'package.json'))) return directory
		if (!tsProject && existsSync(resolve(directory, 'tsconfig.json'))) tsProject = directory
		const parent = dirname(directory)
		if (parent === directory || directory === parse(directory).root) return tsProject ?? dirname(resolve(filename))
		directory = parent
	}
}

/**
 * `load` once per project root: the components of one check or one declaration generation share
 * what is read from their project, such as its autoimports, which run the configuration and parse
 * every autoimport folder.
 */
export function onceByRoot<T>(load: (root: string) => T | Promise<T>): (root: string) => Promise<T> {
	const loaded = new Map<string, Promise<T>>()
	return (root) => {
		let value = loaded.get(root)
		if (!value) {
			value = Promise.resolve().then(() => load(root))
			loaded.set(root, value)
		}
		return value
	}
}
