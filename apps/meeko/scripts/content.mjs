// Runs a task with the modules of meeko-docs-content. They are TypeScript with extensionless
// imports, so Vite loads them as `meeko build` does, without a server. DATABASE_URL comes from
// apps/meeko/.env when the environment does not set it.
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

const site = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Calls `task` with a loader of modules such as `meeko-docs-content/db`, then drains the shared
 * database pool and closes Vite, also when the task fails.
 *
 * @template T
 * @param {(load: (id: string) => Promise<Record<string, any>>) => Promise<T>} task
 * @returns {Promise<T>}
 */
export async function withContent(task) {
	const envFile = join(site, '.env')
	if (existsSync(envFile) && !process.env.DATABASE_URL) process.loadEnvFile(envFile)
	const vite = await createServer({
		root: site,
		configFile: false,
		logLevel: 'error',
		appType: 'custom',
		// Sin WebSocket de HMR: con solo `hmr: false` Vite abre uno igualmente, en un puerto que otro servidor puede ocupar.
		server: { middlewareMode: true, hmr: false, ws: false, watch: null },
		optimizeDeps: { noDiscovery: true, include: [] },
	})
	const load = (id) => vite.ssrLoadModule(id)
	try {
		return await task(load)
	} finally {
		try {
			await (await load('meeko-docs-content/db')).closePool()
		} finally {
			await vite.close()
		}
	}
}
