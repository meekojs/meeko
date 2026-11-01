import type { Announcement, Database, ModerationRule } from 'meeko-docs-content/db'

import { ApiError } from '@meekojs/meeko/server'
import { announcementState, createAnnouncement, deleteAnnouncement, deleteModerationRule, listAnnouncements, listKnownPages, listModerationRules, ModerationError, saveModerationRule, setAnnouncementActive, updateAnnouncement } from 'meeko-docs-content/db'

import type { DocsSite } from '../../shared/schemas/dashboard'
import type { AnnouncementRow, ModerationRuleRow, ModerationView } from '../../shared/schemas/moderation'

import { databaseTask } from './errors'

/** The fields of a rule or an announcement: what the screen sends, signed with the user of the session. */
export interface RuleInput {
	readonly site: DocsSite
	readonly path: string
	readonly action: 'feature' | 'hide'
	readonly reason?: string | undefined
	readonly author: string
	/** The id of the rule of this page that the screen read, or `null` when it had none. */
	readonly id: number | null
	/** The version of that rule, or `null` when the page had none. */
	readonly version: number | null
}

export interface AnnouncementInput {
	readonly id?: number | undefined
	readonly version?: number | undefined
	readonly site: DocsSite
	readonly message: string
	readonly tone: 'danger' | 'info' | 'success' | 'warning'
	readonly startsAt: string | null
	readonly endsAt: string | null
	readonly active: boolean
	readonly author: string
}

const sites: readonly DocsSite[] = ['site', 'ui', 'i18n']

const ruleRow = (rule: ModerationRule, titles: ReadonlyMap<string, string>): ModerationRuleRow => ({
	id: rule.id,
	site: rule.site,
	path: rule.path,
	title: titles.get(rule.path) ?? null,
	action: rule.action,
	reason: rule.reason,
	author: rule.author,
	createdAt: rule.createdAt.toISOString(),
	version: rule.version,
})

const announcementRow = (item: Announcement, now: Date): AnnouncementRow => ({
	id: item.id,
	site: item.site,
	message: item.message,
	tone: item.tone,
	startsAt: item.startsAt?.toISOString() ?? null,
	endsAt: item.endsAt?.toISOString() ?? null,
	active: item.active,
	state: announcementState(item, now),
	author: item.author,
	createdAt: item.createdAt.toISOString(),
	version: item.version,
})

/**
 * Runs a write of the moderation with its refusals as public codes: `422 INVALID_MODERATION` (the
 * reason in `issues`), `422 UNKNOWN_PAGE`, `404 MODERATION_NOT_FOUND` and `409
 * MODERATION_CONFLICT`, when the rule or the announcement changed since the screen read it.
 */
export function moderationTask<T>(task: () => Promise<T>): Promise<T> {
	return databaseTask(async () => {
		try {
			return await task()
		} catch (error) {
			if (!(error instanceof ModerationError)) throw error
			if (error.code === 'not-found') throw new ApiError('MODERATION_NOT_FOUND', 404, error.message)
			if (error.code === 'conflict') throw new ApiError('MODERATION_CONFLICT', 409, error.message)
			if (error.code === 'unknown-page') throw new ApiError('UNKNOWN_PAGE', 422, error.message)
			throw new ApiError('INVALID_MODERATION', 422, { message: error.message, issues: [{ path: '', message: error.message }] })
		}
	})
}

/** The moderation of `site`: its known pages, its rules and its announcements, and the counters of every web. */
export async function readModeration(db: Database, site: DocsSite): Promise<ModerationView> {
	const [pages, rules, announcements] = await Promise.all([listKnownPages(db, site), listModerationRules(db), listAnnouncements(db)])
	const titles = new Map(pages.map((page) => [page.path, page.title]))
	const now = new Date()
	const rows = announcements.map((item) => announcementRow(item, now))
	const count = (name: DocsSite) => ({ rules: rules.filter((rule) => rule.site === name).length, live: rows.filter((row) => row.site === name && row.state === 'live').length })
	return {
		site,
		pages: pages.map((page) => ({ path: page.path, title: page.title, origin: page.origin })),
		rules: rules.filter((rule) => rule.site === site).map((rule) => ruleRow(rule, titles)),
		announcements: rows.filter((row) => row.site === site),
		counts: { site: count(sites[0]!), ui: count(sites[1]!), i18n: count(sites[2]!) },
	}
}

/**
 * Hides or features a page; the rule of that page, if any, is replaced while it is the rule the
 * screen read (same id) at the version it read. A rule deleted and created again is a conflict.
 */
export async function saveRule(db: Database, input: RuleInput): Promise<ModerationRuleRow> {
	const expected = input.id === null || input.version === null ? { expectedVersion: null } : { expectedId: input.id, expectedVersion: input.version }
	const rule = await saveModerationRule(db, { site: input.site, path: input.path, action: input.action, reason: input.reason ?? null, author: input.author }, expected)
	const pages = await listKnownPages(db, input.site)
	return ruleRow(rule, new Map(pages.map((page) => [page.path, page.title])))
}

/** Deletes a rule, while it has the version the screen read: the page shows again as its web has it. */
export async function removeRule(db: Database, id: number, version: number): Promise<ModerationRuleRow> {
	return ruleRow(await deleteModerationRule(db, id, { expectedVersion: version }), new Map())
}

/** Creates an announcement, or replaces the one of `input.id` while it has `input.version`. */
export async function saveAnnouncement(db: Database, input: AnnouncementInput): Promise<AnnouncementRow> {
	const fields = {
		site: input.site,
		message: input.message,
		tone: input.tone,
		startsAt: input.startsAt === null ? null : new Date(input.startsAt),
		endsAt: input.endsAt === null ? null : new Date(input.endsAt),
		active: input.active,
		author: input.author,
	}
	const item = input.id === undefined ? await createAnnouncement(db, fields) : await updateAnnouncement(db, input.id, fields, { expectedVersion: input.version })
	return announcementRow(item, new Date())
}

/** Switches an announcement on or off, while it has the version the screen read; nothing else changes. */
export async function switchAnnouncement(db: Database, id: number, version: number, active: boolean): Promise<AnnouncementRow> {
	return announcementRow(await setAnnouncementActive(db, id, active, { expectedVersion: version }), new Date())
}

/** Deletes an announcement, while it has the version the screen read. */
export async function removeAnnouncement(db: Database, id: number, version: number): Promise<AnnouncementRow> {
	return announcementRow(await deleteAnnouncement(db, id, { expectedVersion: version }), new Date())
}
