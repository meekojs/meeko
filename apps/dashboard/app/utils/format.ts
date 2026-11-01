const dateTime = new Intl.DateTimeFormat('es-ES', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Madrid' })
const number = new Intl.NumberFormat('es-ES')

/** A date of the dashboard, such as «31 oct 2026, 16:40», in the time zone of the project. */
export function formatDate(iso: string | null | undefined): string {
	if (!iso) return '—'
	const date = new Date(iso)
	return Number.isNaN(date.getTime()) ? '—' : dateTime.format(date)
}

export function formatNumber(value: number): string {
	return number.format(value)
}

/** The first characters of a SHA-256, enough to tell two versions apart. */
export function shortHash(hash: string | null | undefined): string {
	return hash ? hash.slice(0, 12) : '—'
}

/** «1 fuente», «3 fuentes». */
export function plural(count: number, one: string, many: string): string {
	return `${formatNumber(count)} ${count === 1 ? one : many}`
}
