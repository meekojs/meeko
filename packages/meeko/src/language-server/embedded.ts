import { getCSSLanguageService } from "vscode-css-languageservice";
import type { Color, ColorInformation, ColorPresentation } from "vscode-css-languageservice";
import { getDefaultHTMLDataProvider, getLanguageService as getHtmlLanguageService } from "vscode-html-languageservice";
import { TextDocument } from "vscode-languageserver-textdocument";
import { CompletionItemKind, DiagnosticSeverity, DiagnosticTag, InsertTextFormat } from "vscode-languageserver/node";
import type { CompletionItem, CompletionList, Diagnostic, Hover, MarkupContent, Position, Range } from "vscode-languageserver/node";
import { cssClassRules } from "./class-rules.js";

// HTML of the template and CSS of `<style>`, outside the TypeScript model: what the editor offers
// while writing markup and styles. Every function reads the text, so it works while a tag or a
// rule is still being typed and the component does not compile.

const htmlService = getHtmlLanguageService();
const cssService = getCSSLanguageService();
const htmlData = getDefaultHTMLDataProvider();
// `@layer` and nesting are standard; an unknown at-rule (a PostCSS plugin's) is not an error here.
cssService.configure({ validate: true, lint: { unknownAtRules: "ignore" } });

interface Region {
  readonly contentStart: number;
  readonly contentEnd: number;
  /** Attributes of the opening tag, such as `scoped` in `<style scoped>`. */
  readonly attributes: string;
}

/** `<template>` content: from its opening tag to the last `</template>`, as in the compiler. */
export function templateRegion(source: string): Region | undefined {
  const open = /<template(?=[\s>])([^>]*)>/.exec(source);
  if (!open) return undefined;
  const contentStart = open.index + open[0].length;
  const close = source.lastIndexOf("</template>");
  return { contentStart, contentEnd: close > contentStart ? close : source.length, attributes: open[1] ?? "" };
}

/** `<style>` content, outside the template. */
export function styleRegion(source: string): Region | undefined {
  const template = templateRegion(source);
  const pattern = /<style(?=[\s>])([^>]*)>/g;
  for (const open of source.matchAll(pattern)) {
    if (template && open.index >= template.contentStart && open.index < template.contentEnd) continue;
    const contentStart = open.index + open[0].length;
    const close = source.indexOf("</style>", contentStart);
    return { contentStart, contentEnd: close < 0 ? source.length : close, attributes: open[1] ?? "" };
  }
  return undefined;
}

/** The document with only `region` kept: positions and offsets stay those of the `.meeko`. */
function masked(document: TextDocument, region: Region, language: string): TextDocument {
  const source = document.getText();
  const blank = (text: string): string => text.replace(/[^\r\n]/g, " ");
  const text = blank(source.slice(0, region.contentStart)) + source.slice(region.contentStart, region.contentEnd) + blank(source.slice(region.contentEnd));
  return TextDocument.create(`${document.uri}#${language}`, language, document.version, text);
}

const inside = (region: Region | undefined, offset: number): region is Region =>
  region !== undefined && offset >= region.contentStart && offset <= region.contentEnd;

/** Start tag around `offset` in the template, and the attribute value it is in, if any. */
export interface TagContext {
  readonly tag: string;
  readonly tagStart: number;
  /** End of the tag: its `>`, or where the next tag starts while it is unfinished. */
  readonly tagEnd: number;
  readonly component: boolean;
  /** The quoted value containing `offset`, with the name of its attribute. */
  readonly value?: { readonly attribute: string; readonly start: number };
}

