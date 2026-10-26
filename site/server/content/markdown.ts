import { existsSync, statSync } from "node:fs";
import { join, posix } from "node:path";
import GithubSlugger from "github-slugger";
import markdownIt from "markdown-it";
import type { MarkdownIt, Token } from "markdown-it";
import type { RenderedDoc, TocEntry } from "../../shared/types/docs.js";
import { pageOfSource } from "./catalog.js";
import { blockLanguage, createHighlight } from "./highlight.js";
import { githubUrl, readRepositoryFile, repositoryRoot, repositoryUrl } from "./repository.js";

const blobPrefix = `${repositoryUrl}/blob/main/`;
const treePrefix = `${repositoryUrl}/tree/main/`;

/** Plain text of an inline token: its text and inline code, without markup. */
function inlineText(token: Token | undefined): string {
  return (token?.children ?? []).map((child) => child.type === "text" || child.type === "code_inline" ? child.content : "").join("").trim();
}

/** `x.md#y` → `/docs/x#y`, `README.md` → `/`, other repository files → GitHub. */
export function rewriteHref(href: string, from: string): string {
  if (/^(?:#|mailto:)/.test(href)) return href;
  let path: string;
  if (href.startsWith(blobPrefix) || href.startsWith(treePrefix)) {
    path = href.slice(href.startsWith(blobPrefix) ? blobPrefix.length : treePrefix.length);
  } else if (/^[a-z][a-z\d+.-]*:/i.test(href) || href.startsWith("//") || href.startsWith("/")) {
    return href;
  } else {
    path = posix.normalize(posix.join(posix.dirname(from), href));
    if (path.startsWith("../")) return href;
  }
  const hashAt = path.indexOf("#");
  const hash = hashAt < 0 ? "" : path.slice(hashAt);
  const file = decodeURI(hashAt < 0 ? path : path.slice(0, hashAt)).replace(/\/$/, "");
  const page = pageOfSource(file);
  if (page) return `${page}${hash}`;
  const absolute = join(repositoryRoot(), ...file.split("/"));
  const folder = existsSync(absolute) && statSync(absolute).isDirectory();
  return `${githubUrl(file, folder ? "tree" : "blob")}${hash}`;
}

/** Shortens text to about `limit` characters, at a word boundary. */
function summary(text: string, limit = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= limit) return clean;
  const cut = clean.slice(0, limit);
  return `${cut.slice(0, cut.lastIndexOf(" ")).replace(/[,;:.]$/, "")}…`;
}

let renderer: Promise<MarkdownIt> | undefined;

/**
 * The Markdown renderer of the site: GitHub-compatible heading ids with anchors, tables in a
 * scrolling wrapper and code blocks highlighted with Shiki, under a header with a copy button.
 */
function markdown(): Promise<MarkdownIt> {
  renderer ??= (async () => {
    const highlight = await createHighlight();
    // The documents are this repository's own trusted content, so their raw HTML is kept.
    const md = markdownIt({ html: true, linkify: false, typographer: false });
    md.renderer.rules.fence = (tokens, index) => {
      const token = tokens[index]!;
      const code = token.content.replace(/\n$/, "");
      const { lang, label } = blockLanguage(token.info, code);
      return `<div class="code-block" data-lang="${md.utils.escapeHtml(label)}"><div class="code-head" data-pagefind-ignore><span class="code-lang">${md.utils.escapeHtml(label)}</span><button type="button" class="code-copy" data-copy>Copiar</button></div>${highlight(code, lang)}</div>\n`;
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
  return renderer;
}

/** Renders a document of the repository by its path from the root, such as `docs/api.md`. */
export async function renderSource(source: string, transform: (text: string) => string = (text) => text): Promise<RenderedDoc> {
  const md = await markdown();
  const text = transform(readRepositoryFile(source));
  const tokens = md.parse(text, {});
  const slugger = new GithubSlugger();
  const toc: TocEntry[] = [];
  let title = "";
  let description = "";
  for (const [index, token] of tokens.entries()) {
    if (token.type === "heading_open") {
      const content = inlineText(tokens[index + 1]);
      const id = slugger.slug(content);
      token.attrSet("id", id);
      if (token.tag === "h1" && !title) title = content;
      if (token.tag === "h2" || token.tag === "h3") toc.push({ id, text: content, level: Number(token.tag.slice(1)) });
    } else if (token.type === "paragraph_open" && !description) {
      description = summary(inlineText(tokens[index + 1]));
    } else if (token.type === "inline") {
      for (const child of token.children ?? []) {
        if (child.type !== "link_open") continue;
        const href = child.attrGet("href");
        if (typeof href === "string" && href) child.attrSet("href", rewriteHref(href, source));
      }
    }
  }
  const html = md.renderer.render(tokens, md.options, {});
  return { title: title || source, description, html, toc, source, editUrl: githubUrl(source, "edit") };
}
