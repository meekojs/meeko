import { dirname, join, resolve } from "node:path";
import { existsSync, statSync } from "node:fs";
import ts from "@typescript/typescript6";
import { applyAutoImports, discoverAutoImportsSync } from "../autoimports.js";
import type { AutoImport } from "../autoimports.js";
import { projectRoot } from "../compiler/project-root.js";
import { analyzePropsDefaults, PropsDefaultsError } from "../compiler/props.js";
import { templateEventType } from "../compiler/events.js";
import { scanInterpolations } from "../compiler/interpolation.js";
import { parseSfc } from "../compiler/sfc.js";
import { attributeValueStart, decodeTemplateText, parseTemplate } from "../compiler/template.js";
import type { TemplateNode } from "../compiler/template.js";

/** Tramo equivalente entre el componente y el archivo TypeScript virtual. */
export interface SourceSpan {
  sourceStart: number;
  sourceEnd: number;
  generatedStart: number;
  generatedEnd: number;
}

/** Autoimport que el editor omitió para poder seguir analizando el componente. */
export interface AutoImportProblem {
  readonly name: string;
  readonly kind: "ambiguous" | "unavailable";
  readonly message: string;
  readonly candidates: readonly AutoImport[];
}

/** Código TypeScript virtual de un componente y su mapa de posiciones. */
export interface VirtualComponent {
  readonly filename: string;
  readonly virtualFilename: string;
  readonly source: string;
  readonly code: string;
  readonly spans: readonly SourceSpan[];
  /** Autoimports descartados en modo tolerante; vacío en modo estricto. */
  readonly problems: readonly AutoImportProblem[];
  toGenerated(offset: number): number | undefined;
  toSource(offset: number): number | undefined;
}

/** Modelo semántico de un componente abierto en el editor. */
export interface EditorModel extends VirtualComponent {
  readonly service: ts.LanguageService;
  dispose(): void;
}

export interface VirtualComponentOptions {
  /** Registro de autoimports ya resuelto; por defecto se lee la configuración estática. */
  readonly registry?: readonly AutoImport[];
  /** Omite los autoimports ambiguos o fuera de ámbito y los informa en `problems`. */
  readonly tolerant?: boolean;
}

export interface EditorModelOptions extends VirtualComponentOptions {
  /** Opciones de TypeScript; por defecto se usan las del tsconfig del proyecto. */
  readonly compilerOptions?: ts.CompilerOptions;
}

/** Opciones resueltas de TypeScript para un proyecto Meeko. */
export interface ProjectCompilerOptions {
  readonly options: ts.CompilerOptions;
  /** Archivos TypeScript del proyecto según el tsconfig; vacío sin tsconfig. */
  readonly fileNames: readonly string[];
  readonly configFile?: string;
}

/** Ruta del documento TypeScript virtual asociado a un componente. */
export function virtualFilenameOf(filename: string): string {
  return `${resolve(filename).replaceAll("\\", "/")}.ts`;
}

/** Construye el TypeScript virtual que relaciona script y plantilla. */
export function createVirtualComponent(source: string, filename: string, options: VirtualComponentOptions = {}): VirtualComponent {
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
  // Every component is an ES module, like the compiler output; this keeps the
  // declarations of components that share a TypeScript project isolated.
  code += "}\nexport {};\n";

  const virtualFilename = virtualFilenameOf(filename);
  const target = resolve(filename).replaceAll("\\", "/").includes("/server/") ? "server" : "client";
  let registry = options.registry ?? discoverAutoImportsSync(projectRoot(filename));
  const problems: AutoImportProblem[] = [];
  let transformed: string | undefined;
  while (transformed === undefined) {
    try {
      transformed = applyAutoImports(code, virtualFilename, registry, target);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const match = /^(?:Ambiguous autoimport (\S+?):|Autoimport (\S+) is unavailable)/.exec(message);
      const name = match?.[1] ?? match?.[2];
      if (!options.tolerant || !name || !registry.some((entry) => entry.name === name)) throw error;
      problems.push({
        name,
        kind: match?.[1] ? "ambiguous" : "unavailable",
        message,
        candidates: registry.filter((entry) => entry.name === name),
      });
      registry = registry.filter((entry) => entry.name !== name);
    }
  }
  const prefixLength = transformed.length - code.length;
  if (prefixLength) {
    for (const span of spans) {
      span.generatedStart += prefixLength;
      span.generatedEnd += prefixLength;
    }
    code = transformed;
  }
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
    source,
    code,
    spans,
    problems,
    toGenerated: (offset) => map(offset, "source"),
    toSource: (offset) => map(offset, "generated"),
  };
}

