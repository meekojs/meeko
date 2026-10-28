import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { MeekoConfig, RobotsConfig, SitemapConfig } from "./config-type.js";
import type { PrerenderIndex } from "./prerender.js";
import { href } from "./router.js";
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

/**
 * The pathnames of `sitemap.xml`: every prerendered page that does not ask for `noindex`, and every
 * route without parameters (rendered on request or in the browser), less the excluded ones. Sorted.
 */
export async function sitemapPathnames(options: {
  readonly index: PrerenderIndex;
  readonly prerenderDirectory: string;
  readonly routes: readonly RouteRecord[];
  readonly exclude?: readonly string[];
}): Promise<string[]> {
  const skip = excluded(options.exclude ?? []);
  const pathnames = new Set<string>();
  for (const [pathname, page] of Object.entries(options.index.pages)) {
    const html = await readFile(join(options.prerenderDirectory, ...page.file.split("/")), "utf8");
    if (!noindex(html)) pathnames.add(pathname);
  }
  const prerendered = new Set(Object.keys(options.index.pages));
  for (const route of options.routes) {
    if (hasParams(route.id) || route.render === "prerender") continue;
    const pathname = href(options.routes, route.id);
    if (!prerendered.has(pathname)) pathnames.add(pathname);
  }
  return [...pathnames].filter((pathname) => !skip(pathname)).sort();
}

function xmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

/** A sitemap of absolute URLs (`origin` + pathname), as the sitemaps.org protocol 0.9 describes. */
export function sitemapXml(origin: string, pathnames: readonly string[]): string {
  const urls = pathnames.map((pathname) => `  <url><loc>${xmlText(new URL(pathname, origin).href)}</loc></url>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}${urls.length ? "\n" : ""}</urlset>\n`;
}

/** `robots.txt` for every user agent, with the sitemap's absolute URL when there is one. */
export function robotsTxt(options: RobotsConfig, sitemapUrl: string | undefined): string {
  const allow = options.allow ?? (options.disallow?.length ? [] : ["/"]);
  const lines = ["User-agent: *", ...allow.map((path) => `Allow: ${path}`), ...(options.disallow ?? []).map((path) => `Disallow: ${path}`)];
  return `${lines.join("\n")}\n${sitemapUrl ? `\nSitemap: ${sitemapUrl}\n` : ""}`;
}