export function tagAt(source: string, offset: number): TagContext | undefined {
  const template = templateRegion(source);
  if (!template || offset <= template.contentStart || offset > template.contentEnd) return undefined;
  const tagStart = source.lastIndexOf("<", offset - 1);
  if (tagStart < template.contentStart) return undefined;
  const tag = /^<([A-Za-z][\w$.-]*)/.exec(source.slice(tagStart, offset))?.[1];
  if (!tag) return undefined;
  let quote: string | undefined;
  let valueStart = 0;
  let attribute = "";
  let lastName = "";
  for (let index = tagStart + 1 + tag.length; index < offset; index++) {
    const char = source[index]!;
    if (quote) {
      if (char === quote) quote = undefined;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      valueStart = index + 1;
      attribute = lastName;
    } else if (char === ">") return undefined;
    else if (/[^\s=]/.test(char)) {
      const name = /^[^\s=>"'/]+/.exec(source.slice(index))?.[0];
      if (name) {
        lastName = name;
        index += name.length - 1;
      }
    }
  }
  let tagEnd = source.length;
  let inner: string | undefined = quote;
  for (let index = offset; index < source.length; index++) {
    const char = source[index]!;
    if (inner) { if (char === inner) inner = undefined; }
    else if (char === '"' || char === "'") inner = char;
    else if (char === ">" || char === "<") { tagEnd = index; break; }
  }
  return {
    tag, tagStart, tagEnd, component: /^[A-Z]/.test(tag) || tag === "component",
    ...(quote ? { value: { attribute, start: valueStart } } : {}),
  };
}

/** `on:event` names of an HTML element, from the HTML data of VS Code (MDN descriptions). */
export function domEventCompletion(document: TextDocument, position: Position, context: TagContext, word: string): CompletionItem[] {
  const start = document.positionAt(document.offsetAt(position) - word.length);
  return htmlData.provideAttributes(context.tag.toLowerCase())
    .filter((attribute) => /^on[a-z]/.test(attribute.name))
    .map((attribute): CompletionItem => {
      const event = attribute.name.slice(2);
      return {
        label: `on:${event}`,
        kind: CompletionItemKind.Event,
        ...(attribute.description ? { documentation: attribute.description } : {}),
        insertTextFormat: InsertTextFormat.Snippet,
        textEdit: { range: { start, end: position }, newText: `on:${event}="$1"` },
      };
    });
}

/**
 * HTML attribute names of an element (`type`, `href`, `aria-*`…), with their snippet and MDN
 * documentation. Event handler attributes are left out: Meeko writes them as `on:event`.
 */
export function htmlAttributeCompletion(document: TextDocument, position: Position, present: ReadonlySet<string>): CompletionItem[] {
  const template = templateRegion(document.getText());
  if (!template) return [];
  const html = masked(document, template, "html");
  const list = htmlService.doComplete(html, position, htmlService.parseHTMLDocument(html));
  return list.items.filter((item) => item.kind !== CompletionItemKind.Snippet && !/^on[a-z]/.test(item.label) && !present.has(item.label))
    .map((item) => ({ ...item, sortText: `1${item.sortText ?? item.label}` }));
}

/**
 * Completion of the template markup that TypeScript does not model: tag names, closing tags and
 * the values of HTML attributes (`type="…"`). `undefined` outside the template or in a value that
 * holds an expression.
 */
export function htmlCompletion(document: TextDocument, position: Position): CompletionList | undefined {
  const source = document.getText();
  const offset = document.offsetAt(position);
  const template = templateRegion(source);
  if (!inside(template, offset)) return undefined;
  const context = tagAt(source, offset);
  if (context?.component) return undefined;
  // Directive values and `{…}` interpolations are TypeScript.
  if (context?.value && /^(?:bind|on|if|each|model|ref|html)\b/.test(context.value.attribute)) return undefined;
  const open = source.lastIndexOf("{", offset - 1);
  if (!context && open > source.lastIndexOf("}", offset - 1) && open >= template.contentStart) return undefined;
  const html = masked(document, template, "html");
  const list = htmlService.doComplete(html, position, htmlService.parseHTMLDocument(html));
  // A lowercase tag only: components come from their own completion.
  const items = list.items.filter((item) => item.kind !== CompletionItemKind.Snippet && !/^on[a-z]/.test(item.label));
  return items.length ? { isIncomplete: list.isIncomplete, items } : undefined;
}

/** MDN documentation of an HTML tag or attribute of the template. */
export function htmlHover(document: TextDocument, position: Position): Hover | undefined {
  const source = document.getText();
  const offset = document.offsetAt(position);
  const template = templateRegion(source);
  if (!inside(template, offset)) return undefined;
  const context = tagAt(source, offset);
  if (context?.component) return undefined;
  const html = masked(document, template, "html");
  return htmlService.doHover(html, position, htmlService.parseHTMLDocument(html)) ?? undefined;
}

/** `<div>` and `</div>` edited together, also in the tags of components. */
export function linkedEditingRanges(document: TextDocument, position: Position): Range[] | undefined {
  const template = templateRegion(document.getText());
  if (!inside(template, document.offsetAt(position))) return undefined;
  const html = masked(document, template, "html");
  return htmlService.findLinkedEditingRanges(html, position, htmlService.parseHTMLDocument(html)) ?? undefined;
}

/**
 * The closing tag that typing `>` (or the `/` of `</`) completes, as the HTML extension of
 * VS Code inserts it: a snippet such as `$0</div>`, or `undefined`.
 */
export function tagCompletion(document: TextDocument, position: Position): string | undefined {
  const template = templateRegion(document.getText());
  if (!inside(template, document.offsetAt(position))) return undefined;
  const html = masked(document, template, "html");
  return htmlService.doTagComplete(html, position, htmlService.parseHTMLDocument(html)) ?? undefined;
}

function styleDocument(document: TextDocument): TextDocument | undefined {
  const style = styleRegion(document.getText());
  return style ? masked(document, style, "css") : undefined;
}

/** CSS completion inside `<style>`. */
export function cssCompletion(document: TextDocument, position: Position): CompletionList | undefined {
  const style = styleRegion(document.getText());
  if (!inside(style, document.offsetAt(position))) return undefined;
  const css = masked(document, style, "css");
  return cssService.doComplete(css, position, cssService.parseStylesheet(css));
}

/** CSS documentation of a property, value or selector inside `<style>`. */
export function cssHover(document: TextDocument, position: Position): Hover | undefined {
  const style = styleRegion(document.getText());
  if (!inside(style, document.offsetAt(position))) return undefined;
  const css = masked(document, style, "css");
  return cssService.doHover(css, position, cssService.parseStylesheet(css)) ?? undefined;
}

/** Colors of `<style>`, for the color decorators and picker. */
export function documentColors(document: TextDocument): ColorInformation[] {
  const css = styleDocument(document);
  return css ? cssService.findDocumentColors(css, cssService.parseStylesheet(css)) : [];
}

export function colorPresentations(document: TextDocument, color: Color, range: Range): ColorPresentation[] {
  const css = styleDocument(document);
  return css ? cssService.getColorPresentations(css, cssService.parseStylesheet(css), color, range) : [];
}

/** A class selector of `<style>`: `.card` in `.card:hover > p`. */
export interface StyleClass {
  readonly name: string;
  /** Offset of the `.` in the `.meeko`. */
  readonly start: number;
  readonly end: number;
  /** Inside `:global(…)`, so it may style markup of other components. */
  readonly global: boolean;
}

/** Class selectors of `<style>`; none while its CSS does not parse. */
export function styleClasses(source: string): StyleClass[] {
  const style = styleRegion(source);
  if (!style) return [];
  return (cssClassRules(source.slice(style.contentStart, style.contentEnd), style.contentStart) ?? [])
    .map((rule) => ({ name: rule.name, start: rule.start, end: rule.end, global: rule.global }));
}

/**
 * Diagnostics of `<style>`: CSS errors and, in `<style scoped>`, classes that neither the template
 * nor the script names. A name counts anywhere in their text, so classes built in the script
 * (`classList.add("open")`, a `computed`) are used too, and a prefix before an interpolation
 * (`badge--${tone}`) covers every class that starts with it. `:global(…)` classes are never
 * reported: they may style other components.
 */
export function styleDiagnostics(document: TextDocument): Diagnostic[] {
  const source = document.getText();
  const style = styleRegion(source);
  if (!style) return [];
  const css = masked(document, style, "css");
  const diagnostics: Diagnostic[] = cssService.doValidation(css, cssService.parseStylesheet(css))
    // `:global(…)` is Meeko's way out of the scope, not an unknown pseudo-class.
    .filter((item) => !/:global/.test(css.getText(item.range)) && !/global/.test(String(item.message)))
    .map((item) => ({ ...item, source: "Meeko" }));
  if (!/\bscoped\b/.test(style.attributes)) return diagnostics;
  const code = source.slice(0, style.contentStart) + source.slice(style.contentEnd);
  const prefixes = [...code.matchAll(/([\w-]+)\$\{/g)].map((match) => match[1]!);
  const used = (name: string): boolean =>
    new RegExp(`(^|[^\\w-])${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\w-])`).test(code)
    || prefixes.some((prefix) => name.startsWith(prefix));
  const classes = styleClasses(source);
  for (const entry of classes) {
    if (entry.global || used(entry.name)) continue;
    diagnostics.push({
      range: { start: document.positionAt(entry.start), end: document.positionAt(entry.end) },
      message: `Ni la plantilla ni el script usan la clase .${entry.name}: <style scoped> sólo alcanza a las etiquetas de este componente`,
      code: "MEEK_UNUSED_CLASS", source: "Meeko", severity: DiagnosticSeverity.Hint, tags: [DiagnosticTag.Unnecessary],
    });
  }
  return diagnostics;
}

/** The text of a hover's contents, for tests and logs. */
export function hoverText(hover: Hover | undefined): string {
  const contents = hover?.contents;
  if (!contents) return "";
  if (typeof contents === "string") return contents;
  if (Array.isArray(contents)) return contents.map((part) => typeof part === "string" ? part : part.value).join("\n");
  return (contents as MarkupContent).value;
}
