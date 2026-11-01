import { parseFragment } from "parse5";

import type { SfcSection } from "./sfc";

import { compileError, hyphenatedStandardElements, maskComponentTags, maskedFormTag, parseErrorMessage, snippetTableTags } from "./sfc";

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
  /** Namespace of an element, such as `http://www.w3.org/2000/svg` inside `<svg>`. */
  namespaceURI?: string;
  value?: string;
  attrs?: TemplateAttribute[];
  childNodes?: TemplateNode[];
  content?: { childNodes: TemplateNode[] };
  start: number;
  end: number;
  /** Nombre original de una etiqueta de componente (`AppButton`); `tagName` lo conserva igual. */
  componentName?: string;
  /**
   * La etiqueta se escribió autocerrada y no tiene etiqueta de cierre: un componente (`<Name />`),
   * `<component />`, `<render />`, `<snippet />` o, desde 1.8, un elemento HTML no vacío (`<div />`).
   * Los elementos vacíos (`<input />`) y los de SVG o MathML no lo llevan.
   */
  selfClosing?: boolean;
  sourceCodeLocation?: {
    startOffset: number;
    endOffset: number;
    attrs?: Record<string, { startOffset: number; endOffset: number }>;
    startTag?: { startOffset: number; endOffset: number };
    endTag?: { startOffset: number; endOffset: number };
  };
}

interface ParsedNode {
  nodeName: string;
  tagName?: string;
  namespaceURI?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: ParsedNode[];
  content?: { childNodes?: ParsedNode[] };
  sourceCodeLocation?: {
    startOffset: number;
    endOffset: number;
    attrs?: Record<string, { startOffset: number; endOffset: number }>;
    startTag?: { startOffset: number; endOffset: number };
    endTag?: { startOffset: number; endOffset: number };
  };
}

interface NormalizeContext {
  readonly source: string;
  readonly filename: string;
  readonly template: SfcSection;
  readonly selfClosing: ReadonlySet<number>;
  /** HTML elements written `<div />`, which the parser read with a masked name. */
  readonly elements: ReadonlySet<number>;
}

/** Hijos normalizados; los que el parser metió en un `<Name />` vuelven a ser hermanos. */
function normalizeChildren(nodes: readonly ParsedNode[], context: NormalizeContext): TemplateNode[] {
  const result: TemplateNode[] = [];
  for (const child of nodes) {
    const normalized = normalize(child, context);
    result.push(normalized);
    if (normalized.selfClosing && normalized.childNodes?.length) {
      result.push(...normalized.childNodes);
      normalized.childNodes = [];
    }
  }
  return result;
}

/** Recupera el nombre original de una etiqueta de componente y valida su cierre. */
function componentTagName(node: ParsedNode, context: NormalizeContext): string | undefined {
  const location = node.sourceCodeLocation;
  if (!node.tagName || !location || !node.tagName.startsWith("j")) return undefined;
  const content = context.template.content;
  const name = /^<([A-Z][\w$]*)/.exec(content.slice(location.startOffset, location.startOffset + 256))?.[1];
  if (!name) return undefined;
  const fail = (message: string, offset: number): never => {
    throw compileError(context.source, context.filename, "MEEK008", `HTML de plantilla no válido: ${message}`, context.template.contentStart + offset);
  };
  const endTag = location.endTag;
  if (endTag) {
    const closing = /^<\/([A-Z][\w$]*)/.exec(content.slice(endTag.startOffset, endTag.endOffset))?.[1];
    if (closing !== name) fail(`<${name}> se cierra con ${content.slice(endTag.startOffset, endTag.endOffset)}`, endTag.startOffset);
  } else if (!context.selfClosing.has(location.startOffset)) {
    fail(`<${name}> debe cerrarse con </${name}> o escribirse como <${name} />`, location.startOffset);
  }
  return name;
}

