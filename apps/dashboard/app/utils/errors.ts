import { isClientError } from '@meekojs/meeko/framework'

/** What went wrong, for a page or an action that could not finish. Serializable. */
export interface Failure {
	readonly code: string
	readonly message: string
	/** What the server reported, such as the frontmatter field that is missing; technical text. */
	readonly detail?: string
}

/** A read of a page: its data, or why it is missing. */
export type Attempt<T> = { readonly ok: true; readonly data: T } | { readonly ok: false; readonly failure: Failure }

const messages: Readonly<Record<string, string>> = {
	DATABASE_UNAVAILABLE: 'No se puede conectar con la base de documentación. Comprueba DATABASE_URL en apps/dashboard/.env y que voidcat-local:5432 responde.',
	SCHEMA_MISSING: 'La base no tiene las tablas de la documentación. Ejecuta pnpm -F meeko-site run db:migrate.',
	SOURCE_NOT_FOUND: 'Esa fuente no existe. Puede que una importación la haya cambiado de identificador.',
	SNAPSHOT_NOT_FOUND: 'Ese snapshot ya no existe: la retención de snapshots lo borró.',
	SNAPSHOT_EMPTY: 'Ese snapshot no tiene páginas y no se puede activar.',
	JOB_RUNNING: 'Hay una importación o publicación en curso. Espera a que termine.',
	JOBS_CLOSED: 'El servidor se está deteniendo.',
	INVALID_ORIGIN: 'El servidor rechazó la petición por su origen. Abre el dashboard desde su dirección habitual.',
	INVALID_CSRF: 'La sesión cambió en otra pestaña. Recarga la página y vuelve a intentarlo.',
	UNAUTHENTICATED: 'La sesión terminó (caducó, se cerró por inactividad o se cerró en otra pestaña). Recarga la página para volver a iniciar sesión.',
	SESSION_REVOKED: 'La sesión se cerró. Recarga la página para volver a iniciar sesión.',
	VALIDATION_ERROR: 'Los datos enviados no son válidos.',
	REVISION_NOT_FOUND: 'Esa revisión no existe o no es de esta fuente.',
	SOURCE_NOT_EDITABLE: 'Esta fuente no se puede editar desde el dashboard.',
	INVALID_REVISION: 'No se guardó: el Markdown no es válido para esta fuente.',
	REVISION_NOT_DRAFT: 'Solo se modifican los borradores: las revisiones publicadas y archivadas son historial. Crea un borrador nuevo a partir de ella.',
	DRAFT_CHANGED: 'Alguien guardó este borrador mientras lo editabas. No se sobrescribió: copia tus cambios, recarga y vuelve a aplicarlos.',
	REVISION_REJECTED: 'No se publicó: el site rechazaría esta revisión. La revisión publicada anterior sigue intacta.',
	MERGE_NOT_TRIVIAL: 'La fusión no es trivial: Git y la revisión cambiaron las mismas líneas. Resuélvela a mano en un borrador nuevo.',
	NO_CONFLICT: 'Esta revisión ya parte del Git actual: no hay nada que fusionar.',
	PREVIEW_FAILED: 'La vista previa falló.',
	PREVIEW_TIMEOUT: 'La vista previa tardó demasiado y se detuvo. Vuelve a intentarlo.',
	PREVIEW_CLOSED: 'El servidor se está deteniendo.',
	BODY_TOO_LARGE: 'El Markdown es demasiado grande para enviarlo (el límite de Meeko es 1 MiB por petición).',
	NETWORK_ERROR: 'No hay respuesta del servidor del dashboard.',
	INVALID_MODERATION: 'No se guardó: la regla o el aviso no son válidos.',
	UNKNOWN_PAGE: 'Esa web no tiene esa página. Importa las fuentes o publica un snapshot si es nueva.',
	MODERATION_NOT_FOUND: 'Esa regla o ese aviso ya no existen: otra persona lo borró. La lista ya muestra lo que hay ahora.',
	MODERATION_CONFLICT: 'Otra persona cambió esta regla o este aviso desde que cargaste la lista. No se guardó nada: la lista ya muestra su versión. Revísala; si vuelves a guardar, sustituirás ese cambio.',
	INVALID_RANGE: 'El rango de fechas no es válido: la fecha inicial debe ser anterior a la final y abarcar como mucho un año.',
	FEEDBACK_NOT_FOUND: 'Ese comentario ya no existe: otra persona lo borró. Recarga la lista.',
}

/** A message in Spanish for an error of the RPC, by its public code. */
export function describeError(error: unknown): Failure {
	if (isClientError(error)) {
		const issue = error.issues?.[0]?.message
		const known = messages[error.code]
		if (known) return issue ? { code: error.code, message: known, detail: issue } : { code: error.code, message: known }
		return { code: error.code, message: issue ?? `El servidor respondió con un error (${error.code}${error.requestId ? `, petición ${error.requestId}` : ''}).` }
	}
	if (error instanceof TypeError) return { code: 'NETWORK_ERROR', message: messages.NETWORK_ERROR! }
	return { code: 'UNKNOWN', message: 'Ocurrió un error inesperado. Revisa la consola del servidor.' }
}

/** The failure of a public `code` with its message, and the technical `detail` if any. */
export function failureOf(code: string, detail?: string): Failure {
	const message = messages[code] ?? `El servidor respondió con un error (${code}).`
	return detail ? { code, message, detail } : { code, message }
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
