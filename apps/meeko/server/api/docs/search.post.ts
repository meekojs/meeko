import { defineApiRoute } from '@meekojs/meeko/server'
import { metricsLimits, metricsRateLimits, normalizeQuery, searchHandler, searchInput } from 'meeko-docs-content/metrics'

import { searchPages } from '../../content/db'

// A confirmed search of the site: the search dialog sends it once the reader stops typing or opens a
// result, never per key (`GET /api/docs/search` answers while typing and stores nothing). The query
// is stored normalized with the results this server finds for it, as the dialog shows them.
export default defineApiRoute({
	body: searchInput,
	status: 204,
	rateLimit: metricsRateLimits.search,
	handler: searchHandler({
		site: 'site',
		count: async (query) => {
			const text = normalizeQuery(query)
			return text && text.length <= metricsLimits.query ? (await searchPages(text, 8)).length : 0
		},
	}),
})
