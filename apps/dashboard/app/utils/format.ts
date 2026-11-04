/** The first characters of a SHA-256, enough to tell two versions apart. */
export function shortHash(hash: string | null | undefined): string {
	return hash ? hash.slice(0, 12) : '—'
}
