import type { AstPath, Doc, Options, Parser, ParserOptions, Plugin, Printer } from "prettier";
import { builders, utils } from "prettier/doc";
import { scanInterpolations } from "../compiler/interpolation.js";
import { isCustomElementTag } from "../compiler/template.js";
import { classOrderOption, classTokens, sortClassTokens } from "./classes.js";
import type { ClassSortMode } from "./classes.js";

const { group, indent, label, softline } = builders;
const { mapDoc } = utils;

/** Parser interno de la plantilla de un `.meeko`; sólo lo usa el parser `meeko` mediante `embed`. */
export const templateParserName = "meeko-template";
const templateAstFormat = "meeko-template";
/** Etiqueta de los docs de expresiones TypeScript; sus llaves nunca son marcadores de interpolación. */
const expressionLabel = "meeko-expression";
const wrapperStart = "<template>";
const wrapperEnd = "</template>";

interface SourceLocation {
  readonly offset: number;
  moveBy(delta: number): SourceLocation;
}

interface SourceSpan {
  readonly start: SourceLocation;
  readonly end: SourceLocation;
}

/** Nodo del AST HTML de Prettier (`src/language-html/parse/ast.js`), sólo lo que usa el plugin. */
interface HtmlNode {
  kind: string;
  name?: string;
  fullName?: string;
  rawName?: string;
  value?: string | null;
  children?: HtmlNode[];
  attrs?: HtmlNode[];
  sourceSpan: SourceSpan;
  valueSpan?: SourceSpan;
  readonly parent?: HtmlNode;
  readonly prev?: HtmlNode;
  readonly next?: HtmlNode;
  isLeadingSpaceSensitive?: boolean;
  hasLeadingSpaces?: boolean;
  /** Expresión sin espacios exteriores de una interpolación `{expr}`. */
  meekoExpression?: string;
  setProperty(property: string, value: unknown): void;
  insertChildBefore(target: HtmlNode, node: Record<string, unknown>): void;
  removeChild(child: HtmlNode): void;
  walk(fn: (node: HtmlNode) => void): void;
}

type HtmlPrinter = Printer<HtmlNode> & {
  embed: NonNullable<Printer<HtmlNode>["embed"]>;
  preprocess: NonNullable<Printer<HtmlNode>["preprocess"]>;
};

interface HostHtml {
  readonly parser: Parser<HtmlNode>;
  readonly printer: HtmlPrinter;
}

type LazyRecord<T> = Record<string, T | (() => Promise<T>)>;

const hostKey = Symbol.for("meeko.prettier.html");
type HostOptions = ParserOptions<HtmlNode> & { [hostKey]?: HostHtml };

async function resolveLazy<T>(record: LazyRecord<T> | undefined, name: string): Promise<T | undefined> {
  const value = record?.[name];
  return typeof value === "function" ? await (value as () => Promise<T>)() : value;
}

/**
 * Parser `vue` y printer `html` del Prettier que ejecuta el plugin. Se toman de `options.plugins`
 * en lugar de importar `prettier/plugins/html` para no mezclar dos versiones de Prettier.
 */
async function hostHtml(options: ParserOptions<HtmlNode>): Promise<HostHtml> {
  const plugins = ((options as { plugins?: unknown[] }).plugins ?? []) as Array<{ parsers?: LazyRecord<Parser<HtmlNode>>; printers?: LazyRecord<HtmlPrinter> }>;
  for (const plugin of [...plugins].reverse()) {
    if (!plugin || typeof plugin !== "object" || !plugin.parsers?.vue || !plugin.printers?.html) continue;
    const parser = await resolveLazy(plugin.parsers, "vue");
    const printer = await resolveLazy(plugin.printers, "html");
    if (parser && printer) return { parser, printer };
  }
  // Standalone sin el plugin HTML entre los cargados: se usa el de esta instalación.
  const html = await import("prettier/plugins/html") as unknown as { parsers: Record<string, Parser<HtmlNode>>; printers: Record<string, HtmlPrinter> };
  return { parser: html.parsers.vue!, printer: html.printers.html! };
}

function host(options: ParserOptions<HtmlNode> | Options): HostHtml {
  const found = (options as HostOptions)[hostKey];
  if (!found) throw new Error("The meeko-template printer runs only after the meeko-template parser");
  return found;
}

const templateParser: Parser<HtmlNode> = {
  astFormat: templateAstFormat,
  // The vue parser keeps the case of `<AppButton>` and accepts `<AppButton />` only inside a root
  // `<template>`; the wrapper keeps every position consistent with `options.originalText`.
  preprocess: (text) => `${wrapperStart}${text}${wrapperEnd}`,
  async parse(text, options) {
    const html = await hostHtml(options);
    (options as HostOptions)[hostKey] = html;
    const root = await html.parser.parse(text, options);
    const template = root.children?.find((child) => child.kind === "element" && child.name === "template");
    if (!template) throw new Error("The template wrapper was not parsed");
    // The template's children become the root's: they are printed without the wrapper.
    root.setProperty("children", template.children ?? []);
    return root;
  },
  locStart: (node) => node.sourceSpan.start.offset,
  locEnd: (node) => node.sourceSpan.end.offset,
};

