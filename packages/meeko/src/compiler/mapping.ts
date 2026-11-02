/** Segmento que relaciona una porción del módulo generado con el archivo .meeko. */
export interface SourceMapping {
	generatedStart: number
	generatedEnd: number
	originalStart: number
	originalLength: number
}

const markerToken = randomUUID().replaceAll('-', '')
const marker = new RegExp(`/\\*__MEEK_SOURCE_${markerToken}_(START|END):(\\d+):(\\d+)__\\*/`, 'g')

/** Marca código conservando la ubicación de su expresión o declaración original. */
export function markSource(code: string, originalStart: number, originalLength = code.length): string {
	return `/*__MEEK_SOURCE_${markerToken}_START:${originalStart}:${originalLength}__*/${code}/*__MEEK_SOURCE_${markerToken}_END:${originalStart}:${originalLength}__*/`
}

/** Retira marcas internas y produce el mapa de segmentos del módulo emitido. */
export function extractSourceMappings(markedCode: string): { code: string; mappings: SourceMapping[] } {
	const mappings: SourceMapping[] = []
	const open: Array<{ generatedStart: number; originalStart: number; originalLength: number }> = []
	const parts: string[] = []
	let generatedOffset = 0
	let cursor = 0
	for (const match of markedCode.matchAll(marker)) {
		const index = match.index
		const chunk = markedCode.slice(cursor, index)
		parts.push(chunk)
		generatedOffset += chunk.length
		const originalStart = Number(match[2])
		const originalLength = Number(match[3])
		if (match[1] === 'START') {
			open.push({ generatedStart: generatedOffset, originalStart, originalLength })
		} else {
			const span = open.pop()
			if (!span || span.originalStart !== originalStart || span.originalLength !== originalLength) {
				throw new Error('Invalid Meeko source mapping markers')
			}
			mappings.push({ ...span, generatedEnd: generatedOffset })
		}
		cursor = index + match[0].length
	}
	const tail = markedCode.slice(cursor)
	parts.push(tail)
	if (open.length !== 0) throw new Error('Unclosed Meeko source mapping marker')
	return { code: parts.join(''), mappings: mappings.sort((a, b) => a.generatedStart - b.generatedStart) }
}

/**
 * Expresión de plantilla cuyas referencias de carácter (`{x &amp;&amp; y}`) cambian su longitud.
 * Sus marcas usan posiciones del texto decodificado a partir de `offset`, su inicio en la fuente.
 */
export interface DecodedRegion {
	offset: number
	decoded: DecodedExpression
}

/**
 * Lleva a la fuente las marcas de las `regions`. Un tramo copiado tal cual se parte en los de
 * `decoded.pieces`, porque una marca no puede ir dentro de `&&` ni de una cadena; uno reescrito
 * (`(expr)`, locales de un snippet) conserva sus extremos.
 */
export function remapDecodedRegions(code: string, mappings: readonly SourceMapping[], regions: readonly DecodedRegion[]): SourceMapping[] {
	if (regions.length === 0) return [...mappings]
	const result: SourceMapping[] = []
	for (const mapping of mappings) {
		const region = regions.find(({ offset, decoded }) => mapping.originalStart >= offset && mapping.originalStart + mapping.originalLength <= offset + decoded.text.length)
		if (!region) {
			result.push(mapping)
			continue
		}
		const { offset, decoded } = region
		const start = mapping.originalStart - offset
		const end = start + mapping.originalLength
		if (code.slice(mapping.generatedStart, mapping.generatedEnd) !== decoded.text.slice(start, end)) {
			const sourceStart = expressionSourceOffset(decoded, start)
			result.push({ ...mapping, originalStart: offset + sourceStart, originalLength: decodedSourceEnd(decoded, end) - sourceStart })
			continue
		}
		for (const piece of decoded.pieces) {
			const from = Math.max(piece.start, start)
			const to = Math.min(piece.end, end)
			if (from >= to) continue
			const verbatim = piece.end - piece.start === piece.sourceEnd - piece.sourceStart
			result.push({
				generatedStart: mapping.generatedStart + from - start,
				generatedEnd: mapping.generatedStart + to - start,
				originalStart: offset + (verbatim ? piece.sourceStart + from - piece.start : piece.sourceStart),
				originalLength: verbatim ? to - from : piece.sourceEnd - piece.sourceStart,
			})
		}
	}
	return result.sort((a, b) => a.generatedStart - b.generatedStart)
}

/** Source end of the decoded text that ends at `position`. */
function decodedSourceEnd(decoded: DecodedExpression, position: number): number {
	if (position === 0) return 0
	const piece = decoded.pieces.find((candidate) => position > candidate.start && position <= candidate.end)
	if (!piece) return decoded.pieces.at(-1)?.sourceEnd ?? 0
	return piece.end - piece.start === piece.sourceEnd - piece.sourceStart ? piece.sourceStart + position - piece.start : piece.sourceEnd
}

/** Convierte un desplazamiento generado en uno del archivo .meeko si existe origen preciso. */
export function originalOffset(mappings: readonly SourceMapping[], generatedOffset: number): number | undefined {
	const span = mappings.filter((entry) => generatedOffset >= entry.generatedStart && generatedOffset < entry.generatedEnd).sort((a, b) => a.generatedEnd - a.generatedStart - (b.generatedEnd - b.generatedStart))[0]
	if (!span) return undefined
	return span.originalStart + Math.min(generatedOffset - span.generatedStart, Math.max(0, span.originalLength - 1))
}
import { randomUUID } from 'node:crypto'

import type { DecodedExpression } from './parser/template'

import { expressionSourceOffset } from './parser/template'
