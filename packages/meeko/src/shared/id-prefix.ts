/** Valid `document.idPrefix`: a letter, then letters, digits, `-` or `_`. */
export function isIdPrefix(value: unknown): value is string {
	return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,31}$/.test(value)
}
