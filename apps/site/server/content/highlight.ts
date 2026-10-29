import { trustHtml } from "@meekojs/meeko";
import type { TrustedHtml } from "@meekojs/meeko";
import { createHighlighterCore } from "shiki/core";
import type { HighlighterCore, LanguageRegistration, ThemeRegistration } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { readRepositoryFile } from "./repository.js";

/** Languages of the fenced blocks in the documents; a block in another language stays plain text. */
const aliases: Readonly<Record<string, string>> = {
  ts: "typescript",
  typescript: "typescript",
  js: "javascript",
  javascript: "javascript",
  sh: "shellscript",
  bash: "shellscript",
  shell: "shellscript",
  powershell: "powershell",
  ps1: "powershell",
  json: "json",
  jsonc: "json",
  html: "html",
  css: "css",
  lua: "lua",
  rust: "rust",
  sql: "sql",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  meeko: "meeko",
};

/**
 * The `.meeko` grammar of the VS Code extension, the same file the editor uses, registered as
 * `meeko` for whole components and as `meeko-template` for template fragments.
 */
function meekoLanguages(): LanguageRegistration[] {
  const grammar = JSON.parse(readRepositoryFile("packages/vscode/syntaxes/meeko.tmLanguage.json")) as Omit<LanguageRegistration, "name"> & {
    repository: Record<string, { patterns?: unknown[] }>;
  };
  const component: LanguageRegistration = { ...grammar, name: "meeko", displayName: "Meeko", embeddedLangs: ["typescript", "html", "css"] };
  // A fragment such as `<p if:when="...">` is the content of a <template> section.
  const template: LanguageRegistration = {
    ...grammar,
    name: "meeko-template",
    displayName: "Meeko",
    scopeName: "source.meeko.template",
    patterns: grammar.repository.template?.patterns as LanguageRegistration["patterns"],
    embeddedLangs: ["typescript", "html", "css"],
  };
  return [component, template];
}

/** The few colors of a code theme of the site; each one is at least 4.5:1 on its code background. */
interface CodePalette {
  readonly background: string;
  readonly foreground: string;
  readonly comment: string;
  readonly keyword: string;
  readonly string: string;
  readonly constant: string;
  readonly func: string;
  readonly type: string;
  readonly tag: string;
  readonly attribute: string;
  readonly punctuation: string;
}

/** On the dark code ground (#0e0f12): cool and quiet, with the blue of Meeko's eyes for calls. */
const nightPalette: CodePalette = {
  background: "#0e0f12",
  foreground: "#d4d7dd",
  comment: "#7d828c",
  keyword: "#c3abf5",
  string: "#9fd3b4",
  constant: "#e9c48e",
  func: "#8fb4ff",
  type: "#7ccfe0",
  tag: "#8cc4f0",
  attribute: "#a9b3c6",
  punctuation: "#8b909a",
};

/** The same roles on the light code ground (#f6f7f9). */
const dayPalette: CodePalette = {
  background: "#f6f7f9",
  foreground: "#24272d",
  comment: "#646973",
  keyword: "#6a3fc4",
  string: "#1d7449",
  constant: "#9a5410",
  func: "#2556c4",
  type: "#0a6a80",
  tag: "#155f9e",
  attribute: "#4f586b",
  punctuation: "#5f636c",
};

/**
 * A TextMate theme of the site from a palette: few colors, so code reads as text with a little
 * structure instead of a rainbow. Meeko directives (`bind:`, `on:`) take the keyword color.
 */
function meekoTheme(name: string, type: "light" | "dark", palette: CodePalette): ThemeRegistration {
  const rule = (scope: string[], foreground: string, fontStyle?: string): NonNullable<ThemeRegistration["tokenColors"]>[number] => ({ scope, settings: fontStyle ? { foreground, fontStyle } : { foreground } });
  return {
    name,
    type,
    colors: { "editor.background": palette.background, "editor.foreground": palette.foreground },
    fg: palette.foreground,
    bg: palette.background,
    tokenColors: [
      { settings: { foreground: palette.foreground } },
      rule(["comment", "punctuation.definition.comment", "string.comment"], palette.comment),
      rule(["punctuation", "meta.brace", "keyword.operator", "punctuation.definition.tag", "punctuation.separator", "punctuation.terminator"], palette.punctuation),
      rule(["keyword", "storage", "storage.type", "storage.modifier", "keyword.control", "keyword.operator.new", "keyword.operator.expression", "keyword.operator.logical", "variable.language.this"], palette.keyword),
      rule(["string", "punctuation.definition.string", "string.template", "markup.inline.raw"], palette.string),
      rule(["constant.numeric", "constant.language", "constant.character", "support.constant", "constant.other", "variable.other.constant", "variable.other.enummember"], palette.constant),
      rule(["entity.name.function", "support.function", "meta.function-call entity.name.function", "variable.function", "punctuation.section.embedded", "entity.name.function.builtin"], palette.func),
      rule(["entity.name.type", "entity.name.class", "support.type", "support.class", "entity.other.inherited-class", "entity.name.type.class.component", "storage.type.primitive", "support.type.primitive"], palette.type),
      rule(["entity.name.tag", "support.class.component"], palette.tag),
      rule(["entity.other.attribute-name", "support.type.property-name", "meta.object-literal.key", "variable.parameter"], palette.attribute),
      rule(["variable", "variable.other", "variable.other.readwrite", "meta.definition.variable", "variable.other.property", "support.variable.property"], palette.foreground),
      rule(["entity.other.attribute-name.directive", "keyword.control.flow"], palette.keyword),
      rule(["markup.heading", "markup.bold"], palette.foreground, "bold"),
      rule(["markup.italic"], palette.foreground, "italic"),
    ],
  };
}

