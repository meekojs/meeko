import type { IconCollectionName, IconInclude } from './index'

/**
 * Opciones de `@meekojs/icon`, en la clave `icon` de `meeko.config.ts`.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import type { IconModuleOptions } from '@meekojs/icon/module'
 *
 * const options: IconModuleOptions = { collections: ['lucide'], include: ['lucide:check'], size: '1.25em' }
 * ```
 */
export interface IconModuleOptions {
	/**
	 * Colecciones de Iconify que usa el proyecto, como `'lucide'`. Cada una es un paquete
	 * `@iconify-json/<colección>` instalado en el proyecto (`pnpm add -D @iconify-json/lucide`).
	 */
	readonly collections?: readonly IconCollectionName[]
	/**
	 * Iconos disponibles para nombres dinámicos (`bind:name`), o `'<colección>:*'` para una colección
	 * entera. Los nombres literales no hace falta listarlos: se resuelven al compilar.
	 */
	readonly include?: readonly IconInclude[]
	/**
	 * Carpeta de SVG propios, relativa a la raíz del proyecto; cada `<nombre>.svg` es `local:<nombre>`.
	 * Por defecto, `'app/icons'` si existe; `false` la desactiva.
	 */
	readonly local?: false | string
	/** Alto por defecto de los iconos, una longitud CSS. Por defecto, `'1em'`. */
	readonly size?: string
}

/** Options with defaults applied and validated. */
export interface ResolvedIconOptions {
	readonly collections: readonly string[]
	readonly include: readonly string[]
	readonly local: false | string | undefined
	readonly size: string
}

const prefixPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const iconPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*:(?:\*|[a-z0-9]+(?:[-_][a-z0-9]+)*)$/
const sizePattern = /^(?:\d*\.?\d+(?:px|em|rem|ex|ch|vw|vh|vmin|vmax|cm|mm|in|pt|pc|%)?)$/

/** Validates the options before reading any file; the errors name the wrong option. */
export function resolveOptions(options: IconModuleOptions): ResolvedIconOptions {
	if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('icon: options must be an object')
	for (const key of Object.keys(options)) if (!['collections', 'include', 'local', 'size'].includes(key)) throw new TypeError(`icon: unknown option ${key}`)
	const collections = options.collections ?? []
	if (!Array.isArray(collections) || collections.some((name) => typeof name !== 'string' || !prefixPattern.test(name))) throw new TypeError('icon: collections must be a list of Iconify prefixes, such as ["lucide"]')
	if (collections.includes('local')) throw new TypeError('icon: "local" is reserved for the SVG files of icon.local')
	const include = options.include ?? []
	if (!Array.isArray(include)) throw new TypeError('icon: include must be a list of icon names')
	for (const name of include) if (typeof name !== 'string' || !iconPattern.test(name)) throw new TypeError(`icon: invalid include entry ${JSON.stringify(name)}; use "collection:name" or "collection:*"`)
	const size = options.size ?? '1em'
	if (typeof size !== 'string' || !sizePattern.test(size)) throw new TypeError(`icon: invalid size ${JSON.stringify(size)}; use a CSS length such as "1em" or "20px"`)
	if (options.local !== undefined && options.local !== false && (typeof options.local !== 'string' || !options.local.trim())) throw new TypeError('icon: local must be a folder or false')
	return { collections: [...new Set(collections)], include: [...new Set(include)], local: options.local, size }
}
