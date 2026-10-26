import ts from "@typescript/typescript6";
import type { AstPath, Doc, Options, Parser, ParserOptions, Plugin, Printer, SupportLanguage, SupportOptions } from "prettier";
import { builders, utils } from "prettier/doc";
import { compile } from "../compiler.js";
import { locate, MeekoCompileError, parseSfc } from "../compiler/sfc.js";
import type { SfcSection } from "../compiler/sfc.js";
import { templateParserName, templatePlugin } from "./template.js";

const { hardline, indent } = builders;
const { replaceEndOfLine } = utils;

/**
 * Opciones que el plugin añade a las de Prettier.
 *
 * @since 1.1.0
 * @example
 * ```ts
 * // prettier.config.ts
 * import type { Config } from "prettier";
 * import type { MeekoPrettierOptions } from "@meekojs/meeko/prettier";
 *
 * const config: Config & MeekoPrettierOptions = {
 *   plugins: ["@meekojs/meeko/prettier"],
 *   meekoIndentSections: true,
 * };
 * export default config;
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/editors.md#formato-con-prettier
 */
export interface MeekoPrettierOptions {
  /**
   * Indenta un nivel el contenido de `<script>`, `<script server>`, `<template>` y `<style>`,
   * como `vueIndentScriptAndStyle` pero también en la plantilla. Por defecto `false`.
   */
  meekoIndentSections?: boolean;
}

interface MeekoSectionNode {
  type: "section";
  name: SfcSection["name"];
  start: number;
  end: number;
  contentStart: number;
  contentEnd: number;
  lang?: string;
}

interface MeekoCommentNode {
  type: "comment";
  start: number;
  end: number;
  value: string;
}

interface MeekoRootNode {
  type: "root";
  start: number;
  end: number;
  children: Array<MeekoSectionNode | MeekoCommentNode>;
}

type MeekoNode = MeekoRootNode | MeekoSectionNode | MeekoCommentNode;

/** Error de sintaxis con la ubicación que Prettier muestra en su marco de código. */
function syntaxError(message: string, line: number, column: number, cause?: unknown): Error {
  const error = new SyntaxError(`${message} (${line}:${column})`) as SyntaxError & { loc: unknown; cause?: unknown };
  error.loc = { start: { line, column } };
  if (cause !== undefined) error.cause = cause;
  return error;
}

/** El archivo debe compilar antes de formatearse; el error conserva la ubicación de Meeko. */
function validate(text: string, filename: string): void {
  try {
    compile(text, filename);
  } catch (error) {
    if (error instanceof MeekoCompileError) {
      const { code, message, location } = error.diagnostic;
      throw syntaxError(`${code}: ${message}`, location.line, location.column, error);
    }
    throw error;
  }
}

function parse(text: string, options: ParserOptions<MeekoNode>): MeekoRootNode {
  const filename = options.filepath || "anonymous.meeko";
  validate(text, filename);
  const document = parseSfc(text, filename);
  // A file without `<script lang="ts">` keeps having none: the implicit stand-in is not printed.
  const sections = [document.server, document.script, document.template, document.style]
    .filter((section): section is SfcSection => section !== undefined && !section.implicit)
    .sort((left, right) => left.start - right.start);
  // The compiler does not read `<script server>`; its syntax is checked here.
  if (document.server) {
    const file = ts.createSourceFile(filename, document.server.content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) as ts.SourceFile & { parseDiagnostics: readonly ts.DiagnosticWithLocation[] };
    const diagnostic = file.parseDiagnostics[0];
    if (diagnostic) {
      const location = locate(text, document.server.contentStart + (diagnostic.start ?? 0));
      throw syntaxError(`MEEK013: ${ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")}`, location.line, location.column);
    }
  }
  const children: MeekoRootNode["children"] = [];
  const comments = (from: number, to: number): void => {
    for (const match of text.slice(from, to).matchAll(/<!--[\s\S]*?-->/g)) {
      const start = from + match.index;
      children.push({ type: "comment", start, end: start + match[0].length, value: match[0].slice(4, -3) });
    }
  };
  let previous = 0;
  for (const section of sections) {
    comments(previous, section.start);
    const lang = section.attributes.find((attribute) => attribute.name === "lang")?.value;
    children.push({
      type: "section", name: section.name, start: section.start, end: section.end,
      contentStart: section.contentStart, contentEnd: section.contentEnd, ...(lang !== undefined ? { lang } : {}),
    });
    previous = section.end;
  }
  comments(previous, text.length);
  return { type: "root", start: 0, end: text.length, children };
}

const meekoParser: Parser<MeekoNode> = {
  astFormat: "meeko",
  parse,
  locStart: (node) => node.start,
  locEnd: (node) => node.end,
};

function verbatim(options: ParserOptions<MeekoNode> | Options, start: number, end: number): Doc {
  return replaceEndOfLine((options.originalText as string).slice(start, end));
}

function isPrettierIgnore(node: MeekoNode | undefined): boolean {
  return node?.type === "comment" && node.value.trim() === "prettier-ignore";
}

