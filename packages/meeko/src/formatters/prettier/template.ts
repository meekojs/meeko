import type { AstPath, Doc, Options, Parser, ParserOptions, Plugin, Printer } from "prettier";

import { builders, utils } from "prettier/doc";

import type { ClassOrder, ClassSortMode } from "./classes";

import { scanInterpolations } from "../../compiler/parser/interpolation";
import { maskComponentTags } from "../../compiler/parser/sfc";
import { isCustomElementTag } from "../../compiler/parser/template";
import { classExpressionOption } from "./class-literals";
import { classOrderOption, classTokens, sortClassTokens } from "./classes";

const { group, indent, label, softline } = builders;
const { mapDoc, replaceEndOfLine } = utils;

/** Parser interno de la plantilla de un `.meeko`; sólo lo usa el parser `meeko` mediante `embed`. */
export const templateParserName = "meeko-template";
const templateAstFormat = "meeko-template";
/** Etiqueta de los docs de expresiones TypeScript; sus llaves nunca son marcadores de interpolación. */
const expressionLabel = "meeko-expression";
const wrapperStart = "<template>";
const wrapperEnd = "</template>";

interface SourceLocation {
  readonly offset: number;
  readonly line: number;
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
  startSourceSpan?: SourceSpan | null;
  endSourceSpan?: SourceSpan | null;
  valueSpan?: SourceSpan;
  readonly parent?: HtmlNode;
  readonly prev?: HtmlNode;
  readonly next?: HtmlNode;
  isLeadingSpaceSensitive?: boolean;
  hasLeadingSpaces?: boolean;
  isTrailingSpaceSensitive?: boolean;
  hasTrailingSpaces?: boolean;
  hasDanglingSpaces?: boolean;
  isDanglingSpaceSensitive?: boolean;
  isWhitespaceSensitive?: boolean;
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
    const root = await html.parser.parse(maskInterpolatedLessThan(text), options);
    restoreInterpolatedLessThan(root);
    const template = root.children?.find((child) => child.kind === "element" && child.name === "template");
    if (!template) throw new Error("The template wrapper was not parsed");
    // The template's children become the root's: they are printed without the wrapper.
    root.setProperty("children", template.children ?? []);
    return root;
  },
  locStart: (node) => node.sourceSpan.start.offset,
  locEnd: (node) => node.sourceSpan.end.offset,
};

/** Lo que lee el parser HTML en lugar de un `<` de una interpolación; nunca está en la fuente. */
const interpolatedLessThan = "";

/**
 * Oculta al parser HTML cada `<` de una interpolación del texto (`{a < b}`, `{"<b>"}`) con las
 * mismas posiciones que el compilador, para que no abra una etiqueta.
 */
function maskInterpolatedLessThan(text: string): string {
  if (text.includes(interpolatedLessThan)) return text;
  const { interpolated } = maskComponentTags(text);
  if (!interpolated.length) return text;
  const chars = text.split("");
  for (const offset of interpolated) chars[offset] = interpolatedLessThan;
  return chars.join("");
}

/** Devuelve su `<` a los textos que leyó el parser HTML. */
function restoreInterpolatedLessThan(ast: HtmlNode): void {
  ast.walk((node) => {
    if (node.kind === "text" && node.value?.includes(interpolatedLessThan)) node.setProperty("value", node.value.replaceAll(interpolatedLessThan, "<"));
  });
}

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

/** Whether `meekoSortClasses` asks for an order, which is what reaches beyond a static element `class`. */
function sortsClasses(options: Options): boolean {
  const mode = (options as { meekoSortClasses?: ClassSortMode }).meekoSortClasses;
  return mode !== undefined && mode !== "off";
}

/**
 * A static `class` of a component tag or `<component is>`: a text prop, which the component usually
 * forwards to its root. It is only rewritten when an order is asked for.
 */
function isComponentClass(node: HtmlNode, element: HtmlNode | undefined): boolean {
  const tag = element?.name;
  return node.fullName?.toLowerCase() === "class" && element?.kind === "element" && tag !== undefined && (/^[A-Z]/.test(tag) || tag === "component");
}

/**
 * The normalized, optionally sorted, value of a static `class`; `undefined` keeps it verbatim. A
 * value with a character reference or a `"` is left alone: its tokens are not the source text.
 */
