import { parseFragment } from "parse5";
import { compileError } from "./sfc.js";
import type { SfcSection } from "./sfc.js";

/** Atributo normalizado de una etiqueta de plantilla. */
export interface TemplateAttribute {
  name: string;
  value: string;
  start: number;
  end: number;
}

/** Nodo propio de plantilla con límites absolutos en el archivo .meeko. */
export interface TemplateNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: TemplateAttribute[];
  childNodes?: TemplateNode[];
  content?: { childNodes: TemplateNode[] };
  start: number;
  end: number;
  sourceCodeLocation?: {
    startOffset: number;
    endOffset: number;
    attrs?: Record<string, { startOffset: number; endOffset: number }>;
  };
}

interface ParsedNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: ParsedNode[];
  content?: { childNodes?: ParsedNode[] };
  sourceCodeLocation?: {
    startOffset: number;
    endOffset: number;
    attrs?: Record<string, { startOffset: number; endOffset: number }>;
  };
}

function normalize(node: ParsedNode, template: SfcSection): TemplateNode {
  const location = node.sourceCodeLocation;
  const attrs = node.attrs?.map((attribute) => {
    const span = location?.attrs?.[attribute.name];
    return {
      name: attribute.name,
      value: attribute.value,
      start: template.contentStart + (span?.startOffset ?? location?.startOffset ?? 0),
      end: template.contentStart + (span?.endOffset ?? location?.endOffset ?? 0),
    };
  });
  const result: TemplateNode = {
    nodeName: node.nodeName,
    start: template.contentStart + (location?.startOffset ?? 0),
    end: template.contentStart + (location?.endOffset ?? template.content.length),
  };
  if (node.tagName !== undefined) result.tagName = node.tagName;
  if (node.value !== undefined) result.value = node.value;
  if (attrs !== undefined) result.attrs = attrs;
  if (node.childNodes !== undefined) result.childNodes = node.childNodes.map((child) => normalize(child, template));
  if (node.content !== undefined) result.content = { childNodes: (node.content.childNodes ?? []).map((child) => normalize(child, template)) };
  if (location !== undefined) result.sourceCodeLocation = location;
  return result;
}

/** Analiza HTML y entrega un AST independiente del parser con posiciones originales. */
export function parseTemplate(source: string, template: SfcSection, filename: string): TemplateNode {
  const errors: Array<{ code: string; startOffset: number }> = [];
  const parsed = parseFragment(template.content, {
    sourceCodeLocationInfo: true,
    onParseError(error) { errors.push({ code: error.code, startOffset: error.startOffset }); },
  }) as unknown as ParsedNode;
  const error = errors[0];
  if (error) throw compileError(source, filename, "MEEK008", `Invalid template HTML: ${error.code}`, template.contentStart + error.startOffset);
  return normalize(parsed, template);
}
