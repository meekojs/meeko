import { isClientError } from '@meekojs/meeko/framework'

/**
 * What went wrong, for a page or an action that could not finish. Serializable: the server data of
 * a page carries it, so it holds no text in a language. The components say it in the language of
 * the document with {@link failureMessage} (app/utils/i18n.ts), by its code.
 */
export interface Failure {
	readonly code: string
	/** What the server reported, such as the frontmatter field that is missing; technical text or a catalog key. */
	readonly detail?: string
	/** The id of the request, for an unknown code. */
	readonly requestId?: string
}

/** A read of a page: its data, or why it is missing. */
export type Attempt<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly failure: Failure }

/** The failure of an error of the RPC, by its public code. */
export function describeError(error: unknown): Failure {
	if (isClientError(error)) {
		const issue = error.issues?.[0]?.message
		return { code: error.code, ...(issue ? { detail: issue } : {}), ...(error.requestId ? { requestId: error.requestId } : {}) }
	}
	if (error instanceof TypeError) return { code: 'NETWORK_ERROR' }
	return { code: 'UNKNOWN' }
}

/** The failure of a public `code`, and the technical `detail` if any. */
export function failureOf(code: string, detail?: string): Failure {
	return detail ? { code, detail } : { code }
}

/** A read that did not run because its input is already known to be invalid. */
export function failed(failure: Failure): Attempt<never> {
	return { ok: false, failure }
}

/** Runs a read and keeps its failure as data, so the page renders an error state instead of a 500. */
export async function attempt<T>(read: () => Promise<T>): Promise<Attempt<T>> {
	try {
		return { ok: true, data: await read() }
	} catch (error) {
		return { ok: false, failure: describeError(error) }
	}
}