let highlighter: Promise<HighlighterCore> | undefined;

function load(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [meekoTheme("meeko-night", "dark", nightPalette), meekoTheme("meeko-day", "light", dayPalette)],
    langs: [
      import("shiki/langs/typescript.mjs"),
      import("shiki/langs/javascript.mjs"),
      import("shiki/langs/html.mjs"),
      import("shiki/langs/css.mjs"),
      import("shiki/langs/json.mjs"),
      import("shiki/langs/shellscript.mjs"),
      import("shiki/langs/powershell.mjs"),
      import("shiki/langs/lua.mjs"),
      import("shiki/langs/rust.mjs"),
      import("shiki/langs/sql.mjs"),
      import("shiki/langs/toml.mjs"),
      import("shiki/langs/yaml.mjs"),
      ...meekoLanguages(),
    ],
  });
  return highlighter;
}

/** Meeko syntax in an HTML fragment: directives, interpolations or component tags. */
const meekoSyntax = /\s(?:bind|on|if|each|model|ref):|\smodel=|\shtml=|<(?:render|snippet|component)\b|<[A-Z][\w$]*[\s/>]|\{[^}\n]+\}/;

/**
 * Grammar of a fenced block: `html` blocks with a `.meeko` component (`<script>` or `<template>`
 * first, after comments) use `meeko`, fragments with Meeko syntax use `meeko-template`.
 */
export function blockLanguage(info: string, code: string): { readonly lang: string; readonly label: string } {
  const name = info.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const lang = aliases[name];
  if (lang === "html" || lang === "meeko") {
    const start = code.replace(/^(?:\s*<!--[\s\S]*?-->)*\s*/, "");
    if (/^<(?:script|template|style)\b/.test(start)) return { lang: "meeko", label: "meeko" };
    if (lang === "meeko" || meekoSyntax.test(code)) return { lang: "meeko-template", label: "meeko" };
    return { lang: "html", label: "html" };
  }
  if (!lang) return { lang: "text", label: name === "text" || !name ? "texto" : name };
  return { lang, label: name };
}

/** Themes of every highlighted block: both as CSS variables, from which the stylesheet picks one. */
const themeOptions = {
  themes: { light: "meeko-day", dark: "meeko-night" },
  defaultColor: false,
} as const;

/**
 * A synchronous highlighter, once the grammars are loaded: the HTML of a block with both themes as
 * CSS variables (`--shiki-light`, `--shiki-dark`), from which the stylesheet picks one. It is trusted
 * HTML: Shiki escapes the code and writes only its own `<pre>`, `<code>` and `<span>` markup.
 */
export async function createHighlight(): Promise<(code: string, lang: string) => TrustedHtml> {
  const shiki = await load();
  return (code, lang) => trustHtml(shiki.codeToHtml(code, { lang, ...themeOptions }));
}

/** A highlighted token: its text and the inline style with the colors of both themes. */
export interface HighlightedToken {
  readonly content: string;
  readonly style: string;
}

/**
 * A synchronous tokenizer with the same grammars and themes as {@link createHighlight}, for code
 * whose HTML the caller writes itself, such as an API signature with links on its type names.
 */
export async function createTokenizer(): Promise<(code: string, lang: string) => HighlightedToken[][]> {
  const shiki = await load();
  return (code, lang) => shiki.codeToTokens(code, { lang, ...themeOptions }).tokens.map((line) => line.map((token) => ({
    content: token.content,
    style: Object.entries(token.htmlStyle ?? {}).map(([property, value]) => `${property}:${value}`).join(";"),
  })));
}
