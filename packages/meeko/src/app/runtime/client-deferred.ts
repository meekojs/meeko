import type { DeferredError, DeferredInternals, DeferredOutcome } from './deferred'

import { createDeferred, deferredSettle, deferredSource, extractDeferred, placeDeferred } from './deferred'

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A deferred value listed in the payload; `outcome` is absent while it is pending. */
export interface PayloadDeferred {
	readonly id: number
	readonly path: readonly (string | number)[]
	readonly outcome: DeferredOutcome | undefined
}

/** One settled value from a streamed `<script data-meeko-deferred>` or ndjson line. */
export interface DeferredLine {
	readonly id: number
	readonly outcome: DeferredOutcome
}

/** A stream that ended before sending a value, for example after a failed write on the server. */
const incompleteDeferred: DeferredError = { code: 'DEFERRED_INCOMPLETE', status: 502 }

function readDeferredError(value: unknown): DeferredError {
	if (!isRecord(value) || typeof value.code !== 'string' || typeof value.status !== 'number' || !Number.isInteger(value.status)) {
		throw new TypeError('Invalid Meeko deferred error')
	}
	return { code: value.code, status: value.status }
}

export function readDeferredEntries(value: unknown): PayloadDeferred[] {
	if (value === undefined) return []
	if (!Array.isArray(value)) throw new TypeError('Invalid Meeko deferred list')
	return value.map((entry: unknown) => {
		if (!isRecord(entry) || typeof entry.id !== 'number' || !Number.isSafeInteger(entry.id) || entry.id < 0 || !Array.isArray(entry.path) || !entry.path.every((key: unknown) => typeof key === 'string' || (typeof key === 'number' && Number.isSafeInteger(key)))) {
			throw new TypeError('Invalid Meeko deferred entry')
		}
		let outcome: DeferredOutcome | undefined
		if (entry.status === 'resolved') outcome = 'value' in entry ? { status: 'resolved', value: entry.value } : { status: 'resolved' }
		else if (entry.status === 'rejected') outcome = { status: 'rejected', error: readDeferredError(entry.error) }
		else if (entry.status !== 'pending') throw new TypeError('Invalid Meeko deferred status')
		return { id: entry.id, path: entry.path as (string | number)[], outcome }
	})
}

export function readDeferredLine(value: unknown): DeferredLine {
	if (!isRecord(value) || typeof value.deferred !== 'number' || !Number.isSafeInteger(value.deferred)) throw new TypeError('Invalid Meeko deferred chunk')
	const outcome: DeferredOutcome = 'error' in value ? { status: 'rejected', error: readDeferredError(value.error) } : 'value' in value ? { status: 'resolved', value: value.value } : { status: 'resolved' }
	return { id: value.deferred, outcome }
}

/** Puts a deferred value at each payload path; settled entries arrive settled. */
export function placePayloadDeferred(props: Record<string, unknown>, entries: readonly PayloadDeferred[]): Map<number, DeferredInternals> {
	const values = new Map<number, DeferredInternals>()
	for (const entry of entries) {
		if (values.has(entry.id)) throw new TypeError(`Duplicate Meeko deferred id ${entry.id}`)
		const value = createDeferred(entry.outcome)
		if (!placeDeferred(props, entry.path, value)) throw new TypeError(`Invalid Meeko deferred path ${JSON.stringify(entry.path)}`)
		values.set(entry.id, value)
	}
	return values
}

/**
 * Collects streamed values and applies them only after `open()`, once the
 * page that reads them has hydrated or committed. `end()` rejects whatever
 * never arrived.
 */
export function deferredReceiver(values: ReadonlyMap<number, DeferredInternals>, report: (error: unknown) => void) {
	let ready = false
	let ended = false
	const queue: DeferredLine[] = []
	const settle = (value: DeferredInternals, outcome: DeferredOutcome): void => {
		try {
			value[deferredSettle](outcome)
		} catch (error) {
			report(error)
		}
	}
	const apply = (line: DeferredLine): void => {
		const target = values.get(line.id)
		if (!target) report(new TypeError(`Unknown Meeko deferred id ${line.id}`))
		else settle(target, line.outcome)
	}
	const finish = (): void => {
		for (const value of values.values()) if (value.status === 'pending') settle(value, { status: 'rejected', error: incompleteDeferred })
	}
	return {
		receive(line: DeferredLine): void {
			if (ready) apply(line)
			else queue.push(line)
		},
		open(): void {
			if (ready) return
			ready = true
			for (const line of queue.splice(0)) apply(line)
			if (ended) finish()
		},
		end(): void {
			ended = true
			if (ready) finish()
		},
	}
}

type BrowserGlobals = Window & { MutationObserver: typeof MutationObserver }

/**
 * Reads `<script type="application/json" data-meeko-deferred>` chunks already
 * in the document and those the parser adds to `<body>` later. Only direct
 * children of `<body>` after `#meeko-payload` count: the server writes them
 * there, while page content (including injected markup) lives inside the app
 * root. A chunk whose text is still arriving is retried when it changes. The
 * parsed document ends at DOMContentLoaded; then `end` runs.
 */
