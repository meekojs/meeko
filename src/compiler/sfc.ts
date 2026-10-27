import { parseFragment } from "parse5";

/** Ubicación de un diagnóstico en el archivo .meeko original. */
export interface SourceLocation {
  offset: number;
  line: number;
  column: number;
}

/** Error de compilación con ubicación y código estable para herramientas. */
export interface CompileDiagnostic {
  code: string;
  message: string;
  filename: string;
  location: SourceLocation;
}

/** Error que conserva el diagnóstico estructurado para CLI y editor. */
export class MeekoCompileError extends Error {
  readonly diagnostic: CompileDiagnostic;

  constructor(diagnostic: CompileDiagnostic) {
    super(`${diagnostic.filename}:${diagnostic.location.line}:${diagnostic.location.column} ${diagnostic.code}: ${diagnostic.message}`);
    this.name = "MeekoCompileError";
    this.diagnostic = diagnostic;
  }
}

interface ParseLocation {
  startOffset: number;
  endOffset: number;
  startTag?: { endOffset: number };
  endTag?: { startOffset: number };
}

interface ParsedNode {
  nodeName: string;
  tagName?: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  sourceCodeLocation?: ParseLocation;
  childNodes?: ParsedNode[];
}

/** Una sección SFC con posiciones conservadas en el archivo fuente. */
export interface SfcSection {
  name: "script" | "server" | "template" | "style";
  start: number;
  end: number;
  content: string;
  contentStart: number;
  contentEnd: number;
  attributes: ReadonlyArray<{ name: string; value: string }>;
  /**
   * The file has no such section: an empty `<script lang="ts">` stands in for it, at the
   * start of the `<template>`, with no source text. Tools that edit or print sections skip it.
   */
  implicit?: true;
}

/** Estructura validada de las secciones de un componente. */
export interface SfcDocument {
  /** `<script lang="ts">`; optional in the file, where its absence is an empty, `implicit` setup. */
  script: SfcSection;
  /** `<script server lang="ts">` de una página: opciones de ruta que nunca entran al componente. */
  server?: SfcSection;
  template: SfcSection;
  style?: SfcSection;
}

/** Convierte un desplazamiento UTF-16 en línea y columna, empezando en uno. */
export function locate(source: string, offset: number): SourceLocation {
  const before = source.slice(0, offset);
  const lines = before.split(/\r\n|\r|\n/);
  return { offset, line: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 };
}

/** Crea un error de compilación asociado al archivo original. */
export function compileError(source: string, filename: string, code: string, message: string, offset: number): MeekoCompileError {
  return new MeekoCompileError({ code, message, filename, location: locate(source, offset) });
}

/** HTML que el parser lee en lugar del original, con las mismas posiciones. */
export interface MaskedHtml {
  readonly text: string;
  /** Inicio de cada etiqueta de componente escrita como `<Name />`. */
  readonly selfClosing: ReadonlySet<number>;
  /** Inicio de cada etiqueta de componente, de apertura o de cierre. */
  readonly tags: readonly number[];
}

const rawTextElement = /<(?:script|style|textarea|title|xmp|iframe|noembed|noframes|noscript|plaintext)(?=[\s/>])/iy;
const componentTag = /<(\/?)[A-Z][\w$]*(?=[\s/>])/y;
// A capital first letter makes `<Form>` a component tag, so only a lowercase `f` is the element.
const formTag = /<(\/?)f[Oo][Rr][Mm](?=[\s/>])/y;
/** The name a masked `<form>` has while parse5 reads the template; see `maskComponentTags`. */
export const maskedFormTag = "jorm";

/** Final `>` of a start tag whose attributes begin at `from`, and whether it ends in `/>`. */
function startTagEnd(html: string, from: number): { end: number; selfClosing: boolean } | undefined {
  let unquotedEnd = -1;
  for (let index = from; index < html.length;) {
    const char = html[index]!;
    if (char === ">") return { end: index, selfClosing: html[index - 1] === "/" && unquotedEnd !== index };
    if (char !== "=") { index++; continue; }
    index++;
    while (index < html.length && /\s/.test(html[index]!)) index++;
    const quote = html[index];
    if (quote === '"' || quote === "'") {
      const close = html.indexOf(quote, index + 1);
      if (close < 0) return undefined;
      index = close + 1;
    } else {
      // An unquoted value keeps its `/`: `x=a/>` is not self-closing in HTML.
      while (index < html.length && !/[\s>]/.test(html[index]!)) index++;
      unquotedEnd = index;
    }
  }
  return undefined;
}

/**
 * Prepara las etiquetas de componente (`<AppButton>`, nombre que empieza por mayúscula) para el
 * parser HTML sin mover ninguna posición. La inicial pasa a `j`, que no empieza ningún elemento
 * HTML, para que `<Table>`, `<Input>` o `<Title>` no reciban las reglas de esos elementos, y el
 * `/` de `<AppButton />` pasa a espacio. Quien analiza el árbol recupera el nombre original y
 * devuelve como hermanos los nodos que el parser metió dentro de una etiqueta autocerrada.
 * `blankComponents` borra cada etiqueta de componente cuando sólo interesan las secciones del
 * archivo: la plantilla valida después su cierre con mensajes propios.
 */
