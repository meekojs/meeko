import { defineServerMiddleware } from '@meekojs/meeko/server'
import { moderationEndpoint, moderationResponse } from 'meeko-docs-content/moderation'

const endpoint = moderationEndpoint('site')

/**
 * The moderation of the site as JSON, never cached: the banner of announcements reads it again
 * after each navigation, so a long session sees the announcements that start, end or are closed
 * from the dashboard (`app/components/Announcements.meeko`).
 */
export default defineServerMiddleware((request, next) => {
	if ((request.method === 'GET' || request.method === 'HEAD') && new URL(request.url).pathname === endpoint) return moderationResponse('site', request)
	return next(request)
})