export function watchDeferredChunks(browser: Window, receive: (line: DeferredLine) => void, end: () => void, report: (error: unknown) => void): () => void {
	const document = browser.document
	const Observer = (browser as BrowserGlobals).MutationObserver
	const seen = new WeakSet<Element>()
	const waiting = new Map<Element, MutationObserver>()
	let stopped = false
	const consume = (script: Element): void => {
		if (stopped || seen.has(script)) return
		let parsed: unknown
		try {
			parsed = JSON.parse(script.textContent ?? '')
		} catch {
			if (!waiting.has(script)) {
				const observer = new Observer(() => consume(script))
				observer.observe(script, { childList: true, characterData: true, subtree: true })
				waiting.set(script, observer)
			}
			return
		}
		seen.add(script)
		waiting.get(script)?.disconnect()
		waiting.delete(script)
		try {
			receive(readDeferredLine(parsed))
		} catch (error) {
			report(error)
		}
	}
	const isChunk = (element: Element): boolean => element.tagName === 'SCRIPT' && element.getAttribute('type') === 'application/json' && element.hasAttribute('data-meeko-deferred')
	const scan = (): void => {
		let afterPayload = false
		for (let element = document.body?.firstElementChild ?? null; element; element = element.nextElementSibling) {
			if (afterPayload) {
				if (isChunk(element)) consume(element)
			} else afterPayload = element.tagName === 'SCRIPT' && element.id === 'meeko-payload'
		}
	}
	const body = new Observer(scan)
	const stop = (): void => {
		if (stopped) return
		stopped = true
		body.disconnect()
		for (const observer of waiting.values()) observer.disconnect()
		waiting.clear()
		document.removeEventListener('DOMContentLoaded', complete)
	}
	const complete = (): void => {
		scan()
		if (stopped) return
		for (const script of waiting.keys()) report(new TypeError(`Invalid Meeko deferred chunk ${script.getAttribute('data-meeko-deferred') ?? ''}`))
		stop()
		end()
	}
	body.observe(document.body ?? document.documentElement, { childList: true })
	scan()
	if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', complete, { once: true })
	else complete()
	return stop
}

/** Splits an ndjson body into lines; aborting `signal` cancels the read. */
export async function* ndjsonLines(body: ReadableStream<Uint8Array>, signal: AbortSignal): AsyncGenerator<string> {
	const reader = body.getReader()
	const decoder = new TextDecoder()
	const cancel = (): void => {
		void reader.cancel(signal.reason).catch(() => {})
	}
	if (signal.aborted) cancel()
	else signal.addEventListener('abort', cancel, { once: true })
	let buffer = ''
	try {
		while (true) {
			const { done, value } = await reader.read()
			if (done || signal.aborted) break
			buffer += decoder.decode(value, { stream: true })
			for (let newline = buffer.indexOf('\n'); newline >= 0; newline = buffer.indexOf('\n')) {
				const line = buffer.slice(0, newline)
				buffer = buffer.slice(newline + 1)
				if (line.trim()) yield line
			}
		}
		buffer += decoder.decode()
		if (buffer.trim() && !signal.aborted) yield buffer
	} finally {
		signal.removeEventListener('abort', cancel)
		if (!signal.aborted) void reader.cancel().catch(() => {})
	}
}

/** Public shape of a browser-side failure, as `{ code, status }`. */
function clientDeferredError(error: unknown): DeferredError {
	if (typeof error === 'object' && error !== null) {
		const { code, status } = error as { code?: unknown; status?: unknown }
		if (typeof code === 'string' && code && typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599) return { code, status }
	}
	return { code: 'INTERNAL_ERROR', status: 500 }
}

/**
 * Settles deferred values returned by a loader that runs in the browser.
 * `signal` aborts when the route is left; a factory's signal also aborts on
 * its timeout.
 */
export function driveClientDeferred(data: unknown, report: (error: unknown) => void, signal: AbortSignal): void {
	for (const { deferred } of extractDeferred(data).found) {
		const source = deferred[deferredSource]
		if (!source) continue
		const work = new AbortController()
		let settled = false
		const settle = (outcome: DeferredOutcome, abandoned?: { readonly reason: unknown }): void => {
			if (settled) return
			settled = true
			clearTimeout(timer)
			signal.removeEventListener('abort', onAbort)
			if (abandoned) work.abort(abandoned.reason)
			try {
				deferred[deferredSettle](outcome)
			} catch (error) {
				report(error)
			}
		}
		const onAbort = (): void => settle({ status: 'rejected', error: clientDeferredError(signal.reason) }, { reason: signal.reason })
		const timer = setTimeout(() => settle({ status: 'rejected', error: { code: 'DEFERRED_TIMEOUT', status: 504 } }, { reason: new DOMException(`Deferred value did not settle within ${source.timeoutMs} ms`, 'TimeoutError') }), source.timeoutMs)
		if (signal.aborted) {
			onAbort()
			continue
		}
		signal.addEventListener('abort', onAbort, { once: true })
		source.start(work.signal).then(
			(value) => settle(value === undefined ? { status: 'resolved' } : { status: 'resolved', value }),
			(error: unknown) => settle({ status: 'rejected', error: clientDeferredError(error) }),
		)
	}
}
