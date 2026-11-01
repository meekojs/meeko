import { defineApiRoute } from '@meekojs/meeko/server'
import { metricsRateLimits, viewHandler, viewInput } from 'meeko-docs-content/metrics'

import { readPage } from '../../content/db'

// One view of a page of the active snapshot, sent by the beacon of app/plugins/metrics.ts. No
// cookies, IP or identifiers: it adds one to the page and the UTC day. A hidden page, or one the
// snapshot does not have, is not counted. It answers 204 in every case.
export default defineApiRoute({
	body: viewInput,
	status: 204,
	rateLimit: metricsRateLimits.view,
	// `/en/…` counts as an English view of the page without the prefix.
	handler: viewHandler({ site: 'site', localized: true, knownPath: async (path, locale) => (await readPage(path, locale)) !== null }),
})
