import { defineApiRoute } from '@meekojs/meeko/server'
import { feedbackHandler, feedbackInput, feedbackSaved, metricsRateLimits, navigationPaths } from 'meeko-docs/metrics/server'

import { navigation } from '../../../app/utils/navigation'

// «¿Te sirvió?» de una página: JSON desde el widget o un formulario nativo sin JavaScript, que vuelve
// a la página con 303. Meeko exige el Origin de la web (1.8) y limita los envíos por cliente.
export default defineApiRoute({
	body: feedbackInput,
	response: feedbackSaved,
	form: true,
	rateLimit: metricsRateLimits.feedback,
	handler: feedbackHandler({ site: 'ui', knownPath: navigationPaths('ui', navigation) }),
})
