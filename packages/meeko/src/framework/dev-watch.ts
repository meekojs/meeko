import { isAbsolute, relative } from 'node:path'

import { builtinComponentModules } from '../compiler'

/**
 * Files whose addition or removal changes what Meeko discovers: routes,
 * layouts, error pages, route middleware, app plugins and the server API, RPC,
 * Socket and middleware modules. Paths are relative to a source root, with `/`.
 */
const discoveryPath = /^(?:app\/(?:pages|layouts|middleware|plugins)\/|app\/(?:app|error)\.meeko$|server\/(?:api|rpc|socket|middleware)\/)/

/** Whether `file` is a discovery input of one of `sourceRoots` (the project and its layers or modules). */
export function isDiscoverySource(file: string, sourceRoots: readonly string[]): boolean {
	return sourceRoots.some((root) => {
		const path = relative(root, file).replaceAll('\\', '/')
		return !path.startsWith('../') && path !== '..' && discoveryPath.test(path)
	})
}

/** Whether a `.meeko` file belongs to a configured component directory (including external module dirs). */
export function isComponentSource(file: string, directories: readonly string[]): boolean {
	if (!file.endsWith('.meeko')) return false
	return directories.some((directory) => {
		const path = relative(directory, file)
		return path !== '' && path !== '..' && !path.startsWith('../') && !path.startsWith('..\\') && !isAbsolute(path)
	})
}

/**
 * Whether `file` holds route options that discovery reads without running them: a page (its
 * `<script server>`), a `*.route.ts` sidecar or a `+group.ts` under `app/pages` of a source root,
 * or (since 1.6) a route middleware of `app/middleware`, whose `{ global }` discovery reads. Editing
 * one may change `render`, the layout or the middleware of routes.
 */
export function isRouteOptionsSource(file: string, sourceRoots: readonly string[]): boolean {
	return sourceRoots.some((root) => {
		const path = relative(root, file).replaceAll('\\', '/')
		if (path.startsWith('app/middleware/')) return path.endsWith('.ts')
		return path.startsWith('app/pages/') && (path.endsWith('.meeko') || path.endsWith('.route.ts') || path.endsWith('/+group.ts'))
	})
}

/** What {@link reachesEagerModule} reads of a Vite module node. */
export interface HotModuleNode {
	readonly file: string | null
	readonly isSelfAccepting?: boolean | undefined
	readonly importers: ReadonlySet<HotModuleNode>
	readonly acceptedHmrDeps: ReadonlySet<HotModuleNode>
}

/** Comparable form of a file path: `/` separators, and no case on Windows. */
export function hotFileKey(file: string): string {
	const path = file.replaceAll('\\', '/')
	return process.platform === 'win32' ? path.toLowerCase() : path
}

/**
 * Whether an edit of `modules` reaches one of the `eager` files (keys of {@link hotFileKey}) through
 * importers that do not take the update themselves. A module that accepts its own update (a
 * component) or an importer that accepts it stops the walk: Vite replaces that module in place.
 * The development app keeps the modules its entry imports statically (`server/runtime.ts` and the
 * plugins) from when it was created; an edit that reaches them must rebuild it, as the browser
 * reloads. Otherwise a plugin went on providing a `createContext` key that the pages, evaluated
 * again, no longer read: `Missing Meeko context`.
 */
export function reachesEagerModule(modules: Iterable<HotModuleNode>, eager: ReadonlySet<string>): boolean {
	if (!eager.size) return false
	const seen = new Set<HotModuleNode>()
	const pending = [...modules]
	for (let node = pending.pop(); node; node = pending.pop()) {
		if (seen.has(node)) continue
		seen.add(node)
		if (node.file && eager.has(hotFileKey(node.file))) return true
		if (node.isSelfAccepting) continue
		for (const importer of node.importers) if (!importer.acceptedHmrDeps.has(node)) pending.push(importer)
	}
	return false
}

/**
 * Whether `file` is a script of a Meeko module (under one of its `directories`: the folders of its
 * entry, plugins, autoimports and components). Its edit reloads the browser, as one of `app/utils`
 * or `app/plugins` of the project does, instead of updating the components that import it: a
 * package rebuilt by its own tooling rewrites many files at once, and a component update applied
 * while a later file of the same rebuild changed imported a second evaluation of a module that a
 * plugin had already read (a `createContext` key: `Missing Meeko context`).
 */
export function isModuleScript(file: string, directories: readonly string[]): boolean {
	if (!/\.[cm]?[jt]sx?$/.test(file) || /\.d\.[cm]?ts$/.test(file)) return false
	const key = hotFileKey(file)
	return directories.some((directory) => key.startsWith(`${hotFileKey(directory).replace(/\/$/, '')}/`))
}

/** What {@link invalidateDevModules} reads of a Vite module node. */
export interface DevModuleNode {
	readonly file: string | null
	readonly importedModules: ReadonlySet<DevModuleNode>
}

