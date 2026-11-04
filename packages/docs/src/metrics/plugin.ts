import { effect } from '@meekojs/meeko'
import { definePlugin } from '@meekojs/meeko/framework'
import { metricsEnabled } from 'meeko-docs-content/metrics/shared'

import type { MetricsMode } from './state'

import { docsMetricsKey, metricsActive, metricsMetaName, sendMetric } from './state'

/** El entorno del proceso en el servidor, sin que el bundle del navegador mencione `process`. */
function serverEnv(): Readonly<Record<string, string | undefined>> {
	return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {}
}

/** Cuenta una vista de cada página que llega a mostrarse, también en la navegación del cliente. */
function trackViews(route: { readonly path: { readonly value: string } }): void {
	let last: string | undefined
	effect(() => {
		const path = route.path.value
		if (path === last) return
		last = path
		sendMetric('/api/docs/views', { path })
	})
}

// Métricas de una web documental (vistas y estado del widget «¿Te sirvió?»), en los dos lados:
//
// - En el servidor decide si están activas (DATABASE_URL y DOCS_METRICS) y lo publica para los
//   componentes y en un <meta>.
// - En el navegador cuenta una vista por página mostrada con un beacon: la primera y cada
//   navegación del cliente que cambia la ruta (no el hash ni la query). Un prefetch nunca llega a
//   confirmar su ruta, y una página prerenderizada por el navegador espera a mostrarse. Un navegador
//   automatizado (navigator.webdriver) no cuenta salvo con DOCS_METRICS=all, que usan las e2e de
//   métricas: así las e2e de otras partes, con el .env real, no escriben métricas. No usa cookies
//   ni identificadores: el beacon sólo lleva la ruta.
export default definePlugin((app) => {
	if (app.side === 'server') {
		const env = serverEnv()
		const enabled = metricsEnabled(env) && Boolean(env.DATABASE_URL?.trim())
		app.provide(docsMetricsKey, { enabled })
		const mode: MetricsMode = !enabled ? 'off' : env.DOCS_METRICS?.trim().toLowerCase() === 'all' ? 'all' : 'on'
		app.addHead(() => ({ meta: [{ name: metricsMetaName, content: mode }] }))
		return
	}
	if (!metricsActive()) return
	const prerendering = (document as Document & { prerendering?: boolean }).prerendering === true
	if (prerendering) document.addEventListener('prerenderingchange', () => trackViews(app.route), { once: true })
	else trackViews(app.route)
})
