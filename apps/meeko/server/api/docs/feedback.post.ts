import { defineApiRoute } from '@meekojs/meeko/server'
import { feedbackHandler, feedbackInput, feedbackSaved, metricsRateLimits } from 'meeko-docs-content/metrics'

import { readPage } from '../../content/db'

// «¿Te sirvió?» of a page: JSON from the widget, or a native form without JavaScript that goes back
// to the page with 303 (`form`). Meeko requires the site's Origin (1.8) and limits the answers per
// client. A page the snapshot does not have, or a hidden one, is not stored.
export default defineApiRoute({
	body: feedbackInput,
	response: feedbackSaved,
	form: true,
	rateLimit: metricsRateLimits.feedback,
	// `/en/…` counts as an English view of the page without the prefix.
	handler: feedbackHandler({ site: 'site', localized: true, knownPath: async (path, locale) => (await readPage(path, locale)) !== null }),
})
