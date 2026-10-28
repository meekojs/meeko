import { existsSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import { trustHtml } from "@meekojs/meeko";
import type { TrustedHtml } from "@meekojs/meeko";
import GithubSlugger from "github-slugger";
import markdownIt from "markdown-it";
import type { MarkdownIt, Token } from "markdown-it";
import type { RenderedDoc, TocEntry } from "../../shared/types/docs.js";
import { pageOfSource } from "./catalog.js";
import { blockLanguage, createHighlight } from "./highlight.js";
import { githubUrl, readRepositoryFile, repositoryPath, repositoryRoot, repositoryUrl, sitePath } from "./repository.js";

const blobPrefix = `${repositoryUrl}/blob/main/`;
const treePrefix = `${repositoryUrl}/tree/main/`;

/** Plain text of an inline token: its text and inline code, without markup. */
function inlineText(token: Token | undefined): string {
  return (token?.children ?? []).map((child) => child.type === "text" || child.type === "code_inline" ? child.content : "").join("").trim();
}

/**
 * `x.md#y` → `/docs/x#y`, the package README → `/`, other repository files → GitHub. Relative links
 * resolve from the real location of `from` in the repository (`CHANGELOG.md` lives in `packages/meeko/`).
 */
export function rewriteHref(href: string, from: string): string {
  if (/^(?:#|mailto:)/.test(href)) return href;
  let path: string;
  if (href.startsWith(blobPrefix) || href.startsWith(treePrefix)) {
    path = href.slice(href.startsWith(blobPrefix) ? blobPrefix.length : treePrefix.length);
  } else if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("/")) {
    return href;
  } else {
    path = posix.normalize(posix.join(posix.dirname(repositoryPath(from)), href));
    if (path.startsWith("../")) return href;
  }
  const hashAt = path.indexOf("#");
  const hash = hashAt < 0 ? "" : path.slice(hashAt);
  // `file` is a path from the repository root, as GitHub URLs and resolved relative links are.
  const file = decodeURI(hashAt < 0 ? path : path.slice(0, hashAt)).replace(/\/$/, "");
  const page = pageOfSource(sitePath(file));
  if (page) return `${page}${hash}`;
  const absolute = join(repositoryRoot(), ...file.split("/"));
  const folder = existsSync(absolute) && statSync(absolute).isDirectory();
  return `${repositoryUrl}/${folder ? "tree" : "blob"}/main/${file}${hash}`;
}

/** Shortens text to about `limit` characters, at a word boundary. */
function summary(text: string, limit = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.]$/, "")}…`;
}

const renderers = new Map<boolean, Promise<MarkdownIt>>();

/** Escapes text for HTML content and attribute values. */
export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

/** A highlighted `<pre>` under the header of every code block: its language and a copy button. */
export function codeBlockHtml(label: string, pre: TrustedHtml): TrustedHtml {
  const name = escapeHtml(label);
  return trustHtml(`<div class="code-block" data-lang="${name}"><div class="code-head" data-pagefind-ignore><span class="code-lang">${name}</span><button type="button" class="code-copy" data-copy>Copiar</button></div>${pre}</div>\n`);
}

/**
 * The Markdown renderer of the site: GitHub-compatible heading ids with anchors, tables in a
 * scrolling wrapper and code blocks highlighted with Shiki, under a header with a copy button.
 * `html` keeps raw HTML, as the documents of the repository use it; JSDoc fragments escape it,
 * because their prose names tags and generics such as `Signal<T>` without backticks.
 *
 * Its output is trusted HTML (`trustHtml`): the text comes from this repository (its documents and
 * the JSDoc of the package), never from visitors, and Shiki escapes the code it highlights.
 */
function markdown(html = true): Promise<MarkdownIt> {
  let renderer = renderers.get(html);
  if (renderer) return renderer;
  renderer = (async () => {
    const highlight = await createHighlight();
    const md = markdownIt({ html, linkify: false, typographer: false });
    md.renderer.rules.fence = (tokens, index) => {
      const token = tokens[index]!;
      const code = token.content.replace(/\n$/, "");
      const { lang, label } = blockLanguage(token.info, code);
      return codeBlockHtml(label, highlight(code, lang));
    };
    md.renderer.rules.table_open = () => '<div class="table-wrap"><table>\n';
    md.renderer.rules.table_close = () => "</table></div>\n";
    md.renderer.rules.heading_close = (tokens, index, options, _env, self) => {
      const open = tokens[index - 2];
      const id = open?.attrGet("id");
      const anchor = id && open?.tag !== "h1"
        ? `<a class="heading-anchor" href="#${md.utils.escapeHtml(encodeURIComponent(id))}" aria-label="Enlace a esta sección" data-pagefind-ignore>#</a>`
        : "";
      return anchor + self.renderToken(tokens, index, options);
    };
    return md;
  })();
  renderers.set(html, renderer);
  return renderer;
}