/** Convierte cada `{expr}` de los textos en un nodo `interpolation`, como `{{ }}` en Vue. */
function extractInterpolations(ast: HtmlNode): void {
  ast.walk((node) => {
    if (!node.children || node.kind === "interpolation" || (node.kind === "element" && (node.name === "script" || node.name === "style"))) return;
    for (const child of [...node.children]) {
      if (child.kind !== "text" || !child.value?.includes("{")) continue;
      const text = child.value;
      const scan = scanInterpolations(text);
      if (!scan.segments.length) continue;
      const start = child.sourceSpan.start;
      const Span = child.sourceSpan.constructor as new (start: SourceLocation, end: SourceLocation) => SourceSpan;
      const span = (from: number, to: number) => new Span(start.moveBy(from), start.moveBy(to));
      let index = 0;
      for (const segment of scan.segments) {
        if (segment.start > index) node.insertChildBefore(child, { kind: "text", value: text.slice(index, segment.start), sourceSpan: span(index, segment.start) });
        node.insertChildBefore(child, {
          kind: "interpolation",
          sourceSpan: span(segment.start, segment.end),
          children: [{
            kind: "text",
            value: text.slice(segment.start + 1, segment.end - 1),
            meekoExpression: segment.expression,
            sourceSpan: span(segment.start + 1, segment.end - 1),
          }],
        });
        index = segment.end;
      }
      if (index < text.length) node.insertChildBefore(child, { kind: "text", value: text.slice(index), sourceSpan: span(index, text.length) });
      node.removeChild(child);
    }
  });
}

/** Sustituye los marcadores `{{`/`}}` que imprime Prettier para una interpolación por `{`/`}`. */
function meekoBraces(input: Doc): Doc {
  const visit = (item: Doc): Doc => {
    if (typeof item === "string") return item === "{{" ? "{" : item === "}}" ? "}" : item;
    if (Array.isArray(item)) return item.map(visit);
    switch (item.type) {
      case "label":
        return item.label === expressionLabel ? item : { ...item, contents: visit(item.contents) };
      case "group":
        return { ...item, contents: visit(item.contents), ...(item.expandedStates ? { expandedStates: item.expandedStates.map(visit) } : {}) };
      case "fill":
        return { ...item, parts: item.parts.map(visit) };
      case "if-break":
        return { ...item, breakContents: visit(item.breakContents), flatContents: visit(item.flatContents) };
      case "align":
      case "indent":
      case "indent-if-break":
      case "line-suffix":
        return { ...item, contents: visit((item as { contents: Doc }).contents) } as Doc;
      default:
        return item;
    }
  };
  return visit(input);
}

const expressionParser = "__ts_expression";

/** Atributos cuyo valor es una expresión TypeScript. */
function isExpressionAttribute(name: string, element: HtmlNode | undefined): boolean {
  const tag = element?.name;
  // On a custom element (`<x-markdown html="intro">`), `html` and `model` are plain HTML attributes;
  // the reserved SVG/MathML names (`<font-face>`) are standard elements, as in the compiler.
  const custom = tag !== undefined && !/^[A-Z]/.test(tag) && isCustomElementTag(tag);
  // `bind="obj"` (since 1.5) on an element or a component; on a custom element it stays an attribute.
  if (name === "model" || name === "bind" || /^model:./.test(name)) return !custom;
  if (/^(?:bind|on):./.test(name) || name === "if:when" || name === "each:of" || name === "each:key") return true;
  if (name === "is") return tag === "component";
  // `html="expression"` on a standard element; a component tag rejects it (MEEK032).
  if (name === "html") return tag !== undefined && !/^[A-Z]/.test(tag) && !custom;
  if (name === "snippet" || name === "args") return tag === "render";
  return false;
}

/** Tags whose `class` is not the element's: a component prop, or a Meeko construct. */
const notElementClass = new Set(["component", "render", "snippet", "template"]);

/** A static `class` of an element; on a component tag (`<Card class="x">`) it is a text prop. */
function isElementClass(node: HtmlNode, element: HtmlNode | undefined): boolean {
  const tag = element?.name;
  return node.fullName?.toLowerCase() === "class" && element?.kind === "element" && tag !== undefined && !/^[A-Z]/.test(tag) && !notElementClass.has(tag);
}

/**
 * The normalized, optionally sorted, value of a static `class`; `undefined` keeps it verbatim. A
 * value with a character reference or a `"` is left alone: its tokens are not the source text.
 */
