// The editor's unsaved changes, for the plugin that asks before a navigation of the app
// (app/plugins/unsaved.client.ts) and for `beforeunload`. One editor is open at a time.

let message: string | null = null

/** Marks the page as having unsaved changes, with the question to ask; `null` clears it. */
export function setUnsaved(question: string | null): void {
	message = question
}

/** The question to ask before leaving, or `null` when nothing is unsaved. */
export function unsavedQuestion(): string | null {
	return message
}