/** What {@link invalidateDevModules} uses of a Vite module graph. */
export interface DevModuleGraph<Node extends DevModuleNode = DevModuleNode> {
	readonly idToModuleMap: ReadonlyMap<string, Node>
	invalidateModule(module: Node, seen?: Set<Node>, timestamp?: number): void
	invalidateAll(): void
}

/** What {@link invalidateDevModules} uses of a Vite development server. */
export interface DevModuleServer {
	/** The graph of every environment, which `invalidateAll` invalidates at once. */
	readonly moduleGraph: { invalidateAll(): void }
	readonly environments?: { readonly client: { readonly moduleGraph: DevModuleGraph }; readonly ssr?: { readonly moduleGraph: DevModuleGraph } }
}

/**
 * Per server module graph, the eager files (keys of {@link hotFileKey}) whose evaluations the
 * development app keeps. Keyed by the graph, not the server: Vite hands its plugins a proxy of the
 * server, and a restart replaces the graph, after which the app is built again and registers anew.
 */
const keptServerModules = new WeakMap<object, ReadonlySet<string>>()

/**
 * Tells {@link invalidateDevModules} which files the development app imported when it was created
 * from the server module `graph` (`server/runtime.ts` and the server and universal plugins, as
 * {@link hotFileKey}s). Each new app registers its own.
 */
export function keepServerModules(graph: object, files: ReadonlySet<string>): void {
	keptServerModules.set(graph, files)
}

/**
 * Invalidates the modules of a development server before a full reload: every module of the
 * browser, and every server module except the eager files registered with {@link keepServerModules}
 * and what they import. The app keeps their evaluations until it is built again; the pages, which
 * load per request, would otherwise evaluate them a second time, and a `createContext` key that a
 * plugin provides would no longer be the one they read (`Missing Meeko context`). An edit of one
 * of them rebuilds the app instead ({@link reachesEagerModule}), which starts from a clean graph.
 */
export function invalidateDevModules(server: DevModuleServer): void {
	const { environments } = server
	const graph = environments?.ssr?.moduleGraph
	const eager = graph && keptServerModules.get(graph)
	// Without a development app (a Vite project that uses the Meeko plugin alone), everything goes.
	if (!environments || !graph || !eager?.size) {
		server.moduleGraph.invalidateAll()
		return
	}
	environments.client.moduleGraph.invalidateAll()
	// What an eager module imports is kept too: a module outside this set is imported by none of them,
	// so invalidating it, and its importers with it, never reaches the set.
	const kept = new Set<DevModuleNode>()
	const pending = [...graph.idToModuleMap.values()].filter((node) => node.file && eager.has(hotFileKey(node.file)))
	for (let node = pending.pop(); node; node = pending.pop()) {
		if (kept.has(node)) continue
		kept.add(node)
		pending.push(...node.importedModules)
	}
	const seen = new Set<DevModuleNode>()
	const timestamp = Date.now()
	for (const node of graph.idToModuleMap.values()) if (!kept.has(node)) graph.invalidateModule(node, seen, timestamp)
}

/**
 * What a route manifest says about each route's render, layouts and named middleware (isomorphic
 * and server), and which route middleware is global, to compare two discoveries.
 */
export function routeOptionsKey(
	routes: readonly {
		readonly id: string
		readonly layouts: readonly string[]
		readonly render?: string
		readonly layout?: unknown
		readonly middleware?: readonly string[]
		readonly serverMiddleware?: readonly string[]
	}[],
	globalMiddleware: readonly string[] = [],
): string {
	return JSON.stringify([routes.map((route) => [route.id, route.layouts, route.render ?? null, route.layout ?? null, route.middleware ?? null, route.serverMiddleware ?? null]), globalMiddleware])
}

/**
 * Whether the dev watcher skips `file`: everything under a `.meeko` directory of
 * `root` except `.meeko/generated`, the entries Vite serves. `meeko check`, the
 * language server, type generation and builds rewrite the rest while `meeko dev`
 * runs, and a stale build output can hold thousands of files; watching them
 * would reload the browser on every check and slow the server start.
 *
 * The rule applies to the path relative to `root`, so a project that itself
 * lives under some `.meeko` directory keeps its own sources watched. Paths
 * outside `root` are never skipped.
 */
export function isDevWatchIgnored(file: string, root: string): boolean {
	const path = relative(root, file).replaceAll('\\', '/')
	if (path === '..' || path.startsWith('../') || isAbsolute(path)) return false
	const segments = path.split('/').filter(Boolean)
	for (let index = 0; index < segments.length - 1; index++) {
		if (segments[index] === '.meeko' && segments[index + 1] !== 'generated') return true
	}
	return false
}

