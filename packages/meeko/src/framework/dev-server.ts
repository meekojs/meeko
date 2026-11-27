import type { Server } from 'node:http'
import type { ViteDevServer } from 'vite'

import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { networkInterfaces } from 'node:os'
import { extname, join, resolve } from 'node:path'

import type { ServerApp, ServerAppOptions } from '../server/runtime/app'
import type { DevAllowedHosts } from '../server/runtime/dev-hosts'
import type { DevServerLogs } from './dev-server-logs'
import type { EditorBridge } from './editor-bridge'

import { escapeHtml } from '../core/server'
import { attachNodeWebSocketServer, toNodeListener } from '../node'
import { reportServerError } from '../server/errors'
import { allowedHostsEnv, blockedDevHostMessage, isDevHostAllowed, mergeDevAllowedHosts, parseAllowedHostsEnv, restrictedHostName, viteAllowedHosts } from '../server/runtime/dev-hosts'
import { meekoEnv } from '../server/runtime/env'
import { visibleHost } from '../server/runtime/fetch-host'
import { listeningMessage } from '../server/runtime/listen-address'
import { handleProcessErrors, processErrorObserver } from '../server/runtime/process-errors'
import { discoverAppPlugins, findRuntimeFile, frameworkServerEntry } from './app-manifest'
import { classProvidersManifestFile, writeClassProvidersManifest } from './class-providers'
import { configuredClassProviders, discoverConfiguredRoutes, loadConfiguredModules, resolveConfigSources } from './config'
import { contentTypes } from './content-types'
import { devtoolsPanelPlugin, devtoolsPanelScript, resolveDevtoolsConfig } from './dev-devtools'
import { supervisedHmrPortEnv, supervisedPortEnv } from './dev-link'
import { recordEditorBridgeOff } from './dev-lock'
import { devHmrHost, devPortInUse, resolveDevPorts } from './dev-port'
import { startPortless } from './dev-portless'
import { createDevServerLogs } from './dev-server-logs'
import { createDevAppReloader, hotFileKey, isDiscoverySource, isRouteOptionsSource, keepServerModules, onServerGraphReset, reachesEagerModule, routeOptionsKey } from './dev-watch'
import { editorBridgeHost, editorBridgeOffReason, startEditorBridge } from './editor-bridge'
import { setModuleDevelopmentMode } from './module-loader'
import { publicFileContents } from './module-public-files'
import { prepareProject } from './prepare-project'
import { discoverRouteMiddleware } from './route-middleware-discovery'
import { assertNoLegacySessionFile } from './runtime-migration'
import { createGlobalStylesheetSnapshot, devStylesheetLink, directStylesheetUrl, frameworkStylesheets } from './styles'
import { withModules } from './vite-config'

function safeDecode(pathname: string): string {
	try {
		return decodeURIComponent(pathname)
	} catch {
		return pathname
	}
}

/** How each development server started by {@link startProject} closes, as on SIGINT. */
const developmentStops = new WeakMap<Server, () => Promise<void>>()

/**
 * Closes a development server started by {@link startProject} as SIGINT does: the editor bridge
 * and its descriptor, the Socket server, the HTTP server, the app and Vite. Idempotent; resolves
 * once everything closed. A production server is not affected.
 */
export function stopDevelopmentServer(server: Server): Promise<void> {
	return developmentStops.get(server)?.() ?? Promise.resolve()
}

/** HTTP and HMR ports of each development server started by {@link startProject}. */
const developmentPorts = new WeakMap<Server, { readonly port: number; readonly hmrPort: number }>()

/** HTTP and HMR ports of a development server started by {@link startProject}; `undefined` for any other server. */
export function developmentServerPorts(server: Server): { readonly port: number; readonly hmrPort: number } | undefined {
	return developmentPorts.get(server)
}

/**
 * `server.allowedHosts` of Vite in `meeko dev`: those of `dev.allowedHosts`, the listening host
 * and the host of `MEEKO_PUBLIC_ORIGIN`, as Vite adds `server.host` and `server.origin`.
 */
