import type { DocsLocale } from '../locale'
import type { AnnouncementTone, ModerationAction, ModerationSite } from '../moderation/shared'
import type { Queryable } from './pool'

import { isDocsLocale } from '../locale'
import { announcementTones, moderationActions, moderationSites, pagePath } from '../moderation/shared'
import { database } from './pool'

/** A rule of `docs_moderation`: one per page of a site and language. */
export interface ModerationRule {
	readonly id: number
	readonly site: ModerationSite
	/** The language it applies to, or `null` for every language. */
	readonly locale: DocsLocale | null
	/** The path of the page without the language prefix. */
	readonly path: string
	readonly action: ModerationAction
	readonly reason: string | null
	readonly author: string
	/** When the rule was created or last changed. */
	readonly createdAt: Date
	/** 1 when created, plus one per change: what a later write names as {@link WriteOptions.expectedVersion}. */
	readonly version: number
}

/** A rule to create, or the new state of the rule of that page. */
export interface ModerationRuleInput {
	readonly site: ModerationSite
	/** The language it applies to, `null` for every language; Spanish when absent, as before. */
	readonly locale?: DocsLocale | null
	/** The path of the page without the language prefix (`/docs/api`, also for English). */
	readonly path: string
	readonly action: ModerationAction
	readonly reason?: string | null
	readonly author: string
}

/** An announcement of `docs_announcements`. */
export interface Announcement {
	readonly id: number
	readonly site: ModerationSite
	/** The language whose pages show it, or `null` for every language. */
	readonly locale: DocsLocale | null
	readonly message: string
	readonly tone: AnnouncementTone
	readonly startsAt: Date | null
	readonly endsAt: Date | null
	readonly active: boolean
	readonly author: string
	readonly createdAt: Date
	/** 1 when created, plus one per change: what a later write names as {@link WriteOptions.expectedVersion}. */
	readonly version: number
}

/**
 * The state a write of the dashboard starts from. With `expectedVersion`, the write applies only
 * while the row still has that version, so a change from an old tab cannot undo a newer one: it is
 * refused with `conflict`. `null` expects no row yet (a rule for a page without one). Without it,
 * the write is unconditional, as a script that owns the data does it.
 */
export interface WriteOptions {
	readonly expectedVersion?: number | null | undefined
}

/**
 * The state a write of a rule starts from. A rule is named by its page, and a page whose rule was
 * deleted and created again has a new rule at version 1 again: so a numeric `expectedVersion`
 * needs the `expectedId` of the rule that was read too, and the write applies only to that same
 * rule at that version.
 */
export interface RuleWriteOptions extends WriteOptions {
	readonly expectedId?: number | undefined
}

/** An announcement to create, or the new state of one. */
export interface AnnouncementInput {
	readonly site: ModerationSite
	/**
	 * The language whose pages show it, `null` for every language. When absent, a new one is
	 * Spanish, as before, and a change keeps the language it had.
	 */
	readonly locale?: DocsLocale | null
	readonly message: string
	readonly tone: AnnouncementTone
	readonly startsAt?: Date | null
	readonly endsAt?: Date | null
	readonly active: boolean
	readonly author: string
}

/** Whether an announcement shows now: `live`, `scheduled` (starts later), `ended` or `inactive` (switched off). */
export type AnnouncementState = 'ended' | 'inactive' | 'live' | 'scheduled'

/** A page a rule can name: a source of the site or a page of its active snapshot. */
export interface KnownPage {
	readonly path: string
	readonly title: string
	/** `source` for a page of `docs_sources`, `snapshot` for one that only the snapshot has (a generated reference page). */
	readonly origin: 'snapshot' | 'source'
}

/** Why a write of the moderation was refused: `conflict` when the row changed since it was read ({@link WriteOptions}). */
export type ModerationErrorCode = 'conflict' | 'invalid' | 'not-found' | 'unknown-page'

/** A write of the moderation that was refused, with a {@link ModerationErrorCode}. */
export class ModerationError extends Error {
	override readonly name = 'ModerationError'
	readonly code: ModerationErrorCode

