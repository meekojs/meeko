import { defineServerMiddleware } from '@meekojs/meeko/server'
import { docsLocales } from 'meeko-docs-content/locale'
import { moderationEndpoint, moderationResponse } from 'meeko-docs-content/moderation'

/** The endpoint of each language: `/_meeko-docs/moderation/site` and `/_meeko-docs/moderation/site/en`. */
const endpoints = new Map(docsLocales.map((locale) => [moderationEndpoint('site', locale), locale]))

/**
 * The moderation of the site in each language as JSON, never cached: the banner of announcements
 * reads it again after each navigation, so a long session sees the announcements that start, end
 * or are closed from the dashboard (`app/components/Announcements.meeko`).
 */
export default defineServerMiddleware((request, next) => {
	const locale = request.method === 'GET' || request.method === 'HEAD' ? endpoints.get(new URL(request.url).pathname) : undefined
	return locale ? moderationResponse('site', request, { locale }) : next(request)
})
