import type { PublicAnnouncement } from 'meeko-docs-content/moderation/shared'

import { createContext } from '@meekojs/meeko'

/**
 * The announcements of this request, which `app/plugins/moderation.server.ts` provides on the
 * server; the banner keeps them in `useState`, so the browser hydrates the same list.
 */
export const announcementsKey = createContext<readonly PublicAnnouncement[]>('site announcements')
