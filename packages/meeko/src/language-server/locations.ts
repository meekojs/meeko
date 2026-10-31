import ts from "@typescript/typescript6";
import { TextDocument } from "vscode-languageserver-textdocument";
import type { Location, Range } from "vscode-languageserver/node";
import type { FeatureContext } from "./features";
import type { VirtualComponent } from "./model";

/** Rango fuente de un tramo generado; ambos extremos deben pertenecer a un mismo tramo mapeado. */
export function sourceRange(component: VirtualComponent, start: number, length: number): [number, number] | undefined {
  for (const span of component.spans) {
    if (start >= span.generatedStart && start + length <= span.generatedEnd) {
      return [span.sourceStart + start - span.generatedStart, span.sourceStart + start + length - span.generatedStart];
    }
  }
  return undefined;
}

export function toRange(document: TextDocument, start: number, end: number): Range {
  return { start: document.positionAt(start), end: document.positionAt(end) };
}

/** Ubicación LSP de un tramo de TypeScript, ya sea de un componente virtual o de un archivo real. */
export function locationOf(context: FeatureContext, fileName: string, span: ts.TextSpan): Location | undefined {
  const virtual = context.project.virtualEntry(fileName);
  if (virtual) {
    const range = sourceRange(virtual, span.start, span.length);
    const target = range && context.locate(virtual.filename);
    return range && target ? { uri: target.uri, range: toRange(target.document, range[0], range[1]) } : undefined;
  }
  const target = context.locate(fileName);
  return target ? { uri: target.uri, range: toRange(target.document, span.start, span.start + span.length) } : undefined;
}

