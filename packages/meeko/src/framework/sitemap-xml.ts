import type { SitemapResolvedUrl } from '../modules/define-meeko-module'

// No Node imports: `@meekojs/meeko/framework` also loads in the browser and in Workers.

function xmlText(value: string): string {
	return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

const hreflangPattern = /^(?:x-default|[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*)$/

/** `<xhtml:link rel="alternate">` of each language version of a URL, validated. */
function alternateLinks(origin: string, url: SitemapResolvedUrl): string[] {
	return (url.alternates ?? []).map((alternate) => {
		if (typeof alternate?.hreflang !== 'string' || !hreflangPattern.test(alternate.hreflang)) {
			throw new Error(`sitemap: ${url.pathname} has an invalid hreflang ${String(alternate?.hreflang)}`)
		}
		if (typeof alternate.pathname !== 'string' || !alternate.pathname.startsWith('/')) {
			throw new Error(`sitemap: the ${alternate.hreflang} alternate of ${url.pathname} must be a pathname that starts with /`)
		}
		return `<xhtml:link rel="alternate" hreflang="${alternate.hreflang}" href="${xmlText(new URL(alternate.pathname, origin).href).replaceAll('"', '&quot;')}"/>`
	})
}

/**
 * Escribe un sitemap (protocolo sitemaps.org 0.9) con URL absolutas: `origin` más cada ruta, con
 * `<lastmod>`, `<changefreq>` y `<priority>` cuando la URL los tiene y un
 * `<xhtml:link rel="alternate" hreflang>` por cada una de sus `alternates`, con el espacio de nombres
 * `xhtml` sólo si alguna los usa. Escapa el XML y no ordena las URL. Es la misma función con la que
 * `meeko build` escribe `sitemap.xml`; úsala cuando el sitemap se sirve desde una base de datos
 * (`sitemap: false` en la configuración), sin escribir el XML a mano.
 *
 * @param origin Origen público, como `"https://example.com"`.
 * @param urls Rutas (`pathname`) o URL con sus campos y versiones en otros idiomas.
 * @returns El documento XML.
 * @throws {Error} Si una alternativa tiene un `hreflang` inválido o un `pathname` que no empieza por `/`.
 * @since 1.8.0
 * @example
 * ```ts
 * // server/middleware/sitemap.ts
 * import { sitemapXml } from "@meekojs/meeko/framework";
 * import { defineServerMiddleware } from "@meekojs/meeko/server";
 *
 * export default defineServerMiddleware(async (request, next) => {
 *   if (new URL(request.url).pathname !== "/sitemap.xml") return next(request);
 *   const pages = await db.pages.list();
 *   const xml = sitemapXml("https://example.com", pages.map((page) => ({
 *     pathname: page.path,
 *     lastmod: page.updatedAt,
 *     alternates: [
 *       { hreflang: "es", pathname: page.path },
 *       { hreflang: "en", pathname: `/en${page.path}` },
 *       { hreflang: "x-default", pathname: page.path },
 *     ],
 *   })));
 *   return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8" } });
 * });
 * ```
 */
export function sitemapXml(origin: string, urls: readonly (string | SitemapResolvedUrl)[]): string {
	let localized = false
	const lines = urls.map((value) => {
		const url: SitemapResolvedUrl = typeof value === 'string' ? { pathname: value } : value
		const links = alternateLinks(origin, url)
		if (links.length) localized = true
		const fields = [
			`<loc>${xmlText(new URL(url.pathname, origin).href)}</loc>`,
			...(url.lastmod === undefined ? [] : [`<lastmod>${xmlText(url.lastmod)}</lastmod>`]),
			...(url.changefreq === undefined ? [] : [`<changefreq>${url.changefreq}</changefreq>`]),
			...(url.priority === undefined ? [] : [`<priority>${url.priority}</priority>`]),
			...links,
		]
		return `  <url>${fields.join('')}</url>`
	})
	const namespaces = `xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"${localized ? ' xmlns:xhtml="http://www.w3.org/1999/xhtml"' : ''}`
	return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${namespaces}>\n${lines.join('\n')}${lines.length ? '\n' : ''}</urlset>\n`
}
