// The change of <UIStat>: its direction, the text on screen and the one a screen reader says. A number is
// formatted with the locale of the document; a text comes formatted already, and its sign gives the direction.

import type { UIStatDirection } from '../types/data'

/** Where a value went: up, down or nowhere. */
export type StatDirection = UIStatDirection

/** The tone of a change: good, bad or neither. */
export type StatTone = 'danger' | 'neutral' | 'success'

/** A change ready to paint: its direction, the signed text on screen and the text without a sign. */
export interface StatChange {
	readonly direction: StatDirection
	/** On screen, with its sign: `+12,5 %`. */
	readonly shown: string
	/** Without a sign, for the sentence of its direction: `12,5 %`. */
	readonly magnitude: string
}

// A leading sign: ASCII, the minus sign, and the dashes some formatters put in its place.
const minus = /^\s*[-−‒–]\s*/
const plus = /^\s*\+\s*/

/** The formatters of a locale: as a percentage of 100 (`12.5` is `12,5 %`) or as the number itself. */
function formatters(locale: string, format: 'number' | 'percent'): { signed: Intl.NumberFormat; unsigned: Intl.NumberFormat } {
	const options: Intl.NumberFormatOptions = format === 'percent' ? { style: 'percent', maximumFractionDigits: 1 } : {}
	return { signed: new Intl.NumberFormat(locale, { ...options, signDisplay: 'exceptZero' }), unsigned: new Intl.NumberFormat(locale, { ...options, signDisplay: 'never' }) }
}

/**
 * The change of a stat. A number goes up above zero and down below it; one that rounds to zero is flat. A
 * text goes down with a leading minus, up with a plus or any other digit than zero, and is flat without one;
 * `direction` overrides both.
 */
export function statChange(change: number | string, { locale, format = 'percent', direction }: { readonly locale: string; readonly format?: 'number' | 'percent' | undefined; readonly direction?: StatDirection | undefined }): StatChange {
	if (typeof change === 'string') {
		const magnitude = change.replace(minus, '').replace(plus, '').trim()
		const sign: StatDirection = minus.test(change) ? 'down' : /[1-9]/.test(change) ? 'up' : 'flat'
		return { direction: direction ?? sign, shown: change.trim(), magnitude }
	}
	const { signed, unsigned } = formatters(locale, format)
	const value = format === 'percent' ? change / 100 : change
	const magnitude = unsigned.format(value)
	const zero = Number.isNaN(value) || magnitude === unsigned.format(0)
	return { direction: direction ?? (zero ? 'flat' : value > 0 ? 'up' : 'down'), shown: signed.format(zero ? 0 : value), magnitude }
}

/** Good when the value went the way it should, bad when it went the other way, neutral when it stayed. */
export function statTone(direction: StatDirection, good: 'down' | 'up' = 'up'): StatTone {
	if (direction === 'flat') return 'neutral'
	return direction === good ? 'success' : 'danger'
}