export function maskComponentTags(html: string, options: { blankComponents?: boolean } = {}): MaskedHtml {
  const chars = html.split("");
  const lower = html.toLowerCase();
  const selfClosing = new Set<number>();
  const tags: number[] = [];
  let changed = false;
  for (let index = html.indexOf("<"); index >= 0 && index < html.length; index = html.indexOf("<", index)) {
    if (html.startsWith("<!--", index)) {
      const close = html.indexOf("-->", index + 4);
      if (close < 0) break;
      index = close + 3;
      continue;
    }
    rawTextElement.lastIndex = index;
    const raw = /[a-z]/.test(html[index + 1] ?? "") ? rawTextElement.exec(html) : null;
    if (raw) {
      const close = lower.indexOf(`</${raw[0].slice(1).toLowerCase()}`, index + raw[0].length);
      if (close < 0) break;
      index = close + 2;
      continue;
    }
    // `</form>` only drops the form from the open elements, so a `<Name />` the parser kept open
    // inside it would swallow the rest of the template. Masked as `jorm`, it closes like a `<div>`.
    formTag.lastIndex = index;
    const form = formTag.exec(html);
    if (form) {
      chars[index + form[1]!.length + 1] = "j";
      changed = true;
    }
    componentTag.lastIndex = index;
    const tag = componentTag.exec(html);
    if (!tag) {
      // Skip the attributes of an HTML start tag: a value may contain `<Name`.
      const element = /^<[a-z][^\s/>]*/i.exec(html.slice(index, index + 256));
      const end = element ? startTagEnd(html, index + element[0].length) : undefined;
      // `<render ... />`, `<snippet ... />` and `<component is="..." />` close themselves like a component tag.
      if (end?.selfClosing && (element![0] === "<render" || element![0] === "<snippet" || element![0] === "<component")) {
        chars[end.end - 1] = " ";
        changed = true;
        selfClosing.add(index);
        if (options.blankComponents) chars.fill(" ", index, end.end + 1);
      }
      index = element ? (end?.end ?? html.length) + 1 : index + 1;
      continue;
    }
    chars[index + 1 + tag[1]!.length] = "j";
    changed = true;
    tags.push(index);
    const end = tag[1] ? { end: html.indexOf(">", componentTag.lastIndex), selfClosing: false } : startTagEnd(html, componentTag.lastIndex);
    if (!end || end.end < 0) break;
    if (end.selfClosing) {
      chars[end.end - 1] = " ";
      selfClosing.add(index);
    }
    // Section parsing does not need the element; a blank keeps `</template>` from closing it.
    if (options.blankComponents) chars.fill(" ", index, end.end + 1);
    index = end.end + 1;
  }
  return { text: changed ? chars.join("") : html, selfClosing, tags };
}

/** Spanish descriptions of the parse5 error codes that a .meeko file can reach. */
const parseErrorMessages: Readonly<Record<string, string>> = {
  "non-void-html-element-start-tag-with-trailing-solidus": "sólo los elementos vacíos (<br />, <img />…), las etiquetas de componente y <component>, <render> y <snippet> pueden cerrarse con />; escribe la etiqueta de cierre",
  "end-tag-with-attributes": "una etiqueta de cierre no lleva atributos",
  "end-tag-with-trailing-solidus": "una etiqueta de cierre no termina en />",
  "unexpected-solidus-in-tag": "hay una / suelta dentro de la etiqueta",
  "unexpected-null-character": "el texto contiene un carácter nulo",
  "unexpected-question-mark-instead-of-tag-name": "<? no abre ninguna etiqueta",
  "invalid-first-character-of-tag-name": "un nombre de etiqueta debe empezar por una letra; escribe &lt; para un < literal",
  "unexpected-equals-sign-before-attribute-name": "hay un = antes del nombre del atributo",
  "missing-end-tag-name": "</> no cierra ninguna etiqueta",
  "unexpected-character-in-attribute-name": "el nombre del atributo contiene un carácter no permitido (\", ' o <)",
  "unexpected-character-in-unquoted-attribute-value": "un valor de atributo sin comillas contiene \", ', <, = o `; ponlo entre comillas",
  "eof-before-tag-name": "el archivo termina dentro de una etiqueta",
  "eof-in-tag": "el archivo termina antes de cerrar la etiqueta con >",
  "missing-attribute-value": "falta el valor del atributo después de =",
  "missing-whitespace-between-attributes": "falta un espacio entre dos atributos",
  "cdata-in-html-content": "<![CDATA[ sólo es válido dentro de SVG o MathML",
  "incorrectly-opened-comment": "un comentario empieza por <!--",
  "eof-in-script-html-comment-like-text": "el archivo termina dentro de un comentario de un <script>",
  "nested-comment": "un comentario no puede contener <!--",
  "abrupt-closing-of-empty-comment": "un comentario vacío se escribe <!---->",
  "eof-in-comment": "el archivo termina dentro de un comentario sin -->",
  "incorrectly-closed-comment": "un comentario termina en --> y no en --!>",
  "eof-in-cdata": "el archivo termina dentro de un bloque CDATA",
  "duplicate-attribute": "el atributo está repetido en la misma etiqueta",
  "misplaced-doctype": "un .meeko no lleva <!DOCTYPE>",
  "end-tag-without-matching-open-element": "la etiqueta de cierre no corresponde a ninguna etiqueta abierta",
  "closing-of-element-with-open-child-elements": "la etiqueta se cierra con elementos hijos todavía abiertos",
  "open-elements-left-after-eof": "quedan etiquetas sin cerrar al final",
  "eof-in-element-that-can-contain-only-text": "el archivo termina dentro de un elemento de sólo texto sin su etiqueta de cierre",
};

