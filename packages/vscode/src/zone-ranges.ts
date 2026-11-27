/** Dónde se ejecutan las líneas de un `.meeko`, según el servidor de lenguaje. */
export type ExecutionZoneKind = 'server' | 'shared' | 'browser'

/** Zona de la respuesta de `meeko/executionZones`. */
export interface ExecutionZoneItem {
	readonly kind: ExecutionZoneKind
	readonly reason: string
	readonly label: string
	readonly detail: string
	readonly range: { readonly start: { readonly line: number; readonly character: number }; readonly end: { readonly line: number; readonly character: number } }
}

/** Tipos de zona, en el orden en que se decoran. */
export const executionZoneKinds: readonly ExecutionZoneKind[] = ['server', 'shared', 'browser']

/** Lo que el cálculo de rangos necesita saber del documento: cuántas líneas tiene y cuánto mide cada una. */
export interface ZoneDocumentLines {
	readonly lineCount: number
	/** Longitud de la línea `line` (base cero), sin el salto de línea. */
	lineLength(line: number): number
}

/** Rango de una decoración de zona; `hover` sólo acompaña a la primera línea de la zona. */
export interface ZoneDecorationRange {
	readonly startLine: number
	readonly startCharacter: number
	readonly endLine: number
	readonly endCharacter: number
	/** Explicación en Markdown de la zona. */
	readonly hover?: string
}

/** Texto en Markdown que explica una zona al pasar el cursor por su primera línea. */
export function zoneHover(zone: Pick<ExecutionZoneItem, 'label' | 'detail'>): string {
	return `**${zone.label}** · ${zone.detail}`
}

/**
 * Calcula los rangos de decoración de las zonas de un tipo. Cada zona se recorta a las líneas del
 * documento y produce un rango para su primera línea, con la explicación, y otro sin ella para el
 * resto: así el hover no se repite en cada línea de la zona.
 */
export function zoneDecorationRanges(zones: readonly ExecutionZoneItem[], kind: ExecutionZoneKind, document: ZoneDocumentLines): ZoneDecorationRange[] {
	return zones
		.filter((zone) => zone.kind === kind)
		.flatMap((zone): ZoneDecorationRange[] => {
			const last = Math.min(zone.range.end.line, document.lineCount - 1)
			const first = Math.min(zone.range.start.line, last)
			const ranges: ZoneDecorationRange[] = [{ startLine: first, startCharacter: 0, endLine: first, endCharacter: document.lineLength(first), hover: zoneHover(zone) }]
			if (last > first) ranges.push({ startLine: first + 1, startCharacter: 0, endLine: last, endCharacter: document.lineLength(last) })
			return ranges
		})
}

/**
 * Regla «gana la petición más reciente» por clave: cada petición recibe un turno y sólo la última
 * de su clave sigue vigente. Los turnos no se reutilizan, de modo que una petición en curso de una
 * clave olvidada queda descartada aunque la clave vuelva a usarse después.
 */
export class LatestRequests {
	private readonly latest = new Map<string, number>()
	private counter = 0

	/** Número de claves con una petición registrada. */
	get size(): number {
		return this.latest.size
	}

	/** Registra una petición nueva para `key` y devuelve su turno. */
	begin(key: string): number {
		const turn = ++this.counter
		this.latest.set(key, turn)
		return turn
	}

	/** Indica si `turn` sigue siendo la petición más reciente de `key`. */
	isCurrent(key: string, turn: number): boolean {
		return this.latest.get(key) === turn
	}

	/** Olvida `key`: sus peticiones en curso dejan de estar vigentes. */
	forget(key: string): void {
		this.latest.delete(key)
	}

	/** Olvida todas las claves. */
	clear(): void {
		this.latest.clear()
	}
}
