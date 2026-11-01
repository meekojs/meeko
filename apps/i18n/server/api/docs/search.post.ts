import { defineApiRoute } from '@meekojs/meeko/server'
import { metricsRateLimits, searchHandler, searchInput } from 'meeko-docs/metrics/server'

// Una búsqueda del filtro de la guía, confirmada tras una pausa al escribir: la consulta normalizada
// y cuántas páginas encontró. Responde 204 siempre.
export default defineApiRoute({
	body: searchInput,
	status: 204,
	rateLimit: metricsRateLimits.search,
	handler: searchHandler({ site: 'i18n' }),
})
