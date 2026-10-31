import { isAbsolute, matchesGlob, relative } from 'node:path'

/** Valida patrones relativos a un directorio de componentes, sin exclusiones negadas. */
export function normalizeComponentExcludes(value: unknown): readonly string[] {
	if (value === undefined) return []
	if (!Array.isArray(value) || value.some((pattern) => typeof pattern !== 'string')) throw new TypeError('Component exclude must be an array of relative glob patterns')
	return Object.freeze(
		value.map((raw: string) => {
			const pattern = raw.replaceAll('\\', '/')
			if (!pattern || isAbsolute(pattern) || /^[A-Za-z]:/.test(pattern) || pattern.startsWith('!') || pattern.split('/').some((part) => part === '..' || part === '.')) {
				throw new TypeError(`Component exclude must be a relative glob pattern: ${raw}`)
			}
			return pattern
		}),
	)
}

/** Una exclusión afecta al registro y los autoimports, no a los imports explícitos. */
export function componentExcluded(file: string, directory: { dir: string; exclude?: readonly string[] }): boolean {
	const path = relative(directory.dir, file).replaceAll('\\', '/')
	return (
		directory.exclude?.some((pattern) => {
			// Una carpeta excluida completa incluye también sus archivos y subcarpetas ocultos.
			if (pattern.endsWith('/**')) {
				const parent = pattern.slice(0, -3)
				const segments = path.split('/')
				for (let length = 1; length < segments.length; length++) {
					if (matchesGlob(segments.slice(0, length).join('/'), parent)) return true
				}
			}
			return matchesGlob(path, pattern)
		}) ?? false
	)
}
