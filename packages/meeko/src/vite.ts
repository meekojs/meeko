import type { Plugin } from 'vite'

import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizePath, resolveConfig, transformWithOxc } from 'vite'

import type { ProjectAliases } from './framework/aliases'

import { generateComponentRegistry } from './autoimports/components'
import { autoImportDirectories, discoverAutoImports, discoverComponents } from './autoimports/registry'
import { autoImportedValues, checkComponentBoundary, transformAutoImports } from './autoimports/transform'
import { transformTypeScriptAutoImports, typeScriptAutoImportMap } from './autoimports/typescript'
import { compile } from './compiler'
import { aliasImporterScope, aliasScopeProblem, matchPathAlias } from './compiler/aliases'
import { serverScriptModule } from './compiler/codegen/server-script'
import { moduleSpecifiers } from './compiler/import-graph'
import { sourceMapForCompiled } from './compiler/sourcemap'
import { assertRouteBlockPlacement, isPageFile, routeBlockFile, routeBlockId, routeBlockSource, withoutRouteBlock } from './compiler/transforms/route-block'
import { resolveProjectAliases, resolveProjectAliasesSync } from './framework/aliases'
import { clientMiddlewareSource, clientPluginsSource, clientRoutesSource, clientSidecarsSource, readBuildAppData, serverAppSource } from './framework/app-manifest'
import { generateAppTypeForFile, generateAppTypes } from './framework/check-app'
import { componentDirectories, discoverConfiguredRoutes, loadConfiguredModules, loadMeekoConfig, resolveConfigSources } from './framework/config'
import { builtinOptimizeInclude, devScanIgnored, invalidateDevModules, isComponentSource, isDevWatchIgnored, isDiscoverySource, isModuleScript } from './framework/dev-watch'
import { editorBridgeDirectory } from './framework/editor-bridge'
import { extractRouteRender } from './framework/routes-discovery'
import { frameworkStylesheets, globalStylesheetFile, globalStylesheetsModule, stylesheetUrl } from './framework/styles'
import { generateComponentRegistryTypes } from './framework/type-declarations'

/**
 * A component's CSS is the module `Card.meeko?meeko-style=<hash>&lang.css`: a real path, as Vue
 * names its style blocks, so PostCSS plugins resolve files (Tailwind's `@reference`, a relative
 * `@import`) from the component's folder. The hash changes with the CSS, for hot updates. The same
 * module with `&inline` is the processed CSS as a string: the component's `css` export.
 */
