// The preview worker of the dashboard: a long-lived child process that renders one source with the
// text of a draft (meeko-docs-content/preview) for each message it receives over IPC. Vite loads the
// TypeScript of the package once; each render has a source context of its own, so nothing of one
// draft reaches the next. server/dashboard/preview.ts starts it, retires it when its memory grows
// and kills it after a while without previews. It ends when the dashboard disconnects.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'vite'

import { exitWithParent } from './parent-guard.mjs'

exitWithParent({ keepAlive: true })

const app = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vite = await createServer({
	root: app,
	configFile: false,
	logLevel: 'error',
	appType: 'custom',
	// No HMR WebSocket: with only `hmr: false` Vite still opens one, on a port another server may hold.
	server: { middlewareMode: true, hmr: false, ws: false, watch: null },
	optimizeDeps: { noDiscovery: true, include: [] },
})
const { renderSourcePreview } = await vite.ssrLoadModule('meeko-docs-content/preview')

// One render at a time, in the order they arrive.
let queue = Promise.resolve()
process.on('message', (message) => {
	queue = queue.then(async () => {
		const { id, file, kind, markdown } = message ?? {}
		try {
			const result = await renderSourcePreview({ file, kind, markdown })
			globalThis.gc?.()
			process.send?.({ id, ok: true, result, rss: process.memoryUsage().rss })
		} catch (error) {
			globalThis.gc?.()
			process.send?.({ id, ok: false, error: error instanceof Error ? error.message : String(error), rss: process.memoryUsage().rss })
		}
	})
})
process.send?.({ ready: true })
