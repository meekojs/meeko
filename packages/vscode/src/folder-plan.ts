/** Clave del cliente que atiende los documentos que no pertenecen a ninguna carpeta del workspace. */
export const globalKey = 'global'

/** Cliente que debería existir para una carpeta del workspace, o el global. */
export interface PlannedClient {
	/** URI de la carpeta, o {@link globalKey}. */
	readonly key: string
	/** URI de la carpeta; `undefined` en el cliente global. */
	readonly folder?: string
	/**
	 * Carpetas cuyos documentos atiende otro cliente: las anidadas dentro de esta carpeta, o todas
	 * las del workspace en el cliente global. Si cambian, el cliente se reinicia para abrir y cerrar
	 * los documentos que gana o pierde.
	 */
	readonly excluded: readonly string[]
}

export interface ClientPlanInput {
	/** URIs de las carpetas del workspace, en su orden. */
	readonly folders: readonly string[]
	/** Hay algún documento abierto que no pertenece a ninguna carpeta. */
	readonly looseDocuments: boolean
	/** Compara las rutas `file:` sin distinguir mayúsculas; por defecto, sólo en Windows. */
	readonly ignoreCase?: boolean
}

/** Clientes por arrancar, detener y conservar al reconciliar. */
export interface ClientChanges {
	readonly stop: string[]
	readonly start: string[]
	readonly keep: string[]
}

function withSlash(uri: string): string {
	return uri.endsWith('/') ? uri : `${uri}/`
}

/** Windows compares the paths of `file:` URIs without case, as `workspace.getWorkspaceFolder` does. */
const windows = process.platform === 'win32'

/** Form of a folder URI to compare with: with a final slash, and lowercase where the case does not count. */
function comparable(uri: string, ignoreCase: boolean): string {
	const folder = withSlash(uri)
	return ignoreCase && /^file:/i.test(folder) ? folder.toLowerCase() : folder
}

/**
 * `true` si `uri` es la carpeta o está dentro de ella.
 *
 * @param folder URI de la carpeta.
 * @param uri URI de un documento o de otra carpeta.
 * @param ignoreCase Compara las rutas `file:` sin distinguir mayúsculas; por defecto, sólo en Windows.
 */
export function insideFolder(folder: string, uri: string, ignoreCase = windows): boolean {
	return comparable(uri, ignoreCase).startsWith(comparable(folder, ignoreCase))
}

/**
 * Carpeta más interna que contiene `uri`, la misma que devuelve `workspace.getWorkspaceFolder`
 * de VS Code con carpetas anidadas.
 */
export function innermostFolder(folders: readonly string[], uri: string, ignoreCase = windows): string | undefined {
	let found: string | undefined
	for (const folder of folders) {
		if (insideFolder(folder, uri, ignoreCase) && (found === undefined || withSlash(folder).length > withSlash(found).length)) found = folder
	}
	return found
}

/** Clave del cliente al que pertenece un documento: su carpeta más interna o el global. */
export function ownerKey(folders: readonly string[], uri: string, ignoreCase = windows): string {
	return innermostFolder(folders, uri, ignoreCase) ?? globalKey
}

/**
 * Un cliente por carpeta y, sólo si hace falta, el global: sin carpetas, o mientras hay documentos
 * abiertos fuera de ellas.
 */
export function planClients(input: ClientPlanInput): PlannedClient[] {
	const ignoreCase = input.ignoreCase ?? windows
	const planned: PlannedClient[] = input.folders.map((folder) => ({
		key: folder,
		folder,
		excluded: input.folders.filter((other) => comparable(other, ignoreCase) !== comparable(folder, ignoreCase) && insideFolder(folder, other, ignoreCase)),
	}))
	if (!input.folders.length || input.looseDocuments) planned.push({ key: globalKey, excluded: [...input.folders] })
	return planned
}

/**
 * Decide qué clientes cambian: se detienen los de carpetas retiradas o cuya firma (servidor y
 * opciones) cambió y se arrancan sólo los nuevos o cambiados. `force` reinicia todos.
 *
 * @param running Firma de cada cliente existente, también de los que no llegaron a arrancar.
 * @param wanted Firma de cada cliente que debe existir, en el orden de arranque.
 * @param force Reinicia también los clientes sin cambios.
 */
export function reconcileClients(running: ReadonlyMap<string, string>, wanted: ReadonlyMap<string, string>, force = false): ClientChanges {
	const changes: ClientChanges = { stop: [], start: [], keep: [] }
	for (const [key, signature] of running) {
		if (!force && wanted.get(key) === signature) changes.keep.push(key)
		else changes.stop.push(key)
	}
	for (const [key, signature] of wanted) {
		if (force || running.get(key) !== signature) changes.start.push(key)
	}
	return changes
}

/** Menor índice libre; cada cliente reserva así su puerto de depuración. */
export function freeSlot(used: Iterable<number>): number {
	const taken = new Set(used)
	let slot = 0
	while (taken.has(slot)) slot++
	return slot
}