/** Options of {@link renderSource}. */
export interface RenderOptions {
  /**
   * The page of an inline code span, such as `/docs/reference/signal` for `` `signal()` ``. The
   * first span of each `##` section that names a page links to it; headings and links keep theirs.
   */
  readonly codeLinks?: (code: string) => string | undefined;
}

/** Links the inline code of `token` that `codeLinks` knows, once per page and section. */
function linkCode(token: Token, codeLinks: NonNullable<RenderOptions["codeLinks"]>, linked: Set<string>): void {
  let depth = 0;
  for (const child of token.children ?? []) {
    if (child.type === "link_open") depth++;
    else if (child.type === "link_close") depth--;
    else if (child.type === "code_inline" && depth === 0) {
      const href = codeLinks(child.content);
      if (!href || linked.has(href)) continue;
      linked.add(href);
      child.type = "html_inline";
      child.content = `<a href="${escapeHtml(href)}"><code>${escapeHtml(child.content)}</code></a>`;
    }
  }
}

/** Renders a document of the repository by its path from the root, such as `docs/api.md`. */
export async function renderSource(source: string, transform: (text: string) => string = (text) => text, options: RenderOptions = {}): Promise<RenderedDoc> {
  const md = await markdown();
  const text = transform(readRepositoryFile(source));
  const tokens = md.parse(text, {});
  const slugger = new GithubSlugger();
  const toc: TocEntry[] = [];
  let title = "";
  let description = "";
  let linked = new Set<string>();
  for (const [index, token] of tokens.entries()) {
    if (token.type === "heading_open") {
      const content = inlineText(tokens[index + 1]);
      const id = slugger.slug(content);
      token.attrSet("id", id);
      if (token.tag === "h1" && !title) title = content;
      if (token.tag === "h2" || token.tag === "h3") toc.push({ id, text: content, level: Number(token.tag.slice(1)) });
      if (token.tag === "h2") linked = new Set();
    } else if (token.type === "paragraph_open" && !description) {
      description = summary(inlineText(tokens[index + 1]));
    } else if (token.type === "inline") {
      for (const child of token.children ?? []) {
        if (child.type !== "link_open") continue;
        const href = child.attrGet("href");
        if (typeof href === "string" && href) child.attrSet("href", rewriteHref(href, source));
      }
      if (options.codeLinks && tokens[index - 1]?.type !== "heading_open") linkCode(token, options.codeLinks, linked);
    }
  }
  const html = trustHtml(md.renderer.render(tokens, md.options, {}));
  return { title: title || source, description, html, toc, source, editUrl: githubUrl(source, "edit") };
}

const headingCache = new Map<string, Promise<ReadonlyMap<string, string>>>();

/** Text of every heading of a document by its id, the same ids as {@link renderSource} writes. */
export function documentHeadings(source: string): Promise<ReadonlyMap<string, string>> {
  let headings = headingCache.get(source);
  if (!headings) {
    headings = markdown().then((md) => {
      const tokens = md.parse(readRepositoryFile(source), {});
      const slugger = new GithubSlugger();
      const found = new Map<string, string>();
      for (const [index, token] of tokens.entries()) {
        if (token.type === "heading_open") {
          const content = inlineText(tokens[index + 1]);
          found.set(slugger.slug(content), content);
        }
        // An explicit `<a id="…">` is an anchor too; its label is the start of the text it opens.
        const html = token.type === "html_block" ? [token.content] : token.type === "inline" ? (token.children ?? []).filter((child) => child.type === "html_inline").map((child) => child.content) : [];
        for (const fragment of html) {
          for (const match of fragment.matchAll(/<a\s[^>]*\bid="([^"]+)"/g)) {
            const label = token.type === "inline" ? inlineText(token).trim().split(/(?<=\.)\s/)[0]!.replace(/\.$/, "") : match[1]!;
            if (!found.has(match[1]!)) found.set(match[1]!, label || match[1]!);
          }
        }
      }
      return found;
    });
    headingCache.set(source, headings);
  }
  return headings;
}

/**
 * Renders Markdown written outside the documents, such as the JSDoc of an export, whose links are
 * relative to `source`. Raw HTML is escaped.
 */
export async function renderFragment(text: string, source: string): Promise<TrustedHtml> {
  const md = await markdown(false);
  const tokens = md.parse(text, {});
  for (const token of tokens) {
    if (token.type !== "inline") continue;
    for (const child of token.children ?? []) {
      if (child.type !== "link_open") continue;
      const href = child.attrGet("href");
      if (typeof href === "string" && href) child.attrSet("href", rewriteHref(href, source));
    }
  }
  return trustHtml(md.renderer.render(tokens, md.options, {}));
}

/** One line of Markdown as inline HTML, without a paragraph, such as a summary in a list. */
export async function renderInline(text: string): Promise<TrustedHtml> {
  return trustHtml((await markdown(false)).renderInline(text));
}
