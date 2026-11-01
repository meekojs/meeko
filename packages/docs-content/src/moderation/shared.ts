// What the public sites need of the moderation, without any dependency: the browser imports it too
// (the documentation shell and the dismissal of announcements), so it must stay free of `pg`, Node
// and the render.

/** A public site whose pages the dashboard moderates. */
export type ModerationSite = 'i18n' | 'site' | 'ui'

/** What a rule does with a page: hide it (404 and out of every list) or feature it. */
export type ModerationAction = 'feature' | 'hide'

/** The tone of an announcement, which picks its color and its ARIA role. */
export type AnnouncementTone = 'danger' | 'info' | 'success' | 'warning'

/** The sites, the actions and the tones the schema accepts, in display order. */
export const moderationSites: readonly ModerationSite[] = ['site', 'ui', 'i18n']
export const moderationActions: readonly ModerationAction[] = ['hide', 'feature']
export const announcementTones: readonly AnnouncementTone[] = ['info', 'success', 'warning', 'danger']

/** An announcement as a site shows it: no author or internal dates, only what the banner renders. */
export interface PublicAnnouncement {
	readonly id: number
	readonly message: string
	readonly tone: AnnouncementTone
}

/**
 * The moderation of one site as its pages apply it: the URL paths of the hidden and of the
 * featured pages, and the announcements in force, newest first. It is plain JSON, so a server can
 * hand it to the browser.
 */
export interface SiteModeration {
	readonly hidden: readonly string[]
	readonly featured: readonly string[]
	readonly announcements: readonly PublicAnnouncement[]
}

/** No moderation: what a site applies without a database. */
export const emptyModeration: SiteModeration = Object.freeze({ hidden: Object.freeze([]), featured: Object.freeze([]), announcements: Object.freeze([]) })

/**
 * The path of a page as the rules name it: without query, fragment or trailing slash, so
 * `/docs/api/?x#y` is `/docs/api`. The root stays `/`.
 */
export function pagePath(href: string): string {
	let path = href
	const cut = path.search(/[?#]/)
	if (cut >= 0) path = path.slice(0, cut)
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
		try {
			path = new URL(path).pathname
		} catch {
			return path
		}
	}
	while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1)
	return path || '/'
}

/**
 * A segment as the router of Meeko reads it (`packages/meeko/src/app/runtime/router.ts`,
 * `decodePart`): decoded, or `undefined` when it does not decode or decodes to `/`, `\`, `.` or
 * `..`, which no route matches.
 */
function routeSegment(part: string): string | undefined {
	try {
		const value = decodeURIComponent(part)
		return value.includes('/') || value.includes('\\') || value === '.' || value === '..' ? undefined : value
	} catch {
		return undefined
	}
}

/**
 * The page that `href` reaches through the router of Meeko, with exactly its normalization: the
 * path without query or fragment, its empty segments dropped (`//buttons`, `/buttons/`) and each
 * one decoded (`/%62uttons`). So `/en//playground?x#y` is `/en/playground`. `null` when the router
 * matches no route with it (a segment that does not decode, or decodes to `/`, `\`, `.` or `..`),
 * or when `href` is not a path. The root is `/`.
 *
 * Meeko does not export this normalization: a test compares it with `matchRoute` so that both
 * stay the same.
 */
