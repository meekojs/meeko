import type { InlineConfig } from 'vite'

import type { ResolvedModules } from './module-loader'

import { installedModulePackages } from './module-loader'

/**
 * Compiles `packages` as source: bundled into the server build and the dev module runner
 * (`ssr.noExternal`), and served file by file to the dev client instead of pre-bundled
 * (`optimizeDeps.exclude`). See {@link installedModulePackages}.
 */
export function withSourcePackages(config: InlineConfig, packages: readonly string[]): InlineConfig {
	if (!packages.length) return config
	const ssr = config.ssr ?? {}
	const noExternal = ssr.noExternal === true ? true : [...[ssr.noExternal ?? []].flat(), ...packages]
	const optimizeDeps = config.optimizeDeps ?? {}
	return { ...config, ssr: { ...ssr, noExternal }, optimizeDeps: { ...optimizeDeps, exclude: [...(optimizeDeps.exclude ?? []), ...packages] } }
}

/**
 * The inline Vite configuration of a `meeko dev` or `meeko build` step with what the modules add:
 * their plugins after Meeko's, then each `extendViteConfig` in order. The installed packages of the
 * modules compile as source ({@link withSourcePackages}).
 */
export function withModules(modules: ResolvedModules, base: InlineConfig, command: 'serve' | 'build'): InlineConfig {
	const sourced = withSourcePackages(base, installedModulePackages(modules.ownedDirectories))
	let config: Record<string, any> = modules.vitePlugins.length ? { ...sourced, plugins: [...(sourced.plugins ?? []), ...modules.vitePlugins] } : sourced
	const ssr = Boolean((base.build as { ssr?: unknown } | undefined)?.ssr)
	for (const extend of modules.viteExtenders) config = extend(config, { command, ssr }) ?? config
	return config as InlineConfig
}
