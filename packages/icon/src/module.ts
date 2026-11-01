import { defineMeekoModule } from '@meekojs/meeko/framework'
import { normalize } from 'node:path'

import type { IconSources } from './collections'
import type { IconData } from './index'
import type { IconModuleOptions } from './options'

import { installedCollections, loadLocalIcons, loadSources, resolveIcon } from './collections'
import { iconDeclarations } from './declarations'
import { resolveOptions } from './options'
import { position, transformIconTags } from './transform'

export type { IconModuleOptions } from './options'

declare module '@meekojs/meeko/framework' {
	interface MeekoConfig {
		/** Opciones de `@meekojs/icon`, que se registra con `modules: ['@meekojs/icon']`. */
		readonly icon?: IconModuleOptions
	}
}

const registryId = 'virtual:meeko-icon'
const resolvedRegistry = '\0meeko-icon:registry'

/**
 * Módulo de iconos de Iconify para Meeko. Registra `<UIIcon>`, resuelve al compilar cada nombre
 * literal en el `<svg>` incrustado, empaqueta para nombres dinámicos sólo los iconos de
 * `icon.include` y genera los tipos de los nombres disponibles. Se registra por su nombre:
 * `modules: ['@meekojs/icon']`, con las opciones en la clave `icon`.
 *
 * @since 0.1.0
 * @example
 * ```ts
 * import { defineMeekoConfig } from '@meekojs/meeko/framework'
 *
 * export default defineMeekoConfig({
 * 	modules: ['@meekojs/icon'],
 * 	icon: { collections: ['lucide'], include: ['lucide:check', 'lucide:x'] },
 * })
 * ```
 */
export default defineMeekoModule<IconModuleOptions>({
	meta: { name: '@meekojs/icon', configKey: 'icon', compatibility: { meeko: '>=1.7 <2' } },
	defaults: {},
	setup(options, meeko) {
		const resolved = resolveOptions(options)
		const root = meeko.rootDir
		const sources = loadSources(root, resolved)
		for (const [file, contents] of iconDeclarations(sources, installedCollections(root))) meeko.addTypeTemplate(file, contents)

		// In dev the local folder is read again on each transform: a new or edited SVG needs no restart.
		const current = (): IconSources => {
			if (!meeko.dev || !sources.localDirectory) return sources
			const local = loadLocalIcons(root, sources.localDirectory)
			return { ...sources, localFiles: local.files, locals: local.icons }
		}

		const registry = new Map<string, IconData>()
		for (const entry of resolved.include) {
			const [prefix, name] = entry.split(':') as [string, string]
			if (name !== '*') registry.set(entry, resolveIcon(sources, entry))
			else if (prefix === 'local') for (const [local, icon] of sources.locals) registry.set(local, icon)
			else {
				const collection = sources.collections.get(prefix)
				if (!collection) throw new Error(`icon: icon.include names "${entry}", but "${prefix}" is not in icon.collections`)
				for (const icon of collection.names) registry.set(`${prefix}:${icon}`, resolveIcon(sources, `${prefix}:${icon}`))
			}
		}

		meeko.addComponentsDir(new URL('./app/components', import.meta.url), { prefix: 'UI' })
		meeko.addStylesheet(new URL('../src/app/styles/icon.css', import.meta.url))
		meeko.addVitePlugin({
			name: 'meeko-icon',
			resolveId(id: string) {
				if (id === registryId) return resolvedRegistry
			},
			load(this: { addWatchFile(file: string): void }, id: string) {
				if (id !== resolvedRegistry) return undefined
				const state = current()
				const icons: Record<string, IconData> = {}
				for (const [name, icon] of registry) {
					const file = state.localFiles.get(name)
					if (file) this.addWatchFile(file)
					icons[name] = state.locals.get(name) ?? icon
				}
				return `export const icons = ${JSON.stringify(icons)};\nexport const size = ${JSON.stringify(resolved.size)};\nexport const dev = ${JSON.stringify(meeko.dev)};\n`
			},
			// `order: 'pre'` runs before Meeko compiles the component: this hook sees the template source.
			transform: {
				order: 'pre',
				handler(this: { addWatchFile(file: string): void }, code: string, id: string) {
					if (!id.endsWith('.meeko')) return undefined
					const state = current()
					let result
					try {
						result = transformIconTags(code, (name) => resolveIcon(state, name))
					} catch (error) {
						const offset = (error as Error & { offset?: number }).offset
						const at = offset === undefined ? '' : `:${position(code, offset).line}:${position(code, offset).column}`
						throw new Error(`${normalize(id)}${at}: ${(error as Error).message}`, { cause: error })
					}
					if (!result) return undefined
					for (const name of result.names) {
						const file = state.localFiles.get(name)
						if (file) this.addWatchFile(file)
					}
					// Only the inserted attributes move code, within their lines.
					return { code: result.code, map: null }
				},
			},
		})
	},
})
