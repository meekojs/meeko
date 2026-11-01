import { defineApiRoute } from '@meekojs/meeko/server'
import { metricsRateLimits, navigationPaths, viewHandler, viewInput } from 'meeko-docs/metrics/server'

import { navigation } from '../../../app/utils/navigation'

// Una vista de una página de la navegación, que envía el beacon del módulo meeko-docs. Sin cookies,
// IP ni identificadores: sólo suma uno a la página y al día (UTC). /en/… cuenta como inglés y el
// árabe del laboratorio (/ar/playground), como /playground. Responde 204 siempre.
export default defineApiRoute({
	body: viewInput,
	status: 204,
	rateLimit: metricsRateLimits.view,
	handler: viewHandler({ site: 'i18n', localized: true, knownPath: navigationPaths('i18n', navigation) }),
})