	constructor(code: ModerationErrorCode, message: string) {
		super(message)
		this.code = code
	}
}

/** Lengths the schema accepts (`002_dashboard.sql`). */
export const moderationLimits = { path: 512, reason: 2000, author: 200, message: 500 } as const

interface RuleRow {
	readonly id: string
	readonly site: ModerationSite
	readonly locale: DocsLocale | null
	readonly path: string
	readonly action: ModerationAction
	readonly reason: string | null
	readonly author: string
	readonly created_at: Date
	readonly version: number
}

interface AnnouncementRow {
	readonly id: string
	readonly site: ModerationSite
	readonly locale: DocsLocale | null
	readonly message: string
	readonly tone: AnnouncementTone
	readonly starts_at: Date | null
	readonly ends_at: Date | null
	readonly active: boolean
	readonly author: string
	readonly created_at: Date
	readonly version: number
}

const rule = (row: RuleRow): ModerationRule => ({ id: Number(row.id), site: row.site, locale: row.locale, path: row.path, action: row.action, reason: row.reason, author: row.author, createdAt: row.created_at, version: row.version })

const ruleColumns = 'id, site, locale, path, action, reason, author, created_at, version'

const announcement = (row: AnnouncementRow): Announcement => ({
	id: Number(row.id),
	site: row.site,
	locale: row.locale,
	message: row.message,
	tone: row.tone,
	startsAt: row.starts_at,
	endsAt: row.ends_at,
	active: row.active,
	author: row.author,
	createdAt: row.created_at,
	version: row.version,
})

function invalid(message: string): never {
	throw new ModerationError('invalid', message)
}

function checkSite(site: string): ModerationSite {
	if (!(moderationSites as readonly string[]).includes(site)) invalid(`Unknown site: ${site}`)
	return site as ModerationSite
}

/** A language of a rule or an announcement: `undefined` is Spanish and `null` every language. */
function checkLocaleOrAll(locale: DocsLocale | null | undefined): DocsLocale | null {
	if (locale === undefined) return 'es'
	if (locale !== null && !isDocsLocale(locale)) invalid(`Unknown locale: ${String(locale)}`)
	return locale
}

/** A filter by language: `undefined` matches every row, `null` only the rules of every language. */
type LocaleFilter = { readonly locale?: DocsLocale | null }

function filterValues(filter: LocaleFilter): [boolean, DocsLocale | null] {
	if (filter.locale === undefined) return [false, null]
	return [true, checkLocaleOrAll(filter.locale)]
}

function checkAuthor(author: string): string {
	const value = author.trim()
	if (!value) invalid('The author is required')
	if (value.length > moderationLimits.author) invalid(`The author is longer than ${moderationLimits.author} characters`)
	return value
}

function checkId(id: number): number {
	if (!Number.isSafeInteger(id) || id < 1) invalid(`Invalid id: ${id}`)
	return id
}

function checkVersion(version: number | null | undefined): number | null | undefined {
	if (version !== undefined && version !== null && (!Number.isSafeInteger(version) || version < 1)) invalid(`Invalid version: ${version}`)
	return version
}

/** The refusal of a write whose row changed or left since it was read. */
function conflict(what: string): never {
	throw new ModerationError('conflict', `${what} changed since it was read`)
}

/**
 * The refusal of a write by id that touched no row: `conflict` when the row is still there with
 * another version, `not-found` when it is gone (another editor deleted it).
 */
async function refuse(db: Queryable, table: 'docs_announcements' | 'docs_moderation', id: number, what: string): Promise<never> {
	if ((await db.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).rows.length > 0) conflict(what)
	throw new ModerationError('not-found', `${what} does not exist`)
}

/**
 * The pages of `site` a rule can name: its sources that Git still has and, for `site`, the pages
 * of the active snapshot (the reference pages generated from the JSDoc have no source), without
 * `/llms.txt` and `/llms-full.txt`, with their titles in `locale` (Spanish by default). Their paths
 * have no language prefix. Sorted by path.
 */
