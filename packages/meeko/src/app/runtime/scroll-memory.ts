/** The member of `history.state` that names an entry. Anything else in the state belongs to someone else. */
const ENTRY = 'meekoEntry'
const STORAGE_KEY = 'meeko:scroll'
const MAX_ENTRIES = 200
/** How long a position beyond the end of the page waits for its content, such as a `deferred` value. */
const RESTORE_BUDGET_MS = 10_000
/** A browser rounds a position to device pixels, so `scrollY` can differ from what was asked. */
const SAME_POSITION_PX = 1

type Position = readonly [left: number, top: number]

/** Where the reader was in each history entry of the tab. */
export interface ScrollMemory {
	/** Reads the position of the page on screen, before anything can replace it. */
	note(): void
	/** Remembers the entry being left and returns the state of the new one, for `pushState`. */
	leave(): unknown
	/** Returns the state of the current entry with its name kept, for `replaceState`. */
	keep(): unknown
	/** After a traversal has painted its page, goes back to the entry's position. `false` if it has none. */
	arrive(): boolean
	dispose(): void
}

const inert: ScrollMemory = { note() {}, leave: () => null, keep: () => null, arrive: () => false, dispose() {} }

function isPosition(value: unknown): value is Position {
	return Array.isArray(value) && value.length === 2 && value.every((part) => typeof part === 'number' && Number.isFinite(part))
}

function readStored(browser: Window): Map<string, Position> {
	const entries = new Map<string, Position>()
	try {
		const stored: unknown = JSON.parse(browser.sessionStorage.getItem(STORAGE_KEY) ?? '{}')
		for (const [key, value] of Object.entries(stored as object)) if (isPosition(value)) entries.set(key, value)
	} catch {
		/* Without storage, or with something else in it: the memory only lasts as long as the document. */
	}
	return entries
}

/**
 * Keeps a position per history entry: the name of the entry goes in `history.state`, next to whatever
 * other code keeps there, and the positions in `sessionStorage`, because an entry that is being left
 * can no longer be written to. Between entries of a document Meeko scrolls by itself. On a reload or
 * a return from another document the browser does, and much earlier than hydration, so the entry on
 * screen goes back to `auto` when the page hides.
 *
 * @param browser The window. A host without a document or `scrollTo` gets an inert memory.
 * @param navigating Whether a navigation is in flight: the page on screen is not the current entry's.
 * @returns The memory of the tab.
 */
export function createScrollMemory(browser: Window, navigating: () => boolean): ScrollMemory {
	const root = (browser as Partial<Window>).document?.documentElement
	if (!root || typeof browser.scrollTo !== 'function') return inert
	const history = browser.history
	const entries = readStored(browser)
	let frame: number | undefined
	let position: Position = [browser.scrollX, browser.scrollY]

	/** The name of the current entry, given now if it has none. A state that is not an object is left alone. */
	const name = (): string | undefined => {
		const state: unknown = history.state
		if (state !== null && state !== undefined && typeof state !== 'object') return undefined
		const known = (state as Record<string, unknown> | null)?.[ENTRY]
		if (typeof known === 'string') return known
		const created = Math.random().toString(36).slice(2, 10)
		history.replaceState({ ...state, [ENTRY]: created }, '', browser.location.href)
		return created
	}
	let current = name()

	const note = (): void => {
		position = [browser.scrollX, browser.scrollY]
	}
	/** While a position is still being restored, the entry keeps the one it is heading to. */
	const remember = (): void => {
		if (current === undefined || frame !== undefined) return
		entries.delete(current)
		entries.set(current, position)
	}
	const cancel = (): void => {
		if (frame !== undefined) browser.cancelAnimationFrame(frame)
		frame = undefined
	}
	const restore = ([left, top]: Position): void => {
		cancel()
		const deadline = Date.now() + RESTORE_BUDGET_MS
		const step = (): void => {
			browser.scrollTo({ left, top, behavior: 'instant' })
			note()
			const placed = browser.scrollY
			if (Math.abs(placed - top) <= SAME_POSITION_PX || Date.now() > deadline) return
			frame = browser.requestAnimationFrame(() => {
				frame = undefined
				// Someone else moved the page: the reader, or code of the application. It is theirs now.
				if (Math.abs(browser.scrollY - placed) <= SAME_POSITION_PX) step()
			})
		}
		step()
	}
	/** Entries created without the navigator: a fragment link, or `pushState` of the application. */
	const onChange = (): void => {
		if (!navigating()) {
			const entry = name()
			if (entry !== current) {
				remember()
				current = entry
				// WebKit gives a fragment entry `auto`, and each entry has its own mode.
				history.scrollRestoration = 'manual'
			}
		}
		if (frame === undefined) note()
	}
	const save = (): void => {
		note()
		remember()
		try {
			browser.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries([...entries].slice(-MAX_ENTRIES))))
		} catch {
			/* Full or blocked storage: only a return to this document loses its position. */
		}
	}
	const onPageHide = (): void => {
		save()
		history.scrollRestoration = 'auto'
	}
	const onPageShow = (): void => {
		history.scrollRestoration = 'manual'
	}

	const stored = current === undefined ? undefined : entries.get(current)
	// `auto` means the browser restores this load, so a reader who already moved keeps the page. It did
	// nothing if the page is still at the top, as in WebKit on a reload, or if the content that reaches
	// that far is not there yet.
	if (stored && (history.scrollRestoration === 'manual' || browser.scrollY === 0 || root.scrollHeight - browser.innerHeight < stored[1] - SAME_POSITION_PX)) restore(stored)
	history.scrollRestoration = 'manual'
	browser.addEventListener('scroll', onChange, { passive: true })
	browser.addEventListener('hashchange', onChange)
	browser.addEventListener('pagehide', onPageHide)
	browser.addEventListener('pageshow', onPageShow)

	return {
		note() {
			if (frame === undefined) note()
		},
		leave() {
			remember()
			cancel()
			current = Math.random().toString(36).slice(2, 10)
			position = [0, 0]
			return { [ENTRY]: current }
		},
		keep() {
			const state: unknown = history.state
			return state !== null && state !== undefined && typeof state !== 'object' ? state : { ...state, [ENTRY]: current }
		},
		arrive() {
			remember()
			cancel()
			current = name()
			history.scrollRestoration = 'manual'
			const target = current === undefined ? undefined : entries.get(current)
			if (target) restore(target)
			return Boolean(target)
		},
		dispose() {
			cancel()
			save()
			history.scrollRestoration = 'auto'
			browser.removeEventListener('scroll', onChange)
			browser.removeEventListener('hashchange', onChange)
			browser.removeEventListener('pagehide', onPageHide)
			browser.removeEventListener('pageshow', onPageShow)
		},
	}
}
