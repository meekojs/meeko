// The logic of <UIDateRange>: calendar arithmetic on `YYYY-MM-DD` texts, the default shortcuts, the
// validation and what the template reads. Every date is a day number counted in UTC, so neither the time
// zone of the server nor that of the browser moves a day; only `localToday` reads the clock, and the
// component calls it after mounting, never while rendering.
import type { Signal } from '@meekojs/meeko'

import { computed, effect, signal, untrack } from '@meekojs/meeko'

import type { UIDateRangeIssue, UIDateRangePreset, UIDateRangeProps, UIDateRangeValue } from '../types/date-range'
import type { LocalizedUIMessages } from './messages'

import { fillMessage } from './messages'

const dayLength = 86_400_000
const datePattern = /^(\d{4})-(\d{2})-(\d{2})$/

/** The day number of a `YYYY-MM-DD` text (days since 1970-01-01), or `undefined` if it is not a real date. */
export function dayNumber(date: string): number | undefined {
	const match = datePattern.exec(date)
	if (!match) return undefined
	const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
	// setUTCFullYear, unlike Date.UTC, keeps the years 0 to 99; both carry over (February 30 is March 2).
	const parsed = new Date(0)
	const time = parsed.setUTCFullYear(year, month - 1, day)
	if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return undefined
	return time / dayLength
}

/** Whether a text is a real date `YYYY-MM-DD`. */
export const isDate = (date: string | undefined): date is string => date !== undefined && dayNumber(date) !== undefined

/** The `YYYY-MM-DD` text of a day number. */
export function dateOf(day: number): string {
	const date = new Date(day * dayLength)
	const year = String(date.getUTCFullYear()).padStart(4, '0')
	return `${year}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`
}

/** `date` moved `days` days, forwards or backwards. */
export const addDays = (date: string, days: number): string => dateOf(dayNumber(date)! + days)

/** The first day of the month of `date`. */
export const startOfMonth = (date: string): string => `${date.slice(0, 7)}-01`

/** The last day of the month of `date`, February 29 in a leap year. */
export function endOfMonth(date: string): string {
	const [year, month] = [Number(date.slice(0, 4)), Number(date.slice(5, 7))]
	// Day 0 of the next month is the last day of this one.
	const last = new Date(0)
	last.setUTCFullYear(year, month, 0)
	return `${date.slice(0, 7)}-${String(last.getUTCDate()).padStart(2, '0')}`
}

/** Days of a range, counting its first and its last: a single day is 1. */
export const rangeDays = (from: string, to: string): number => dayNumber(to)! - dayNumber(from)! + 1

