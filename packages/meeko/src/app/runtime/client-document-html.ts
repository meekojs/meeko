import type { HydrationPayload } from './client-payload'

import { ndjsonLines } from './client-deferred'
import { readPayload } from './client-payload'

/** Where, in `sessionStorage`, a tab remembers its recovery reloads: a JSON list of `[url, time]`. */
const RELOAD_KEY = 'meeko:document-html-reload'

/** A reload this recent for the same URL did not help: another one would only repeat it. */
const RELOAD_WINDOW_MS = 60_000

/** How many URLs a tab may have reloaded within `RELOAD_WINDOW_MS`, which bounds what it stores. */
const RELOAD_LIMIT = 32

/** The URL no longer answers this document: only a new document can show what it should have. */
class StaleDocument extends Error {}

/** The reloads stored by this tab. Anything else in that key, damaged or not, counts as none. */
function storedReloads(stored: string | null): ReadonlyArray<readonly [string, number]> {
	try {
		const reloads: unknown = JSON.parse(stored ?? '[]')
		const valid = Array.isArray(reloads) && reloads.every((reload: unknown) => Array.isArray(reload) && typeof reload[0] === 'string' && Number.isFinite(reload[1]))
		return valid ? (reloads as Array<[string, number]>) : []
	} catch {
		return []
	}
}

/**
 * Claims the only reload a URL may have in `RELOAD_WINDOW_MS`, which keeps a page whose value differs
 * in every response from reloading forever, also when the tab visits other URLs in between. A failed
 * attempt does not renew it. Without storage the reload cannot be counted, so it is refused; with
 * `RELOAD_LIMIT` URLs in the window too, since forgetting one would give it another reload.
 */
function claimReload(browser: Window): boolean {
	const url = browser.location.href
	try {
		const now = Date.now()
		// A time ahead of the clock says nothing about this window: the clock went back.
		const recent = storedReloads(browser.sessionStorage.getItem(RELOAD_KEY)).filter(([, time]) => time <= now && now - time < RELOAD_WINDOW_MS)
		if (recent.length >= RELOAD_LIMIT || recent.some(([claimed]) => claimed === url)) return false
		browser.sessionStorage.setItem(RELOAD_KEY, JSON.stringify([...recent, [url, now]]))
		return true
	} catch {
		return false
	}
}

/** The HTML of every value that a navigation response declares marked, by identity. */
function declaredValues(response: unknown, declared: HydrationPayload['markedHtml']): ReadonlyMap<string, string> {
	const values = new Map<string, string>()
	for (const [identity, path] of Object.entries(declared)) {
		let value = response
		for (const key of path) value = typeof value === 'object' && value !== null ? (value as Record<string | number, unknown>)[key] : undefined
		if (typeof value === 'string') values.set(identity, value)
	}
	return values
}

/**
 * The payload of a response. A stream route answers ndjson, whose first line is the payload and has
 * every value that does not wait: that line is enough, and the rest of the stream is cancelled, so
 * a slow deferred value neither delays the element nor keeps the connection open.
 */
async function payloadText(response: Response, type: string, signal: AbortSignal): Promise<string> {
	if (!type.startsWith('application/meeko+ndjson')) return await response.text()
	if (!response.body) throw new StaleDocument('the stream is empty')
	const lines = ndjsonLines(response.body, signal)
	const line = await lines.next()
	await lines.return(undefined)
	if (line.done) throw new StaleDocument('the stream is empty')
	return line.value
}

export interface DocumentHtmlRecovery {
	/** The HTML of the value at `index` of the document's list; `undefined` when there is none to insert. */
	read(index: number): Promise<string | undefined>
	/** Abandons what is in flight, without reloading or reporting anything. */
	dispose(): void
}

/**
 * Recovers the `documentHtml` values of the first document, once one of its elements must paint
 * again. Only a value that the current navigation response declares marked, and whose identity is
 * the one this document names, is ever inserted: no position, route or value held by the browser
 * makes a string HTML.
 *
 * When the URL no longer answers that value (it was republished or removed, or the response is a
 * redirect, another route or not a Meeko payload), the page is out of date and nothing here can
 * repair it, so the document loads again, at most once per `RELOAD_WINDOW_MS`: that also takes the
 * user wherever the server now sends them. After that, the element stays empty and the error goes to
 * the navigation observer. A request that fails leaves the document valid, so it does not reload: it
 * reports the error and the next render of the element tries again.
 */
export function documentHtmlRecovery(options: { readonly browser: Window; readonly payload: HydrationPayload; readonly url: URL; readonly request: (url: URL, signal: AbortSignal) => Promise<Response>; readonly report: (error: unknown) => void }): DocumentHtmlRecovery {
	const { browser, payload, url, request, report } = options
	const work = new AbortController()
	/** Kept once it has the values: they are identified by their content, so they cannot go stale. */
	let values: Promise<ReadonlyMap<string, string>> | undefined
	const load = async (): Promise<ReadonlyMap<string, string>> => {
		const response = await request(url, work.signal)
		const type = (response.headers.get('content-type') ?? '').toLowerCase()
		// What this URL answers now is not this page: a redirect, a login, a page that is gone, or a
		// server that does not speak Meeko's protocol and has the value only in its document.
		const stale = response.redirected || (response.status >= 300 && response.status < 400) ? 'the request was redirected' : [401, 403, 404, 410].includes(response.status) ? `HTTP ${response.status}` : type.startsWith('text/html') ? 'the response is a document' : undefined
		if (stale) {
			void response.body?.cancel().catch(() => {})
			throw new StaleDocument(stale)
		}
		if (!response.ok) {
			void response.body?.cancel().catch(() => {})
			throw new Error(`Document HTML request failed: HTTP ${response.status}`)
		}
		const text = await payloadText(response, type, work.signal)
		let parsed: unknown
		let read: HydrationPayload
		try {
			parsed = JSON.parse(text)
			read = readPayload(parsed)
		} catch (cause) {
			throw new StaleDocument('the response is not a Meeko payload', { cause })
		}
		if (read.route !== payload.route) throw new StaleDocument(`the response is of route ${read.route}`)
		return declaredValues(parsed, read.markedHtml)
	}
	/** Several elements can wait for the same response; it reloads or reports only once. */
	let settled: Promise<unknown> | undefined
	const outdated = (response: Promise<unknown>, reason: string): void => {
		values = undefined
		if (settled === response) return
		settled = response
		if (claimReload(browser)) browser.location.reload()
		else report(new Error(`Document HTML could not be recovered, and loading the document again did not help: ${reason}. A value marked with documentHtml must be the same in the document and in the navigation response.`))
	}
	return {
		async read(index) {
			const identity = payload.documentHtml[index]
			if (identity === undefined) return undefined
			const response = (values ??= load())
			try {
				const declared = await response
				if (work.signal.aborted) return undefined
				const html = declared.get(identity)
				if (html === undefined) outdated(response, 'the response no longer declares this value')
				return html
			} catch (error) {
				if (work.signal.aborted) return undefined
				if (error instanceof StaleDocument) outdated(response, error.message)
				else {
					// The next render of the element tries again.
					values = undefined
					if (settled !== response) report(error)
					settled = response
				}
				return undefined
			}
		},
		dispose() {
			work.abort()
		},
	}
}
