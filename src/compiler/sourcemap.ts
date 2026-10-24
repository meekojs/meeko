import type { SourceMapping } from "./mapping.js";

const base64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function vlq(value: number): string {
  let bits = value < 0 ? (-value << 1) | 1 : value << 1;
  let output = "";
  do {
    let digit = bits & 31;
    bits >>>= 5;
    if (bits) digit |= 32;
    output += base64[digit]!;
  } while (bits);
  return output;
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let index = 0; index < source.length; index++) if (source[index] === "\n") starts.push(index + 1);
  return starts;
}

function position(starts: readonly number[], offset: number): { line: number; column: number } {
  let low = 0;
  let high = starts.length;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if (starts[middle]! <= offset) low = middle;
    else high = middle;
  }
  return { line: low, column: offset - starts[low]! };
}

/** Input sourcemap for Oxc: generated TypeScript locations point to the original SFC. */
export function sourceMapForCompiled(code: string, source: string, filename: string, mappings: readonly SourceMapping[]): object {
  const offsets: Array<number | undefined> = new Array(code.length);
  // Broad marks first; nested expression marks override them.
  for (const span of [...mappings].sort((a, b) => (b.generatedEnd - b.generatedStart) - (a.generatedEnd - a.generatedStart))) {
    for (let generated = span.generatedStart; generated < span.generatedEnd; generated++) {
      offsets[generated] = span.originalStart + Math.min(generated - span.generatedStart, Math.max(0, span.originalLength - 1));
    }
  }
  const sourceLines = lineStarts(source);
  const generatedLines = lineStarts(code);
  const rows: string[] = [];
  let previousOriginalLine = 0;
  let previousOriginalColumn = 0;
  for (let line = 0; line < generatedLines.length; line++) {
    const begin = generatedLines[line]!;
    const end = generatedLines[line + 1] === undefined ? code.length : generatedLines[line + 1]! - 1;
    const segments: string[] = [];
    let previousGeneratedColumn = 0;
    let mapped = false;
    for (let offset = begin; offset < end; offset++) {
      const original = offsets[offset];
      const generatedColumn = offset - begin;
      if (original === undefined) {
        if (mapped) {
          segments.push(vlq(generatedColumn - previousGeneratedColumn));
          previousGeneratedColumn = generatedColumn;
          mapped = false;
        }
        continue;
      }
      const { line: originalLine, column: originalColumn } = position(sourceLines, original);
      segments.push(vlq(generatedColumn - previousGeneratedColumn) + vlq(0) + vlq(originalLine - previousOriginalLine) + vlq(originalColumn - previousOriginalColumn));
      previousGeneratedColumn = generatedColumn;
      previousOriginalLine = originalLine;
      previousOriginalColumn = originalColumn;
      mapped = true;
    }
    rows.push(segments.join(","));
  }
  return { version: 3, file: `${filename}.ts`, sources: [filename], sourcesContent: [source], names: [], mappings: rows.join(";") };
}