const styleQuery = /[?&]meeko-style=([0-9a-f]{64})(?:&inline)?&lang\.css$/
const clientPagesModule = 'virtual:meeko-client-pages'
const clientRoutesModule = 'virtual:meeko-manifest/client'
const clientSidecarsModule = 'virtual:meeko-client-routes'
const serverAppModule = 'virtual:meeko-server-app'
const clientPluginsModule = 'virtual:meeko-plugins/client'
const clientMiddlewareModule = 'virtual:meeko-middleware/client'
const virtualModules = new Set([clientPagesModule, clientRoutesModule, clientSidecarsModule, serverAppModule, clientPluginsModule, clientMiddlewareModule, globalStylesheetsModule])
/** A module that imports `defineMeekoModule` holds build code: the browser must never load it. */
const moduleDefinitionImport = /\bimport\s*\{[^}]*\bdefineMeekoModule\b[^}]*\}\s*from\s*["']@meekojs\/meeko\/framework["']/
/** This package (its `src/` and `dist/`), whose documentation shows module imports in comments. */
const packageDirectory = `${normalizePath(resolve(dirname(fileURLToPath(import.meta.url)), '..'))}/`

/** Source without block and line comments, close enough for an import check. */
function withoutComments(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'`\\])\/\/.*$/gm, '$1')
}

/** Files and directories of the configured modules that only the server may load. */
interface ModuleBoundary {
	/** Module entries (setup code), server plugins, server middleware and server handlers. */
	readonly serverFiles: ReadonlySet<string>
	/** `addAutoImportsDir` directories with `scope: "server"`, ending in `/`. */
	readonly serverDirectories: readonly string[]
	/** Directories a module owns, ending in `/`: a `.server.ts` file there is server-only. */
	readonly ownedDirectories: readonly string[]
}

async function moduleBoundary(root: string): Promise<ModuleBoundary> {
	const { modules } = await loadConfiguredModules(root)
	const directory = (path: string): string => `${normalizePath(path).replace(/\/$/, '')}/`
	return {
		serverFiles: new Set(
			[
				...modules.entryFiles,
				...modules.plugins.filter((plugin) => plugin.mode === 'server').map((plugin) => plugin.file),
				...modules.serverMiddleware,
				...modules.serverHandlers.map((handler) => handler.file),
			].map((file) => normalizePath(file)),
		),
		serverDirectories: modules.autoImportsDirs.filter((entry) => entry.scope === 'server').map((entry) => directory(entry.dir)),
		ownedDirectories: modules.ownedDirectories.map(directory),
	}
}
const runtimeDirectory = `${normalizePath(dirname(fileURLToPath(import.meta.url)))}/`

/** `server.fs.deny` pattern of the editor bridge descriptors, which hold the session token. */
const editorBridgeFsDeny = `**/${editorBridgeDirectory}/**`

let viteFsDeny: Promise<string[]> | undefined

/**
 * Vite's default `server.fs.deny`. A list returned from `config` replaces the default
 * when the user sets none, so the plugin adds its pattern to these.
 */
function defaultFsDeny(): Promise<string[]> {
	viteFsDeny ??= resolveConfig({ configFile: false, envDir: false, logLevel: 'silent', plugins: [] }, 'serve').then((resolved) => [...resolved.server.fs.deny])
	return viteFsDeny
}

/** Maps each specifier inserted by an autoimport transform to the names it provides. */
function autoimportedSpecifiers(prefix: string): Map<string, string[]> {
	const result = new Map<string, string[]>()
	for (const line of prefix.split('\n')) {
		const match = /^import (?:type )?(?:\{ \S+ as (\S+) \}|\* as (\S+)) from ("(?:[^"\\]|\\.)*");$/.exec(line.trim())
		if (!match) continue
		const specifier = JSON.parse(match[3]!) as string
		result.set(specifier, [...(result.get(specifier) ?? []), (match[1] ?? match[2])!])
	}
	return result
}

/**
 * Plugin de Vite de Meeko: compila los imports `.meeko` en cliente y SSR, añade HMR y CSS durante el
 * desarrollo, aplica los autoimports a `.meeko` y `.ts`, y en una aplicación del framework genera
 * los módulos virtuales de rutas, páginas y servidor y el módulo de cada `<script server>`.
 * `meeko dev` y `meeko build` lo configuran solos; añádalo a mano sólo con un host de Vite propio.
 *
 * @returns El plugin de Vite.
 * @example
 * ```ts
 * // vite.config.ts
 * import { defineConfig } from "vite";
 * import { meeko } from "@meekojs/meeko/vite";
 *
 * export default defineConfig({
 *   plugins: [meeko()],
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/api.md#herramientas
 */