/** Opciones que comprueba `meeko check`; se usan si el proyecto no tiene tsconfig.json. */
export function defaultCompilerOptions(root: string): ts.CompilerOptions {
  return {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noUncheckedIndexedAccess: true,
    exactOptionalPropertyTypes: true,
    verbatimModuleSyntax: true,
    skipLibCheck: true,
    noEmit: true,
    rootDirs: [root, resolve(root, ".meeko/types")],
    allowArbitraryExtensions: true,
  };
}

const emitOptions = [
  "outDir", "outFile", "rootDir", "declaration", "declarationDir", "declarationMap", "emitDeclarationOnly",
  "composite", "incremental", "tsBuildInfoFile", "sourceMap", "inlineSourceMap", "inlineSources", "noEmitOnError",
] as const;

/**
 * Lee el tsconfig.json de la raíz del proyecto. El editor conserva sus opciones de tipos
 * (paths, lib, types, strict...) y sólo fuerza lo necesario para analizar componentes:
 * sin emisión, extensiones arbitrarias y `rootDirs` sobre `.meeko/types`.
 */
export function resolveProjectCompilerOptions(root: string): ProjectCompilerOptions {
  const directory = resolve(root);
  const configFile = join(directory, "tsconfig.json");
  if (!existsSync(configFile)) return { options: defaultCompilerOptions(directory), fileNames: [] };
  let failed = false;
  const parsed = ts.getParsedCommandLineOfConfigFile(configFile, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => { failed = true; },
  });
  if (!parsed || failed) return { options: defaultCompilerOptions(directory), fileNames: [], configFile };
  const options: ts.CompilerOptions = { ...parsed.options };
  for (const key of emitOptions) delete options[key];
  options.noEmit = true;
  options.allowArbitraryExtensions = true;
  const rootDirs = [...(options.rootDirs ?? [])];
  for (const entry of [directory, resolve(directory, ".meeko/types")]) {
    if (!rootDirs.some((existing) => resolve(existing).toLowerCase() === entry.toLowerCase())) rootDirs.push(entry);
  }
  options.rootDirs = rootDirs;
  const fileNames = parsed.fileNames.filter((file) => /\.(?:[cm]?ts|tsx)$/.test(file) && !file.endsWith(".meeko.ts"));
  return { options, fileNames, configFile };
}

/** Versión de un archivo en disco para que TypeScript detecte cambios guardados. */
export function diskVersion(file: string): string {
  try {
    const stat = statSync(file);
    return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
  } catch { return "missing"; }
}

/** Construye un proyecto TypeScript virtual de un solo componente. */
export function createEditorModel(source: string, filename: string, options: EditorModelOptions = {}): EditorModel {
  const component = createVirtualComponent(source, filename, options);
  const { virtualFilename, code } = component;
  const compilerOptions = options.compilerOptions ?? resolveProjectCompilerOptions(projectRoot(filename)).options;
  const host: ts.LanguageServiceHost = {
    getCompilationSettings: () => compilerOptions,
    getScriptFileNames: () => [virtualFilename],
    getScriptVersion: (file) => file === virtualFilename ? "1" : diskVersion(file),
    getScriptSnapshot: (file) => {
      const content = file === virtualFilename ? code : ts.sys.readFile(file);
      return content === undefined ? undefined : ts.ScriptSnapshot.fromString(content);
    },
    getCurrentDirectory: () => dirname(filename),
    getDefaultLibFileName: (settings) => ts.getDefaultLibFilePath(settings),
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
  return { ...component, service, dispose: () => service.dispose() };
}

function validIdentifier(value: string): boolean {
  return /^[A-Za-z_$][\w$]*$/.test(value);
}
