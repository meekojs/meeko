import { useI18n } from '@meekojs/i18n'

import { timeZone } from '../utils/i18n'

/**
 * The formats of the dashboard in the language of the document: dates in the time zone of the
 * project, so the server render and the browser write the same, and numbers.
 */
export function useFormat() {
	const i18n = useI18n()
	return {
		/** A date such as «31 oct 2026, 16:40» or «Oct 31, 2026, 4:40 PM»; `—` without one. */
		date(iso: string | null | undefined): string {
			if (!iso) return '—'
			const date = new Date(iso)
			return Number.isNaN(date.getTime()) ? '—' : i18n.date(date, { dateStyle: 'medium', timeStyle: 'short', timeZone })
		},
		number(value: number): string {
			return i18n.number(value)
		},
		/** A share from 0 to 1 as «67 %» or «67%». */
		percent(share: number): string {
			return i18n.number(Number.isFinite(share) ? share : 0, { style: 'percent', maximumFractionDigits: 0 })
		},
		/** A UTC day (`YYYY-MM-DD`) such as «1 oct 2026». */
		day(value: string, options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
			return i18n.date(new Date(`${value}T00:00:00Z`), { ...options, timeZone: 'UTC' })
		},
	}
}
