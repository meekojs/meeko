import { contentHash, normalizeText } from './sources/overlay'

/** A line of a diff: kept, removed from the first text or added by the second. */
export interface DiffLine {
	readonly type: 'add' | 'equal' | 'remove'
	readonly text: string
}

/** Lines of a text without the empty line after its final newline. */
function lines(text: string): string[] {
	const normalized = normalizeText(text)
	if (!normalized) return []
	return (normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized).split('\n')
}

/**
 * The lines that turn `before` into `after`, by their longest common subsequence. Common lines at
 * both ends are matched first, so an edit in a long document compares only the changed middle.
 */
export function diffLines(before: string, after: string): DiffLine[] {
	const a = lines(before)
	const b = lines(after)
	let start = 0
	while (start < a.length && start < b.length && a[start] === b[start]) start++
	let endA = a.length
	let endB = b.length
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--
		endB--
	}
	const n = endA - start
	const m = endB - start
	if (n * m > 25_000_000) throw new RangeError('The texts differ in too many lines to compare')
	// lengths[i][j]: common subsequence of a[start + i…endA) and b[start + j…endB).
	const width = m + 1
	const lengths = new Uint32Array((n + 1) * width)
	for (let i = n - 1; i >= 0; i--) {
		for (let j = m - 1; j >= 0; j--) {
			lengths[i * width + j] = a[start + i] === b[start + j] ? lengths[(i + 1) * width + j + 1]! + 1 : Math.max(lengths[(i + 1) * width + j]!, lengths[i * width + j + 1]!)
		}
	}
	const result: DiffLine[] = a.slice(0, start).map((text) => ({ type: 'equal', text }))
	let i = 0
	let j = 0
	while (i < n && j < m) {
		if (a[start + i] === b[start + j]) {
			result.push({ type: 'equal', text: a[start + i]! })
			i++
			j++
		} else if (lengths[(i + 1) * width + j]! >= lengths[i * width + j + 1]!) {
			result.push({ type: 'remove', text: a[start + i]! })
			i++
		} else {
			result.push({ type: 'add', text: b[start + j]! })
			j++
		}
	}
	for (; i < n; i++) result.push({ type: 'remove', text: a[start + i]! })
	for (; j < m; j++) result.push({ type: 'add', text: b[start + j]! })
	for (const text of a.slice(endA)) result.push({ type: 'equal', text })
	return result
}

/** Options of {@link unifiedDiff}. */
export interface UnifiedDiffOptions {
	/** Name of the first text in the header, such as `a/docs/api.md`. */
	readonly from?: string
	/** Name of the second text in the header. */
	readonly to?: string
	/** Unchanged lines around each change (3 by default). */
	readonly context?: number
}

/** The unified diff of two texts, as `git diff` prints it; empty when they are equal. */
export function unifiedDiff(before: string, after: string, options: UnifiedDiffOptions = {}): string {
	const diff = diffLines(before, after)
	const context = options.context ?? 3
	const changed = diff.flatMap((line, index) => (line.type === 'equal' ? [] : [index]))
	if (!changed.length) return ''
	// Ranges of the diff to print, each change with its context, merging those that touch.
	const ranges: Array<[number, number]> = []
	for (const index of changed) {
		const from = Math.max(0, index - context)
		const to = Math.min(diff.length, index + context + 1)
		const last = ranges[ranges.length - 1]
		if (last && from <= last[1]) last[1] = Math.max(last[1], to)
		else ranges.push([from, to])
	}
	const out = [`--- ${options.from ?? 'a'}`, `+++ ${options.to ?? 'b'}`]
	// Line numbers in each text where the diff starts.
	const lineA: number[] = []
	const lineB: number[] = []
	let countA = 1
	let countB = 1
	for (const line of diff) {
		lineA.push(countA)
		lineB.push(countB)
		if (line.type !== 'add') countA++
		if (line.type !== 'remove') countB++
	}
	for (const [from, to] of ranges) {
		const hunk = diff.slice(from, to)
		const sizeA = hunk.filter((line) => line.type !== 'add').length
		const sizeB = hunk.filter((line) => line.type !== 'remove').length
		const startA = sizeA ? lineA[from]! : lineA[from]! - 1
		const startB = sizeB ? lineB[from]! : lineB[from]! - 1
		out.push(`@@ -${startA},${sizeA} +${startB},${sizeB} @@`)
		for (const line of hunk) out.push(`${line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}${line.text}`)
	}
	return `${out.join('\n')}\n`
}

/**
 * How the Markdown that the site shows relates to Git:
 *
 * - `missing`: the file no longer exists in Git.
 * - `git`: no published revision; the site shows Git.
 * - `same`: the published revision has the same text as Git.
 * - `edited`: the published revision differs, and Git has not changed since it was written.
 * - `conflict`: the published revision differs, and Git changed after it was written.
 */