export function devViteAllowedHosts(allowedHosts: DevAllowedHosts, host: string, publicOrigin: string | undefined): true | string[] {
	const patterns = viteAllowedHosts(allowedHosts)
	if (patterns === true) return true
	const extra = [host]
	if (publicOrigin) {
		try {
			extra.push(new URL(publicOrigin).hostname)
		} catch {
			/* createServerApp reports an invalid public origin */
		}
	}
	return [...new Set([...patterns, ...extra.map((name) => name.toLowerCase())])]
}

/** `name` of the project's `package.json`, or `undefined` when it is missing or unreadable. */
async function readPackageName(root: string): Promise<string | undefined> {
	try {
		const name = (JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) as { name?: unknown }).name
		return typeof name === 'string' ? name : undefined
	} catch {
		return undefined
	}
}

export async function startDevelopment(root: string): Promise<Server> {
	assertNoLegacySessionFile(root)
	// Every module resolution of this process (Vite plugin, autoimports, discovery) runs with dev: true.
	setModuleDevelopmentMode(true)
	const { config, modules } = await loadConfiguredModules(root)
	const server = config.server?.adapter === 'node' ? config.server : undefined
	const host = meekoEnv(process.env, 'HOST') || server?.host || '127.0.0.1'
	// A port named by MEEKO_PORT, PORT or server.port (or the one a supervisor's first server took) is
	// kept, and listening reports it when in use; otherwise dev takes the first free one from 4173 up.
	const named = process.env[supervisedPortEnv] || meekoEnv(process.env, 'PORT') || server?.port
	const namedHmr = process.env[supervisedHmrPortEnv] || process.env.MEEKO_HMR_PORT
	const { port, hmrPort, busy } = await resolveDevPorts({
		host,
		...(named ? { port: Number(named) } : {}),
		...(namedHmr ? { hmrPort: Number(namedHmr) } : {}),
	})
	if (busy !== undefined) process.stdout.write(`[meeko] El puerto ${busy} está en uso; meeko dev usa el ${port}\n`)
	// `dev.portless` registers a portless route to the port just chosen; a failure only warns.
	const portless = await startPortless({ root, option: config.dev?.portless, packageName: await readPackageName(root), port, warn: (message) => process.stderr.write(`[meeko] ${message}\n`) })
	// `dev.allowedHosts`, MEEKO_ALLOWED_HOSTS and the portless host open `meeko dev` to a proxy, a tunnel
	// or a LAN name: Vite's host check and, through the app's SessionManager, the Origin checks.
	const allowedHosts = mergeDevAllowedHosts(config.dev?.allowedHosts, parseAllowedHostsEnv(process.env[allowedHostsEnv]), portless ? [portless.host] : [])
	try {
		await prepareProject(root)
	} catch (error) {
		await portless?.release()
		throw error
	}
	let vite: ViteDevServer | undefined
	let app: ServerApp | undefined
	let socketServer: ReturnType<typeof attachNodeWebSocketServer> | undefined
	let bridge: EditorBridge | undefined
	/** Forwards server `console` calls to the browser; `dev.serverLogs: false` turns it off. */
	let serverLogs: DevServerLogs | undefined
	/** Rebuilds the app when a discovery source is added or removed; set once the app exists. */
	let onTreeChange: ((file: string) => void) | undefined
	/** Rebuilds the app when an edit changes the render or layout of a route; set once the app exists. */
	let onOptionsChange: ((file: string) => void) | undefined
	/** Runs a Vite restart once the app's work in flight drains, and rebuilds the app after it; set once the app exists. */
	let onRestart: ((start: () => Promise<void>) => Promise<void>) | undefined
	/** What the app's entry imports statically (`server/runtime.ts`, the server and universal plugins), as {@link hotFileKey}s. */
	let eagerFiles: ReadonlySet<string> = new Set()
	/** Rebuilds the app when an edit reaches {@link eagerFiles}; set once the app exists. */
	let onEagerChange: (() => void) | undefined
	/** Whether the app's replacement invalidates the server modules itself, which needs no other rebuild. */
	let resettingModules = false
	// The class providers next to it, for the editor of an untrusted workspace, which does not run the modules.
	await writeClassProvidersManifest(root, await configuredClassProviders(root)).catch((error: unknown) => process.stderr.write(`[meeko] ${classProvidersManifestFile} no se pudo escribir: ${error instanceof Error ? error.message : String(error)}\n`))
	// The processed global stylesheet on disk, for editor tools that read class names from CSS files.
	const stylesheetSnapshot = createGlobalStylesheetSnapshot(root, (message) => process.stderr.write(`[meeko] ${message}\n`), modules.stylesheets)
	const reportError = (error: unknown, requestId: string): void => {
		if (app) {
			app.reportError(error, requestId)
			return
		}
		reportServerError(error, requestId, (failure, id) => {
			process.stderr.write(`[meeko] request error ${id} (${failure instanceof Error ? failure.name : 'UnknownError'})\n`)
			console.error(failure)
		})
	}
	try {
		const publicOrigin = meekoEnv(process.env, 'PUBLIC_ORIGIN')
		const { createServer: createViteServer, searchForWorkspaceRoot } = await import('vite')
		const { meeko } = await import('../vite')
		if (config.dev?.serverLogs !== false) {
			serverLogs = createDevServerLogs({ hot: () => vite?.ws })
		}
		// `devtools` mounts the in-page panel; only here, never in a build or `meeko start`.
		const devtools = resolveDevtoolsConfig(config.devtools)
		vite = await createViteServer(
			withModules(
				modules,
				{
					root,
					configFile: false,
					plugins: [
						meeko(),
						stylesheetSnapshot.plugin,
						...(serverLogs ? [serverLogs.plugin] : []),
						...(devtools.panel ? [devtoolsPanelPlugin(devtools)] : []),
						{
							name: 'meeko:editor-bridge',
							// A restart (a changed `.env`, `server.restart()`) replaces `server.ws` and runs this
							// hook again for the new one. Its first client reaches it once `devServer.ws` points to
							// it: the bridge moves there before that client's first message.
							configureServer(server) {
								server.ws.on('connection', () => bridge?.refresh())
							},
						},
						{
							name: 'meeko:dev-eager-modules',
							// The app keeps the modules its entry imports statically from when it was created; pages and
							// server modules load per request. An edit that reaches the former without a hot boundary
							// (a plugin, a module it imports, server/runtime.ts) rebuilds the app, as the browser
							// reloads: otherwise the stale plugin went on providing a context key the pages no longer read.
							// Every hotUpdate hook runs before Vite sends the reload, so the browser waits for the new app.
							// The nodes come from the graph: the Meeko plugin empties `modules` for the autoimport
							// sources (app/utils, app/composables), whose edits it turns into a full reload.
							hotUpdate({ file }) {
								if (this.environment.name !== 'ssr') return
								if (reachesEagerModule(this.environment.moduleGraph.getModulesByFile(file) ?? [], eagerFiles)) onEagerChange?.()
							},
						},
						{
							name: 'meeko:dev-discovery',
							// A restart also replaces `server.watcher` and closes the old one with its listeners:
							// this hook subscribes each new watcher once.
							configureServer(server) {
								server.watcher.on('add', (file) => onTreeChange?.(file))
								server.watcher.on('unlink', (file) => onTreeChange?.(file))
								server.watcher.on('change', (file) => onOptionsChange?.(file))
							},
						},
						{
							name: 'meeko:dev-restart',
							// A restart also closes the module runner that loaded the app's entry: its pages,
							// layouts and server modules would fail to load ("Vite module runner has been
							// closed") until the app is created again on the new runner. Every restart (a
							// changed `.env` or config dependency, `server.restart()`) goes through
							// `server.restart`, and Vite copies the new server's properties, this wrapper
							// included, onto the instance this host holds; so this hook wraps each new server's
							// method once and the app follows every restart. The wrapper tells the app before
							// Vite closes anything: requests from then on wait for the new app, and the restart
							// itself waits for the requests and the app build still running on the old runner.
							configureServer(server) {
								const restart = server.restart
								server.restart = (forceOptimize) => {
									const start = (): Promise<void> => restart.call(server, forceOptimize)
									return onRestart ? onRestart(start) : start()
								}
							},
						},
					],
					// One Meeko instance on the server, as in the build: a package linked
					// outside node_modules (pnpm link:, a workspace) would otherwise run
					// inlined in Vite's module runner beside the copy this host imported,
					// with separate reactivity and context state.
					ssr: { external: ['@meekojs/meeko'] },
					server: {
						middlewareMode: true,
						// Middleware mode opens a separate Vite WebSocket server, on a port derived
						// from the app port so concurrent projects do not share 24678. It speaks plain `ws`
						// on loopback: without `protocol`, a page served through an HTTPS proxy asks for `wss`.
						hmr: { protocol: 'ws', host: devHmrHost, port: hmrPort },
						// Like Vite's own `server.host` and `server.origin`, the listening host and the public
						// origin are allowed too. Meeko checks the result first, with its own message (below).
						allowedHosts: devViteAllowedHosts(allowedHosts, host, publicOrigin),
						// Module files may live outside the workspace (a linked package); the browser loads their runtime files.
						...(modules.ownedDirectories.length ? { fs: { allow: [searchForWorkspaceRoot(root), ...modules.ownedDirectories] } } : {}),
					},
					appType: 'custom',
				},
				'serve',
			),
		)
		const globalStylesheet = (): string => {
			// Vite names the module by its real path with forward slashes, as the client entry imports it.
			return frameworkStylesheets(root, modules.stylesheets)
				.map((file) => {
					const moduleId = file.replaceAll('\\', '/')
					return devStylesheetLink(directStylesheetUrl(file), moduleId)
				})
				.join('')
		}
		const devServer = vite
		const createDevApp = async (): Promise<ServerApp> => {
			await modules.callHook('routes:resolved', { routes: await discoverConfiguredRoutes(root) })
			const runtimeFile = findRuntimeFile(root)
			eagerFiles = new Set(
				[
					...(await discoverAppPlugins(root)).filter((plugin) => plugin.mode !== 'client').map((plugin) => plugin.file),
					...(runtimeFile ? [runtimeFile] : []),
				].map(hotFileKey),
			)
			// A full reload of the Meeko plugin (an edited page or app/utils, a component added) keeps what this app holds.
			keepServerModules(devServer.environments.ssr.moduleGraph, eagerFiles)
			// Vite may invalidate them anyway (a tsconfig.json added, edited or removed): the app is built
			// again then. The rebuild invalidates the graph itself once the requests in flight finish: one
			// that the current app renders would otherwise import its page from the invalidated graph, a
			// new `createContext` key that the app's plugins do not provide (`Missing Meeko context`).
			onServerGraphReset(devServer.environments.ssr.moduleGraph, () => {
				if (resettingModules || !eagerFiles.size || !onEagerChange) return false
				onEagerChange()
				return true
			})
			const entry = (await devServer.ssrLoadModule(`/${frameworkServerEntry}`)) as { createApp(options: Omit<ServerAppOptions, 'manifest' | 'load' | 'runtime'>): Promise<ServerApp> }
			return entry.createApp({
				production: false,
				root,
				platform: {
					name: 'node',
					env: process.env,
					waitUntil(promise) {
						void Promise.resolve(promise).catch((error: unknown) => reportError(error, randomUUID()))
					},
				},
				...(publicOrigin ? { publicOrigin } : {}),
				devAllowedHosts: allowedHosts,
				document: {
					// Vite's client and the unbundled global stylesheet replace the production manifest links.
					head: ({ nonce }) => `<script type="module"${nonce ? ` nonce="${escapeHtml(nonce)}"` : ''} src="/@vite/client"></script>` + globalStylesheet() + (devtools.panel ? devtoolsPanelScript(nonce, escapeHtml) : ''),
				},
			})
		}
		app = await createDevApp()
		const origin = app.publicOrigin
		// Requests wait for a pending rebuild (`reloader`, below), so they never meet the old routes or a
		// closed module runner, and a restart waits for the requests in flight.
		const serve = (request: Request): Promise<Response> => reloader.use((running) => running.fetch(request))
		const blockedHosts = new Set<string>()
		const listener = toNodeListener((request) => (serverLogs ? serverLogs.handle(request, () => serve(request)) : serve(request)), { onError: reportError, ...(origin ? { publicOrigin: origin } : {}) })
		const httpServer = createServer((request, response) => {
			if (bridge?.handle(request, response)) return
			// The same check as Vite's `server.allowedHosts` (the resolved one, with what modules add),
			// before Vite and the module public files, so the 403 names Meeko's option.
			if (!isDevHostAllowed(request.headers.host, devServer.config.server.allowedHosts)) {
				const message = blockedDevHostMessage(restrictedHostName(request.headers.host) ?? '')
				if (!blockedHosts.has(message)) {
					blockedHosts.add(message)
					process.stderr.write(`${message}\n`)
				}
				response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
				response.end(message)
				return
			}
			// Vite cannot route a malformed target; the Meeko listener answers it with INVALID_URL.
			let pathname: string
			try {
				pathname = new URL(request.url || '/', 'http://localhost').pathname
			} catch {
				listener(request, response)
				return
			}
			// Public files of the modules, as the build writes them into the client output.
			const publicPath = safeDecode(pathname).replace(/^\/+/, '')
			const publicFile = modules.publicFiles.size && (request.method === 'GET' || request.method === 'HEAD') ? modules.publicFiles.get(publicPath) : undefined
			if (publicFile !== undefined) {
				void publicFileContents(publicFile).then(
					(body) => {
						response.writeHead(200, { 'content-type': contentTypes[extname(pathname).toLowerCase()] ?? 'application/octet-stream', 'cache-control': 'no-cache', ...modules.publicFileHeaders.get(publicPath) })
						response.end(request.method === 'HEAD' ? undefined : body)
					},
					(error: unknown) => {
						reportError(error, randomUUID())
						response.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
						response.end('Internal Server Error')
					},
				)
				return
			}
			devServer.middlewares(request, response, () => listener(request, response))
		})
		// The Socket handshake keeps the listening address as its identity; upgrade.ts accepts the
		// other loopback names, so a page opened at the printed localhost connects too.
		const listeningOrigin = `http://${visibleHost(host)}:${port}`
		const attachSocket = (running: ServerApp): ReturnType<typeof attachNodeWebSocketServer> | undefined =>
			running.socket
				? attachNodeWebSocketServer({
						server: httpServer,
						hub: running.socket.hub,
						publicOrigin: origin ?? listeningOrigin,
						pathnamePrefix: running.socket.pathnamePrefix,
						...(running.socket.maxMessageBytes === undefined ? {} : { maxMessageBytes: running.socket.maxMessageBytes }),
						onError: (error) => reportError(error, randomUUID()),
					})
				: undefined
		socketServer = attachSocket(app)
		// The app is built again from fresh discovery, on the module runner Vite has now, when
		// - a page, layout, middleware or server module is added or removed: that changes the
		//   manifest the app was created with;
		// - Vite restarts: that closes the module runner the app loads its modules through.
		// Requests wait for the new app, so the browser's full reload never meets the old routes.
		// The HTTP server, its public origin, Vite's middleware and the editor bridge stay; the
		// new app runs `server/runtime.ts` and the server modules again, so what they keep in
		// memory (sessions in a `MemorySessionStore`, caches, module state) starts empty, and
		// Socket connections close when the previous Socket server does.
		const sourceRoots = (await resolveConfigSources(root)).map((source) => source.root)
		const reloader = createDevAppReloader(app, async (prior, superseded) => {
			let next: ServerApp
			try {
				resettingModules = true
				try {
					devServer.moduleGraph.invalidateAll()
				} finally {
					resettingModules = false
				}
				next = await createDevApp()
			} catch (error) {
				// A broken tree (two root layouts, a bad route file) keeps the previous app until it is fixed.
				// When a restart began meanwhile, the app is built again after it, which reports what still fails.
				if (!superseded()) reportError(error, randomUUID())
				return prior
			}
			app = next
			const previousSocket = socketServer
			socketServer = attachSocket(next)
			try {
				await previousSocket?.close()
				await prior.close()
			} catch (error) {
				reportError(error, randomUUID())
			}
			return next
		})
		onTreeChange = (file) => {
			if (isDiscoverySource(resolve(file), sourceRoots)) reloader.rebuild()
		}
		onEagerChange = () => reloader.rebuild()
		// Since 1.5 an edit inside a page, a sidecar or a +group.ts may change a route's layout (or
		// its render), and since 1.6 its middleware, as may `{ global }` of a route middleware: the
		// manifest the app was created with changes, so the app is built again.
		const currentOptions = async (): Promise<string> => {
			const middleware = await discoverRouteMiddleware(root)
			return routeOptionsKey(await discoverConfiguredRoutes(root), [...middleware.global, ...middleware.serverGlobal])
		}
		let routeOptions = await currentOptions()
		onOptionsChange = (file) => {
			if (!isRouteOptionsSource(resolve(file), sourceRoots)) return
			void currentOptions().then(
				(next) => {
					if (next === routeOptions) return
					routeOptions = next
					reloader.rebuild()
				},
				() => reloader.rebuild(),
			)
		}
		onRestart = (start) => {
			const restarted = reloader.restart(start)
			// The new server starts with an empty module graph: transforming the stylesheet fills in its dependencies again.
			void restarted.then(
				() => stylesheetSnapshot.refresh(),
				() => undefined,
			)
			return restarted
		}
		await new Promise<void>((done, fail) => {
			const failed = (error: NodeJS.ErrnoException): void => fail(error.code === 'EADDRINUSE' ? devPortInUse(port, host, error) : error)
			httpServer.once('error', failed)
			httpServer.listen(port, host, () => {
				httpServer.off('error', failed)
				done()
			})
		})
		// Live values for local editors, only in development and only when this server listens on loopback.
		const address = httpServer.address()
		// Without a bridge, the reason is said after the URL and noted in `.meeko/dev/server.json`, so the
		// editor can explain it instead of only finding no descriptor.
		const bridgeOff = address && typeof address !== 'string' ? editorBridgeOffReason(process.env.MEEKO_EDITOR_BRIDGE, address.address) : undefined
		const bridgeHost = address && typeof address !== 'string' && !bridgeOff ? editorBridgeHost(address.address) : undefined
		if (bridgeHost && address && typeof address !== 'string') {
			try {
				bridge = await startEditorBridge({ root, origin: `http://${bridgeHost}:${address.port}`, hot: () => devServer.ws })
			} catch (error) {
				// The application keeps running without live values in the editor.
				const message = error instanceof Error ? error.message : String(error)
				process.stderr.write(`[meeko] editor bridge unavailable: ${message}\n`)
				recordEditorBridgeOff(root, `el puente no arrancó: ${message}`)
			}
		}
		// In the background: the first request shares the transform instead of waiting for it.
		stylesheetSnapshot.start(devServer)
		let stopped: Promise<void> | undefined
		let releaseProcessErrors = (): void => {}
		const shutdown = (): Promise<void> => {
			if (stopped) return stopped
			process.off('SIGINT', shutdown)
			process.off('SIGTERM', shutdown)
			stopped = (async () => {
				const steps: Array<() => Promise<unknown>> = [
					// Its event streams would keep the HTTP server open.
					() => bridge?.close() ?? Promise.resolve(),
					() => socketServer?.close() ?? Promise.resolve(),
					() => stylesheetSnapshot.close(),
					() => new Promise<void>((done, fail) => httpServer.close((error) => (error ? fail(error) : done()))),
					async () => (await reloader.current).close(),
					() => devServer.close(),
					async () => serverLogs?.close(),
					() => portless?.release() ?? Promise.resolve(),
				]
				for (const close of steps) {
					try {
						await close()
					} catch (error) {
						reportError(error, randomUUID())
					}
				}
				releaseProcessErrors()
			})()
			return stopped
		}
		// A rejection of the app's code is reported and the dev server keeps running; an exception
		// closes it with code 1. The policy is the first app's; the observer follows each rebuild.
		releaseProcessErrors = handleProcessErrors(app, {
			close: shutdown,
			onError: (error, requestId, info) => processErrorObserver(app)(error, requestId, info),
		})
		developmentStops.set(httpServer, shutdown)
		developmentPorts.set(httpServer, { port: address && typeof address !== 'string' ? address.port : port, hmrPort })
		process.once('SIGINT', shutdown)
		process.once('SIGTERM', shutdown)
		process.stdout.write(listeningMessage(host, port, networkInterfaces))
		if (portless) process.stdout.write(`  Portless: ${portless.url}\n`)
		if (bridgeOff) {
			process.stderr.write(`Valores en vivo del editor desactivados (${bridgeOff})\n`)
			recordEditorBridgeOff(root, bridgeOff)
		}
		return httpServer
	} catch (error) {
		serverLogs?.close()
		const cleanup = await Promise.allSettled([stylesheetSnapshot.close(), bridge?.close(), socketServer?.close(), app?.close(), vite?.close(), portless?.release()])
		for (const result of cleanup) {
			if (result.status === 'rejected') reportError(result.reason, randomUUID())
		}
		throw error
	}
}
