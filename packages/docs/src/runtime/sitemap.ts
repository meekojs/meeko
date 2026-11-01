import { localeAlternates, localeOf, stripLocale } from '@meekojs/i18n'
import { sitemapXml } from '@meekojs/meeko/framework'
import { isDocsLocale } from 'meeko-docs-content/locale'
import { isHiddenPath, readSiteModeration, revalidatedDocument } from 'meeko-docs-content/moderation'
import { defaultLocale, locales, origin, pathnames, site } from 'virtual:meeko-docs-sitemap'

/**
 * El handler de `/sitemap.xml` que añade el módulo con la opción `site`: las páginas de la web menos
 * las que la moderación oculta ahora mismo, en cada idioma, también como alternativas de las demás.
 * Cada petición lo calcula (la moderación lleva 30 s de caché) y `revalidatedDocument` obliga a
 * revalidarlo, así que una regla nueva llega sin otro build. Sin base de datos no oculta nada, como
 * las páginas, que entonces responden 200.
 *
 * @param request La petición de la ruta.
 * @returns El sitemap, o `405` para un método que no es `GET` ni `HEAD`.
 */
export default async function sitemapHandler(request: Request): Promise<Response> {
	if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, HEAD' } })
	const [es, en] = await Promise.all([readSiteModeration(site, { locale: 'es' }), readSiteModeration(site, { locale: 'en' })])
	const visible = new Set(
		pathnames.filter((pathname) => {
			const locale = localeOf(pathname, locales, defaultLocale)
			// A language without rules of its own (`/ar/playground`) follows the Spanish page, as the
			// aliases of the navigation do when the page answers 404.
			if (!isDocsLocale(locale)) return !isHiddenPath(es, stripLocale(pathname, locales))
			return !isHiddenPath(locale === 'en' ? en : es, pathname)
		}),
	)
	const routing = { locales, defaultLocale }
	const urls = [...visible].map((pathname) => ({ pathname, alternates: localeAlternates(pathname, routing, (version) => visible.has(version)) }))
	return revalidatedDocument(request, sitemapXml(origin, urls), 'application/xml; charset=utf-8')
}