function normalize(node: ParsedNode, context: NormalizeContext): TemplateNode {
  const { template } = context;
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
  if (node.tagName === maskedFormTag && /^<\/?form/i.test(template.content.slice(location?.startOffset ?? 0, (location?.startOffset ?? 0) + 6))) {
    result.nodeName = "form";
    result.tagName = "form";
  } else if (node.tagName !== undefined) result.tagName = node.tagName;
  if (node.tagName?.startsWith("j") && location) {
    const original = /^<([a-z][\w-]*)/.exec(template.content.slice(location.startOffset, location.startOffset + 256))?.[1];
    if (original && snippetTableTags.has(original)) { result.nodeName = original; result.tagName = original; }
  }
  // An implied `<tbody>` has a null location.
  const element = location != null && context.elements.has(location.startOffset);
  if (element) {
    // `<div />` was read as `<jiv  >`; the source keeps its name.
    const original = /^<([a-z][^\s/>]*)/i.exec(template.content.slice(location.startOffset, location.startOffset + 256))?.[1]?.toLowerCase();
    if (original) { result.nodeName = original; result.tagName = original; }
    // `<td /></td>`: a table or list element keeps its name, so its own end tag would close it.
    if (location.endTag) {
      throw compileError(context.source, context.filename, "MEEK008", `HTML de plantilla no válido: <${original} /> ya está cerrada; quita ${template.content.slice(location.endTag.startOffset, location.endTag.endOffset)} o escribe <${original}></${original}>`, template.contentStart + location.endTag.startOffset);
    }
  }
  if (node.tagName !== undefined && node.namespaceURI !== undefined) result.namespaceURI = node.namespaceURI;
  const componentName = componentTagName(node, context);
  if (componentName !== undefined) {
    result.tagName = componentName;
    result.componentName = componentName;
  }
  if (node.value !== undefined) result.value = node.value;
  if (attrs !== undefined) result.attrs = attrs;
  if (node.childNodes !== undefined) result.childNodes = normalizeChildren(node.childNodes, context);
  if (node.content !== undefined) result.content = { childNodes: normalizeChildren(node.content.childNodes ?? [], context) };
  if (location !== undefined) result.sourceCodeLocation = location;
  if ((element || componentName !== undefined || node.tagName === "render" || node.tagName === "snippet" || node.tagName === "component" || result.tagName === "col") && location?.startTag && context.selfClosing.has(location.startOffset)) {
    // The parser kept `<Name />` or `<div />` open; the element ends with its start tag.
    result.selfClosing = true;
    result.end = template.contentStart + location.startTag.endOffset;
    result.sourceCodeLocation = { ...location, endOffset: location.startTag.endOffset };
  }
  return result;
}

/**
 * Decodifica un tramo crudo de un nodo de texto como lo hace el parser HTML: entidades y saltos
 * CRLF. Compilador y editor analizan el texto crudo para que sus posiciones coincidan con la
 * fuente, y decodifican sólo el contenido de cada parte. Un `<` del tramo queda como texto.
 */
export function decodeTemplateText(raw: string): string {
  return decodeTemplateExpression(raw.replace(/\r\n?/g, "\n")).text;
}

/**
 * Tramo de una expresión decodificada: `text.slice(start, end)` procede de `raw.slice(sourceStart, sourceEnd)`.
 * Un tramo sin referencias conserva la longitud; el de una referencia (`&lt;`) la cambia.
 *
 * @example
 * ```ts
 * decodeTemplateExpression("a &amp;&amp; b").pieces[1];
 * // { start: 2, end: 3, sourceStart: 2, sourceEnd: 7 }
 * ```
 */
export interface DecodedExpressionPiece {
  /** Inicio en el texto decodificado. */
  start: number;
  /** Fin, exclusivo, en el texto decodificado. */
  end: number;
  /** Inicio en el texto crudo. */
  sourceStart: number;
  /** Fin, exclusivo, en el texto crudo. */
  sourceEnd: number;
}

