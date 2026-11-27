import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Lo mínimo que este módulo lee de un plugin de Vite: Meeko los pasa tal cual a Vite. */
type VitePlugin = Record<string, unknown> & { readonly name: string }

/** Prefijo de los plugins que devuelve `@tailwindcss/vite`. */
const tailwindPrefix = '@tailwindcss/vite:'

/** Las claves de un plugin que no son hooks y se copian sin envolver. */
const passive = new Set(['name', 'enforce', 'apply', 'api'])

/** Un `@import` de la entrada principal de UI, con comillas o `url()`; no el de `@meekojs/ui/hues`. */
const entryImport = /@import\s+(?:url\(\s*)?(['"])@meekojs\/ui\1/

/**
 * Envuelve los plugins de `@tailwindcss/vite` para que se aparten cuando la aplicación, u otro módulo,
 * ya registra su propio `@tailwindcss/vite`: la hoja se compila una sola vez. Cada configuración
 * resuelta de Vite lo decide de nuevo; mientras están apartados, sus hooks no hacen nada.
 *
 * @param plugins - Los plugins de una llamada a `tailwindcss()` de `@tailwindcss/vite`.
 * @returns Copias de esos plugins con el mismo nombre, orden y hooks.
 */
export function guardTailwind(plugins: readonly VitePlugin[]): VitePlugin[] {
	const own = new WeakSet<object>()
	let active = true
	const guarded = (hook: (...args: unknown[]) => unknown) =>
		function (this: unknown, ...args: unknown[]): unknown {
			return active ? hook.apply(this, args) : undefined
		}
	return plugins.map((plugin) => {
		const copy: VitePlugin = { name: plugin.name }
		for (const [key, hook] of Object.entries(plugin)) {
			if (passive.has(key)) copy[key] = hook
			else if (key === 'configResolved' && typeof hook === 'function')
				copy[key] = function (this: unknown, config: { readonly plugins?: readonly { readonly name?: unknown }[] }) {
					// Another instance of @tailwindcss/vite in the same configuration compiles the sheets instead.
					active = !config.plugins?.some((other) => typeof other.name === 'string' && other.name.startsWith(tailwindPrefix) && !own.has(other))
					return active ? (hook as (...args: unknown[]) => unknown).call(this, config) : undefined
				}
			else if (typeof hook === 'function') copy[key] = guarded(hook as (...args: unknown[]) => unknown)
			else if (hook && typeof hook === 'object' && typeof (hook as { handler?: unknown }).handler === 'function') copy[key] = { ...hook, handler: guarded((hook as { handler: (...args: unknown[]) => unknown }).handler) }
			else copy[key] = hook
		}
		own.add(copy)
		return copy
	})
}

/**
 * Los plugins de `@tailwindcss/vite`, protegidos con {@link guardTailwind}, como una entrada de `plugins`
 * que Vite espera: el paquete y sus binarios nativos se cargan sólo cuando Vite resuelve una
 * configuración, no cuando otra herramienta (`meeko check`, el editor) carga los módulos.
 *
 * @returns Un thenable que Vite resuelve con instancias nuevas cada vez que lo espera.
 */
export function tailwindPlugins(): PromiseLike<VitePlugin[]> {
	return {
		then(resolve, reject) {
			return import('@tailwindcss/vite').then(({ default: tailwind }) => guardTailwind(tailwind() as unknown as VitePlugin[])).then(resolve, reject)
		},
	}
}

/** Lee una hoja local: su texto, o `undefined` si no existe o no se puede leer. */
export type ReadStylesheet = (path: string) => string | undefined

/** Las hojas locales que se siguen como mucho por debajo de la que se examina: `main.css` → `ui.css` → … */
const maxImportDepth = 8

/** Un `@import` relativo (`./x.css`, `../x.css`), con comillas o `url()`; el grupo 2 es la ruta. */
const localImport = /@import\s+(?:url\(\s*)?(['"])(\.\.?\/[^'"]+)\1/g

const readText: ReadStylesheet = (path) => {
	try {
		return readFileSync(path, 'utf8')
	} catch {
		return undefined
	}
}

/** El CSS sin comentarios; cada comentario conserva su longitud, así que los desplazamientos son los del original. */
const withoutComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, (comment) => ' '.repeat(comment.length))

/**
 * Si una hoja importa la entrada CSS de UI, directamente o a través de sus `@import` locales relativos
 * (`main.css` → `./ui.css` → `@meekojs/ui`): como mucho {@link maxImportDepth} hojas por debajo, y cada
 * una una sola vez, así que un ciclo de imports termina.
 */
function reachesEntry(plain: string, file: string | undefined, read: ReadStylesheet, depth: number, seen: Set<string>): boolean {
	if (entryImport.test(plain)) return true
	if (file === undefined || depth >= maxImportDepth) return false
	for (const [, , specifier] of plain.matchAll(localImport)) {
		const path = resolve(dirname(file), specifier.replace(/[?#].*$/, ''))
		if (seen.has(path)) continue
		seen.add(path)
		const css = read(path)
		if (css !== undefined && reachesEntry(withoutComments(css), path, read, depth + 1, seen)) return true
	}
	return false
}

/**
 * Inserta las variables de `ui.tokens` en una hoja que importa `@meekojs/ui`, directamente o a través de
 * sus `@import` locales relativos (`@import './ui.css'`): tras su último `@import`, de modo que siguen a los
 * tokens de UI y preceden a las reglas de la propia hoja, que ganan a ambos.
 *
 * @param code - El CSS de la hoja, antes de que Tailwind resuelva sus `@import`.
 * @param tokens - Las reglas que genera `tokenStyles` a partir de `ui.tokens`.
 * @param file - La ruta de la hoja, para seguir sus `@import` relativos; sin ella sólo cuenta un import directo.
 * @param read - Lee una hoja importada; por defecto, del disco.
 * @returns El CSS con los tokens, o `undefined` si la hoja no llega a `@meekojs/ui`.
 */
export function insertTokens(code: string, tokens: string, file?: string, read: ReadStylesheet = readText): string | undefined {
	const plain = withoutComments(code)
	if (!reachesEntry(plain, file, read, 0, new Set(file === undefined ? [] : [resolve(file)]))) return undefined
	let end = 0
	for (const match of plain.matchAll(/@import\b[^;]*;/g)) end = match.index + match[0].length
	return `${code.slice(0, end)}\n${tokens}${code.slice(end)}`
}

/**
 * Si la hoja global de la aplicación importa la entrada CSS de UI, directamente o a través de sus
 * `@import` locales relativos. Sin ella los componentes no tienen estilos: la aplicación compila la hoja
 * de UI con su Tailwind, y el módulo ya no añade una precompilada.
 *
 * @param css - El contenido de `app/styles/main.css`, o `undefined` si no existe.
 * @param file - La ruta de esa hoja, para seguir sus `@import` relativos; sin ella sólo cuenta un import directo.
 * @param read - Lee una hoja importada; por defecto, del disco.
 */
export function importsEntry(css: string | undefined, file?: string, read: ReadStylesheet = readText): boolean {
	return css !== undefined && reachesEntry(withoutComments(css), file, read, 0, new Set(file === undefined ? [] : [resolve(file)]))
}
