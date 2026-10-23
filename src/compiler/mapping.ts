/** Segmento que relaciona una porción del módulo generado con el archivo .meeko. */
export interface SourceMapping {
  generatedStart: number;
  generatedEnd: number;
  originalStart: number;
  originalLength: number;
}

const markerToken = randomUUID().replaceAll("-", "");
const marker = new RegExp(`/\\*__MEEK_SOURCE_${markerToken}_(START|END):(\\d+):(\\d+)__\\*/`, "g");

/** Marca código conservando la ubicación de su expresión o declaración original. */
export function markSource(code: string, originalStart: number, originalLength = code.length): string {
  return `/*__MEEK_SOURCE_${markerToken}_START:${originalStart}:${originalLength}__*/${code}/*__MEEK_SOURCE_${markerToken}_END:${originalStart}:${originalLength}__*/`;
}

/** Retira marcas internas y produce el mapa de segmentos del módulo emitido. */
export function extractSourceMappings(markedCode: string): { code: string; mappings: SourceMapping[] } {
  const mappings: SourceMapping[] = [];
  const open: Array<{ generatedStart: number; originalStart: number; originalLength: number }> = [];
  const parts: string[] = [];
  let generatedOffset = 0;
  let cursor = 0;
  for (const match of markedCode.matchAll(marker)) {
    const index = match.index;
    const chunk = markedCode.slice(cursor, index);
    parts.push(chunk);
    generatedOffset += chunk.length;
    const originalStart = Number(match[2]);
    const originalLength = Number(match[3]);
    if (match[1] === "START") {
      open.push({ generatedStart: generatedOffset, originalStart, originalLength });
    } else {
      const span = open.pop();
      if (!span || span.originalStart !== originalStart || span.originalLength !== originalLength) {
        throw new Error("Invalid Meeko source mapping markers");
      }
      mappings.push({ ...span, generatedEnd: generatedOffset });
    }
    cursor = index + match[0].length;
  }
  const tail = markedCode.slice(cursor);
  parts.push(tail);
  if (open.length !== 0) throw new Error("Unclosed Meeko source mapping marker");
  return { code: parts.join(""), mappings: mappings.sort((a, b) => a.generatedStart - b.generatedStart) };
}

/** Convierte un desplazamiento generado en uno del archivo .meeko si existe origen preciso. */
export function originalOffset(mappings: readonly SourceMapping[], generatedOffset: number): number | undefined {
  const span = mappings
    .filter((entry) => generatedOffset >= entry.generatedStart && generatedOffset < entry.generatedEnd)
    .sort((a, b) => (a.generatedEnd - a.generatedStart) - (b.generatedEnd - b.generatedStart))[0];
  if (!span) return undefined;
  return span.originalStart + Math.min(generatedOffset - span.generatedStart, Math.max(0, span.originalLength - 1));
}
import { randomUUID } from "node:crypto";
