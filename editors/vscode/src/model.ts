import { dirname, resolve } from "node:path";
import { parseFragment } from "parse5";
import ts from "@typescript/typescript6";
import { parseSfc } from "../../../src/compiler/sfc.js";

/** Tramo equivalente entre el componente y el archivo TypeScript virtual. */
export interface SourceSpan {
  sourceStart: number;
  sourceEnd: number;
  generatedStart: number;
  generatedEnd: number;
}

interface NodeLocation {
  startOffset: number;
  endOffset: number;
  attrs?: Record<string, { startOffset: number; endOffset: number }>;
}

interface TemplateNode {
  nodeName: string;
  value?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: TemplateNode[];
  sourceCodeLocation?: NodeLocation;
}

/** Modelo semántico de un componente abierto en el editor. */
export interface EditorModel {
  readonly filename: string;
  readonly virtualFilename: string;
  readonly code: string;
  readonly spans: readonly SourceSpan[];
  readonly service: ts.LanguageService;
  toGenerated(offset: number): number | undefined;
  toSource(offset: number): number | undefined;
  dispose(): void;
}

/** Construye un proyecto TypeScript virtual para referencias entre secciones. */
export function createEditorModel(source: string, filename: string): EditorModel {
  const document = parseSfc(source, filename);
  const spans: SourceSpan[] = [];
  let code = document.script.content;
  spans.push({
    sourceStart: document.script.contentStart,
    sourceEnd: document.script.contentEnd,
    generatedStart: 0,
    generatedEnd: code.length,
  });
  code += "\ndeclare function defineProps<T>(): T;\nfunction __meeko_template() {\n";

  /** Agrega una expresión conservando su posición original. */
  const expression = (value: string, sourceStart: number): void => {
    code += "void (";
    const generatedStart = code.length;
    code += value;
    spans.push({ sourceStart, sourceEnd: sourceStart + value.length, generatedStart, generatedEnd: code.length });
    code += ");\n";
  };

  const template = document.template;
  const root = parseFragment(template.content, { sourceCodeLocationInfo: true }) as unknown as TemplateNode;

  /** Recorre la plantilla y conserva el ámbito de cada lista. */
  const visit = (node: TemplateNode): void => {
    const attrs = node.attrs ?? [];
    const location = node.sourceCodeLocation;
    const list = attrs.find((attr) => attr.name === "each:of");
    const item = attrs.find((attr) => attr.name === "each:as")?.value ?? "item";
    const index = attrs.find((attr) => attr.name === "each:index")?.value ?? "index";
    if (list) {
      const listStart = attributeValueStart(template.content, location?.attrs?.["each:of"]);
      code += `for (const ${validIdentifier(item) ? item : "item"} of (`;
      const generatedStart = code.length;
      code += list.value;
      if (listStart !== undefined) spans.push({
        sourceStart: template.contentStart + listStart,
        sourceEnd: template.contentStart + listStart + list.value.length,
        generatedStart,
        generatedEnd: code.length,
      });
      code += `)) {\nconst ${validIdentifier(index) ? index : "index"} = 0;\n`;
    }

    for (const attr of attrs) {
      if (!/^(?:bind|on|if|each):/.test(attr.name) || ["each:of", "each:as", "each:index"].includes(attr.name)) continue;
      const start = attributeValueStart(template.content, location?.attrs?.[attr.name]);
      if (start !== undefined) expression(attr.value, template.contentStart + start);
    }

    if (node.nodeName === "#text" && location) {
      const original = template.content.slice(location.startOffset, location.endOffset);
      const matches = original.matchAll(/\{([^{}]+)\}/g);
      for (const match of matches) {
        const value = match[1];
        if (value !== undefined && match.index !== undefined) {
          expression(value, template.contentStart + location.startOffset + match.index + 1);
        }
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
    if (list) code += "}\n";
  };
  for (const node of root.childNodes ?? []) visit(node);
  code += "}\n";

  const virtualFilename = `${resolve(filename).replaceAll("\\", "/")}.ts`;
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      skipLibCheck: true,
      noEmit: true,
    }),
    getScriptFileNames: () => [virtualFilename],
    getScriptVersion: () => "1",
    getScriptSnapshot: (file) => {
      const content = file === virtualFilename ? code : ts.sys.readFile(file);
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => dirname(filename),
    getDefaultLibFileName: (options) => ts.getDefaultLibFilePath(options),
    fileExists: (file) => file === virtualFilename || ts.sys.fileExists(file),
    readFile: (file) => file === virtualFilename ? code : ts.sys.readFile(file),
    readDirectory: ts.sys.readDirectory,
    directoryExists: ts.sys.directoryExists,
    getDirectories: ts.sys.getDirectories,
    realpath: (file) => ts.sys.realpath?.(file) ?? file,
    useCaseSensitiveFileNames: () => ts.sys.useCaseSensitiveFileNames,
    getNewLine: () => ts.sys.newLine,
  };
  const service = ts.createLanguageService(host, ts.createDocumentRegistry());
  const map = (offset: number, direction: "source" | "generated"): number | undefined => {
    for (const span of spans) {
      const from = direction === "source" ? span.sourceStart : span.generatedStart;
      const to = direction === "source" ? span.generatedStart : span.sourceStart;
      const end = direction === "source" ? span.sourceEnd : span.generatedEnd;
      if (offset >= from && offset <= end) return to + offset - from;
    }
    return undefined;
  };
  return {
    filename,
    virtualFilename,
    code,
    spans,
    service,
    toGenerated: (offset) => map(offset, "source"),
    toSource: (offset) => map(offset, "generated"),
    dispose: () => service.dispose(),
  };
}

function validIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}

/** Encuentra el inicio del valor literal de un atributo en la plantilla. */
function attributeValueStart(source: string, range?: { startOffset: number; endOffset: number }): number | undefined {
  if (!range) return undefined;
  const raw = source.slice(range.startOffset, range.endOffset);
  const match = /=\s*(["'])/.exec(raw);
  return match && match.index !== undefined ? range.startOffset + match.index + match[0].length : undefined;
}
