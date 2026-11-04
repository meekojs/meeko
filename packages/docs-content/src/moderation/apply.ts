import type { SiteModeration } from './shared'

import { isFeaturedPath, isHiddenPath, pagePath } from './shared'

/**
 * Arrays of a snapshot payload whose items link to pages: the links of the sidebar (`links`), the
 * cards of `/docs` (`docs`), the symbols of the reference index (`entries`) and of `/exports`
 * (`items`). A hidden page leaves them; a featured one is marked.
 */
const linkLists = new Set(['docs', 'entries', 'items', 'links'])

interface Link {
	readonly href: string
	readonly label: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isLink(value: unknown): value is Link & Record<string, unknown> {
	return isRecord(value) && typeof value.href === 'string'
}

/**
 * `value` with the lists of {@link linkLists} moderated, at any depth. `emptied` tells that a list
 * lost every item, so the group that holds it (a section of the sidebar, say) leaves its own list.
 */
function walk(value: unknown, moderation: SiteModeration, inList: boolean): { readonly value: unknown; readonly emptied: boolean } {
	if (Array.isArray(value)) {
		let emptied = false
		const items: unknown[] = []
		for (const item of value) {
			if (inList && isLink(item) && isHiddenPath(moderation, item.href)) continue
			const result = walk(item, moderation, false)
			if (result.emptied) continue
			items.push(inList && isLink(result.value) && isFeaturedPath(moderation, result.value.href) ? { ...result.value, featured: true } : result.value)
		}
		if (value.length > 0 && items.length === 0) emptied = true
		return { value: items, emptied }
	}
	if (!isRecord(value)) return { value, emptied: false }
	let emptied = false
	const next: Record<string, unknown> = {}
	for (const [key, child] of Object.entries(value)) {
		const list = linkLists.has(key) && Array.isArray(child)
		const result = list || Array.isArray(child) || isRecord(child) ? walk(child, moderation, list) : { value: child, emptied: false }
		// A list that lost every item, directly or because its own groups emptied (the sections of a
		// group of `/exports`), takes the item that holds it out of its list too.
		if (Array.isArray(child) && result.emptied) emptied = true
		next[key] = result.value
	}
	return { value: next, emptied }
}

/** The pages of the sidebar in its order, the order the pager follows. */
function sidebarOrder(nav: unknown): Link[] {
	if (!Array.isArray(nav)) return []
	return nav.flatMap((section) => (isRecord(section) && Array.isArray(section.links) ? section.links.filter(isLink) : []))
}

/**
 * A pager whose previous or next page is hidden: its neighbours in the moderated sidebar instead,
 * or nothing when the current page is not in it.
 */
function moderatePager(pager: unknown, nav: unknown, current: unknown, moderation: SiteModeration): unknown {
	if (!isRecord(pager)) return pager
	const previous = pager.previous
	const next = pager.next
	const hiddenPrevious = isLink(previous) && isHiddenPath(moderation, previous.href)
	const hiddenNext = isLink(next) && isHiddenPath(moderation, next.href)
	if (!hiddenPrevious && !hiddenNext) return pager
	const order = sidebarOrder(nav)
	const at = typeof current === 'string' ? order.findIndex((link) => pagePath(link.href) === pagePath(current)) : -1
	const neighbour = (offset: number): Link | null => {
		if (at < 0) return null
		const link = order[at + offset]
		return link ? { href: link.href, label: link.label } : null
	}
	return { ...pager, ...(hiddenPrevious ? { previous: neighbour(-1) } : {}), ...(hiddenNext ? { next: neighbour(1) } : {}) }
}

/** The id of a group of an index, as its table of contents names it: `anchor` in the reference, `id` in `/exports`. */
function groupId(group: unknown): string | null {
	if (!isRecord(group)) return null
	if (typeof group.anchor === 'string') return group.anchor
	return typeof group.id === 'string' ? group.id : null
}

/** The symbols of a group of an index: its `entries` (reference) or the `items` of its `sections` (`/exports`). */
function groupItems(group: unknown): unknown[] {
	if (!isRecord(group)) return []
	if (Array.isArray(group.entries)) return group.entries
	if (Array.isArray(group.sections)) return group.sections.flatMap((section) => (isRecord(section) && Array.isArray(section.items) ? section.items : []))
	return []
}

/** The id of the section of the reference index that lists every module of `/exports`. */
const exportsSection = 'todos-los-exports'

/**
 * What an index of the reference shows besides its lists, after they were moderated (`before` is
 * the stored payload, `after` the moderated one): the links to the modules of `/exports` and the
 * card and section that lead there leave when `/exports` is hidden; the total, the counts per kind
 * and the table of contents follow the symbols and groups that are left.
 */
function moderateIndex(before: Record<string, unknown>, after: Record<string, unknown>, moderation: SiteModeration): void {
	if (typeof after.exportsLink === 'string' && isHiddenPath(moderation, after.exportsLink)) after.exportsLink = null
	if (Array.isArray(after.modules)) after.modules = after.exportsLink === null ? [] : after.modules.filter((module) => !(isLink(module) && isHiddenPath(moderation, module.href)))
	if (!Array.isArray(before.groups) || !Array.isArray(after.groups)) return
	const items = after.groups.flatMap(groupItems)
	if (typeof after.total === 'number') after.total = items.length
	if (Array.isArray(after.kinds)) after.kinds = after.kinds.map((kind) => (isRecord(kind) && typeof kind.count === 'number' ? { ...kind, count: items.filter((item) => isRecord(item) && item.kind === kind.kind).length } : kind)).filter((kind) => !isRecord(kind) || kind.count !== 0)
	if (Array.isArray(after.toc)) {
		const left = new Set(after.groups.map(groupId))
		const gone = new Set(before.groups.map(groupId).filter((id) => id !== null && !left.has(id)))
		if ('exportsLink' in after && (after.exportsLink === null || (Array.isArray(after.modules) && after.modules.length === 0))) gone.add(exportsSection)
		after.toc = after.toc.filter((entry) => !(isRecord(entry) && typeof entry.id === 'string' && gone.has(entry.id)))
	}
}

/**
 * The payload of a page of the site's snapshot as its moderation shows it: hidden pages leave the
 * sidebar, the cards of `/docs` and the indexes of the reference (a group that loses every page
 * goes with them, and the total, the counts per kind and the table of contents follow), featured
 * ones carry `featured: true`, and a pager that pointed to a hidden page points to its neighbour
 * in the moderated sidebar. Hiding `/docs/reference/exports` also takes its links out of the
 * reference index (`modules`, and `exportsLink` becomes `null`). The HTML of the articles is not rewritten: a
 * link inside a guide to a hidden page leads to its 404. Nothing changes without rules.
 *
 * @example
 * ```ts
 * const page = await readPage<GuidePage>(path)
 * if (!page || isHiddenPath(moderation, path)) notFound()
 * const shown = moderateSnapshotPayload(page, moderation)
 * ```
 */
export function moderateSnapshotPayload<T>(payload: T, moderation: SiteModeration): T {
	if (!moderation.hidden.length && !moderation.featured.length) return payload
	const { value } = walk(payload, moderation, false)
	if (isRecord(value) && isRecord(payload)) moderateIndex(payload, value, moderation)
	if (isRecord(value) && 'pages' in value && 'nav' in value) value.pages = moderatePager(value.pages, value.nav, value.current, moderation)
	return value as T
}

/** The path of an absolute link of `origin` (`https://…/docs/api` → `/docs/api`), or `null` for another site. */
function originPath(href: string, origin: string): string | null {
	return href.startsWith(origin) ? pagePath(href.slice(origin.length) || '/') : null
}

/**
 * `/llms.txt` without the list items that link to a hidden page: `- [Title](origin/path): …`.
 */
export function moderateLlmsIndex(text: string, origin: string, moderation: SiteModeration): string {
	if (!moderation.hidden.length) return text
	return text
		.split('\n')
		.filter((line) => {
			const link = /^- \[[^\]]*\]\(([^)\s]+)\)/.exec(line)
			const path = link ? originPath(link[1]!, origin) : null
			return path === null || !isHiddenPath(moderation, path)
		})
		.join('\n')
}

/**
 * `/llms-full.txt` without the sections of hidden pages. Each section starts with a rule and the
 * comment with its URL (`---`, a blank line and `<!-- origin/path -->`), and runs to the next.
 */
export function moderateLlmsFull(text: string, origin: string, moderation: SiteModeration): string {
	if (!moderation.hidden.length) return text
	const marker = '\n---\n\n<!-- '
	const [head, ...sections] = text.split(marker)
	const kept = sections.filter((section) => {
		const url = section.slice(0, section.indexOf(' -->'))
		const path = originPath(url, origin)
		return path === null || !isHiddenPath(moderation, path)
	})
	const body = [head, ...kept].join(marker)
	return body.endsWith('\n') ? body : `${body}\n`
}
