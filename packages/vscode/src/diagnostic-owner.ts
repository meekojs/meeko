import { globalKey } from './folder-plan'

/** Qué hacer con los diagnósticos que un servidor publica para un archivo. */
export type DiagnosticRoute = 'publish' | 'publish-loose' | 'drop'

export interface DiagnosticRouteInput {
	/** Clave del cliente que recibe la publicación: una carpeta o {@link globalKey}. */
	readonly client: string
	/** Clave del propietario del archivo: su carpeta más interna o {@link globalKey}. */
	readonly owner: string
	/** El cliente global existe y no ha fallado. */
	readonly globalActive: boolean
}

/**
 * Regla de propiedad de los diagnósticos. Un archivo de una carpeta sólo lo publica el cliente de
 * esa carpeta. Un archivo sin carpeta lo atiende el cliente global; mientras éste no existe se
 * conservan los de un servidor de carpeta (`publish-loose`, que se anotan para retirarlos si el
 * global arranca después), porque nadie más los daría. Con el global activo, un servidor de
 * carpeta no publica nada de esos archivos: el global ya los muestra y habría duplicados.
 */
export function routeDiagnostics({ client, owner, globalActive }: DiagnosticRouteInput): DiagnosticRoute {
	if (owner !== globalKey) return client === owner ? 'publish' : 'drop'
	if (client === globalKey) return 'publish'
	return globalActive ? 'drop' : 'publish-loose'
}

/**
 * Archivos sin carpeta cuyos diagnósticos publicó un servidor de carpeta, por cliente. Cuando el
 * global arranca se retiran de la colección de cada cliente para que no queden huérfanos.
 */
export class LooseDiagnostics {
	private readonly published = new Map<string, Set<string>>()

	/** Anota que `client` publicó diagnósticos de `uri`. */
	record(client: string, uri: string): void {
		const uris = this.published.get(client) ?? new Set<string>()
		uris.add(uri)
		this.published.set(client, uris)
	}

	/** Vacía lo anotado y lo devuelve por cliente, para borrarlo de sus colecciones. */
	takeAll(): Map<string, string[]> {
		const taken = new Map([...this.published].map(([client, uris]) => [client, [...uris]] as [string, string[]]))
		this.published.clear()
		return taken
	}

	/** Olvida lo de un cliente que se detiene: su colección desaparece con él. */
	forget(client: string): void {
		this.published.delete(client)
	}
}