export type DivergenceState = 'conflict' | 'edited' | 'git' | 'missing' | 'same'

/** Inputs of {@link divergence}. */
export interface DivergenceInput {
	/** The file in Git now, or `null` when it no longer exists. */
	readonly git: string | null
	/** Hash of the Markdown stored by the last import (`docs_sources.base_hash`). */
	readonly importedHash: string | null
	/** The published revision, or `null` when there is none. */
	readonly published: { readonly markdown: string; readonly baseHash: string | null } | null
	/** The file's path, for the diff header. */
	readonly file?: string
}

/** What {@link divergence} reports. */
export interface Divergence {
	readonly state: DivergenceState
	/** Git differs from the Markdown of the last import: import the sources again. */
	readonly importStale: boolean
	/** Lines the published revision adds to and removes from Git. */
	readonly added: number
	readonly removed: number
	/** Unified diff from Git to the published revision; empty without differences. */
	readonly diff: string
}

/** Compares the published revision of a source with its file in Git. */
export function divergence(input: DivergenceInput): Divergence {
	const gitHash = input.git === null ? null : contentHash(input.git)
	const importStale = gitHash !== input.importedHash
	if (input.git === null) return { state: 'missing', importStale, added: 0, removed: 0, diff: '' }
	if (!input.published) return { state: 'git', importStale, added: 0, removed: 0, diff: '' }
	const lines = diffLines(input.git, input.published.markdown)
	const added = lines.filter((line) => line.type === 'add').length
	const removed = lines.filter((line) => line.type === 'remove').length
	if (!added && !removed) return { state: 'same', importStale, added, removed, diff: '' }
	const file = input.file ?? 'source.md'
	const state = input.published.baseHash !== null && input.published.baseHash !== gitHash ? 'conflict' : 'edited'
	return { state, importStale, added, removed, diff: unifiedDiff(input.git, input.published.markdown, { from: `a/${file}`, to: `b/${file}` }) }
}

/** A change of one side over the base: base lines `[start, end)` become `lines`. */
interface Change {
	readonly start: number
	readonly end: number
	readonly lines: readonly string[]
}

/** The changes that turn `base` into `side`, by ranges of the base's lines. */
function changes(base: string, side: string): Change[] {
	const result: Change[] = []
	let at = 0
	let current: { start: number; end: number; lines: string[] } | null = null
	for (const line of diffLines(base, side)) {
		if (line.type === 'equal') {
			if (current) result.push(current)
			current = null
			at++
			continue
		}
		current ??= { start: at, end: at, lines: [] }
		if (line.type === 'remove') {
			at++
			current.end = at
		} else current.lines.push(line.text)
	}
	if (current) result.push(current)
	return result
}

const sameChange = (a: Change, b: Change): boolean => a.start === b.start && a.end === b.end && a.lines.length === b.lines.length && a.lines.every((line, index) => line === b.lines[index])

/** What {@link mergeThreeWay} returns. */
export type ThreeWayMerge =
	| {
			/** Both sides changed different parts of the base: `text` has both. */
			readonly clean: true
			readonly text: string
	  }
	| {
			readonly clean: false
			/** Places where both sides changed the same or neighbouring lines of the base differently. */
			readonly conflicts: number
	  }

/**
 * Joins the changes that `ours` and `theirs` made to `base`, as `git merge-file` does, only when
 * it is trivial: every change of one side touches lines of the base that the other side neither
 * changed nor borders. Changes that both sides made the same way count once. Anything else is a
 * conflict, and the caller decides by hand.
 */
export function mergeThreeWay(base: string, ours: string, theirs: string): ThreeWayMerge {
	let left: Change[]
	let right: Change[]
	try {
		left = changes(base, ours)
		right = changes(base, theirs)
	} catch (error) {
		// Texts too different to compare line by line are never a trivial merge.
		if (error instanceof RangeError) return { clean: false, conflicts: 1 }
		throw error
	}
	const merged: Change[] = []
	let conflicts = 0
	let i = 0
	let j = 0
	while (i < left.length || j < right.length) {
		const a = left[i]
		const b = right[j]
		if (a && b && sameChange(a, b)) {
			merged.push(a)
			i++
			j++
			continue
		}
		// Overlapping or touching ranges (an insertion at the edge of the other's change too).
		if (a && b && a.start <= b.end && b.start <= a.end) {
			conflicts++
			i++
			j++
			continue
		}
		if (a && (!b || a.end < b.start)) {
			merged.push(a)
			i++
		} else {
			merged.push(b!)
			j++
		}
	}
	if (conflicts) return { clean: false, conflicts }
	const original = lines(base)
	const out: string[] = []
	let at = 0
	for (const change of merged) {
		out.push(...original.slice(at, change.start), ...change.lines)
		at = change.end
	}
	out.push(...original.slice(at))
	return { clean: true, text: out.length ? `${out.join('\n')}\n` : '' }
}
