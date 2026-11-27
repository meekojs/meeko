import type { InlineConfig, Plugin } from 'vite'

import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'

import type { MeekoAdapterName } from '../modules/define-meeko-config'
import type { BuildAppData } from './app-manifest'
import type { PrerenderIndex } from './prerender'

import { cloudflareEntrySource } from './adapter-templates'
import { buildDataFile, frameworkClientEntry, frameworkNodeEntry } from './app-manifest'
import { assetManifest, clientAssets, readViteManifest } from './build-assets'
import { adapterOutput, assertBuildAdapter, bundledAdapters, clientOutput, cloudflareAdapter, nodeOutput, prerenderServer, prerenderStaging, staticClientEntry } from './build-outputs'
import { cloudflareAssetsDirectory, cloudflarePrerenderDirectory, wranglerConfig, wranglerSource } from './cloudflare-build'
import { discoverConfiguredRoutes, loadConfiguredModules } from './config'
import { resolvedDocument, resolveSiteOrigin } from './module-loader'
import { writeModulePublicFiles } from './module-public-files'
import { prepareProject } from './prepare-project'
import { prerenderForBuild } from './prerender'
import { staticClientEntrySource } from './project-templates'
import { discoverErrorPage } from './routes-discovery'
import { assertNoLegacySessionFile } from './runtime-migration'
import { robotsTxt, siteFilesOptions, sitemapEntryRoutes, sitemapUrls, sitemapXml } from './site-files'
import { assertStaticApp, writeStaticOutput } from './static-adapter'
import { hasFrameworkTsconfigs, prepareFrameworkTypeDeclarations } from './type-declarations'
import { withModules } from './vite-config'

/** Bit de `light-dark()` en `lightningcss.Features`; debe conservarse para seguir el tema elegido. */
const lightningCssLightDark = 1 << 20

/** The module that replaces Meeko's HTML parser for CSP hashes in a Worker without `contentSecurityPolicy`. */
const documentHashesStub = '\0meeko:document-hashes'

/**
 * Leaves the HTML parser of the CSP hashes (parse5) out of a Worker whose configuration has no
 * `contentSecurityPolicy`: Meeko's page handler only loads it to hash a document for its own CSP, and
 * a Worker is one module, where a dynamic import is bundled too.
 */
const withoutDocumentHashes: Plugin = {
	name: 'meeko:without-document-hashes',
	enforce: 'pre',
	resolveId(source, importer) {
		if (source !== './inline-sources.js' || !importer) return null
		return /[\\/]server[\\/]runtime[\\/]framework-render\.[jt]s$/.test(importer.split('?')[0]!) ? documentHashesStub : null
	},
	load(id) {
		if (id !== documentHashesStub) return null
		return 'export function documentHashes() { throw new Error("This Worker was built without server.contentSecurityPolicy; rebuild it to hash documents"); }\n'
	},
}

/**
 * Opciones de {@link buildProject}.
 *
 * @example
 * ```ts
 * import { buildProject } from "@meekojs/meeko/build";
 * import type { BuildProjectOptions } from "@meekojs/meeko/build";
 *
 * const options: BuildProjectOptions = { adapter: "deno" };
 * await buildProject(process.cwd(), options);
 * ```
 */
export interface BuildProjectOptions {
	/** Sustituye a `MeekoConfig.server.adapter`. */
	readonly adapter?: MeekoAdapterName
}

/**
 * Resultado de {@link buildProject}.
 *
 * @example
 * ```ts
 * import { buildProject } from "@meekojs/meeko/build";
 *
 * const { adapter, output } = await buildProject(process.cwd());
 * console.log(`build ${adapter} en ${output}`);
 * ```
 */
export interface BuildProjectResult {
	/** Adaptador usado. */
	readonly adapter: MeekoAdapterName
	/** Carpeta de salida, ejecutable sin las fuentes de la aplicación. */
	readonly output: string
}

