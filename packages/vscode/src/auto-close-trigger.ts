/** Posición de un documento, con la forma de `vscode.Position` pero sin depender de `vscode`. */
export interface TagClosePosition {
	readonly line: number
	readonly character: number
}

/** Un cambio de contenido de `vscode.TextDocumentChangeEvent`: sólo lo que decide el cierre de etiquetas. */
export interface TagCloseChange {
	readonly text: string
	readonly rangeLength: number
}

/** Lo que el cierre automático necesita saber de un cambio de documento. */
export interface TagCloseEvent<Change extends TagCloseChange = TagCloseChange> {
	readonly languageId: string
	/** `'undo'` o `'redo'` cuando el cambio viene de deshacer o rehacer. */
	readonly reason: 'redo' | 'undo' | undefined
	readonly changes: readonly Change[]
}

/**
 * El cambio que dispara la petición de la etiqueta de cierre: el último de un documento `.meeko`
 * cuando inserta `>` o `/` sin reemplazar texto y no viene de deshacer o rehacer.
 */
export function tagCloseTrigger<Change extends TagCloseChange>(event: TagCloseEvent<Change>): Change | undefined {
	if (event.languageId !== 'meeko' || event.changes.length === 0) return undefined
	if (event.reason === 'undo' || event.reason === 'redo') return undefined
	const change = event.changes[event.changes.length - 1]!
	if ((change.text !== '>' && change.text !== '/') || change.rangeLength !== 0) return undefined
	return change
}

/** Dónde queda el cursor tras escribir el carácter: una columna después del inicio del cambio. */
export function tagClosePosition(start: TagClosePosition): TagClosePosition {
	return { line: start.line, character: start.character + 1 }
}

/** Estado del editor cuando llega la respuesta del servidor. */
export interface TagCloseResponse {
	readonly snippet: string | null | undefined
	/** El editor activo sigue mostrando el documento que hizo la petición. */
	readonly sameDocument: boolean
	readonly requestedVersion: number
	readonly currentVersion: number
	readonly requestedPosition: TagClosePosition
	/** El cursor del editor activo, o `undefined` sin editor. */
	readonly cursor: TagClosePosition | undefined
}

/**
 * Indica si la etiqueta de cierre aún puede insertarse: hay respuesta, el documento no cambió de
 * versión y el cursor sigue donde se pidió. Si se siguió escribiendo o el cursor salió de la
 * etiqueta, el cierre acabaría en otro sitio.
 */
export function tagCloseApplies(response: TagCloseResponse): boolean {
	const { cursor, requestedPosition } = response
	if (!response.snippet || !cursor || !response.sameDocument) return false
	if (response.currentVersion !== response.requestedVersion) return false
	return cursor.line === requestedPosition.line && cursor.character === requestedPosition.character
}