/**
 * Expresión de plantilla con sus referencias de carácter decodificadas y el mapa de cada tramo al texto crudo.
 *
 * @example
 * ```ts
 * const { text } = decodeTemplateExpression("a<b&&c");
 * // text === "a<b&&c"
 * ```
 */
export interface DecodedExpression {
  /** La expresión que se evalúa. */
  text: string;
  /** Los tramos de `text`, en orden y sin huecos. */
  pieces: DecodedExpressionPiece[];
}

/** A candidate character reference: `&name;`, `&#123;` or `&#x7b;`, with or without its `;`. */
const characterReference = /&(?:#[xX][\da-fA-F]*|#\d*|[A-Za-z][\dA-Za-z]*);?/g;

/**
 * Decodifica las referencias de carácter (`&lt;`, `&amp;`, `&#60;`) de una expresión de plantilla
 * como lo hace el parser HTML en el texto, pero sin interpretar marcado: `{a<b&&c}` o
 * `{"<b>" && x}` llegan completos. Los `pieces` permiten situar cada posición del texto
 * decodificado en la fuente, para diagnósticos y source maps. No normaliza los saltos CRLF.
 *
 * @example
 * ```ts
 * decodeTemplateExpression("x &amp;&amp; '&lt;'").text; // "x && '<'"
 * ```
 */
export function decodeTemplateExpression(raw: string): DecodedExpression {
  const pieces: DecodedExpressionPiece[] = [];
  let text = "";
  let cursor = 0;
  const push = (value: string, sourceEnd: number): void => {
    pieces.push({ start: text.length, end: text.length + value.length, sourceStart: cursor, sourceEnd });
    text += value;
    cursor = sourceEnd;
  };
  if (raw.includes("&")) {
    for (const match of raw.matchAll(characterReference)) {
      const reference = decodeCharacterReference(match[0]);
      if (!reference) continue;
      if (match.index > cursor) push(raw.slice(cursor, match.index), match.index);
      push(reference.value, match.index + reference.length);
    }
  }
  if (cursor < raw.length || pieces.length === 0) push(raw.slice(cursor), raw.length);
  return { text, pieces };
}

/**
 * Posición en el texto crudo de una posición del texto decodificado por `decodeTemplateExpression`.
 * Dentro de una referencia, apunta a su `&`.
 *
 * @example
 * ```ts
 * const decoded = decodeTemplateExpression("a &amp;&amp; b");
 * expressionSourceOffset(decoded, 5); // 13, la `b`
 * ```
 */
export function expressionSourceOffset(decoded: DecodedExpression, position: number): number {
  for (const piece of decoded.pieces) {
    if (position >= piece.end) continue;
    if (position < piece.start) break;
    return piece.end - piece.start === piece.sourceEnd - piece.sourceStart ? piece.sourceStart + position - piece.start : piece.sourceStart;
  }
  return decoded.pieces.at(-1)?.sourceEnd ?? 0;
}

const referenceCache = new Map<string, { value: string; length: number } | null>();

/**
 * The value of the reference at the start of `candidate` and the characters it takes, as the HTML
 * parser reads it in text (`&amp1` takes `&amp`). `undefined` when it is not a reference (`&b`).
 * The candidate has no `<`, so parsing it cannot open a tag.
 */
function decodeCharacterReference(candidate: string): { value: string; length: number } | undefined {
  const cached = referenceCache.get(candidate);
  if (cached !== undefined) return cached ?? undefined;
  const decode = (value: string): string => (parseFragment(value).childNodes as Array<{ value?: string }>).map((node) => node.value ?? "").join("");
  const whole = decode(candidate);
  let result: { value: string; length: number } | null = null;
  if (whole !== candidate) {
    // The shortest prefix that decodes and leaves the rest as it is: legacy names (`&amp`) need no `;`.
    for (let length = 2; length <= candidate.length && !result; length++) {
      const prefix = candidate.slice(0, length);
      const value = decode(prefix);
      if (value !== prefix && value + candidate.slice(length) === whole) result = { value, length };
    }
  }
  if (referenceCache.size > 512) referenceCache.clear();
  referenceCache.set(candidate, result);
  return result ?? undefined;
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

/**
 * A custom element (`<x-markdown>`): its name has a hyphen. `html` and `model` are directives only
 * on standard elements, where they are not valid HTML attributes; on a custom element they stay
 * the HTML attributes they were in 1.0. The compiler and the language server share this rule.
 */
export function isCustomElementTag(tag: string): boolean {
  return tag.includes("-") && !hyphenatedStandardElements.has(tag);
}

const impliedEndTag = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr", "p", "li", "dt", "dd", "option", "optgroup", "rb", "rp", "rt", "rtc"]);

/** Template element whose end tag starts at `offset`, at any depth. */
function templateEndingAt(node: ParsedNode, offset: number): ParsedNode | undefined {
  if (node.tagName === "template" && node.sourceCodeLocation?.endTag?.startOffset === offset) return node;
  for (const child of [...(node.childNodes ?? []), ...(node.content?.childNodes ?? [])]) {
    const found = templateEndingAt(child, offset);
    if (found) return found;
  }
  return undefined;
}

/**
 * Whether the elements still open when a nested `</template>` closes are `<Name />` components
 * (or elements without a required end tag), so the parse error is only an effect of the mask.
 */
function onlySelfClosingOpen(root: ParsedNode, offset: number, selfClosing: ReadonlySet<number>): boolean {
  const template = templateEndingAt(root, offset);
  if (!template || selfClosing.size === 0) return false;
  let current: { childNodes?: ParsedNode[] } | undefined = template.content;
  let found = false;
  while (current) {
    const last: ParsedNode | undefined = (current.childNodes ?? []).filter((child) => child.tagName !== undefined).at(-1);
    const location = last?.sourceCodeLocation;
    if (!last || !location || location.endTag) break;
    if (selfClosing.has(location.startOffset)) found = true;
    else if (!impliedEndTag.has(last.tagName!)) return false;
    current = last;
  }
  return found;
}

/** Analiza HTML y entrega un AST independiente del parser con posiciones originales. */
export function parseTemplate(source: string, template: SfcSection, filename: string): TemplateNode {
  const errors: Array<{ code: string; startOffset: number }> = [];
  const masked = maskComponentTags(template.content, { tableSnippets: true });
  const parsed = parseFragment(masked.text, {
    sourceCodeLocationInfo: true,
    onParseError(error) { errors.push({ code: error.code, startOffset: error.startOffset }); },
  }) as unknown as ParsedNode;
  // `</template>` reports a `<Name />` that the parser kept open; normalize closes it.
  const error = errors.find((item) => !(item.code === "closing-of-element-with-open-child-elements" && onlySelfClosingOpen(parsed, item.startOffset, masked.selfClosing)));
  if (error) throw compileError(source, filename, "MEEK008", `HTML de plantilla no válido: ${parseErrorMessage(error.code)}`, template.contentStart + error.startOffset);
  // The parser ignores a `</Name>` without its open tag; report it instead.
  const closed = new Set<number>();
  const collect = (node: ParsedNode): void => {
    const endTag = node.sourceCodeLocation?.endTag;
    if (endTag && node.tagName?.startsWith("j")) closed.add(endTag.startOffset);
    for (const child of [...(node.childNodes ?? []), ...(node.content?.childNodes ?? [])]) collect(child);
  };
  collect(parsed);
  const stray = masked.tags.find((offset) => template.content.startsWith("</", offset) && !closed.has(offset));
  if (stray !== undefined) {
    const tag = /^<\/[^\s>]*>?/.exec(template.content.slice(stray))?.[0] ?? "</";
    throw compileError(source, filename, "MEEK008", `HTML de plantilla no válido: ${tag} no cierra ninguna etiqueta de componente abierta`, template.contentStart + stray);
  }
  return normalize(parsed, { source, filename, template, selfClosing: masked.selfClosing, elements: masked.elements });
}
