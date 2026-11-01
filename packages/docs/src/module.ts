import { defineMeekoModule } from '@meekojs/meeko/framework'
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
			// La moderación en JSON, sin caché, que el navegador vuelve a pedir tras cada navegación.
			meeko.addServerHandler({ route: moderationEndpoint(site), handler: new URL('./runtime/endpoint.ts', import.meta.url) })
			// Vistas por beacon y estado del widget «¿Te sirvió?» (DATABASE_URL, DOCS_METRICS).
			meeko.addPlugin({ src: new URL('./metrics/plugin.ts', import.meta.url) })
		}
	},
})