/** Today in the time zone of this device, as `YYYY-MM-DD`. Only after mounting: it reads the clock. */
export function localToday(now: Date = new Date()): string {
	return `${String(now.getFullYear()).padStart(4, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

/** The texts of <UIDateRange> that its default shortcuts use. */
type PresetTexts = Pick<LocalizedUIMessages['dateRange'], 'today' | 'last7Days' | 'thisMonth' | 'previousMonth'>

/**
 * The default shortcuts: today; the last 7 days, today included; this month up to today; and the whole
 * previous month, which in January is December of the year before.
 */
export function defaultDateRangePresets(text: PresetTexts): readonly UIDateRangePreset[] {
	return [
		{ label: text.today, range: (today) => ({ from: today, to: today }) },
		{ label: text.last7Days, range: (today) => ({ from: addDays(today, -6), to: today }) },
		{ label: text.thisMonth, range: (today) => ({ from: startOfMonth(today), to: today }) },
		{
			label: text.previousMonth,
			range: (today) => {
				const last = addDays(startOfMonth(today), -1)
				return { from: startOfMonth(last), to: last }
			},
		},
	]
}

/** The limits of a range; a limit that is not a date `YYYY-MM-DD` does not apply. */
export interface DateRangeLimits {
	readonly min?: string | undefined
	readonly max?: string | undefined
	readonly maxDays?: number | undefined
}

/** What is wrong with a range, and which of its two dates says so. */
export interface DateRangeProblem {
	readonly issue: UIDateRangeIssue
	readonly from: boolean
	readonly to: boolean
}

/**
 * What is wrong with a range, or `undefined` if nothing is. Each date is checked alone against `min` and
 * `max`, also while the other one is missing; the order and `maxDays` need both. A date that is not
 * `YYYY-MM-DD` counts as missing, as the value of an unfinished native field is `''`.
 */
export function validateDateRange(range: UIDateRangeValue, limits: DateRangeLimits = {}): DateRangeProblem | undefined {
	const from = dayNumber(range.from)
	const to = dayNumber(range.to)
	const min = limits.min === undefined ? undefined : dayNumber(limits.min)
	const max = limits.max === undefined ? undefined : dayNumber(limits.max)
	const below = (day: number | undefined): boolean => day !== undefined && min !== undefined && day < min
	const above = (day: number | undefined): boolean => day !== undefined && max !== undefined && day > max
	if (below(from) || below(to)) return { issue: 'min', from: below(from), to: below(to) }
	if (above(from) || above(to)) return { issue: 'max', from: above(from), to: above(to) }
	if (from === undefined || to === undefined) return undefined
	if (from > to) return { issue: 'order', from: true, to: true }
	const maxDays = limits.maxDays
	if (maxDays !== undefined && Number.isFinite(maxDays) && maxDays >= 1 && to - from + 1 > maxDays) return { issue: 'length', from: true, to: true }
	return undefined
}

/** Whether a range has both dates and nothing wrong. */
export const isCompleteDateRange = (range: UIDateRangeValue, limits?: DateRangeLimits): boolean => isDate(range.from) && isDate(range.to) && validateDateRange(range, limits) === undefined

/** A date written for a sentence, in the language of the document and always in UTC; the text itself if `Intl` fails. */
export function formatDate(date: string, locale: string): string {
	const day = dayNumber(date)
	if (day === undefined) return date
	try {
		return new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(day * dayLength))
	} catch {
		return date
	}
}

/** The sentence of a problem, with its numbers and dates filled in. */
export function dateRangeMessage(issue: UIDateRangeIssue, text: LocalizedUIMessages['dateRange'], locale: string, limits: DateRangeLimits): string {
	if (issue === 'length') return fillMessage(text.tooLong, { days: new Intl.NumberFormat(locale).format(limits.maxDays ?? 0) })
	if (issue === 'min') return fillMessage(text.beforeMin, { min: formatDate(limits.min ?? '', locale) })
	if (issue === 'max') return fillMessage(text.afterMax, { max: formatDate(limits.max ?? '', locale) })
	return text.order
}

/** A shortcut as the template paints it. */
export interface DateRangePresetState {
	readonly key: number
	readonly label: string
	readonly pressed: boolean
	readonly apply: () => void
}

const same = (a: UIDateRangeValue | undefined, b: UIDateRangeValue | undefined): boolean => a !== undefined && b !== undefined && a.from === b.from && a.to === b.to

/**
 * What the template of `<UIDateRange>` reads and the component runs. `today` is a signal of the component:
 * the prop, or the local date once mounted. `emit` receives each complete and valid range the user leaves,
 * when it differs from the last one in place, whether the user or the parent put that one.
 */
export function createDateRange(props: UIDateRangeProps, models: { readonly from: Signal<string>; readonly to: Signal<string> }, messages: LocalizedUIMessages, emit: (range: UIDateRangeValue) => void) {
	const text = messages.dateRange
	const mountedToday = signal<string | undefined>(undefined)
	const today = computed(() => (isDate(props.today) ? props.today : mountedToday.value))
	const limits = (): DateRangeLimits => ({ min: props.min, max: props.max, maxDays: props.maxDays })
	const current = (): UIDateRangeValue => ({ from: models.from.value, to: models.to.value })

	const problem = computed(() => validateDateRange(current(), limits()))
	const message = computed(() => (problem.value ? dateRangeMessage(problem.value.issue, text, messages.locale, limits()) : ''))
	const fromInvalid = computed(() => props.invalid === true || problem.value?.from === true)
	const toInvalid = computed(() => props.invalid === true || problem.value?.to === true)

	const complete = (range: UIDateRangeValue): UIDateRangeValue | undefined => (isCompleteDateRange(range, limits()) ? range : undefined)
	/** The last complete and valid range in place: the one emitted, or one the parent wrote in between. */
	let settled = untrack(() => complete(current()))
	// The range now and the one before it, whoever wrote them: the `model` of a field writes the value before
	// its `input` event reaches the <fieldset>, so the edit needs the range that was there before.
	let latest = untrack(current)
	let previous = latest
	effect(() => {
		const range = current()
		untrack(() => {
			previous = latest
			latest = range
		})
	})

	/** Emits the range the user left if it is complete, valid and new; `before` is the one it replaced. */
	const settle = (before: UIDateRangeValue, next: UIDateRangeValue): void => {
		settled = complete(before) ?? settled
		const done = complete(next)
		if (done && !same(done, settled)) {
			settled = { from: done.from, to: done.to }
			emit(settled)
		}
	}

	const presetList = computed(() => props.presets ?? defaultDateRangePresets(text))
	const presets = computed<readonly DateRangePresetState[]>(() => {
		const day = today.value
		const range = current()
		return presetList.value.map((preset, key) => {
			const target = day === undefined ? undefined : preset.range(day)
			return {
				key,
				label: preset.label,
				pressed: same(target, range),
				apply: () => {
					if (!target) return
					const before = current()
					models.from.value = target.from
					models.to.value = target.to
					settle(before, target)
				},
			}
		})
	})

	return {
		today,
		presets,
		problem,
		message,
		fromInvalid,
		toInvalid,
		/** The `input` of a date, once its `model` has written it: a date, or `''` while it is unfinished. */
		edited: (): void => {
			const now = current()
			// The effect may have seen the edit already, or not yet.
			settle(same(latest, now) ? previous : latest, now)
		},
		/** Once mounted: the local date, which the shortcuts take while the prop `today` is missing. */
		mount: (): void => {
			mountedToday.value = localToday()
		},
	}
}
