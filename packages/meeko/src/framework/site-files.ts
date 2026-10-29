import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MeekoConfig, RobotsConfig, SitemapConfig, SitemapEntriesContext, SitemapEntry } from "./config-type.js";
import type { PrerenderIndex } from "./prerender.js";
import { routeBlockFile } from "./route-block.js";
import { href, matchRoute } from "./router.js";
import type { RouteRecord } from "./router.js";

/** `sitemap` and `robots` of the configuration with their defaults; absent when off. */
export interface SiteFilesOptions {
  readonly sitemap?: SitemapConfig;
  readonly robots?: RobotsConfig;
}

export function siteFilesOptions(config: MeekoConfig): SiteFilesOptions {
  const sitemap = config.sitemap === true ? {} : config.sitemap || undefined;
  const robots = config.robots === true ? {} : config.robots || undefined;
  return { ...(sitemap ? { sitemap } : {}), ...(robots ? { robots } : {}) };
}

function hasParams(id: string): boolean {
  return /\[(?:\.\.\.)?[A-Za-z_$][\w$]*\]/.test(id);
}

/** `exclude` patterns as one test: `*` is any run of characters, `/` included. */
function excluded(patterns: readonly string[]): (pathname: string) => boolean {
  const tests = patterns.map((pattern) => new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`));
  return (pathname) => tests.some((test) => test.test(pathname));
}

/** Whether a stored document asks robots not to index it (`<meta name="robots" content="noindex">`). */
function noindex(html: string): boolean {
  for (const [tag] of html.matchAll(/<meta\b[^>]*>/gi)) {
    if (!/\bname\s*=\s*["']?(?:robots|googlebot)["'\s>/]/i.test(tag)) continue;
    if (/\bcontent\s*=\s*["'][^"']*\b(?:noindex|none)\b/i.test(tag)) return true;
  }
  return false;
}

/** The optional sitemaps.org fields of a URL, validated and serialized. */
export interface SitemapUrlFields {
  readonly lastmod?: string;
  readonly changefreq?: NonNullable<SitemapEntry["changefreq"]>;
  readonly priority?: number;
}

/** A URL of `sitemap.xml`: its pathname and optional fields. */
export interface SitemapUrl extends SitemapUrlFields {
  readonly pathname: string;
}

/** A URL that `sitemapEntries` of a route declared, with the route that declared it. */
export interface DeclaredSitemapUrl extends SitemapUrl {
  /** Route ID. */
  readonly route: string;
  /** Whether the route is `render: "prerender"`: its URLs must be prerendered pages. */
  readonly prerender: boolean;
}

const changefreqs: ReadonlySet<unknown> = new Set(["always", "hourly", "daily", "weekly", "monthly", "yearly", "never"]);
/** W3C Datetime, the format of `<lastmod>`: a date, or a date and time with its time zone. */
const w3cDatetime = /^\d{4}(?:-\d{2}(?:-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2}))?)?)?$/;

function entryFields(entry: SitemapEntry, label: string): SitemapUrlFields {
  const fields: { lastmod?: string; changefreq?: NonNullable<SitemapUrlFields["changefreq"]>; priority?: number } = {};
  if (entry.lastmod !== undefined) {
    if (entry.lastmod instanceof Date) {
      if (Number.isNaN(entry.lastmod.getTime())) throw new Error(`${label}: lastmod is an invalid Date`);
      fields.lastmod = entry.lastmod.toISOString();
    } else if (typeof entry.lastmod === "string" && w3cDatetime.test(entry.lastmod) && !Number.isNaN(Date.parse(entry.lastmod))) {
      fields.lastmod = entry.lastmod;
    } else {
      throw new Error(`${label}: lastmod must be a Date or a W3C Datetime text, such as "2026-10-01" or "2026-10-01T12:00:00Z"`);
    }
  }
  if (entry.changefreq !== undefined) {
    if (!changefreqs.has(entry.changefreq)) throw new Error(`${label}: changefreq must be always, hourly, daily, weekly, monthly, yearly or never`);
    fields.changefreq = entry.changefreq;
  }
  if (entry.priority !== undefined) {
    if (typeof entry.priority !== "number" || !(entry.priority >= 0 && entry.priority <= 1)) throw new Error(`${label}: priority must be a number from 0 to 1`);
    fields.priority = entry.priority;
  }
  return fields;
}

/**
 * IDs of the routes whose options (sidecar or `<script server>`) name `sitemapEntries`, read
 * without executing them: the build loads only those modules to evaluate it. The option must be
 * written in the options, like `render`, not brought in by a spread.
 */
export async function sitemapEntryRoutes(routes: readonly RouteRecord[]): Promise<Set<string>> {
  const ids = new Set<string>();
  for (const route of routes) {
    if (!route.sidecar) continue;
    const file = routeBlockFile(route.sidecar) ?? route.sidecar;
    let source: string;
    try { source = await readFile(file, "utf8"); }
    catch { continue; }
    if (/\bsitemapEntries\b/.test(source)) ids.add(route.id);
  }
  return ids;
}

/** Route options as `sitemapEntries` reads them; any other key is ignored. */
interface SitemapRouteOptions {
  readonly render?: unknown;
  readonly sitemapEntries?: unknown;
}

/**
 * Evaluates `sitemapEntries` of the routes in `declared` (their IDs) with the build's `context`
 * and returns their URLs. Each URL must belong to its route and appear once.
 * @throws {Error} For a `render: "client"` route, an invalid entry, a URL that another route shadows
 * or a repeated URL; the message names the route.
 */
export async function collectSitemapEntries(options: {
  readonly routes: readonly RouteRecord[];
  readonly declared: ReadonlySet<string>;
  readonly loadRoute: (key: string) => Promise<unknown>;
  readonly context: SitemapEntriesContext;
}): Promise<DeclaredSitemapUrl[]> {
  const urls = new Map<string, DeclaredSitemapUrl>();
  for (const route of options.routes) {
    if (!route.sidecar || !options.declared.has(route.id)) continue;
    const loaded = await options.loadRoute(route.sidecar) as SitemapRouteOptions | undefined;
    const declared = loaded?.sitemapEntries;
    if (declared === undefined) continue;
    const render = route.render ?? loaded?.render;
    if (render === "client") throw new Error(`Route ${route.id} uses render: "client" and cannot declare sitemapEntries`);
    const entries = typeof declared === "function" ? await (declared as (context: SitemapEntriesContext) => unknown)(options.context) : declared;
    if (!Array.isArray(entries)) throw new Error(`sitemapEntries of route ${route.id} must be a list of { params, lastmod, changefreq, priority }, or a function that returns one`);
    for (const entry of entries as unknown[]) {
      if (typeof entry !== "object" || entry === null || Array.isArray(entry)) throw new Error(`sitemapEntries of route ${route.id}: each entry is an object such as { params: { slug: "a" } }`);
      const { params } = entry as SitemapEntry;
      const pathname = href(options.routes, route.id, params ? { params } : {});
      const label = `sitemapEntries of route ${route.id} (${pathname})`;
      if (matchRoute(options.routes, pathname)?.route !== route) throw new Error(`${label}: the URL is shadowed by another route`);
      if (urls.has(pathname)) throw new Error(`${label}: duplicate sitemap URL`);
      urls.set(pathname, { pathname, route: route.id, prerender: render === "prerender", ...entryFields(entry as SitemapEntry, label) });
    }
  }
  return [...urls.values()];
}

/**
 * The URLs of `sitemap.xml`: every prerendered page that does not ask for `noindex`, every route
 * without parameters (rendered on request or in the browser) and, since 1.7, the URLs of
 * `sitemapEntries`, less the excluded ones. A declared URL adds its fields to the page with its
 * pathname; one of a `render: "prerender"` route must be a prerendered page. Sorted by pathname.
 */
export async function sitemapUrls(options: {
  readonly index: PrerenderIndex;
  readonly prerenderDirectory: string;
  readonly routes: readonly RouteRecord[];
  readonly exclude?: readonly string[];
  readonly declared?: readonly DeclaredSitemapUrl[];
}): Promise<SitemapUrl[]> {
  const skip = excluded(options.exclude ?? []);
  const urls = new Map<string, SitemapUrl>();
  const hidden = new Set<string>();
  for (const [pathname, page] of Object.entries(options.index.pages)) {
    const html = await readFile(join(options.prerenderDirectory, ...page.file.split("/")), "utf8");
    if (noindex(html)) hidden.add(pathname);
    else urls.set(pathname, { pathname });
  }
  const prerendered = new Set(Object.keys(options.index.pages));
  for (const route of options.routes) {
    if (hasParams(route.id) || route.render === "prerender") continue;
    const pathname = href(options.routes, route.id);
    if (!prerendered.has(pathname)) urls.set(pathname, { pathname });
  }
  for (const { route, prerender, ...url } of options.declared ?? []) {
    if (prerender && !prerendered.has(url.pathname)) {
      throw new Error(`sitemapEntries of route ${route} lists ${url.pathname}, which is not prerendered: add it to prerenderEntries or remove it`);
    }
    // A page that asks for noindex stays out, even when it is declared.
    if (!hidden.has(url.pathname)) urls.set(url.pathname, url);
  }
  return [...urls.values()].filter((url) => !skip(url.pathname))
    .sort((left, right) => left.pathname < right.pathname ? -1 : left.pathname > right.pathname ? 1 : 0);
}

/** The pathnames of `sitemap.xml`; see {@link sitemapUrls}, which also returns their fields. */
export async function sitemapPathnames(options: Parameters<typeof sitemapUrls>[0]): Promise<string[]> {
  return (await sitemapUrls(options)).map((url) => url.pathname);
}

function xmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/**
 * A sitemap of absolute URLs (`origin` + pathname), as the sitemaps.org protocol 0.9 describes,
 * with `<lastmod>`, `<changefreq>` and `<priority>` when a URL has them.
 */
export function sitemapXml(origin: string, urls: readonly (string | SitemapUrl)[]): string {
  const lines = urls.map((value) => {
    const url: SitemapUrl = typeof value === "string" ? { pathname: value } : value;
    const fields = [
      `<loc>${xmlText(new URL(url.pathname, origin).href)}</loc>`,
      ...url.lastmod === undefined ? [] : [`<lastmod>${xmlText(url.lastmod)}</lastmod>`],
      ...url.changefreq === undefined ? [] : [`<changefreq>${url.changefreq}</changefreq>`],
      ...url.priority === undefined ? [] : [`<priority>${url.priority}</priority>`],
    ];
    return `  <url>${fields.join("")}</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${lines.join("\n")}${lines.length ? "\n" : ""}</urlset>\n`;
}

/** `robots.txt` for every user agent, with the sitemap's absolute URL when there is one. */
export function robotsTxt(options: RobotsConfig, sitemapUrl: string | undefined): string {
  const allow = options.allow ?? (options.disallow?.length ? [] : ["/"]);
  const lines = ["User-agent: *", ...allow.map((path) => `Allow: ${path}`), ...(options.disallow ?? []).map((path) => `Disallow: ${path}`)];
  return `${lines.join("\n")}\n${sitemapUrl ? `\nSitemap: ${sitemapUrl}\n` : ""}`;
}