function classValue(value: string, options: Options): string | undefined {
  if (value.includes("&") || value.includes('"')) return undefined;
  const mode = (options as { meekoSortClasses?: ClassSortMode }).meekoSortClasses;
  const order = (options as Record<string, unknown>)[classOrderOption] as ClassOrder | undefined;
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

/** Text and interpolations: the whitespace at their edges is part of a text node in the compiler. */
function isTextLike(node: HtmlNode): boolean {
  return node.kind === "text" || node.kind === "interpolation";
}

/** What Prettier's printer joins with a soft line, which would drop the whitespace between them. */
function isTextOrComment(node: HtmlNode): boolean {
  return node.kind === "text" || node.kind === "comment";
}

function startsOnItsOwnLine(child: HtmlNode, parent: HtmlNode): boolean {
  return Boolean(child.hasLeadingSpaces && parent.startSourceSpan && parent.startSourceSpan.end.line < child.sourceSpan.start.line);
}

function endsOnItsOwnLine(child: HtmlNode, parent: HtmlNode): boolean {
  return Boolean(child.hasTrailingSpaces && parent.endSourceSpan && child.sourceSpan.end.line < parent.endSourceSpan.start.line);
}

function contentSpansLines(node: HtmlNode): boolean {
  return Boolean(node.startSourceSpan && node.endSourceSpan && node.startSourceSpan.end.line < node.endSourceSpan.start.line);
}

/**
 * `<snippet name="a"> <b>x</b> </snippet>`: for the compiler that space is content, and with a line
 * break it would be formatting. No line can break there, so the snippet is printed as written, unless
 * a neighbor without whitespace prints part of its tags.
 */
function isPrintedAsWritten(node: HtmlNode): boolean {
  if (node.kind !== "element" || node.name !== "snippet") return false;
  if ((node.prev && node.isLeadingSpaceSensitive && !node.hasLeadingSpaces) || (node.next && node.isTrailingSpaceSensitive && !node.hasTrailingSpaces)) return false;
  const first = node.children?.[0];
  const last = node.children?.[node.children.length - 1];
  if (!first || !last) return Boolean(node.hasDanglingSpaces && !contentSpansLines(node));
  return (!isTextLike(first) && Boolean(first.hasLeadingSpaces) && !startsOnItsOwnLine(first, node)) || (!isTextLike(last) && Boolean(last.hasTrailingSpaces) && !endsOnItsOwnLine(last, node));
}

/** A component with `<snippet>` blocks and nothing else: the compiler reads no text among them. */
function holdsOnlySnippets(node: HtmlNode): boolean {
  return /^[A-Z]/.test(node.name ?? "") && (node.children ?? []).every((child) => child.kind === "comment" || (child.kind === "element" && child.name === "snippet"));
}

/**
 * The compiler renders the whitespace of a template as text nodes, so saving a file must not add or
 * remove any: `<li each:of="a" each:as="b">{b}</li>` keeps its text node without whitespace, and
 * `Hi<b> you</b>` keeps its space. Every `htmlWhitespaceSensitivity` follows this rule: left to
 * itself, `"ignore"` would do both, and `"css"` would too wherever it takes an element for a block.
 * Formatting may still turn one whitespace into another (a space into a line break and indentation),
 * which renders the same outside `white-space: pre`. The compiler itself drops whitespace in two
 * places, which stay free: among the blocks of a component with only `<snippet>` content, and between
 * an element and the edge of a `<snippet>` when that whitespace has a line break.
 */
function keepWhitespace(ast: HtmlNode): void {
  ast.walk((node) => {
    const children = node.children;
    if (!children || (node.kind !== "element" && node.kind !== "root") || node.isWhitespaceSensitive) return;
    if (holdsOnlySnippets(node)) {
      node.isDanglingSpaceSensitive = false;
      for (const child of children) child.isLeadingSpaceSensitive = child.isTrailingSpaceSensitive = false;
      return;
    }
    const snippet = node.name === "snippet";
    const first = children[0];
    const last = children[children.length - 1];
    if (!first || !last) {
      node.isDanglingSpaceSensitive = Boolean(node.hasDanglingSpaces && !(snippet && contentSpansLines(node)));
      return;
    }
    // The whitespace at the edges of the root belongs to the `<template>` section: the `meeko` printer keeps it.
    if (node.kind === "element") {
      first.isLeadingSpaceSensitive = !snippet || isTextLike(first) || (Boolean(first.hasLeadingSpaces) && !startsOnItsOwnLine(first, node));
      last.isTrailingSpaceSensitive = !snippet || isTextLike(last) || (Boolean(last.hasTrailingSpaces) && !endsOnItsOwnLine(last, node));
    }
    for (let index = 1; index < children.length; index++) {
      const previous = children[index - 1]!;
      const next = children[index]!;
      if (next.hasLeadingSpaces && !(isTextOrComment(previous) && isTextOrComment(next))) continue;
      previous.isTrailingSpaceSensitive = true;
      next.isLeadingSpaceSensitive = true;
    }
  });
}

/** Content on its own lines stays there: `<p> text </p>` would render the same, but reads worse. */
function keepsLineBreaks(node: HtmlNode): boolean {
  if (node.kind !== "element" || node.isWhitespaceSensitive) return false;
  const first = node.children?.[0];
  const last = node.children?.[node.children.length - 1];
  return Boolean(first && last && (startsOnItsOwnLine(first, node) || endsOnItsOwnLine(last, node)));
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
    try {
      const processed = host(options).printer.preprocess(ast, options) as HtmlNode;
      keepWhitespace(processed);
      return processed;
    } finally { options.parser = parser; }
  },
  print(path, options, print) {
    const { node } = path;
    if (isPrintedAsWritten(node)) return replaceEndOfLine(options.originalText.slice(node.sourceSpan.start.offset, node.sourceSpan.end.offset));
    const printed = host(options).printer.print(path, options, print);
    if (node.kind === "root") return meekoBraces(printed);
    const breaks = keepsLineBreaks(node) && typeof printed === "object" && !Array.isArray(printed) && printed.type === "group";
    return breaks ? { ...printed, break: true } : printed;
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
        const isClassExpression = node.fullName === "bind:class" && sortsClasses(options);
        const printed = await expressionDoc(textToDoc, unescapedValue(node), { __isInHtmlAttribute: true, ...(isClassExpression ? { [classExpressionOption]: true } : {}) });
        if (!printed) return undefined;
        const value = mapDoc(printed.hug ? group(printed.doc) : [indent([softline, printed.doc]), softline], (item) =>
          typeof item === "string" ? item.replaceAll('"', "&quot;") : item);
        return [node.rawName ?? node.fullName!, '="', label(expressionLabel, group(value)), '"'];
      };
    }
    const element = path.parent as HtmlNode | undefined;
    if (node.kind === "attribute" && node.value != null && (isElementClass(node, element) || (sortsClasses(options) && isComponentClass(node, element)))) {
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