export async function listKnownPages(db: Queryable = database(), site: ModerationSite, options: { readonly locale?: DocsLocale } = {}): Promise<KnownPage[]> {
	checkSite(site)
	// Every language has the pages of Spanish, translated or as a fallback; the titles are the language's.
	const locale = checkLocaleOrAll(options.locale) ?? 'es'
	const sources = await db.query<{ path: string; title: string }>(`SELECT DISTINCT ON (path) path, title FROM docs_sources WHERE site = $1 AND removed_at IS NULL AND locale IN ('es', $2) ORDER BY path, locale = $2 DESC`, [site, locale])
	const pages = new Map<string, KnownPage>()
	for (const row of sources.rows) pages.set(row.path, { path: row.path, title: row.title, origin: 'source' })
	if (site === 'site') {
		const snapshot = await db.query<{ path: string; title: string | null }>(
			`SELECT p.path, COALESCE(p.payload #>> '{written,title}', p.payload #>> '{page,name}', p.payload #>> '{doc,title}', p.payload #>> '{head,title}') AS title
			FROM docs_pages AS p JOIN docs_snapshots AS s ON s.id = p.snapshot_id
			WHERE s.active AND p.locale = $1 AND p.path NOT IN ('/llms.txt', '/llms-full.txt')`,
			[locale],
		)
		for (const row of snapshot.rows) if (!pages.has(row.path)) pages.set(row.path, { path: row.path, title: row.title ?? row.path, origin: 'snapshot' })
	}
	return [...pages.values()].sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * The rules of `site`, or of every site, by site, path and language. `locale` keeps the rules of
 * that language and the global ones; `null`, only the global ones.
 */
export async function listModerationRules(db: Queryable = database(), site?: ModerationSite, filter: LocaleFilter = {}): Promise<ModerationRule[]> {
	if (site !== undefined) checkSite(site)
	const [filtered, locale] = filterValues(filter)
	const result = await db.query<RuleRow>(
		`SELECT ${ruleColumns} FROM docs_moderation
		WHERE ($1::text IS NULL OR site = $1) AND (NOT $2 OR locale IS NULL OR locale = $3::text)
		ORDER BY site, path, locale NULLS FIRST`,
		[site ?? null, filtered, locale],
	)
	return result.rows.map(rule)
}

/**
 * Hides or features a page: creates the rule of `(site, locale, path)` or replaces the one it has, with
 * the new author and date, and adds one to its version. The path must be a page that
 * {@link listKnownPages} lists, unless `allowUnknown`, and the home page (`/`) cannot be hidden.
 * With `expectedVersion` (see {@link RuleWriteOptions}), `null` creates the rule only if the page
 * has none, and a number replaces it only while it is still the rule `expectedId` with that
 * version: one deleted and created again since it was read is another rule, and a conflict.
 *
 * @throws {ModerationError} `invalid` for a malformed field or a numeric `expectedVersion` without `expectedId`, `unknown-page` for a path the site does not have, `conflict` when the rule changed, left or was created again since it was read.
 */
export async function saveModerationRule(db: Queryable = database(), input: ModerationRuleInput, options: RuleWriteOptions & { readonly allowUnknown?: boolean } = {}): Promise<ModerationRule> {
	const site = checkSite(input.site)
	const locale = checkLocaleOrAll(input.locale)
	const path = pagePath(input.path.trim())
	if (!/^\/[^?#\s]*$/.test(path) || path.length > moderationLimits.path) invalid(`Invalid page path: ${input.path}`)
	if (!(moderationActions as readonly string[]).includes(input.action)) invalid(`Unknown action: ${input.action}`)
	if (input.action === 'hide' && path === '/') invalid('The home page of a site cannot be hidden')
	const reason = input.reason?.trim() || null
	if (reason !== null && reason.length > moderationLimits.reason) invalid(`The reason is longer than ${moderationLimits.reason} characters`)
	const author = checkAuthor(input.author)
	const expected = checkVersion(options.expectedVersion)
	const expectedId = options.expectedId === undefined ? undefined : checkId(options.expectedId)
	if (typeof expected === 'number' && expectedId === undefined) invalid('A rule written from the version it had names its id too')
	if (!options.allowUnknown && !(await listKnownPages(db, site, locale === null ? {} : { locale })).some((page) => page.path === path)) throw new ModerationError('unknown-page', `${site} has no page ${path}`)
	const values = [site, path, input.action, reason, author, locale]
	const name = `The rule of ${site} ${locale ?? 'all'} ${path}`
	if (expected === null) {
		const created = await db.query<RuleRow>(`INSERT INTO docs_moderation (site, path, action, reason, author, locale) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT ON CONSTRAINT docs_moderation_site_locale_path DO NOTHING RETURNING ${ruleColumns}`, values)
		return created.rows[0] ? rule(created.rows[0]) : conflict(name)
	}
	if (expected !== undefined) {
		const updated = await db.query<RuleRow>(
			`UPDATE docs_moderation SET action = $3, reason = $4, author = $5, created_at = now(), version = version + 1
			WHERE site = $1 AND path = $2 AND locale IS NOT DISTINCT FROM $6::text AND version = $7 AND id = $8 RETURNING ${ruleColumns}`,
			[...values, expected, expectedId],
		)
		return updated.rows[0] ? rule(updated.rows[0]) : conflict(name)
	}
	const result = await db.query<RuleRow>(
		`INSERT INTO docs_moderation (site, path, action, reason, author, locale) VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT ON CONSTRAINT docs_moderation_site_locale_path DO UPDATE SET action = EXCLUDED.action, reason = EXCLUDED.reason, author = EXCLUDED.author, created_at = now(), version = docs_moderation.version + 1
		RETURNING ${ruleColumns}`,
		values,
	)
	return rule(result.rows[0]!)
}

/**
 * Deletes a rule: the page shows as Git has it again. With `expectedVersion`, only while the rule
 * still has that version.
 *
 * @throws {ModerationError} `not-found` when the rule does not exist (another editor deleted it), `conflict` when it changed since it was read.
 */
export async function deleteModerationRule(db: Queryable = database(), id: number, options: WriteOptions = {}): Promise<ModerationRule> {
	const expected = checkVersion(options.expectedVersion)
	const result = await db.query<RuleRow>(`DELETE FROM docs_moderation WHERE id = $1 AND ($2::integer IS NULL OR version = $2) RETURNING ${ruleColumns}`, [checkId(id), expected ?? null])
	const row = result.rows[0]
	return row ? rule(row) : refuse(db, 'docs_moderation', id, `Moderation rule ${id}`)
}

function announcementValues(input: AnnouncementInput): unknown[] {
	const site = checkSite(input.site)
	if (input.locale !== undefined) checkLocaleOrAll(input.locale)
	const message = input.message.trim()
	if (!message) invalid('The message is required')
	if (message.length > moderationLimits.message) invalid(`The message is longer than ${moderationLimits.message} characters`)
	if (!(announcementTones as readonly string[]).includes(input.tone)) invalid(`Unknown tone: ${input.tone}`)
	const startsAt = input.startsAt ?? null
	const endsAt = input.endsAt ?? null
	for (const date of [startsAt, endsAt]) if (date !== null && Number.isNaN(date.getTime())) invalid('Invalid date')
	if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) invalid('The end must be after the start')
	return [site, message, input.tone, startsAt, endsAt, input.active, checkAuthor(input.author)]
}

const announcementColumns = 'id, site, locale, message, tone, starts_at, ends_at, active, author, created_at, version'

/**
 * The announcements of `site`, or of every site, newest first. `locale` keeps those its pages show
 * (that language and every language); `null`, only those of every language.
 */
export async function listAnnouncements(db: Queryable = database(), site?: ModerationSite, filter: LocaleFilter = {}): Promise<Announcement[]> {
	if (site !== undefined) checkSite(site)
	const [filtered, locale] = filterValues(filter)
	const result = await db.query<AnnouncementRow>(
		`SELECT ${announcementColumns} FROM docs_announcements
		WHERE ($1::text IS NULL OR site = $1) AND (NOT $2 OR locale IS NULL OR locale = $3::text)
		ORDER BY created_at DESC, id DESC`,
		[site ?? null, filtered, locale],
	)
	return result.rows.map(announcement)
}

/**
 * Creates an announcement. Without dates it shows while `active`; `startsAt` and `endsAt` bound it.
 *
 * @throws {ModerationError} `invalid` for an empty or long message, an unknown tone or an end that is not after the start.
 */
export async function createAnnouncement(db: Queryable = database(), input: AnnouncementInput): Promise<Announcement> {
	const result = await db.query<AnnouncementRow>(`INSERT INTO docs_announcements (site, message, tone, starts_at, ends_at, active, author, locale) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING ${announcementColumns}`, [...announcementValues(input), checkLocaleOrAll(input.locale)])
	return announcement(result.rows[0]!)
}

/**
 * Replaces an announcement with `input` and adds one to its version; the author becomes the one of
 * the change. `created_at` keeps the date it was created. With `expectedVersion`, only while it
 * still has that version.
 *
 * @throws {ModerationError} `not-found` when it does not exist, `conflict` when it changed since it was read, `invalid` as {@link createAnnouncement}.
 */
export async function updateAnnouncement(db: Queryable = database(), id: number, input: AnnouncementInput, options: WriteOptions = {}): Promise<Announcement> {
	const expected = checkVersion(options.expectedVersion)
	const result = await db.query<AnnouncementRow>(
		`UPDATE docs_announcements SET site = $2, message = $3, tone = $4, starts_at = $5, ends_at = $6, active = $7, author = $8, version = version + 1,
			locale = CASE WHEN $10 THEN $11::text ELSE locale END
		WHERE id = $1 AND ($9::integer IS NULL OR version = $9) RETURNING ${announcementColumns}`,
		[checkId(id), ...announcementValues(input), expected ?? null, input.locale !== undefined, input.locale ?? null],
	)
	const row = result.rows[0]
	return row ? announcement(row) : refuse(db, 'docs_announcements', id, `Announcement ${id}`)
}

/**
 * Switches an announcement on or off and changes nothing else: its message, tone, dates and author
 * stay as the database has them, whatever an old tab shows. It adds one to its version and, with
 * `expectedVersion`, applies only while it still has that version.
 *
 * @throws {ModerationError} `not-found` when it does not exist, `conflict` when it changed since it was read.
 */
export async function setAnnouncementActive(db: Queryable = database(), id: number, active: boolean, options: WriteOptions = {}): Promise<Announcement> {
	if (typeof active !== 'boolean') invalid('active must be true or false')
	const expected = checkVersion(options.expectedVersion)
	const result = await db.query<AnnouncementRow>(`UPDATE docs_announcements SET active = $2, version = version + 1 WHERE id = $1 AND ($3::integer IS NULL OR version = $3) RETURNING ${announcementColumns}`, [checkId(id), active, expected ?? null])
	const row = result.rows[0]
	return row ? announcement(row) : refuse(db, 'docs_announcements', id, `Announcement ${id}`)
}

/**
 * Deletes an announcement. With `expectedVersion`, only while it still has that version.
 *
 * @throws {ModerationError} `not-found` when it does not exist, `conflict` when it changed since it was read.
 */
export async function deleteAnnouncement(db: Queryable = database(), id: number, options: WriteOptions = {}): Promise<Announcement> {
	const expected = checkVersion(options.expectedVersion)
	const result = await db.query<AnnouncementRow>(`DELETE FROM docs_announcements WHERE id = $1 AND ($2::integer IS NULL OR version = $2) RETURNING ${announcementColumns}`, [checkId(id), expected ?? null])
	const row = result.rows[0]
	return row ? announcement(row) : refuse(db, 'docs_announcements', id, `Announcement ${id}`)
}

/** Whether `item` shows at `now`. */
export function announcementState(item: Pick<Announcement, 'active' | 'endsAt' | 'startsAt'>, now: Date = new Date()): AnnouncementState {
	if (!item.active) return 'inactive'
	if (item.endsAt && item.endsAt.getTime() <= now.getTime()) return 'ended'
	if (item.startsAt && item.startsAt.getTime() > now.getTime()) return 'scheduled'
	return 'live'
}