export function routePath(href: string): string | null {
	let path = href
	const cut = path.search(/[?#]/)
	if (cut >= 0) path = path.slice(0, cut)
	if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) {
		try {
			path = new URL(path).pathname
		} catch {
			return null
		}
	}
	if (!path.startsWith('/')) return null
	const parts = path.split('/').slice(1).filter(Boolean).map(routeSegment)
	if (parts.some((part) => part === undefined)) return null
	return `/${parts.join('/')}`
}

const routeSets = new WeakMap<readonly string[], ReadonlySet<string>>()

/** The paths of `paths` through {@link routePath}, without the ones no route matches; computed once per list. */
function routePaths(paths: readonly string[]): ReadonlySet<string> {
	let set = routeSets.get(paths)
	if (!set) {
		set = new Set(paths.map(routePath).filter((path) => path !== null))
		routeSets.set(paths, set)
	}
	return set
}

/**
 * Whether `href` names a hidden page of `moderation`, directly or through one of its `aliases`
 * (alias path → page path). Both sides are compared as the router reads them ({@link routePath}),
 * so an encoded segment, a repeated slash, a query or a trailing slash cannot dodge a rule; the
 * aliases apply after that normalization.
 */
export function isHiddenPath(moderation: SiteModeration, href: string, aliases?: ReadonlyMap<string, string>): boolean {
	if (!moderation.hidden.length) return false
	const path = routePath(href)
	if (path === null) return false
	const hidden = routePaths(moderation.hidden)
	if (hidden.has(path)) return true
	if (aliases === undefined) return false
	for (const [alias, page] of aliases) {
		if (routePath(alias) !== path) continue
		const target = routePath(page)
		if (target !== null && hidden.has(target)) return true
	}
	return false
}

/** Whether `href` names a featured page of `moderation`, compared as {@link isHiddenPath} does. */
export function isFeaturedPath(moderation: SiteModeration, href: string): boolean {
	if (!moderation.featured.length) return false
	const path = routePath(href)
	return path !== null && routePaths(moderation.featured).has(path)
}

/**
 * The path where a public site answers its moderation as JSON, never cached: the browser asks for
 * it after each navigation, so the rules and announcements do not stay as the first page had them.
 */
export function moderationEndpoint(site: ModerationSite): string {
	return `/_meeko-docs/moderation/${site}`
}

/**
 * `value` when it is a {@link SiteModeration} as {@link moderationEndpoint} answers it, or `null`:
 * the browser checks the answer before it replaces the moderation of the page with it.
 */
export function parseSiteModeration(value: unknown): SiteModeration | null {
	if (typeof value !== 'object' || value === null) return null
	const { hidden, featured, announcements } = value as Record<string, unknown>
	const paths = (list: unknown): list is string[] => Array.isArray(list) && list.every((item) => typeof item === 'string')
	if (!paths(hidden) || !paths(featured) || !Array.isArray(announcements)) return null
	const valid = announcements.every((item: unknown) => {
		if (typeof item !== 'object' || item === null) return false
		const { id, message, tone } = item as Record<string, unknown>
		return Number.isSafeInteger(id) && typeof message === 'string' && (announcementTones as readonly unknown[]).includes(tone)
	})
	return valid ? { hidden, featured, announcements: announcements as PublicAnnouncement[] } : null
}

/**
 * The moderation that {@link moderationEndpoint} answers now, or `null` when it does not answer,
 * fails or answers something else: the page then keeps the moderation it has. The cookie of the
 * closed announcements goes with the request, and no cache keeps the answer.
 */
export async function fetchSiteModeration(endpoint: string, signal?: AbortSignal): Promise<SiteModeration | null> {
	try {
		const response = await fetch(endpoint, { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' }, ...(signal ? { signal } : {}) })
		return response.ok ? parseSiteModeration(await response.json()) : null
	} catch {
		return null
	}
}

/** The cookie that remembers, in the browser, the announcements its reader closed. */
export const dismissedCookie = 'meeko-docs-notices'

/** The ids of the closed announcements in a `Cookie` header (or `document.cookie`). Malformed values count as none. */
export function dismissedAnnouncements(cookieHeader: string | null | undefined): number[] {
	if (!cookieHeader) return []
	for (const part of cookieHeader.split(';')) {
		const [name, ...rest] = part.trim().split('=')
		if (name !== dismissedCookie) continue
		return rest
			.join('=')
			.split('.')
			.map(Number)
			.filter((id) => Number.isSafeInteger(id) && id > 0)
	}
	return []
}

/**
 * The value of `document.cookie` that closes `id` too, for a year and for the whole site. It keeps
 * the 20 newest ids: older announcements have ended long before.
 */
export function dismissCookie(cookieHeader: string | null | undefined, id: number, secure = false): string {
	const ids = [...new Set([...dismissedAnnouncements(cookieHeader), id])].sort((a, b) => b - a).slice(0, 20)
	return `${dismissedCookie}=${ids.join('.')}; Path=/; Max-Age=31536000; SameSite=Lax${secure ? '; Secure' : ''}`
}

/** `moderation` without the announcements that `cookieHeader` closed: what the server renders, so a closed banner never flashes. */
export function withoutDismissed(moderation: SiteModeration, cookieHeader: string | null | undefined): SiteModeration {
	const closed = dismissedAnnouncements(cookieHeader)
	if (!closed.length || !moderation.announcements.length) return moderation
	return { ...moderation, announcements: moderation.announcements.filter((announcement) => !closed.includes(announcement.id)) }
}

/** The ARIA role of an announcement: `alert` interrupts for a danger, `status` waits for the others. */
export function announcementRole(tone: AnnouncementTone): 'alert' | 'status' {
	return tone === 'danger' ? 'alert' : 'status'
}
