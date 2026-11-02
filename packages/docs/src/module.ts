import type {} from '@meekojs/i18n/module'
import type { MeekoModuleContext } from '@meekojs/meeko/framework'
import type * as CodeTags from 'meeko-docs-content/content/code-tags'
import type * as Highlight from 'meeko-docs-content/content/highlight'

import { defineMeekoModule } from '@meekojs/meeko/framework'
import { docsLocales } from 'meeko-docs-content/locale'
import { moderationEndpoint } from 'meeko-docs-content/moderation/shared'

import type * as ImportedValues from './imported-values'

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
		addCodeHighlighting(meeko)
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

/**
 * Highlights the code of `<DocsCode>` while building, with the same Shiki as the documentation of
 * the site (`meeko-docs-content`). Shiki stays out of the bundles: it reads the grammar of
 * `packages/vscode`, and a deployed web has neither that file nor the package. It loads the first
 * time a component uses the tag. The chunk of each page carries the HTML of its own blocks.
 */
function addCodeHighlighting(meeko: MeekoModuleContext): void {
	let tools: ReturnType<typeof loadCodeTools> | undefined
	const highlighted = new Map<string, { html: string; label: string }>()
	meeko.addVitePlugin({
		name: 'meeko-docs:code',
		// `order: 'pre'` runs before Meeko compiles the component: this hook sees the template source.
		transform: {
			order: 'pre',
			async handler(this: { addWatchFile(file: string): void }, code: string, id: string) {
				const file = id.split('?')[0]!
				if (!file.endsWith('.meeko') || !code.includes('<DocsCode')) return undefined
				const { blockLanguage, codeLanguage, createHighlight, importedValues, transformCodeTags, tsImport } = await (tools ??= loadCodeTools())
				const highlight = await createHighlight()
				const values = await importedValues(
					code,
					file,
					(module) => tsImport(module, import.meta.url),
					(source) => this.addWatchFile(source),
				)
				const result = transformCodeTags(code, file, {
					tag: 'DocsCode',
					evaluate(expression) {
						const [name, key] = expression.split('.')
						const value = name && key ? (values.get(name) as Record<string, unknown> | undefined)?.[key] : undefined
						return typeof value === 'string' ? value : undefined
					},
					highlight(text, label) {
						const cacheKey = `${label ?? ''}\0${text}`
						let block = highlighted.get(cacheKey)
						if (!block) {
							const language = blockLanguage(codeLanguage(text, label), text)
							block = { html: String(highlight(text, language.lang)), label: language.label }
							highlighted.set(cacheKey, block)
						}
						return block
					},
				})
				return result === undefined ? undefined : { code: result, map: null }
			},
		},
	})
}

/**
 * The highlighter and the tag transform of `meeko-docs-content` and the values of `./imported-values`,
 * whose TypeScript sources Node cannot load by itself because their relative imports have no
 * extension. Only a build or `meeko dev` get here, where the workspace has `tsx`; `meeko start` never
 * transforms a component.
 */
async function loadCodeTools() {
	const { tsImport } = await import('tsx/esm/api')
	const parent = import.meta.url
	const [{ blockLanguage, createHighlight }, { codeLanguage, transformCodeTags }, { importedValues }] = (await Promise.all([tsImport('meeko-docs-content/content/highlight', parent), tsImport('meeko-docs-content/content/code-tags', parent), tsImport(new URL('./imported-values.ts', parent).href, parent)])) as [typeof Highlight, typeof CodeTags, typeof ImportedValues]
	return { blockLanguage, codeLanguage, createHighlight, importedValues, transformCodeTags, tsImport }
}

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
