import { createHash } from 'node:crypto'

/**
 * Text of published revisions over the files of the repository, by path from the repository root
 * (`docs/api.md`, `packages/meeko/README.md`). A file without an entry is read from Git.
 */
export type SourceOverlay = ReadonlyMap<string, string>

/** The overlay without revisions: every file comes from the repository. */
export const emptyOverlay: SourceOverlay = new Map()

/** A published revision as the overlay takes it. */
export interface OverlayRevision {
	/** Path of its file from the repository root, such as `docs/api.md`. */
	readonly file: string
	readonly markdown: string
}

/** Line endings as the renderer reads every file: `\n` only. */
export function normalizeText(text: string): string {
	return text.replace(/\r\n?/g, '\n')
}

/**
 * Normalizes a repository path: forward slashes, no leading `./` or `/`, no `.` or `..` segments.
 * Throws for an empty path or one that leaves the repository.
 */
export function normalizeSourcePath(path: string): string {
	const segments: string[] = []
	for (const segment of path.replaceAll('\\', '/').split('/')) {
		if (!segment || segment === '.') continue
		if (segment === '..') throw new TypeError(`A source path cannot leave the repository: ${path}`)
		segments.push(segment)
	}
	if (!segments.length) throw new TypeError('A source path cannot be empty')
	return segments.join('/')
}

/**
 * The overlay of a set of published revisions: their text by the normalized path of their file.
 * Two revisions of the same file are an error, as the database allows one published per source.
 */
export function createOverlay(revisions: Iterable<OverlayRevision>): SourceOverlay {
	const overlay = new Map<string, string>()
	for (const revision of revisions) {
		const file = normalizeSourcePath(revision.file)
		if (overlay.has(file)) throw new TypeError(`Two published revisions for ${file}`)
		overlay.set(file, normalizeText(revision.markdown))
	}
	return overlay
}

/**
 * A reader that returns the overlay's text for its files and `read(path)` for the rest. `resolve`
 * maps the path a caller uses to the key of the overlay (the package README is `README.md` for the
 * site and `packages/meeko/README.md` in the repository).
 */
export function overlayReader(read: (path: string) => string, overlay: SourceOverlay, resolve: (path: string) => string = normalizeSourcePath): (path: string) => string {
	if (!overlay.size) return read
	return (path) => overlay.get(resolve(path)) ?? read(path)
}

/** SHA-256 of a text, in hexadecimal, after normalizing its line endings. */
export function contentHash(text: string): string {
	return createHash('sha256').update(normalizeText(text), 'utf8').digest('hex')
}

/** An identity of an overlay's content: equal overlays have equal signatures. */
export function overlaySignature(overlay: SourceOverlay): string {
	if (!overlay.size) return ''
	const hash = createHash('sha256')
	for (const file of [...overlay.keys()].sort()) hash.update(`${file}\0${contentHash(overlay.get(file)!)}\n`)
	return hash.digest('hex')
}
