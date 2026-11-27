import { resolve } from 'node:path'

import { loadConfiguredModules } from './config'
import { setModuleDevelopmentMode } from './module-loader'
import { createGlobalStylesheetSnapshot } from './styles'
import { withModules } from './vite-config'

/** Result of {@link writeGlobalStylesheetSnapshot}. */
export type StylesheetSnapshotResult = 'written' | 'none' | 'failed'

/**
 * Writes `.meeko/styles/main.css` without starting the development server: the file
 * `meeko dev` keeps, with the same contents, for the editor and for `meekoSortClasses: "stylesheet"`
 * where nothing has run `meeko dev` (a clean checkout, CI). It goes through the same Vite pipeline
 * as development (the Meeko plugin, the plugins and `extendViteConfig` of the modules, in
 * development mode) on a server that has no HTTP listener, no WebSocket and no watcher, and which is
 * closed before this returns.
 *
 * Without module stylesheets or `app/styles/main.css` nothing is written and a stale snapshot is
 * removed, as `meeko dev` does. Stylesheets that do not compile are reported through `report` and
 * keep the previous snapshot (`'failed'`); a file that cannot be written rejects.
 *
 * @param projectRoot Project folder.
 * @param report Receives the warning of a stylesheet that does not compile.
 */
export async function writeGlobalStylesheetSnapshot(projectRoot: string, report: (message: string) => void): Promise<StylesheetSnapshotResult> {
	const root = resolve(projectRoot)
	// The modules run in development mode, as in `meeko dev`; their other resolutions in this process keep the previous mode.
	setModuleDevelopmentMode(true)
	try {
		const { modules } = await loadConfiguredModules(root)
		const snapshot = createGlobalStylesheetSnapshot(root, report, modules.stylesheets)
		return await snapshot.generate(async () => {
			const { createServer, searchForWorkspaceRoot } = await import('vite')
			const { meeko } = await import('../vite')
			// The path aliases and the rest of the plugin stay for the `@import`s of the stylesheets; its server hook
			// (it compiles every component to refresh the registry and the declarations) and watchers do not apply.
			const { configureServer: _server, handleHotUpdate: _hotUpdate, ...components } = meeko()
			return createServer(
				withModules(
					modules,
					{
						root,
						configFile: false,
						plugins: [
							components,
							{
								name: 'meeko:stylesheet-snapshot-no-optimizer',
								// The Meeko plugin and the modules add to `optimizeDeps.include`, which merges by appending:
								// it is emptied once resolved, so nothing is scanned, pre-bundled or cached.
								configResolved(resolved) {
									for (const environment of Object.values(resolved.environments)) {
										environment.optimizeDeps.include = []
										environment.optimizeDeps.noDiscovery = true
									}
								},
							},
						],
						ssr: { external: ['@meekojs/meeko'] },
						// Only the transform of the stylesheets is used: nothing listens, watches or pre-bundles.
						server: {
							middlewareMode: true,
							hmr: false,
							watch: null,
							...(modules.ownedDirectories.length ? { fs: { allow: [searchForWorkspaceRoot(root), ...modules.ownedDirectories] } } : {}),
						},
						optimizeDeps: { noDiscovery: true },
						appType: 'custom',
					},
					'serve',
				),
			)
		})
	} finally {
		setModuleDevelopmentMode(false)
	}
}
