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
  name: "script" | "template" | "style";
  content: string;
  contentStart: number;
  contentEnd: number;
  attributes: ReadonlyArray<{ name: string; value: string }>;
}

/** Estructura validada de las secciones de un componente. */
export interface SfcDocument {
  script: SfcSection;
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

/** Analiza y valida las secciones superiores de un archivo .meeko. */
export function parseSfc(source: string, filename = "anonymous.meeko"): SfcDocument {
  const parseErrors: Array<{ code: string; startOffset: number }> = [];
  const root = parseFragment(source, {
    sourceCodeLocationInfo: true,
    onParseError(error) {
      parseErrors.push({ code: error.code, startOffset: error.startOffset });
    },
  }) as unknown as ParsedNode;
  if (parseErrors[0]) {
    const error = parseErrors[0];
    throw compileError(source, filename, "MEEK001", `Invalid component HTML: ${error.code}`, error.startOffset);
  }

  const sections = new Map<SfcSection["name"], SfcSection>();
  for (const node of root.childNodes ?? []) {
    if (node.nodeName === "#comment" || (node.nodeName === "#text" && !(node.value ?? "").trim())) continue;
    const tag = node.tagName;
    const location = node.sourceCodeLocation;
    if (tag !== "script" && tag !== "template" && tag !== "style") {
      throw compileError(source, filename, "MEEK002", "Only script, template and style sections are allowed at the top level", location?.startOffset ?? 0);
    }
    if (!location?.startTag || !location.endTag) {
      throw compileError(source, filename, "MEEK003", `Section <${tag}> must have a closing tag`, location?.startOffset ?? 0);
    }
    if (sections.has(tag)) {
      throw compileError(source, filename, "MEEK004", `Duplicate <${tag}> section`, location.startOffset);
    }
    sections.set(tag, {
      name: tag,
      content: source.slice(location.startTag.endOffset, location.endTag.startOffset),
      contentStart: location.startTag.endOffset,
      contentEnd: location.endTag.startOffset,
      attributes: node.attrs ?? [],
    });
  }

  const script = sections.get("script");
  const template = sections.get("template");
  if (!script) throw compileError(source, filename, "MEEK005", "A <script lang=\"ts\"> section is required", 0);
  if (!script.attributes.some((attribute) => attribute.name === "lang" && attribute.value === "ts")) {
    throw compileError(source, filename, "MEEK006", "The script section must use lang=\"ts\"", script.contentStart);
  }
  if (!template) throw compileError(source, filename, "MEEK007", "A <template> section is required", source.length);
  const style = sections.get("style");
  return style ? { script, template, style } : { script, template };
}
