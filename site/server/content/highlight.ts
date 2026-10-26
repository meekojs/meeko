import { createHighlighterCore } from "shiki/core";
import type { HighlighterCore, LanguageRegistration } from "shiki/core";
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
  const grammar = JSON.parse(readRepositoryFile("editors/vscode/syntaxes/meeko.tmLanguage.json")) as Omit<LanguageRegistration, "name"> & {
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

let highlighter: Promise<HighlighterCore> | undefined;

function load(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    engine: createJavaScriptRegexEngine(),
    themes: [import("shiki/themes/github-light-default.mjs"), import("shiki/themes/github-dark-default.mjs")],
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

/**
 * A synchronous highlighter, once the grammars are loaded: the HTML of a block with both themes as
 * CSS variables (`--shiki-light`, `--shiki-dark`), from which the stylesheet picks one.
 */
export async function createHighlight(): Promise<(code: string, lang: string) => string> {
  const shiki = await load();
  return (code, lang) => shiki.codeToHtml(code, {
    lang,
    themes: { light: "github-light-default", dark: "github-dark-default" },
    defaultColor: false,
    // The light theme's comment gray falls below 4.5:1 on the site's cream code background.
    colorReplacements: { "github-light-default": { "#6e7781": "#59636e" } },
  });
}
