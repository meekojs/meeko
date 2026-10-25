import { dirname, resolve } from "node:path";
import { statSync } from "node:fs";
import ts from "@typescript/typescript6";
import { applyAutoImports, discoverAutoImportsSync } from "../../../src/autoimports.js";
import { projectRoot } from "../../../src/compiler/project-root.js";
import { analyzePropsDefaults, PropsDefaultsError } from "../../../src/compiler/props.js";
import { templateEventType } from "../../../src/compiler/events.js";
import { scanInterpolations } from "../../../src/compiler/interpolation.js";
import { parseSfc } from "../../../src/compiler/sfc.js";
import { attributeValueStart, decodeTemplateText, parseTemplate } from "../../../src/compiler/template.js";
import type { TemplateNode } from "../../../src/compiler/template.js";

/** Tramo equivalente entre el componente y el archivo TypeScript virtual. */
export interface SourceSpan {
  sourceStart: number;
  sourceEnd: number;
  generatedStart: number;
  generatedEnd: number;
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
  const scriptFile = ts.createSourceFile(filename, document.script.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let defaultKeys: readonly string[] = [];
  for (const statement of scriptFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const call = declaration.initializer;
      if (!call || !ts.isCallExpression(call) || !ts.isIdentifier(call.expression) || call.expression.text !== "defineProps") continue;
      try { defaultKeys = analyzePropsDefaults(call)?.keys ?? []; }
      catch (error) { if (!(error instanceof PropsDefaultsError)) throw error; }
    }
  }
  const defaultKeysType = defaultKeys.map((key) => JSON.stringify(key)).join(" | ");
  const defaultKeysOfProps = `Extract<${defaultKeysType}, keyof T>`;
  const defaultPick = `Pick<T, ${defaultKeysOfProps}>`;
  const resolvedDefaults = `{ [K in keyof ${defaultPick}]-?: Exclude<${defaultPick}[K], undefined> }`;
  const propsReturn = defaultKeysType
    ? `T extends unknown ? Omit<T, ${defaultKeysOfProps}> & ${resolvedDefaults} : never`
    : "T";
  const defaultsParameter = defaultKeysType ? `Partial<T> & ${resolvedDefaults}` : "Partial<T>";
  code += `\ndeclare function defineProps<T>(defaults?: ${defaultsParameter}): ${propsReturn};\nfunction __meeko_template() {\n`;

  /** Agrega una expresión conservando su posición original. */
  const expression = (value: string, sourceStart: number): void => {
    code += "void (";
    const generatedStart = code.length;
    code += value;
    spans.push({ sourceStart, sourceEnd: sourceStart + value.length, generatedStart, generatedEnd: code.length });
    code += ");\n";
  };

  const mapped = (value: string, sourceStart: number): void => {
    const generatedStart = code.length;
    code += value;
    spans.push({ sourceStart, sourceEnd: sourceStart + value.length, generatedStart, generatedEnd: code.length });
  };

  const root = parseTemplate(source, document.template, filename);

  /** Recorre la plantilla y conserva el ámbito de cada lista. */
  const visit = (node: TemplateNode): void => {
    const attrs = node.attrs ?? [];
    const list = attrs.find((attr) => attr.name === "each:of");
    const item = attrs.find((attr) => attr.name === "each:as")?.value ?? "item";
    const index = attrs.find((attr) => attr.name === "each:index")?.value ?? "index";
    if (list) {
      const listStart = attributeValueStart(source, list);
      code += `for (const ${validIdentifier(item) ? item : "item"} of (`;
      const generatedStart = code.length;
      code += list.value;
      if (listStart !== undefined) spans.push({
        sourceStart: listStart,
        sourceEnd: listStart + list.value.length,
        generatedStart,
        generatedEnd: code.length,
      });
      code += `)) {\nconst ${validIdentifier(index) ? index : "index"}: number = 0;\n`;
    }

    if (node.tagName === "component" && attrs.some((attr) => attr.name === "is")) {
      const reference = attrs.find((attr) => attr.name === "is")!;
      code += "void ((";
      mapped(reference.value, attributeValueStart(source, reference) ?? reference.start);
      code += ") satisfies import(\"@meekojs/meeko\").Component<never>);\n";
      code += "void ((";
      mapped(reference.value, attributeValueStart(source, reference) ?? reference.start);
      code += ").renderToString(";
      mapped("{", attributeValueStart(source, reference) ?? reference.start);
      code += " ";
      for (const attribute of attrs) {
        const rawName = /^[^\s=]+/.exec(source.slice(attribute.start, attribute.end))?.[0] ?? attribute.name;
        if (!rawName.startsWith("bind:")) continue;
        mapped(rawName.slice(5), attribute.start + 5);
        code += ": ";
        mapped(attribute.value, attributeValueStart(source, attribute) ?? attribute.start);
        code += ", ";
      }
      code += "}));\n";
    } else {
      for (const attr of attrs) {
        if (!/^(?:bind|on|if|each):/.test(attr.name) && !(node.tagName === "component" && attr.name === "is")) continue;
        if (["each:of", "each:as", "each:index"].includes(attr.name)) continue;
        const start = attributeValueStart(source, attr);
        if (start === undefined) continue;
        if (attr.name.startsWith("on:")) {
          code += `void (((__meeko_handler: (event: ${templateEventType(attr.name.slice(3))}) => unknown) => __meeko_handler)(`;
          mapped(attr.value, start);
          code += "));\n";
        } else if (attr.name === "each:key") {
          code += "void (((__meeko_key: string | number) => __meeko_key)(";
          mapped(attr.value, start);
          code += "));\n";
        } else expression(attr.value, start);
      }
    }

    if (node.nodeName === "#text") {
      // El CLI informa de interpolaciones vacías o sin cerrar; aquí sólo se modelan las válidas.
      for (const segment of scanInterpolations(source.slice(node.start, node.end)).segments) {
        if (segment.expression) expression(decodeTemplateText(segment.expression), node.start + segment.expressionStart);
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
    for (const child of node.content?.childNodes ?? []) visit(child);
    if (list) code += "}\n";
  };
  for (const node of root.childNodes ?? []) visit(node);
  code += "}\n";

  const virtualFilename = `${resolve(filename).replaceAll("\\", "/")}.ts`;
  const rootDirectory = projectRoot(filename);
  const registry = discoverAutoImportsSync(rootDirectory);
  const target = resolve(filename).replaceAll("\\", "/").includes("/server/") ? "server" : "client";
  const transformed = applyAutoImports(code, virtualFilename, registry, target);
  const prefixLength = transformed.length - code.length;
  if (prefixLength) {
    for (const span of spans) {
      span.generatedStart += prefixLength;
      span.generatedEnd += prefixLength;
    }
    code = transformed;
  }
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => ({
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noUncheckedIndexedAccess: true,
      exactOptionalPropertyTypes: true,
      verbatimModuleSyntax: true,
      skipLibCheck: true,
      noEmit: true,
      rootDirs: [rootDirectory, resolve(rootDirectory, ".meeko/types")],
      allowArbitraryExtensions: true,
    }),
    getScriptFileNames: () => [virtualFilename],
    getScriptVersion: (file) => {
      if (file === virtualFilename) return "1";
      try {
        const stat = statSync(file);
        return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
      } catch { return "missing"; }
    },
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
