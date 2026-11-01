import * as v from 'valibot'

import type { DocsSite } from '../../shared/schemas/dashboard'
import type { Failure } from './errors'

import { isCalendarDay, metricsInput } from '../../shared/schemas/metrics'
import { failureOf } from './errors'

/** A range of UTC days, both included, as `YYYY-MM-DD`. */
export interface DayRange {
	readonly from: string
	readonly to: string
}

const day = /^\d{4}-\d{2}-\d{2}$/
const dayMs = 86_400_000

/** Today in UTC, as `YYYY-MM-DD`: the metrics count by UTC day. */
export function todayUtc(now: number = Date.now()): string {
	return new Date(now).toISOString().slice(0, 10)
}

/** The `days` UTC days that end today. */
export function lastDays(days: number, now: number = Date.now()): DayRange {
	return { from: todayUtc(now - (days - 1) * dayMs), to: todayUtc(now) }
}

/**
 * The range of the URL: `from` and `to` when both look like days, or the last 30 days. A range
 * with the shape of days that is not valid (`2026-99-99`, reversed, longer than a year) is kept, so
 * the page shows why: {@link rangeFailure} tells it before any reading.
 */
export function defaultRange(from: string | undefined, to: string | undefined): DayRange {
	return from && to && day.test(from) && day.test(to) ? { from, to } : lastDays(30)
}

/** The presets of the range, as rows before a custom range. */
export const presets = [7, 30, 90].map((days) => ({
	label: `${days} días`,
	range: () => lastDays(days),
	matches: (range: DayRange) => {
		const expected = lastDays(days)
		return range.from === expected.from && range.to === expected.to
	},
}))

/** The address of the metrics of a web in a range. */
export function metricsHref(site: DocsSite, range: DayRange): string {
	const query = new URLSearchParams({ ...(site === 'site' ? {} : { site }), from: range.from, to: range.to })
	return `/metrics?${query}`
}

/**
 * Why the metrics of `site` cannot be read in `range`, checked before rendering or asking the
 * server (the same schema as the RPC): days that are not in the calendar, a reversed range or one
 * longer than a year are `INVALID_RANGE`. `null` when it is valid.
 */
export function rangeFailure(site: DocsSite, range: DayRange): Failure | null {
	const result = v.safeParse(metricsInput, { site, from: range.from, to: range.to })
	return result.success ? null : failureOf('INVALID_RANGE', result.issues[0].message)
}

/**
 * The page of a list to show after its total changed: `page` while it still exists, or the last one
 * that does (a mutation or a filter can leave fewer rows than the page starts at). At least 1.
 *
 * @example
 * ```ts
 * pageWithin(2, 25, 25) // 1: the only comment of page 2 left the list
 * ```
 */
export function pageWithin(page: number, total: number, pageSize: number): number {
	return Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / pageSize)))
}

const short = new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })

/** «1 oct 2026 – 30 oct 2026», or one day; «Rango no válido» when a day is not in the calendar. */
export function formatRange(range: DayRange): string {
	if (!isCalendarDay(range.from) || !isCalendarDay(range.to)) return 'Rango no válido'
	const from = short.format(new Date(`${range.from}T00:00:00Z`))
	const to = short.format(new Date(`${range.to}T00:00:00Z`))
	return from === to ? from : `${from} – ${to}`
}

const percentFormat = new Intl.NumberFormat('es-ES', { style: 'percent', maximumFractionDigits: 0 })

/** A share from 0 to 1 as «67 %». */
export function percent(share: number): string {
	return percentFormat.format(Number.isFinite(share) ? share : 0)
}
