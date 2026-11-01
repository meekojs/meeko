import { definePlugin } from '@meekojs/meeko/framework'
import { withoutDismissed } from 'meeko-docs-content/moderation'

import { siteModeration } from '../../server/content/db'
import { announcementsKey } from '../utils/announcements'

// The announcements in force of the site, without the ones this reader closed (their cookie), so
// the server never renders a banner that the browser would then hide. Never throws: without a
// database the list is empty.
export default definePlugin(async (app) => {
	const moderation = withoutDismissed(await siteModeration(), app.request?.headers.get('cookie'))
	app.provide(announcementsKey, moderation.announcements)
})