function contentParser(node: MeekoSectionNode): string | undefined {
  if (node.name === "template") return templateParserName;
  if (node.name === "script" || node.name === "server") return "typescript";
  const lang = node.lang?.toLowerCase() ?? "css";
  return lang === "css" || lang === "scss" || lang === "less" ? lang : undefined;
}

const meekoPrinter: Printer<MeekoNode> = {
  getVisitorKeys: (node) => (node.type === "root" ? ["children"] : []),
  print(path: AstPath<MeekoNode>, options, print) {
    const { node } = path;
    if (node.type !== "root") return verbatim(options, node.start, node.end);
    const text = options.originalText;
    const parts: Doc[] = [];
    path.each((child, index) => {
      const current = child.node as MeekoSectionNode | MeekoCommentNode;
      const previous = index > 0 ? node.children[index - 1] : undefined;
      if (previous) {
        parts.push(hardline);
        // One blank line between sections or comments is kept; more collapse into one.
        if ((text.slice(previous.end, current.start).match(/\n/g)?.length ?? 0) > 1) parts.push(hardline);
      }
      parts.push(isPrettierIgnore(previous) ? verbatim(options, current.start, current.end) : print());
    }, "children");
    return [parts, hardline];
  },
  embed(path: AstPath<MeekoNode>, options: Options) {
    const { node } = path;
    if (node.type !== "section") return null;
    const parser = contentParser(node);
    if (!parser) return null;
    return async (textToDoc: (text: string, options: Options) => Promise<Doc>) => {
      const text = options.originalText as string;
      const open = verbatim(options, node.start, node.contentStart);
      const close = verbatim(options, node.contentEnd, node.end);
      const content = text.slice(node.contentStart, node.contentEnd);
      if (!content.trim()) return [open, close];
      const body = await textToDoc(content, { parser, __embeddedInHtml: true });
      const indented = (options as MeekoPrettierOptions).meekoIndentSections === true;
      return [open, indented ? indent([hardline, body]) : [hardline, body], hardline, close];
    };
  },
};

/**
 * Lenguaje `.meeko` que el plugin registra en Prettier, con el parser `meeko` y la extensión
 * `.meeko`.
 *
 * @since 1.1.0
 * @example
 * ```ts
 * import { languages } from "@meekojs/meeko/prettier";
 *
 * languages[0]?.extensions; // [".meeko"]
 * ```
 */
export const languages: SupportLanguage[] = [{
  name: "Meeko",
  parsers: ["meeko"],
  extensions: [".meeko"],
  vscodeLanguageIds: ["meeko"],
}];

/**
 * Parsers del plugin: `meeko` para archivos completos y el interno de la plantilla. El nombre
 * `meeko` es estable.
 *
 * @since 1.1.0
 * @example
 * ```ts
 * import { format } from "prettier";
 *
 * const formatted = await format(source, { parser: "meeko", plugins: ["@meekojs/meeko/prettier"] });
 * ```
 */
export const parsers: Record<string, Parser> = {
  meeko: meekoParser,
  ...templatePlugin.parsers,
};

/**
 * Printers del plugin: `meeko` imprime cada sección del componente y delega el script, el estilo y
 * la plantilla en los printers de TypeScript, CSS y HTML de Prettier.
 *
 * @since 1.1.0
 * @example
 * ```ts
 * import { printers } from "@meekojs/meeko/prettier";
 *
 * Object.keys(printers).includes("meeko"); // true
 * ```
 */
export const printers: Record<string, Printer> = {
  meeko: meekoPrinter,
  ...templatePlugin.printers,
};

/**
 * Opciones propias del plugin para Prettier: `meekoIndentSections` (booleana, `false` por
 * defecto). El nombre de la opción es estable.
 *
 * @since 1.1.0
 * @example
 * ```json
 * { "plugins": ["@meekojs/meeko/prettier"], "meekoIndentSections": true }
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/editors.md#formato-con-prettier
 */
export const options: SupportOptions = {
  meekoIndentSections: {
    type: "boolean",
    category: "Meeko",
    default: false,
    description: "Indent the content of <script>, <script server>, <template> and <style> sections in .meeko files.",
  },
};

/**
 * Plugin de Prettier para componentes `.meeko`. Formatea `<script>` y `<script server>` como
 * TypeScript, `<style>` como CSS y la plantilla como HTML, con los valores de las directivas y el
 * texto `{expr}` formateados como expresiones. Un archivo que no compila no se formatea.
 *
 * @since 1.1.0
 * @example
 * ```ts
 * import { format } from "prettier";
 * import meeko from "@meekojs/meeko/prettier";
 *
 * const output = await format('<script lang="ts">const a=1</script><template><p>{a}</p></template>', {
 *   parser: "meeko",
 *   plugins: [meeko],
 * });
 * ```
 * @see https://github.com/meekojs/meeko/blob/main/docs/editors.md#formato-con-prettier
 */
const plugin: Plugin = { languages, parsers, printers, options };
export default plugin;
