import { createContext, inject } from '@meekojs/meeko'
import { useState } from '@meekojs/meeko/framework'

export type { FeedbackInput, MetricsSite } from 'meeko-docs-content/metrics/shared'
export { feedbackInput, metricsLimits, normalizeQuery, storedQuery } from 'meeko-docs-content/metrics/shared'

/** Lo que el servidor decide de las métricas en cada petición. */
export interface DocsMetricsState {
	/** `true` con `DATABASE_URL` y sin `DOCS_METRICS=off`: la web cuenta y guarda respuestas. */
	readonly enabled: boolean
}

/** La decisión de la petición, que publica el plugin de métricas en el servidor. */
export const docsMetricsKey = createContext<DocsMetricsState>('meeko-docs metrics')

/** `<meta>` que lee el plugin en el navegador antes de hidratar, para no contar sin base de datos. */
export const metricsMetaName = 'meeko-docs-metrics'

const disabled: DocsMetricsState = Object.freeze({ enabled: false })

function provided(): DocsMetricsState {
	try {
		return inject(docsMetricsKey)
	} catch {
		return disabled
	}
}

/**
 * Señal con el estado de las métricas de la web: si están activas, el widget «¿Te sirvió?» se
 * muestra; si no, desaparece. En SSR la escribe el plugin de servidor y viaja en el estado, así que
 * el navegador hidrata lo mismo. Se llama en el `<script>` de un componente.
 *
 * @returns La señal compartida del estado de las métricas.
 * @example
 * ```ts
 * const metrics = useDocsMetrics()
 * const visible = computed(() => metrics.value.enabled)
 * ```
 */
export function useDocsMetrics() {
	return useState<DocsMetricsState>('meeko-docs:metrics', provided)
}

/**
 * Envía una métrica al endpoint propio con `navigator.sendBeacon` (sobrevive al cierre de la
 * página) o, sin él, con `fetch` `keepalive`. Es JSON del mismo origen, así que el navegador añade
 * `Origin` y Meeko lo acepta. Nunca lanza: una métrica perdida no afecta a la página.
 *
 * @param endpoint `/api/docs/views` o `/api/docs/search`.
 * @param body El cuerpo JSON del endpoint.
 * @returns `true` si el navegador aceptó el envío.
 * @example
 * ```ts
 * sendMetric('/api/docs/search', { q: 'botón', results: 3 })
 * ```
 */
export function sendMetric(endpoint: '/api/docs/search' | '/api/docs/views', body: Readonly<Record<string, unknown>>): boolean {
	try {
		const payload = new Blob([JSON.stringify(body)], { type: 'application/json' })
		if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(endpoint, payload)) return true
		void fetch(endpoint, { method: 'POST', body: payload, keepalive: true, credentials: 'same-origin' }).catch(() => {})
		return true
	} catch {
		return false
	}
}

let active: boolean | undefined

/**
 * Lo que el servidor escribe en el `<meta>`: `off` sin métricas, `on` con ellas y `all` con
 * `DOCS_METRICS=all`, que cuenta también los navegadores automatizados (solo para las e2e).
 */
export type MetricsMode = 'all' | 'off' | 'on'

/**
 * Si la página que cargó el navegador tiene las métricas activas, según el `<meta>` que escribió el
 * servidor. Un navegador automatizado (`navigator.webdriver`, como el de una e2e) es un bot evidente
 * y no cuenta salvo en el modo `all`. Se lee la primera vez, que es antes de hidratar (el plugin),
 * porque la navegación del cliente rehace el `<head>` sin ese `<meta>`.
 *
 * @returns `true` cuando la web cuenta vistas y búsquedas.
 * @example
 * ```ts
 * if (metricsActive()) sendMetric('/api/docs/views', { path: location.pathname })
 * ```
 */
export function metricsActive(): boolean {
	if (typeof document === 'undefined') return false
	if (active === undefined) {
		const mode = document.querySelector(`meta[name="${metricsMetaName}"]`)?.getAttribute('content')
		active = mode === 'all' || (mode === 'on' && navigator.webdriver !== true)
	}
	return active
}
