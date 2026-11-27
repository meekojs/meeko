import { globalKey } from './folder-plan'

/** Qué hacer con los diagnósticos que un cliente publica de un documento. */
export interface DiagnosticRoute {
	/** El cliente los muestra. */
	readonly accept: boolean
	/** Cliente que mostraba los de ese documento y debe retirarlos. */
	readonly evict?: string
}

/**
 * Decide qué cliente muestra los diagnósticos de cada documento, para que ninguno salga dos veces.
 *
 * Un documento de una carpeta sólo los recibe del cliente de su carpeta. Un servidor también
 * publica de archivos fuera de su carpeta (el `meeko.config.ts` de un proyecto que empieza más
 * arriba, un componente importado de otra ruta): esos documentos pertenecen al cliente global, que
 * puede no existir, así que los muestra un solo cliente a la vez: el primero que los publica, o el
 * global en cuanto publica los suyos.
 */
export class DiagnosticOwners {
	/** Client that shows the diagnostics of each document outside the workspace folders. */
	private readonly holders = new Map<string, string>()

	/**
	 * @param client Clave del cliente que publica.
	 * @param owner Clave del cliente al que pertenece el documento.
	 * @param uri URI del documento.
	 * @param count Número de diagnósticos publicados; `0` los retira.
	 */
	route(client: string, owner: string, uri: string, count: number): DiagnosticRoute {
		if (owner !== globalKey) return { accept: client === owner }
		const holder = this.holders.get(uri)
		if (count === 0) {
			// Clearing is harmless for a client that shows nothing, and frees the document for another.
			if (holder === client) this.holders.delete(uri)
			return { accept: true }
		}
		if (holder === undefined || holder === client) {
			this.holders.set(uri, client)
			return { accept: true }
		}
		if (client !== globalKey) return { accept: false }
		this.holders.set(uri, client)
		return { accept: true, evict: holder }
	}

	/**
	 * Olvida un cliente detenido: su colección de diagnósticos desaparece con él.
	 *
	 * @param client Clave del cliente.
	 */
	forget(client: string): void {
		for (const [uri, holder] of this.holders) {
			if (holder === client) this.holders.delete(uri)
		}
	}
}