/** The app `meeko dev` serves and the triggers that replace it; see {@link createDevAppReloader}. */
export interface DevAppReloader<T> {
	/** The app that answers the next request; pending while its replacement is built. */
	readonly current: Promise<T>
	/**
	 * Runs `run` with the app once no replacement is pending, and counts it as in flight until it
	 * settles: a restart lets it finish on the module runner it started on before closing that runner.
	 */
	use<R>(run: (app: T) => Promise<R>): Promise<R>
	/** Replaces the app after a discovery change. Changes within the coalescing delay make one replacement. */
	rebuild(): void
	/**
	 * Runs the Vite restart `start` once the requests and the replacement in flight have finished
	 * (or after the drain timeout), and replaces the app once the restart settles, resolved or
	 * rejected. Requests wait from this call on: the restart closes the module runner the current
	 * app loads its modules through. Resolves or rejects as `start` does.
	 */
	restart<R>(start: () => Promise<R>): Promise<R>
}

/**
 * Serializes the replacements of the development app. One replacement is pending at a
 * time: a discovery change and a restart that coincide build a single app, after the restart.
 * `replace` builds the next app from the previous one and resolves to the app that serves
 * from then on; it must not reject (it returns the previous app when the new one fails).
 * `superseded()` tells it whether a restart began while it was building: the app is then built
 * again after that restart, so a failure of this one needs no report.
 *
 * A restart closes the module runner of the old Vite server. A request or a replacement that
 * started before it still loads modules through that runner ("transport was disconnected",
 * "module runner has been closed"), so the restart waits for them, up to `drainTimeout`
 * milliseconds; requests that arrive meanwhile wait for the app built after the restart.
 */
export function createDevAppReloader<T>(initial: T, replace: (prior: T, superseded: () => boolean) => Promise<T>, delay = 25, drainTimeout = 5_000): DevAppReloader<T> {
	let current: Promise<T> = Promise.resolve(initial)
	let queued = false
	/** Every Vite restart in flight, settled together. */
	let restarting: Promise<unknown> | undefined
	/** Restarts begun so far, to tell a replacement that one began while it was building. */
	let restarts = 0
	/** Requests and the replacement running on the module runner of the current Vite server. */
	let active = 0
	const idle = new Set<() => void>()
	const release = (): void => {
		active--
		if (active === 0) for (const done of [...idle]) done()
	}
	const drained = (): Promise<void> =>
		active === 0
			? Promise.resolve()
			: new Promise((done) => {
					const finish = (): void => {
						clearTimeout(timer)
						idle.delete(finish)
						done()
					}
					const timer = setTimeout(finish, drainTimeout)
					idle.add(finish)
				})
	const schedule = (): void => {
		if (queued) return
		queued = true
		const previous = current
		current = (async () => {
			const prior = await previous
			// Coalesces the events of a file tree created or removed at once.
			await new Promise((done) => setTimeout(done, delay))
			// The app must load through the module runner of the server that results from the restart.
			while (restarting) {
				const waiting = restarting
				await waiting
				if (restarting === waiting) restarting = undefined
			}
			queued = false
			const begun = restarts
			active++
			try {
				return await replace(prior, () => restarts !== begun)
			} finally {
				release()
			}
		})()
	}
	return {
		get current() {
			return current
		},
		async use(run) {
			// A replacement scheduled while this request waited (a restart, a discovery change) is waited for too.
			let pending: Promise<T>
			let app: T
			do {
				pending = current
				app = await pending
			} while (pending !== current)
			active++
			try {
				return await run(app)
			} finally {
				release()
			}
		},
		rebuild: schedule,
		restart(start) {
			restarts++
			let settle!: () => void
			const settled = new Promise<void>((done) => {
				settle = done
			})
			restarting = restarting ? Promise.all([restarting, settled]) : settled
			schedule()
			const running = drained().then(start)
			void running.then(settle, settle)
			return running
		},
	}
}

/**
 * Dependency-scan globs that keep Vite's optimizer out of `.meeko`, where a
 * previous build leaves prerendered HTML. They are negated `optimizeDeps.entries`
 * patterns, relative to the Vite root.
 */
export const devScanIgnored: readonly string[] = ['!**/.meeko/**']

/**
 * `optimizeDeps.include` of the browser in `meeko dev`: the modules of Meeko's own components
 * (`@meekojs/meeko/builtins/*`), which only the pages that use their tags import. Pages load
 * with `import()`, so Vite would find them on the first visit to such a page, optimize them
 * again and reload it. Only when Vite optimizes Meeko (installed in `node_modules`, not linked
 * from a workspace and not in `optimizeDeps.exclude`): including them from a linked copy would
 * bundle a second runtime.
 */
export function builtinOptimizeInclude(runtime: string, exclude: readonly string[] | undefined): string[] {
	if (!runtime.replaceAll('\\', '/').includes('/node_modules/')) return []
	if (exclude?.some((entry) => entry === '@meekojs/meeko' || entry.startsWith('@meekojs/meeko/'))) return []
	return Object.values(builtinComponentModules).map((module) => module.specifier)
}
