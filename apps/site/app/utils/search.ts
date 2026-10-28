import { trustHtml } from "@meekojs/meeko";
import type { TrustedHtml } from "@meekojs/meeko";

/** A section of a page that matches the query. */
export interface SearchSection {
  readonly url: string;
  readonly title: string;
  /** HTML from Pagefind: the escaped text of the page with `<mark>` around the matches. */
  readonly excerpt: TrustedHtml;
}

/** A page that matches the query, with its best sections. */
export interface SearchResult {
  readonly url: string;
  readonly title: string;
  /** HTML from Pagefind, as in {@link SearchSection}. */
  readonly excerpt: TrustedHtml;
  readonly sections: readonly SearchSection[];
}

interface PagefindData {
  readonly url: string;
  readonly excerpt: string;
  readonly meta?: { readonly title?: string };
  readonly sub_results?: ReadonlyArray<{ readonly url: string; readonly title: string; readonly excerpt: string }>;
}

interface Pagefind {
  init?(): Promise<void>;
  options?(options: Record<string, unknown>): Promise<void>;
  search(query: string): Promise<{ readonly results: ReadonlyArray<{ data(): Promise<PagefindData> }> } | null>;
}

/** Where `postbuild` writes the Pagefind bundle, next to the prerendered pages. */
const bundle = "/pagefind/pagefind.js";
let pagefind: Promise<Pagefind> | undefined;

/** Pagefind addresses `docs/api/index.html` as `/docs/api/`; the site's routes have no trailing slash. */
function siteUrl(url: string): string {
  return url.replace(/\/index\.html(?=#|$)/, "/").replace(/(.)\/(?=#|$)/, "$1");
}

/** Loads the Pagefind bundle of the build. It only exists after `pnpm run build`. */
function load(): Promise<Pagefind> {
  pagefind ??= (import(/* @vite-ignore */ bundle) as Promise<Pagefind>).then(async (module) => {
    await module.options?.({ excerptLength: 24 });
    await module.init?.();
    return module;
  });
  pagefind.catch(() => { pagefind = undefined; });
  return pagefind;
}

/** Starts loading the index, such as when the search opens. */
export function preloadSearch(): void {
  load().catch(() => {});
}

/**
 * An excerpt of Pagefind as trusted HTML. The index is built by `postbuild` from the prerendered
 * pages of this site, never from visitors, and Pagefind escapes `<` and `>` of the indexed text
 * before it adds the `<mark>` around the matches, so the query itself never becomes markup.
 */
function excerptHtml(excerpt: string): TrustedHtml {
  return trustHtml(excerpt);
}

/** The first `limit` pages that match `query`, with up to three sections each. */
export async function searchDocs(query: string, limit = 8): Promise<SearchResult[]> {
  const engine = await load();
  const response = await engine.search(query);
  const pages = await Promise.all((response?.results ?? []).slice(0, limit).map((result) => result.data()));
  return pages.map((page) => ({
    url: siteUrl(page.url),
    title: page.meta?.title ?? siteUrl(page.url),
    excerpt: excerptHtml(page.excerpt),
    sections: (page.sub_results ?? [])
      // The first section is often the page heading itself.
      .filter((section) => siteUrl(section.url) !== siteUrl(page.url) && section.title !== page.meta?.title)
      .slice(0, 3)
      .map((section) => ({ url: siteUrl(section.url), title: section.title, excerpt: excerptHtml(section.excerpt) })),
  }));
}