/**
 * Construye el proyecto como `meeko build`: el cliente, el bundle de servidor del adaptador y sus
 * páginas prerenderizadas, bajo `.meeko/output/<adapter>/`. El adaptador sale de `options`, de
 * `meeko.config.ts` o, por defecto, `node`. Necesita `vite` instalado. No comprueba tipos; desde
 * `1.7`, en un proyecto limpio (sin `meeko check` ni `meeko dev` previos) genera antes los tipos y
 * los `tsconfig.*.json` de `.meeko/`, como `meeko check`.
 *
 * @param projectRoot Carpeta del proyecto.
 * @param options Adaptador que sustituye al de la configuración.
 * @returns El adaptador y la carpeta de salida.
 * @throws {Error} Si el adaptador no existe, el proyecto conserva `server/session.ts` o falla el build.
 * @example
 * ```ts
 * import { buildProject } from "@meekojs/meeko/build";
 *
 * const result = await buildProject(process.cwd(), { adapter: "cloudflare" });
 * // result.output: <proyecto>/.meeko/output/cloudflare
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/framework.md#build-despliegue-y-verificación
 */
export async function buildProject(projectRoot: string, options: BuildProjectOptions = {}): Promise<BuildProjectResult> {
	const root = resolve(projectRoot)
	const { config, modules } = await loadConfiguredModules(root)
	const adapter = assertBuildAdapter(options.adapter ?? config.server?.adapter ?? 'node')
	assertNoLegacySessionFile(root)
	const outputDirectory = adapterOutput(adapter)
	const output = resolve(root, outputDirectory)
	// Absolute URLs need the public origin; without it the build fails before building anything.
	// Only what writes one resolves it: an origin nothing uses is never read nor validated.
	const siteFiles = siteFilesOptions(config)
	const origin = siteFiles.sitemap ? resolveSiteOrigin(config) : undefined
	const seo = resolvedDocument(config, modules)?.seo
	const needsOrigin = [
		...(siteFiles.sitemap && origin === undefined ? ['sitemap'] : []),
		...(typeof seo === 'object' && (seo.canonical || seo.ogUrl) && seo.origin === undefined ? ['document.seo (canonical y og:url)'] : []),
	]
	if (needsOrigin.length) {
		throw new Error(`${needsOrigin.join(' y ')} ${needsOrigin.length > 1 ? 'necesitan' : 'necesita'} la URL pública del sitio: declara site en meeko.config.ts (site: "https://example.com") o define MEEKO_PUBLIC_ORIGIN al construir`)
	}
	if (adapter === 'static') await assertStaticApp(root)
	await modules.callHook('build:before', { adapter, output })
	await prepareProject(root)
	// `meeko build` checks the project first, which writes them; a clean project called from a
	// script has none, and Vite fails on the references of its tsconfig.json.
	if (!hasFrameworkTsconfigs(root)) await prepareFrameworkTypeDeclarations(root)
	// On a static host navigation reads each page's payload file instead of negotiating Accept. That
	// entry has its own file: the shared one in .meeko/generated stays the server-negotiating entry.
	const clientEntry = adapter === 'static' ? staticClientEntry : frameworkClientEntry
	if (adapter === 'static') {
		await mkdir(resolve(root, dirname(staticClientEntry)), { recursive: true })
		await writeFile(resolve(root, staticClientEntry), staticClientEntrySource, 'utf8')
	}
	await modules.callHook('routes:resolved', { routes: await discoverConfiguredRoutes(root) })
	const vite = await import('vite')
	const { meeko } = await import('../vite')
	const build = (base: InlineConfig): ReturnType<typeof vite.build> => vite.build(withModules(modules, base, 'build'))
	await build({
		root,
		configFile: false,
		// La bajada de Lightning CSS sigue `prefers-color-scheme`, pero el tema explícito de Meeko
		// cambia `color-scheme` en `<html>` aunque difiera del sistema. La función nativa sí lo sigue.
		...(config.theme === undefined || config.theme === false ? {} : { css: { lightningcss: { exclude: lightningCssLightDark } } }),
		plugins: [meeko()],
		logLevel: 'warn',
		build: {
			outDir: clientOutput,
			manifest: true,
			emptyOutDir: true,
			rollupOptions: { input: clientEntry },
		},
	})
	const clientDirectory = resolve(root, clientOutput)
	// Module public files join the client build before its asset manifest is computed.
	await writeModulePublicFiles(clientDirectory, modules)
	const sitemapUrl = siteFiles.sitemap && origin ? new URL('/sitemap.xml', origin).href : undefined
	if (siteFiles.sitemap && existsSync(join(clientDirectory, 'sitemap.xml'))) {
		throw new Error('El archivo público sitemap.xml (de public/ o de un módulo) choca con el que genera la opción sitemap de meeko.config.ts; quita uno de los dos')
	}
	// robots.txt only needs the configuration: it joins the client build like a public file.
	if (siteFiles.robots) {
		const target = join(clientDirectory, 'robots.txt')
		if (existsSync(target)) throw new Error('El archivo público robots.txt (de public/ o de un módulo) choca con el que genera la opción robots de meeko.config.ts; quita uno de los dos')
		await writeFile(target, robotsTxt(siteFiles.robots, sitemapUrl), 'utf8')
	}
	const server = config.server?.adapter === 'node' ? config.server : undefined
	const viteManifest = await readViteManifest(root)
	// One id for the whole build, also when the Node server is built twice (with a sitemap).
	const buildId = randomUUID()
	const writeData = async (): Promise<void> => {
		const data: BuildAppData = {
			client: clientAssets(viteManifest, clientEntry),
			assets: await assetManifest(clientDirectory, viteManifest),
			node: { host: server?.host ?? '127.0.0.1', port: server?.port ?? 4173 },
			buildId,
		}
		await mkdir(resolve(root, '.meeko/build'), { recursive: true })
		await writeFile(resolve(root, buildDataFile), JSON.stringify(data, null, 2) + '\n', 'utf8')
	}
	await writeData()
	const buildNodeServer = (outDir: string): ReturnType<typeof vite.build> =>
		build({
			root,
			configFile: false,
			plugins: [meeko()],
			logLevel: 'warn',
			ssr: { external: ['@meekojs/meeko'] },
			build: {
				ssr: frameworkNodeEntry,
				// public/ belongs to the client build, which the server reads from client/.
				outDir,
				emptyOutDir: true,
				copyPublicDir: false,
				rollupOptions: { output: { entryFileNames: 'index.mjs', chunkFileNames: 'chunks/[name]-[hash].mjs' } },
			},
		})
	// A Node server renders the prerendered pages for every adapter. The sitemap lists those pages
	// and the Node output serves only the files of the asset manifest baked into its bundle, so with
	// a sitemap Node renders them with an intermediate server and builds its own afterwards.
	const nodeTarget = adapter === 'node' && !siteFiles.sitemap ? nodeOutput : prerenderServer
	await buildNodeServer(nodeTarget)
	// The routes whose options name sitemapEntries: only their modules are loaded to evaluate it.
	const sitemapRoutes = siteFiles.sitemap ? await sitemapEntryRoutes(await discoverConfiguredRoutes(root)) : new Set<string>()
	const { sitemap: declared } = await prerenderForBuild(root, `${nodeTarget}/index.mjs`, prerenderStaging, { sitemapRoutes })
	if (siteFiles.sitemap && origin) {
		const index = JSON.parse(await readFile(resolve(root, prerenderStaging, 'manifest.json'), 'utf8')) as PrerenderIndex
		const urls = await sitemapUrls({
			index,
			prerenderDirectory: resolve(root, prerenderStaging),
			routes: await discoverConfiguredRoutes(root),
			declared,
			...(siteFiles.sitemap.exclude ? { exclude: siteFiles.sitemap.exclude } : {}),
		})
		// Modules may change the URLs or annotate them, such as with the language versions of i18n.
		await modules.callHook('sitemap:resolved', { urls })
		await writeFile(join(clientDirectory, 'sitemap.xml'), sitemapXml(origin, urls), 'utf8')
		await writeData()
		if (adapter === 'node') await buildNodeServer(nodeOutput)
	}
	if (adapter === 'static') {
		await writeStaticOutput({
			root,
			output,
			clientDirectory,
			prerenderDirectory: resolve(root, prerenderStaging),
			nodeServer: `${nodeTarget}/index.mjs`,
			config: config.server?.adapter === 'static' ? config.server : undefined,
			errorPage: (await discoverErrorPage(root)) !== undefined,
		})
		await modules.callHook('build:done', { adapter, output })
		return { adapter, output }
	}
	if (adapter === 'bun' || adapter === 'deno') {
		const target = bundledAdapters[adapter]
		await writeFile(resolve(root, target.entry), target.source, 'utf8')
		await build({
			root,
			configFile: false,
			plugins: [meeko()],
			logLevel: 'warn',
			// Bundle every dependency, including Meeko itself; only runtime built-ins stay external.
			ssr: {
				noExternal: true,
				resolve: { conditions: [adapter, 'module', 'node', 'development|production'], externalConditions: [adapter, 'node', 'module-sync'] },
			},
			build: {
				ssr: target.entry,
				outDir: outputDirectory,
				emptyOutDir: true,
				copyPublicDir: false,
				rollupOptions: { output: { entryFileNames: target.file, chunkFileNames: 'chunks/[name]-[hash].js' } },
			},
		})
	}
	const cloudflare = config.server?.adapter === 'cloudflare' ? config.server : undefined
	if (adapter === 'cloudflare') {
		// The prerendered pages share the assets directory under a reserved prefix.
		if (existsSync(resolve(root, clientOutput, '_meeko'))) throw new Error('public/_meeko está reservado para la salida de Cloudflare de Meeko; cámbiale el nombre')
		const wrangler = await wranglerConfig(root, cloudflare)
		const className = (wrangler.durable_objects as { bindings: Array<{ class_name: string }> }).bindings[0]!.class_name
		await writeFile(resolve(root, cloudflareAdapter.entry), cloudflareEntrySource(className), 'utf8')
		await build({
			root,
			configFile: false,
			plugins: [meeko(), ...(cloudflare?.contentSecurityPolicy ? [] : [withoutDocumentHashes])],
			logLevel: 'warn',
			// One self-contained module for workerd; only runtime modules stay external.
			ssr: {
				target: 'webworker',
				noExternal: true,
				resolve: { conditions: ['workerd', 'worker', 'browser', 'module', 'development|production'], externalConditions: ['workerd', 'worker'] },
			},
			build: {
				ssr: cloudflareAdapter.entry,
				// public/ is served from assets/ only; a copy next to worker.js would be uploaded with it.
				outDir: outputDirectory,
				emptyOutDir: true,
				copyPublicDir: false,
				rollupOptions: {
					external: [/^cloudflare:/, 'node:async_hooks'],
					output: { entryFileNames: cloudflareAdapter.file, codeSplitting: false },
				},
			},
		})
		await writeFile(join(output, cloudflareAdapter.config), wranglerSource(wrangler), 'utf8')
	}
	const publicFiles = adapter === 'cloudflare' ? cloudflareAssetsDirectory : 'client'
	await cp(resolve(root, clientOutput), join(output, publicFiles), {
		recursive: true,
		filter: (source) => relative(resolve(root, clientOutput), source).split(sep)[0] !== '.vite',
	})
	const prerenderOutput = adapter === 'cloudflare' ? cloudflarePrerenderDirectory : 'prerender'
	await rm(join(output, ...prerenderOutput.split('/')), { recursive: true, force: true })
	await cp(resolve(root, prerenderStaging), join(output, ...prerenderOutput.split('/')), { recursive: true })
	await modules.callHook('build:done', { adapter, output })
	return { adapter, output }
}
