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

/**
 * Decodifica un tramo crudo de un nodo de texto como lo hace el parser HTML: entidades y saltos
 * CRLF. Compilador y editor analizan el texto crudo para que sus posiciones coincidan con la
 * fuente, y decodifican sólo el contenido de cada parte.
 */
export function decodeTemplateText(raw: string): string {
  const normalized = raw.replace(/\r\n?/g, "\n");
  if (!normalized.includes("&")) return normalized;
  return (parseFragment(normalized).childNodes as Array<{ value?: string }>).map((node) => node.value ?? "").join("");
}

/**
 * Devuelve la posición absoluta donde empieza el valor de un atributo, con o sin comillas.
 * Es `undefined` si el atributo no tiene `=`. Compilador y editor la comparten para mapear directivas.
 */
export function attributeValueStart(source: string, attribute: Pick<TemplateAttribute, "start" | "end">): number | undefined {
  const raw = source.slice(attribute.start, attribute.end);
  const equals = raw.indexOf("=");
  if (equals < 0) return undefined;
  let index = equals + 1;
  while (index < raw.length && /\s/.test(raw[index]!)) index++;
  if (raw[index] === '"' || raw[index] === "'") index++;
  return attribute.start + index;
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