export function meeko(): Plugin {
	let isDev = false
	let ssrBuild = false
	let workerBuild = false
	let root = ''
	// The project's path aliases (`~/`, `@/`, `#shared/`, `#server/` and those of `alias`), read once
	// per configuration: a change of `meeko.config.*` reads them again.
	let aliasState: Promise<ProjectAliases> | undefined
	// Vite's `resolve.alias` (the project's and the modules') runs first: Meeko leaves out the prefixes it takes.
	let viteAlias: unknown
	const projectAliases = (): Promise<ProjectAliases> =>
		(aliasState ??= resolveProjectAliases(root, undefined, { viteAlias })
			// A configuration that fails is reported where it is loaded; resolution keeps the static reading.
			.catch(() => resolveProjectAliasesSync(root)))
	// The CSS of each compiled component by hash, and the hashes of each file, newest last. Only the
	// last two of a file are kept: the browser and SSR transforms of one edit may finish in either
	// order, and older stylesheets would otherwise pile up for as long as `meeko dev` runs.
	const styles = new Map<string, string>()
	const fileStyles = new Map<string, string[]>()
	let activeComponentDirectories: string[] = []
	/** Folders of the modules' files outside the project, for {@link isModuleScript}. */
	let activeModuleDirectories: string[] = []
	let registeredComponentFiles = new Set<string>()
	const projectOwnedComponent = (file: string): boolean => {
		const path = relative(root, resolve(file))
		return path !== '..' && !path.startsWith('../') && !path.startsWith('..\\') && !isAbsolute(path) && !path.split(/[\\/]/).includes('node_modules')
	}
	// Vite may report an add, unlink and change in the same burst. Never write the generated
	// loader concurrently: its file must describe one complete discovery before invalidation.
	let registryUpdate: Promise<unknown> = Promise.resolve()
	const refreshComponentRegistry = (editedFile?: string): Promise<string | undefined> => {
		const update = registryUpdate.then(async () => {
			if (editedFile && projectOwnedComponent(editedFile) && registeredComponentFiles.has(normalizePath(resolve(editedFile)))) {
				await generateAppTypeForFile(root, editedFile, { onError: (file, error) => console.error(`[meeko] Cannot update types for ${file}:`, error) })
				return
			}
			const registry = await generateComponentRegistry(root)
			await generateAppTypes(root, { onError: (file, error) => console.error(`[meeko] Cannot update types for ${file}:`, error) })
			await generateComponentRegistryTypes(root)
			registeredComponentFiles = new Set((await discoverComponents(root)).map(({ file }) => normalizePath(resolve(file))))
			return registry
		})
		registryUpdate = update.catch(() => undefined)
		return update
	}
	const componentWatchDirectories = async (): Promise<string[]> => {
		const { config, modules } = await loadConfiguredModules(root)
		const sources = await resolveConfigSources(root, config)
		return [
			...new Set([
				...sources.flatMap((source) => componentDirectories(config.components).map((entry) => resolve(source.root, entry.path))),
				...modules.componentsDirs.map((entry) => resolve(entry.dir)),
			]),
		]
	}
	const autoImportWatchDirectories = async (): Promise<string[]> => {
		const config = await loadMeekoConfig(root)
		const sources = await resolveConfigSources(root, config)
		return sources.flatMap((source) => autoImportDirectories(config.imports).map((directory) => resolve(source.root, directory)))
	}
	const keepStyle = (filename: string, hash: string, css: string): void => {
		styles.set(hash, css)
		const hashes = (fileStyles.get(filename) ?? []).filter((known) => known !== hash)
		hashes.push(hash)
		while (hashes.length > 2) styles.delete(hashes.shift()!)
		fileStyles.set(filename, hashes)
	}
	/**
	 * Whether a file under the project feeds autoimports or routes. `tree` also
	 * counts the server modules that discovery lists, for an added or removed file.
	 */
	const watchedSource = async (file: string, tree = false): Promise<boolean> => {
		const normalized = normalizePath(file)
		const normalizedRoot = normalizePath(root)
		if (normalized.startsWith(`${normalizedRoot}/meeko.config.`)) return false
		if (isComponentSource(file, await componentWatchDirectories())) return true
		const config = await loadMeekoConfig(root)
		const sources = await resolveConfigSources(root, config)
		for (const source of sources) {
			const prefix = `${normalizePath(source.root)}/`
			if (!normalized.startsWith(prefix)) continue
			const path = normalized.slice(prefix.length)
			// The default folders and those of `imports.appDirs`, `sharedDirs` and `serverDirs`.
			const registrySource = autoImportDirectories(config.imports).some((directory) => path.startsWith(`${directory}/`))
			const routesSource = /^(?:app\/(?:pages|layouts|middleware|plugins)|server\/middleware)\//.test(path)
			if (registrySource || routesSource || (tree && isDiscoverySource(file, [source.root]))) return true
		}
		return false
	}
	/**
	 * Resolves a path alias from `importer`: the project first, then each layer, the first folder
	 * where the file exists. `null` when `id` has no alias. Throws `MEEK118` for `@/` in shared/ and,
	 * in the browser graph, `MEEK108` for `#server/` outside the server; the SSR graph still loads
	 * server code from app/, as with a relative import (an email template rendered by an API route).
	 */
	const resolveAlias = async (context: { resolve(source: string, importer?: string, options?: { skipSelf?: boolean }): Promise<{ id: string } | null> }, id: string, importer: string, ssr: boolean, options?: object): Promise<{ id: string } | null> => {
		if (id.startsWith('.') || id.startsWith('/') || id.startsWith('\0') || isAbsolute(id) || !id.includes('/')) return null
		const importerFile = importer.replace(/[?#].*$/, '')
		// A package's own `#imports` and paths are its business.
		if (/[\\/]node_modules[\\/]/.test(importerFile)) return null
		const project = await projectAliases()
		const match = matchPathAlias(project.aliases, id)
		if (!match) return null
		const scope = aliasImporterScope(importerFile, project.sourceRoots)
		const problem = scope && aliasScopeProblem(match.alias, scope, id)
		if (problem && (problem.code !== 'MEEK108' || !ssr)) throw new Error(`${problem.code}: ${normalizePath(importerFile)}: ${problem.message}`)
		for (const target of match.alias.targets) {
			const resolved = await context.resolve(normalizePath(join(target, match.rest)), importer, { ...options, skipSelf: true })
			if (resolved) return resolved
		}
		return null
	}
	return {
		name: 'meeko:components',
		enforce: 'pre',
		configResolved(config) {
			isDev = config.command === 'serve'
			ssrBuild = Boolean(config.build.ssr)
			// Workers have no TCP: their bundle never carries the redis package.
			workerBuild = config.ssr?.target === 'webworker'
			root = config.root
			// A host may resolve a configuration of its own without `resolve`.
			viteAlias = (config as { readonly resolve?: { readonly alias?: unknown } }).resolve?.alias
			aliasState = undefined
		},
		async resolveId(id, importer, options) {
			if (virtualModules.has(id)) return `\0${id}`
			const page = routeBlockFile(id)
			if (page !== undefined) {
				const resolved = await this.resolve(page, importer, { skipSelf: true })
				return resolved ? routeBlockId(resolved.id) : null
			}
			// Path aliases. A `resolve.alias` of the project or of a module runs before this plugin and wins.
			return importer ? resolveAlias(this, id, importer, Boolean(options?.ssr || ssrBuild), options) : null
		},
		async load(id, options) {
			const page = routeBlockFile(id)
			if (page !== undefined) {
				const filename = normalizePath(resolve(page))
				// Only a page of this project or its layers carries route options.
				if (
					!isPageFile(
						filename,
						(await resolveConfigSources(root)).map((entry) => entry.root),
					)
				) {
					throw new Error(`Route options can only be loaded from a page under app/pages: ${filename}`)
				}
				this.addWatchFile(filename)
				const source = await readFile(filename, 'utf8')
				const block = routeBlockSource(source, filename)
				if (block === undefined) throw new Error(`${filename} has no <script server> section`)
				// Top-level code runs per request inside a generated loader; it rejects render: "client".
				const body = serverScriptModule(source, filename)
				// Only `render: "client"` options are public; every other block stays on the server.
				if (!(options?.ssr || ssrBuild) && (body || extractRouteRender(filename, block) !== 'client')) {
					throw new Error(`Server route options reached the client bundle: <script server> of ${filename}`)
				}
				return body ? { code: body.code, map: body.map as never } : block
			}
			const virtual = id.startsWith('\0') ? id.slice(1) : undefined
			if (virtual === globalStylesheetsModule) {
				if (options?.ssr || ssrBuild) throw new Error(`${globalStylesheetsModule} belongs to the client bundle`)
				const { modules } = await loadConfiguredModules(root)
				return frameworkStylesheets(root, modules.stylesheets)
					.map((file) => `import ${JSON.stringify(stylesheetUrl(root, file))};`)
					.join('\n')
			}
			if (virtual === clientRoutesModule) return clientRoutesSource(root)
			if (virtual === clientSidecarsModule) return clientSidecarsSource(root)
			if (virtual === serverAppModule) return serverAppSource(root, ssrBuild && !isDev ? await readBuildAppData(root) : undefined, { redis: !workerBuild })
			if (virtual === clientPluginsModule) {
				if (options?.ssr || ssrBuild) throw new Error(`${clientPluginsModule} belongs to the client bundle`)
				return clientPluginsSource(root)
			}
			if (virtual === clientMiddlewareModule) {
				if (options?.ssr || ssrBuild) throw new Error(`${clientMiddlewareModule} belongs to the client bundle`)
				return clientMiddlewareSource(root)
			}
			if (virtual === clientPagesModule) {
				const routes = await discoverConfiguredRoutes(root)
				const unique = [...new Set(routes.flatMap((route) => [route.file, ...route.layouts, ...(route.error ? [route.error] : [])]))]
				const entries = unique.map((file) => {
					const path = relative(root, file).replaceAll('\\', '/')
					if (path === '..' || path.startsWith('../') || isAbsolute(path)) throw new Error(`Page outside Meeko project: ${file}`)
					const specifier = `/${path}`
					return `${JSON.stringify(specifier)}: () => import(${JSON.stringify(specifier)})`
				})
				return `export const modules = {${entries.join(',')}};`
			}
			const style = styleQuery.exec(id)?.[1]
			if (style === undefined) return null
			const css = styles.get(style)
			if (css !== undefined) return css
			// A tab opened before a restart of `meeko dev` (or before several edits) asks for a stylesheet
			// this server no longer has. Without a result Vite would read the .meeko file itself as CSS and
			// fail in PostCSS; an empty stylesheet keeps the page up until it reloads with the current one.
			this.warn(`[meeko] ${id.replace(/\?.*$/, '')}: la hoja de estilos ${style.slice(0, 8)} ya no existe (una pestaña anterior al reinicio de meeko dev o a una edición) y se sirve vacía; recarga la página.`)
			return '/* meeko: stylesheet from an earlier version of this component */\n'
		},
		async transform(source, id, options) {
			const serverTransform = Boolean(options?.ssr || ssrBuild)
			const normalizedId = normalizePath(resolve(id))
			const normalizedRoot = normalizePath(root)
			const clientModule = !serverTransform && normalizedId.startsWith(`${normalizedRoot}/`)
			// Every component this plugin compiles, also one outside the project, follows the project's `css` options.
			const config = normalizedId.startsWith(`${normalizedRoot}/`) || id.endsWith('.meeko') ? await loadMeekoConfig(root) : undefined
			const sources = normalizedId.startsWith(`${normalizedRoot}/`) ? await resolveConfigSources(root, config) : []
			// Module code may live outside the project (a linked package): its boundary applies to any id.
			const boundary = serverTransform || normalizedId.startsWith(runtimeDirectory) ? undefined : await moduleBoundary(root)
			const serverDirectories = [...sources.map((entry) => `${normalizePath(entry.root)}/server/`), ...(boundary?.serverDirectories ?? [])]
			const serverOnly = (moduleId: string): boolean => serverDirectories.some((directory) => moduleId.startsWith(directory)) || (boundary?.serverFiles.has(moduleId.replace(/\?.*$/, '')) ?? false)
			if (clientModule && (serverOnly(normalizedId) || /\.server\.[cm]?[jt]sx?$/.test(id))) {
				throw new Error(`Server-only module reached the client bundle: ${id}`)
			}
			if (boundary) {
				if (serverOnly(normalizedId) || (/\.server\.[cm]?[jt]sx?(?:\?|$)/.test(id) && boundary.ownedDirectories.some((directory) => normalizedId.startsWith(directory)))) {
					throw new Error(`Server-only module reached the client bundle: ${id}`)
				}
				const ownRuntime = normalizedId.startsWith(`${packageDirectory}dist/`) || normalizedId.startsWith(`${packageDirectory}src/`)
				if (/\.[cm]?[jt]sx?(?:\?|$)/.test(id) && !ownRuntime && moduleDefinitionImport.test(withoutComments(source))) {
					throw new Error(`Meeko module setup reached the client bundle: ${id}; only meeko.config.ts may import a module created with defineMeekoModule`)
				}
			}
			if (serverTransform && normalizedId.startsWith(`${normalizedRoot}/`) && /\.client\.[cm]?[jt]sx?$/.test(id)) {
				throw new Error(`Client-only module reached the server bundle: ${id}`)
			}
			const checkBoundary = async (code: string, original?: string): Promise<void> => {
				if (!clientModule) return
				const autoimported = original === undefined ? new Map<string, string[]>() : autoimportedSpecifiers(code.slice(0, code.length - original.length))
				for (const { value, typeOnly } of moduleSpecifiers(code, id)) {
					// A type-only import (`import type { UIOptions } from "@meekojs/ui"`) is erased: it loads nothing.
					if (typeOnly) continue
					// `skipSelf` also skips this plugin's aliases: resolve them here.
					const dependency = (await resolveAlias(this, value, id, false)) ?? (await this.resolve(value, id, { skipSelf: true }))
					if (dependency && serverOnly(normalizePath(dependency.id))) {
						const names = autoimported.get(value)
						throw new Error(names ? `Client module ${id} imports server-only module ${value} through autoimport ${names.join(', ')}` : `Client module ${id} imports server-only module ${value}`)
					}
				}
			}
			if (!id.endsWith('.meeko')) {
				if (/\.[cm]?[jt]sx?$/.test(id) && clientModule) await checkBoundary(source)
				const routeBlock = routeBlockFile(id) !== undefined
				if (/\.[cm]?tsx?$/.test(id) && normalizedId.startsWith(`${normalizedRoot}/`)) {
					const registry = await discoverAutoImports(root)
					// Only `render: "client"` sidecars reach the browser graph; they get browser autoimports.
					const clientSidecar = clientModule && (routeBlock || (/\.route\.[cm]?tsx?$/.test(id) && /\/app\/pages\//.test(normalizedId)))
					let transformed: string | undefined
					try {
						// A route block lives in a `.meeko` under `app/`, so its scope cannot come from its path.
						const scope = clientSidecar ? 'client' : routeBlock ? 'server' : undefined
						// Plain app/ modules resolve framework clients per graph, like a `.meeko` component.
						transformed = transformTypeScriptAutoImports(
							source,
							id,
							root,
							registry,
							sources.map((entry) => entry.root),
							scope,
							serverTransform,
						)
					} catch (error) {
						const name = clientSidecar && error instanceof Error ? /^Autoimport (\S+) is unavailable/.exec(error.message)?.[1] : undefined
						if (name) throw new Error(`Client route sidecar ${id} uses autoimport ${name}, which is not available in the browser; render: "client" sidecars must call API or RPC endpoints instead`, { cause: error })
						throw error
					}
					if (transformed) {
						await checkBoundary(transformed, source)
						if (routeBlock) return transformWithOxc(transformed, `${routeBlockFile(id)!}.ts`, { lang: 'ts' }, typeScriptAutoImportMap(source, transformed, id))
						return { code: transformed, map: typeScriptAutoImportMap(source, transformed, id) }
					}
				}
				if (routeBlock) return transformWithOxc(source, `${routeBlockFile(id)!}.ts`, { lang: 'ts' })
				return null
			}
			const filename = normalizePath(resolve(id))
			assertRouteBlockPlacement(
				source,
				filename,
				sources.map((entry) => entry.root),
			)
			const scopeAttribute = config?.css?.scopeAttribute
			const registry = await discoverAutoImports(root)
			// `<MeekoThemeToggle>` exists only with `theme` (MEEK111).
			const theme = config ? config.theme !== undefined && config.theme !== false : undefined
			const styleHashOf = (css: string): string => createHash('sha256').update(filename).update('\0').update(css).digest('hex')
			// In the SSR graph and in dev, `css` is the stylesheet after PostCSS, as Vite inlines it: the
			// SSR document embeds it before the client bundle loads (Tailwind's @apply, @utilities) and
			// hot updates reapply it. The production client bundle reads `css` nowhere, since the CSS
			// asset that Vite bundles styles the page: it keeps the compiler's string, without a second
			// PostCSS pass per component nor the processed copy as dead weight in the page chunks.
			const styleModule = serverTransform || isDev ? (css: string): string => `${filename}?meeko-style=${styleHashOf(css)}&inline&lang.css` : undefined
			const result = compile(source, filename, { hot: isDev, projectComponents: autoImportedValues(registry), ...(styleModule ? { styleModule } : {}), ...(scopeAttribute ? { scopeAttribute } : {}), ...(theme === undefined ? {} : { theme }) })
			// A component outside server/ may run in the browser: the browser graph stops at MEEK108. The SSR
			// graph does not, so a component that only server code imports (an email template in
			// app/emails/ rendered by an API route) keeps compiling there, as in 1.2.
			if (!serverTransform && !serverDirectories.some((directory) => filename.startsWith(directory))) {
				checkComponentBoundary(source, filename, result, registry, serverDirectories, (await projectAliases()).aliases)
			}
			const styleHash = styleHashOf(result.css)
			if (result.css) keepStyle(filename, styleHash, result.css)
			const cssModule = `${filename}?meeko-style=${styleHash}&lang.css`
			const cssImport = result.css ? `\nimport ${JSON.stringify(cssModule)};` : ''
			// The SSR document gives the inline <style> of this CSS the id of the client's module, so
			// Vite's client adopts it in place instead of appending a copy (see style-modules.ts).
			const styleRegistration = serverTransform && isDev && result.css ? `\n__meeko.registerStyleModule(css, ${JSON.stringify(cssModule)});` : ''
			const hotCode = isDev ? `\nif (import.meta.hot) {\n  __meeko.enableHotModule(__hotId);\n  __meeko.connectLiveBridge(import.meta.hot);\n  import.meta.hot.accept((next) => { if (next) __meeko.replaceHotModule(__hotId, next); });\n}\n` : ''
			const code = transformAutoImports(source, filename, result.code, registry, serverTransform ? 'server' : 'client')
			await checkBoundary(code, result.code)
			const shifted = code.length - result.code.length
			const mappings = result.mappings.map((mapping) => ({
				...mapping,
				generatedStart: mapping.generatedStart + shifted,
				generatedEnd: mapping.generatedEnd + shifted,
			}))
			const generated = `${code}${cssImport}${styleRegistration}${hotCode}`
			// The map embeds its source text; leave the server-only route options out of it.
			return transformWithOxc(generated, `${filename}.ts`, { lang: 'ts' }, sourceMapForCompiled(generated, withoutRouteBlock(source, filename), filename, mappings))
		},
		async config(config, env) {
			if (env.command !== 'serve') return undefined
			// No page may fetch the editor bridge descriptors and their token. Vite appends
			// this to the user's `server.fs.deny`; without one, its defaults must stay.
			const deny = [...(config.server?.fs?.deny === undefined ? await defaultFsDeny() : []), editorBridgeFsDeny]
			// `server.watch: null` turns the watcher off; a merged object would turn it back on.
			if (config.server?.watch === null) return { server: { fs: { deny } } }
			// configResolved replaces this with the resolved root before the watcher starts.
			root = resolve(config.root ?? '')
			// Checks, editor tooling and builds rewrite `.meeko` files that Vite never
			// loads; Vite appends this matcher to the user's `server.watch.ignored`.
			return { server: { fs: { deny }, watch: { ignored: [(file: string) => isDevWatchIgnored(file, root)] } } }
		},
		configEnvironment: {
			// After every other plugin, so an input another plugin sets still wins over the HTML crawl.
			order: 'post',
			handler(name, config, env) {
				if (env.command !== 'serve') return undefined
				const include = name === 'client' ? builtinOptimizeInclude(runtimeDirectory, config.optimizeDeps?.exclude) : []
				const included = include.length ? { include } : {}
				const entries = config.optimizeDeps?.entries
				// Explicit entries stay; Vite appends the exclusion to them.
				if (entries !== undefined) return { optimizeDeps: { entries: [...devScanIgnored], ...included } }
				// An input names the scan entries itself; explicit entries would replace it.
				if (config.input !== undefined || config.build?.rolldownOptions?.input !== undefined || config.build?.rollupOptions?.input !== undefined) {
					return include.length ? { optimizeDeps: included } : undefined
				}
				// Vite's default crawl, every HTML file except tests and coverage, now outside `.meeko`.
				return { optimizeDeps: { entries: ['**/*.html', '!**/__tests__/**', '!**/coverage/**', ...devScanIgnored], ...included } }
			},
		},
		async configureServer(server) {
			const directories = await componentWatchDirectories()
			activeComponentDirectories = directories
			// The folders of the modules' files, except the project's own: a module file at its root.
			const moduleScriptDirectories = async (): Promise<string[]> =>
				(await loadConfiguredModules(root)).modules.ownedDirectories.filter((directory) => {
					const path = relative(directory, root)
					return path.startsWith('..') || isAbsolute(path)
				})
			activeModuleDirectories = await moduleScriptDirectories()
			const configSource = (file: string): boolean => normalizePath(file).startsWith(`${normalizePath(root)}/meeko.config.`)
			const onConfigChange = async (): Promise<void> => {
				aliasState = undefined
				const updated = await componentWatchDirectories()
				activeComponentDirectories = updated
				activeModuleDirectories = await moduleScriptDirectories()
				server.watcher.add(updated)
				await refreshComponentRegistry()
				invalidateDevModules(server)
				server.ws.send({ type: 'full-reload' })
			}
			// A new or removed page, layout or server module changes discovery; Vite's
			// hot update only reports edits of files it already knows.
			const onTreeChange = (file: string): void => {
				void (async () => {
					if (configSource(file)) {
						await onConfigChange()
						return
					}
					if (normalizePath(resolve(file)) === normalizePath(resolve(root, globalStylesheetFile))) {
						invalidateDevModules(server)
						server.ws.send({ type: 'full-reload' })
						return
					}
					const component = isComponentSource(file, activeComponentDirectories)
					const changed = component || (await watchedSource(file, true))
					if (!changed) return
					if (component) await refreshComponentRegistry()
					invalidateDevModules(server)
					server.ws.send({ type: 'full-reload' })
				})().catch((error: unknown) => server.config.logger.error(String(error)))
			}
			server.watcher.on('add', onTreeChange)
			server.watcher.on('unlink', onTreeChange)
			// An edited component can be absent from Vite's module graph (for example before its
			// first render), so hot-update alone cannot keep its declarations current.
			server.watcher.on('change', (file) => {
				if (configSource(file)) {
					void onConfigChange().catch((error: unknown) => server.config.logger.error(String(error)))
					return
				}
				if (isComponentSource(file, activeComponentDirectories)) {
					void refreshComponentRegistry(file).catch((error: unknown) => server.config.logger.error(String(error)))
				}
			})
			// Explicit watches also cover configured folders created after startup and linked module
			// directories outside Vite's root. A new autoimport must invalidate consumers already loaded.
			server.watcher.add([
				...new Set([
					...directories,
					...(await autoImportWatchDirectories()),
					dirname(resolve(root, globalStylesheetFile)),
					...(await loadConfiguredModules(root)).modules.stylesheets,
					...['ts', 'mts', 'js', 'mjs'].map((extension) => join(root, `meeko.config.${extension}`)),
				]),
			])
			await refreshComponentRegistry()
		},
		async handleHotUpdate({ file, server }) {
			const normalized = normalizePath(file)
			const configFile = normalized.startsWith(`${normalizePath(root)}/meeko.config.`)
			if (configFile) {
				aliasState = undefined
				// The watcher also covers config files that Vite has not put in its module graph.
				return []
			}
			if (isComponentSource(file, activeComponentDirectories)) {
				await registryUpdate
				// Keep the compiler's own component HMR and CSS update path for an edit.
				return
			}
			// A script of a module that the browser imported reloads it, as Meeko's own runtime does (see
			// isModuleScript). A file only watched for a stylesheet (its @utilities) has no module id.
			const moduleScript = isModuleScript(file, activeModuleDirectories) && [...(server.environments?.client.moduleGraph.getModulesByFile(normalized) ?? [])].some((node) => node.id !== null)
			if (!normalized.startsWith(runtimeDirectory) && !moduleScript && !(await watchedSource(file))) return
			invalidateDevModules(server)
			server.ws.send({ type: 'full-reload' })
			return []
		},
	}
}