function classValue(value: string, options: Options): string | undefined {
  if (value.includes("&") || value.includes('"')) return undefined;
  const mode = (options as { meekoSortClasses?: ClassSortMode }).meekoSortClasses;
  const order = (options as Record<string, unknown>)[classOrderOption] as ReadonlyMap<string, number> | undefined;
  return sortClassTokens(classTokens(value), mode, order).join(" ");
}

function unescapedValue(node: HtmlNode): string {
  return (node.value ?? "").replaceAll("&quot;", '"').replaceAll("&apos;", "'");
}

type TextToDoc = (text: string, options: Options) => Promise<Doc>;

/** Formatea una expresión; `undefined` si Prettier no la entiende y debe quedar como está. */
async function expressionDoc(textToDoc: TextToDoc, text: string, extra: Options): Promise<{ doc: Doc; hug: boolean } | undefined> {
  if (!text.trim()) return undefined;
  let hug = false;
  let list = false;
  try {
    const result = await textToDoc(text, {
      parser: expressionParser,
      __embeddedInHtml: true,
      __onHtmlBindingRoot: (ast: { type?: string; node?: { type?: string } }) => {
        const type = (ast.type === "JsExpressionRoot" ? ast.node : ast)?.type;
        hug = type === "ObjectExpression" || type === "ArrayExpression" || type === "TemplateLiteral" || type === "StringLiteral";
        list = type === "SequenceExpression";
      },
      ...extra,
    });
    // `a, b` is a list of values (`args`), not a comma expression: Prettier would add parentheses.
    return list ? undefined : { doc: result, hug };
  } catch {
    return undefined;
  }
}

/** `<p></p\n>{x}`: the next node prints the `}` of this interpolation itself. */
function nextBorrowsClosingMarker(node: HtmlNode | undefined): boolean {
  return Boolean(node?.prev && node.prev.kind !== "text" && node.prev.kind !== "comment" && node.isLeadingSpaceSensitive && !node.hasLeadingSpaces);
}

const visitorKeys: Record<string, readonly string[]> = {
  root: ["children"],
  element: ["attrs", "startTagComments", "children"],
  ieConditionalComment: ["children"],
  interpolation: ["children"],
  text: ["children"],
};

const templatePrinter: Printer<HtmlNode> = {
  getVisitorKeys: (node) => (visitorKeys[node.kind] ?? []).filter((key) => Array.isArray((node as unknown as Record<string, unknown>)[key])),
  preprocess(ast, options) {
    extractInterpolations(ast);
    // The HTML preprocess looks for `{{ }}` unless the parser is `html`; `{expr}` is already extracted.
    const parser = options.parser;
    options.parser = "html";
    try { return host(options).printer.preprocess(ast, options); }
    finally { options.parser = parser; }
  },
  print(path, options, print) {
    const printed = host(options).printer.print(path, options, print);
    return path.node.kind === "root" ? meekoBraces(printed) : printed;
  },
  embed(path: AstPath<HtmlNode>, options: Options) {
    const node = path.node;
    const parent = node.parent;
    if (node.kind === "text" && parent?.kind === "interpolation") {
      return async (textToDoc: TextToDoc) => {
        const printed = await expressionDoc(textToDoc, node.meekoExpression ?? node.value ?? "", {});
        if (!printed) return undefined;
        const closing = nextBorrowsClosingMarker(parent.next) ? "" : softline;
        return label(expressionLabel, [indent([softline, printed.doc]), closing]);
      };
    }
    if (node.kind === "attribute" && node.value != null && node.fullName && isExpressionAttribute(node.fullName, path.parent as HtmlNode | undefined)) {
      return async (textToDoc: TextToDoc) => {
        const printed = await expressionDoc(textToDoc, unescapedValue(node), { __isInHtmlAttribute: true });
        if (!printed) return undefined;
        const value = mapDoc(printed.hug ? group(printed.doc) : [indent([softline, printed.doc]), softline], (item) =>
          typeof item === "string" ? item.replaceAll('"', "&quot;") : item);
        return [node.rawName ?? node.fullName!, '="', label(expressionLabel, group(value)), '"'];
      };
    }
    if (node.kind === "attribute" && node.value != null && isElementClass(node, path.parent as HtmlNode | undefined)) {
      const value = classValue(node.value, options);
      if (value !== undefined) return [node.rawName ?? node.fullName!, '="', value, '"'];
    }
    return host(options as ParserOptions<HtmlNode>).printer.embed(path, options);
  },
};

/** Parser y printer de la plantilla; el plugin principal los incluye. */
export const templatePlugin: Pick<Plugin<HtmlNode>, "parsers" | "printers"> = {
  parsers: { [templateParserName]: templateParser },
  printers: { [templateAstFormat]: templatePrinter },
};
