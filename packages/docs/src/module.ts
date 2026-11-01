import type {} from '@meekojs/i18n/module'
import type { MeekoModuleContext } from '@meekojs/meeko/framework'

import { defineMeekoModule } from '@meekojs/meeko/framework'
import { docsLocales } from 'meeko-docs-content/locale'
import { moderationEndpoint } from 'meeko-docs-content/moderation/shared'

/** Opciones del módulo en `meeko.config.ts`: `modules: ['meeko-docs']` y `docs: { site: 'ui' }`. */
export interface DocsModuleOptions {
	/**
	 * La web en la base de documentación (`ui` o `i18n`). Con ella, el Shell aplica la moderación
	 * del dashboard (páginas ocultas y destacadas) y muestra sus avisos, leídos de `DATABASE_URL`;
	 * sin ella, o sin base de datos, la web funciona igual sin moderación. También activa las
	 * métricas (vistas, búsquedas del filtro y «¿Te sirvió?»), que `DOCS_METRICS=off` desactiva;
	 * la web declara sus endpoints en `server/api/docs/*.post.ts`.
	 */
	readonly site?: 'i18n' | 'ui'
}

declare module '@meekojs/meeko/framework' {
	interface MeekoConfig {
		/** Opciones de `meeko-docs`, que se registra con `modules: ['meeko-docs']`. */
		readonly docs?: DocsModuleOptions
	}
}

/** Base documental privada del monorepo; no forma parte de los paquetes publicados. */
export default defineMeekoModule<DocsModuleOptions>({
	meta: { name: 'meeko-docs', configKey: 'docs', compatibility: { meeko: '>=1.7 <2' } },
	setup(options, meeko) {
		meeko.addComponentsDir(new URL('./app/components', import.meta.url))
		meeko.addStylesheet(new URL('./app/styles/docs.css', import.meta.url))
		const site = options?.site
		if (site !== undefined) {
			if (site !== 'ui' && site !== 'i18n') throw new TypeError(`meeko-docs: site must be "ui" or "i18n", not ${String(site)}`)
			meeko.addPlugin({ src: new URL('./runtime/moderation.server.ts', import.meta.url), options: { site } })
			// La moderación en JSON por idioma (`/en` para el inglés), sin caché, que el navegador vuelve a
			// pedir tras cada navegación.
			for (const locale of docsLocales) meeko.addServerHandler({ route: moderationEndpoint(site, locale), handler: new URL('./runtime/endpoint.ts', import.meta.url) })
			// Vistas por beacon y estado del widget «¿Te sirvió?» (DATABASE_URL, DOCS_METRICS).
			meeko.addPlugin({ src: new URL('./metrics/plugin.ts', import.meta.url) })
			addModeratedSitemap(meeko, site)
		}
	},
})

const sitemapModule = 'virtual:meeko-docs-sitemap'
const resolvedSitemapModule = `\0${sitemapModule}`

/**
 * `/sitemap.xml` servido con la moderación vigente (`./runtime/sitemap.ts`), con las URL de las rutas
 * sin parámetros. Un archivo de `sitemap: true` se serviría antes que este handler, sin moderación y
 * para siempre, así que la opción es un error. Sin origen público no hay sitemap, como en `meeko build`.
 */
function addModeratedSitemap(meeko: MeekoModuleContext, site: 'i18n' | 'ui'): void {
	if (meeko.config.sitemap) throw new TypeError('meeko-docs: with docs.site, the module serves /sitemap.xml with the moderation in force: remove sitemap from meeko.config.ts')
	const origin = meeko.config.site ?? process.env.MEEKO_PUBLIC_ORIGIN
	if (!origin) return
	const i18n = meeko.config.i18n
	const locales = i18n ? Object.keys(i18n.catalogs) : docsLocales
	let pathnames: readonly string[] = []
	meeko.hooks.hook('routes:resolved', ({ routes }) => {
		pathnames = routes
			.map((route) => route.id)
			.filter((id) => !id.includes('['))
			.sort()
	})
	meeko.addVitePlugin({
		name: 'meeko-docs:sitemap',
		resolveId: (id: string) => (id === sitemapModule ? resolvedSitemapModule : undefined),
		load(id: string) {
			if (id !== resolvedSitemapModule) return undefined
			const values = { site, origin: new URL(origin).origin, locales, defaultLocale: i18n?.defaultLocale ?? 'es', pathnames }
			return Object.entries(values)
				.map(([name, value]) => `export const ${name} = ${JSON.stringify(value)};`)
				.join('\n')
		},
	})
	meeko.addServerHandler({ route: '/sitemap.xml', handler: new URL('./runtime/sitemap.ts', import.meta.url) })
}
