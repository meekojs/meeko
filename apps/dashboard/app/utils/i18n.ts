// The texts of the dashboard in the language of the document for what the catalogs cannot name with
// a fixed key: an error code of the server, the message of a schema, the facts of a job.
import type { I18n } from '@meekojs/i18n'

import type { Job } from '../../shared/schemas/dashboard'
import type { Failure } from './errors'

/** The time zone of the project: the dates of the server render and the browser match. */
export const timeZone = 'Europe/Madrid'

/**
 * The key that explains a public code, in app/locales/<locale>/common.json. Only the form of a code:
 * `errors.title` is a text of the page, which a code from the server never reaches.
 */
function errorKey(code: string): string | undefined {
	return /^[A-Z][A-Z0-9_]*$/.test(code) ? `errors.${code}` : undefined
}

/**
 * Whether `text` has the form of a message that the schemas of shared/schemas and the server send as
 * a catalog key (`validation.*` and `issues.*`), so the client and the server answers say them in the
 * language of the page. Any other key of the catalogs is not theirs to name.
 */
const isIssueKey = (text: string): boolean => /^(?:validation|issues)\.\w+$/.test(text)

/**
 * A message that a datum names. `has` proved it exists, and the messages of these three families
 * take no values (tests/translations.test.ts): the types cannot tell, so this is its one key.
 */
type DataKey = 'errors.UNKNOWN'

/** A message of a schema or of the server: its text when it is a known key; any other (technical) text as is. */
export function issueText(i18n: I18n, message: string): string
export function issueText(i18n: I18n, message: string | undefined): string | undefined
export function issueText(i18n: I18n, message: string | undefined): string | undefined {
	return message !== undefined && isIssueKey(message) && i18n.has(message) ? i18n.t(message as DataKey) : message
}

/**
 * What a failure means for the reader, by its code (`errors.<CODE>`). A code the catalogs do not
 * explain gets the generic message with the code: the page never asks them for a key they lack.
 */
export function failureMessage(i18n: I18n, failure: Failure): string {
	const key = errorKey(failure.code)
	if (key !== undefined && i18n.has(key)) return i18n.t(key as DataKey)
	return failure.requestId ? i18n.t('errors.unknownCodeRequest', { code: failure.code, request: failure.requestId }) : i18n.t('errors.unknownCode', { code: failure.code })
}

/** What a finished job found, in the language of the page; `null` while it runs or without a result. */
export function jobSummary(i18n: I18n, job: Pick<Job, 'facts' | 'status' | 'summary'>): string | null {
	const facts = job.facts
	const n = (value: number) => i18n.number(value)
	if (!facts) return job.status === 'failed' && job.summary === null ? null : job.summary
	switch (facts.kind) {
		case 'import':
			return i18n.t('job.summary.import', { inserted: n(facts.inserted), updated: n(facts.updated), unchanged: n(facts.unchanged), removed: n(facts.removed), restored: n(facts.restored) })
		case 'publish': {
			const values = { id: facts.snapshotId, pages: n(facts.pages), es: n(facts.locales.es), en: n(facts.locales.en), translated: n(facts.translation.translated), outdated: n(facts.translation.outdated), missing: n(facts.translation.missing) }
			return facts.revisions ? i18n.t('job.summary.publishRevisions', { ...values, revisions: n(facts.revisions) }) : i18n.t('job.summary.publish', values)
		}
		case 'health':
			return i18n.t('job.summary.health', { pending: n(facts.pending), exports: n(facts.exports), broken: n(facts.broken), links: n(facts.links) })
		case 'conflict': {
			const name = (id: number | null) => (id === null ? i18n.t('job.summary.none') : `#${id}`)
			return facts.expected === facts.actual ? i18n.t('job.summary.reactivated', { from: name(facts.expected) }) : i18n.t('job.summary.conflict', { from: name(facts.expected), to: name(facts.actual) })
		}
	}
}