/**
 * The Spanish message of a parse5 error code, with the code in parentheses to search for it; an
 * unknown code keeps a generic message.
 */
export function parseErrorMessage(code: string): string {
  return `${parseErrorMessages[code] ?? "el parser HTML rechaza esta construcción"} (${code})`;
}

/** Empty client script of a file without `<script lang="ts">`, placed where its template starts. */
function implicitScript(offset: number): SfcSection {
  return { name: "script", start: offset, end: offset, content: "", contentStart: offset, contentEnd: offset, attributes: [{ name: "lang", value: "ts" }], implicit: true };
}

/** Analiza y valida las secciones superiores de un archivo .meeko. */
export function parseSfc(source: string, filename = "anonymous.meeko"): SfcDocument {
  const parseErrors: Array<{ code: string; startOffset: number }> = [];
  const masked = maskComponentTags(source, { blankComponents: true });
  const root = parseFragment(masked.text, {
    sourceCodeLocationInfo: true,
    onParseError(error) {
      parseErrors.push({ code: error.code, startOffset: error.startOffset });
    },
  }) as unknown as ParsedNode;
  if (parseErrors[0]) {
    const error = parseErrors[0];
    throw compileError(source, filename, "MEEK001", `HTML de componente no válido: ${parseErrorMessage(error.code)}`, error.startOffset);
  }

  const sections = new Map<SfcSection["name"], SfcSection>();
  for (const node of root.childNodes ?? []) {
    if (node.nodeName === "#comment" || (node.nodeName === "#text" && !(node.value ?? "").trim())) continue;
    const tag = node.tagName;
    const location = node.sourceCodeLocation;
    if (tag !== "script" && tag !== "template" && tag !== "style") {
      throw compileError(source, filename, "MEEK002", "En el nivel superior sólo se admiten las secciones script, template y style", location?.startOffset ?? 0);
    }
    if (!location?.startTag || !location.endTag) {
      throw compileError(source, filename, "MEEK003", `La sección <${tag}> necesita etiqueta de cierre`, location?.startOffset ?? 0);
    }
    const name: SfcSection["name"] = tag === "script" && node.attrs?.some((attribute) => attribute.name === "server") ? "server" : tag;
    if (sections.has(name)) {
      throw compileError(source, filename, "MEEK004", name === "server" ? "Sección <script server> duplicada" : `Sección <${tag}> duplicada`, location.startOffset);
    }
    sections.set(name, {
      name,
      start: location.startOffset,
      end: location.endOffset,
      content: source.slice(location.startTag.endOffset, location.endTag.startOffset),
      contentStart: location.startTag.endOffset,
      contentEnd: location.endTag.startOffset,
      attributes: node.attrs ?? [],
    });
  }

  // A blanked component tag outside every section would otherwise vanish silently.
  const stray = masked.tags.find((offset) => ![...sections.values()].some((section) => offset >= section.contentStart && offset < section.contentEnd));
  if (stray !== undefined) {
    throw compileError(source, filename, "MEEK002", "En el nivel superior sólo se admiten las secciones script, template y style", stray);
  }
  const template = sections.get("template");
  if (!template) throw compileError(source, filename, "MEEK007", "Falta la sección <template>, que es obligatoria", source.length);
  // Since 1.1 `<script lang="ts">` is optional (MEEK005 is no longer reported): without it the
  // setup is empty and the props are `Record<string, never>`, as with an empty script.
  const script = sections.get("script") ?? implicitScript(template.start);
  if (!script.attributes.some((attribute) => attribute.name === "lang" && attribute.value === "ts")) {
    throw compileError(source, filename, "MEEK006", "La sección script debe usar lang=\"ts\"", script.contentStart);
  }
  const server = sections.get("server");
  if (server && !server.attributes.some((attribute) => attribute.name === "lang" && attribute.value === "ts")) {
    throw compileError(source, filename, "MEEK006", "La sección script server debe usar lang=\"ts\"", server.contentStart);
  }
  if (server?.attributes.some((attribute) => attribute.name === "server" && attribute.value !== "")) {
    throw compileError(source, filename, "MEEK043", "El atributo server no lleva valor; escribe <script server lang=\"ts\">", server.start);
  }
  const style = sections.get("style");
  return { script, template, ...(server ? { server } : {}), ...(style ? { style } : {}) };
}
